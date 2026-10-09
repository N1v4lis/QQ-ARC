using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

// A per-user installer. This build tool never installs or launches the app.
internal static class FirstLightSetup {
  const string Marker = "QQAFRS01";
  const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\QQARCFOX-__RS_SERIES__";
  static readonly string AppId = "QQARCFOX-__RS_SERIES__";
  [STAThread] static int Main(string[] args) {
    Application.EnableVisualStyles();
    try {
      if (args.Length == 1 && args[0] == "--verify") { using (var zip = Payload()) Validate(zip); return 0; }
      if (args.Length == 2 && args[0] == "--extract-test") {
        string testRoot = Path.GetFullPath(args[1]);
        if (!testRoot.Split(Path.DirectorySeparatorChar).Contains("_scratch")) throw new Exception("Test extraction must be inside _scratch.");
        using (var zip = Payload()) { Validate(zip); Extract(zip, testRoot); }
        return 0;
      }
      if (args.Length == 1 && args[0] == "--uninstall") { Uninstall(); return 0; }
      Application.Run(new SetupForm()); return 0;
    } catch (Exception e) { if (args.Length == 0) MessageBox.Show(e.Message, "QQAF Setup", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
  }
  static ZipArchive Payload() {
    string self = Application.ExecutablePath;
    using (var f = File.OpenRead(self)) {
      if (f.Length < 16) throw new Exception("Installer payload missing.");
      f.Position = f.Length - 16;
      var trailer = new byte[16]; ReadFully(f, trailer);
      if (Encoding.ASCII.GetString(trailer, 8, 8) != Marker) throw new Exception("Installer footer invalid.");
      long size = BitConverter.ToInt64(trailer, 0);
      if (size <= 0 || size > 512 * 1024 * 1024 || size > f.Length - 16) throw new Exception("Installer payload size invalid.");
      f.Position = f.Length - 16 - size;
      var data = new byte[(int)size]; ReadFully(f, data);
      return new ZipArchive(new MemoryStream(data, false), ZipArchiveMode.Read);
    }
  }
  static void ReadFully(Stream s, byte[] data) { int offset = 0; while (offset < data.Length) { int n = s.Read(data, offset, data.Length - offset); if (n == 0) throw new EndOfStreamException(); offset += n; } }
  static string Relative(ZipArchiveEntry e) {
    string name = e.FullName.Replace('/', Path.DirectorySeparatorChar);
    if (string.IsNullOrEmpty(name) || Path.IsPathRooted(name) || name.Contains(':') || name.Split(Path.DirectorySeparatorChar).Any(x => x == ".." || x == ".")) throw new Exception("Invalid archive path.");
    return name;
  }
  static void Validate(ZipArchive zip) {
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (var e in zip.Entries) if (!seen.Add(Relative(e))) throw new Exception("Duplicate archive entry.");
    var manifest = zip.GetEntry("package-manifest.json");
    if (manifest == null || zip.GetEntry("qqaf.exe") == null || zip.GetEntry("qqaf-native.exe") == null) throw new Exception("Incomplete app package.");
    object[] files;
    using (var reader = new StreamReader(manifest.Open(), Encoding.UTF8)) files = new JavaScriptSerializer().Deserialize<object[]>(reader.ReadToEnd());
    var expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "package-manifest.json", "verification.json" };
    foreach (var item in files) {
      var row = (Dictionary<string, object>)item;
      string name = (string)row["path"], hash = (string)row["sha256"];
      var e = zip.GetEntry(name);
      if (e == null) throw new Exception("Required file missing: " + name);
      expected.Add(name);
      string actual;
      using (var sha = SHA256.Create()) using (var stream = e.Open()) actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
      if (hash != actual || Convert.ToInt64(row["bytes"]) != e.Length) throw new Exception("Package integrity failed: " + name);
    }
    if (zip.Entries.Any(e => !expected.Contains(e.FullName))) throw new Exception("Unexpected package file.");
    var verified = zip.GetEntry("verification.json");
    if (verified == null) throw new Exception("Clean package report missing.");
    using (var reader = new StreamReader(verified.Open(), Encoding.UTF8)) {
      var report = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
      if (!(bool)report["verified"] || !(bool)report["cleanRelease"] || Convert.ToInt32(report["initialAccounts"]) != 0 || Convert.ToInt32(report["initialProviders"]) != 0 || Convert.ToInt32(report["initialPersonas"]) != 0) throw new Exception("Package is not a verified empty build.");
    }
  }
  static void Extract(ZipArchive zip, string target) {
    target = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar);
    if (Directory.Exists(target) && Directory.EnumerateFileSystemEntries(target).Any()) throw new Exception("Please choose an empty folder. Existing applications and data will not be overwritten.");
    Directory.CreateDirectory(target);
    foreach (var e in zip.Entries) {
      string file = Path.GetFullPath(Path.Combine(target, Relative(e)));
      if (!file.StartsWith(target + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("Archive entry escaped target folder.");
      Directory.CreateDirectory(Path.GetDirectoryName(file));
      using (var input = e.Open()) using (var output = new FileStream(file, FileMode.CreateNew)) input.CopyTo(output);
    }
  }
  static void Shortcut(string path, string executable, string directory) {
    var shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
    try {
      dynamic link = shell.GetType().InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { path });
      link.TargetPath = executable; link.WorkingDirectory = directory; link.IconLocation = executable + ",0"; link.Description = "QQARCFOX · __CODENAME__"; link.Save();
      System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);
    } finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); }
  }
  static string Install(string path, bool desktop) {
    string target = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar);
    string home = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    if (target == Path.GetPathRoot(target) || target == Path.GetFullPath(home)) throw new Exception("Choose a dedicated application folder.");
    // Reject any parent reparse point so extraction cannot be redirected into another directory.
    for (var parent = new DirectoryInfo(target); parent != null; parent = parent.Parent) if (parent.Exists && (parent.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("Installation folder cannot contain symbolic links.");
    using (var zip = Payload()) { Validate(zip); Extract(zip, target); }
    File.Copy(Application.ExecutablePath, Path.Combine(target, "Uninstall.exe"), false);
    File.WriteAllText(Path.Combine(target, "install-marker.json"), new JavaScriptSerializer().Serialize(new { appId = AppId, path = target, desktopShortcut = desktop }), Encoding.UTF8);
    string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "QQARCFOX __CODENAME__"); Directory.CreateDirectory(menu);
    Shortcut(Path.Combine(menu, "QQAF.lnk"), Path.Combine(target, "qqaf.exe"), target);
    Shortcut(Path.Combine(menu, "Uninstall.lnk"), Path.Combine(target, "Uninstall.exe"), target);
    // The uninstall shortcut needs the explicit command argument.
    dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
    try { dynamic link = shell.CreateShortcut(Path.Combine(menu, "Uninstall.lnk")); link.Arguments = "--uninstall"; link.Save(); System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link); }
    finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); }
    if (desktop) Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "QQAF __CODENAME__.lnk"), Path.Combine(target, "qqaf.exe"), target);
    using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey)) {
      k.SetValue("DisplayName", "QQARCFOX __RS_SERIES__ · __CODENAME__"); k.SetValue("DisplayVersion", "__VERSION__"); k.SetValue("Publisher", "QQARCFOX"); k.SetValue("InstallLocation", target);
      k.SetValue("DisplayIcon", Path.Combine(target, "qqaf.exe")); k.SetValue("UninstallString", "\"" + Path.Combine(target, "Uninstall.exe") + "\" --uninstall"); k.SetValue("NoModify", 1); k.SetValue("NoRepair", 1);
    }
    return target;
  }
  static void Uninstall() {
    string folder = Path.GetDirectoryName(Application.ExecutablePath), marker = Path.Combine(folder, "install-marker.json");
    if (!File.Exists(marker)) throw new Exception("Installer identity not found.");
    var item = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(marker, Encoding.UTF8));
    if ((string)item["appId"] != AppId || !string.Equals((string)item["path"], folder, StringComparison.OrdinalIgnoreCase)) throw new Exception("Uninstall folder invalid.");
    if (MessageBox.Show("卸载 QQAF 程序文件？账号、设置与其他用户数据将保留。请先退出 QQAF。", "QQAF", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
    if (Process.GetProcessesByName("qqaf").Any(p => { try { return p.MainModule.FileName.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase); } catch { return false; } })) throw new Exception("请先退出 QQAF。");
    using (var zip = Payload()) { Validate(zip); foreach (var e in zip.Entries) { string file = Path.GetFullPath(Path.Combine(folder, Relative(e))); if (file.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && File.Exists(file)) File.Delete(file); } }
    File.Delete(marker);
    string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "QQARCFOX __CODENAME__");
    foreach (string name in new[] { "QQAF.lnk", "Uninstall.lnk" }) { string f = Path.Combine(menu, name); if (File.Exists(f)) File.Delete(f); }
    if (Directory.Exists(menu) && !Directory.EnumerateFileSystemEntries(menu).Any()) Directory.Delete(menu);
    if ((bool)item["desktopShortcut"]) { string f = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "QQAF __CODENAME__.lnk"); if (File.Exists(f)) File.Delete(f); }
    Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
    MessageBox.Show("程序文件已卸载，用户数据保留。卸载器本身可手动删除。", "QQAF");
  }
  sealed class SetupForm : Form {
    bool installing;
    bool installed;
    readonly TextBox path = new TextBox(); readonly Button install = new Button(); readonly CheckBox desktop = new CheckBox(); readonly Label status = new Label();
    public SetupForm() {
      FormClosing += (s,e) => { if (installing) e.Cancel = true; };
      Text = "QQARCFOX · __CODENAME__ 安装"; ClientSize = new Size(600, 290); FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen;
      Font = new Font("Segoe UI", 10); Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
      Controls.Add(new Label { Text = "__CODENAME_UPPER__", Font = new Font("Segoe UI", 23, FontStyle.Bold), Location = new Point(24, 20), AutoSize = true });
      Controls.Add(new Label { Text = "__PHRASE__\nFlutter + Rust 实验版 · 全新空白配置", Location = new Point(26, 74), AutoSize = true });
      path.SetBounds(24, 131, 460, 28); path.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "QQARCFOX-__RS_SERIES__"); Controls.Add(path);
      var browse = new Button { Text = "选择…", Left = 494, Top = 129, Width = 80 }; browse.Click += (s,e) => { using (var d = new FolderBrowserDialog()) { d.Description = "选择专用的空安装目录"; if (d.ShowDialog() == DialogResult.OK) path.Text = d.SelectedPath; } }; Controls.Add(browse);
      desktop.Text = "创建桌面快捷方式"; desktop.SetBounds(24, 170, 250, 26); Controls.Add(desktop);
      status.SetBounds(24, 201, 550, 26); status.Text = "默认关闭窗口最小化到任务栏。不注册开机启动。"; Controls.Add(status);
      install.Text = "安装"; install.SetBounds(394, 245, 84, 30); install.Click += async (s,e) => {
        if (installed) { Close(); return; }
        installing = true; install.Enabled = false; path.Enabled = false; desktop.Enabled = false; status.Text = "正在校验并安装…";
        string destination = path.Text; bool shortcut = desktop.Checked;
        try { await Task.Run(() => Install(destination, shortcut)); status.Text = "安装完成。通过开始菜单或 qqaf.exe 启动。"; install.Text = "完成"; installed = true; install.Enabled = true; }
        catch (Exception ex) { status.Text = "安装失败"; MessageBox.Show(ex.Message, "QQAF", MessageBoxButtons.OK, MessageBoxIcon.Error); install.Enabled = true; path.Enabled = true; desktop.Enabled = true; }
        finally { installing = false; }
      }; Controls.Add(install);
      var cancel = new Button { Text = "关闭", Left = 490, Top = 245, Width = 84 }; cancel.Click += (s,e) => Close(); Controls.Add(cancel);
    }
  }
}
