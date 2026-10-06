// 截取真实窗口（不是页面）：验证"无边框窗口"必须看 OS 层的窗口，不能只看页面。
//
// 做法：用 .NET 的 PrintWindow / CopyFromScreen 按窗口句柄抓图。
//   · PrintWindow(flag=2, PW_RENDERFULLCONTENT) 能拿到被遮挡/未激活窗口的内容
//     （Electron 的 GPU 合成窗口必须用这个；flag=0 会得到一片黑）。
//   · 抓完裁出"顶部 120px"，用来肉眼确认**没有 Windows 标题栏与右上角三键**：
//     有标题栏时那一带会是浅色的系统条 + 三个按钮；无边框时就是页面自己的标题栏。
//
// 用法：node tools/shot-window.mjs [输出目录] [--title QQ Agent]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'shots/window');
const TITLE = (() => {
  const i = process.argv.indexOf('--title');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'QQ Agent';
})();

fs.mkdirSync(OUT, { recursive: true });
const full = path.join(OUT, 'window-full.png');
const crop = path.join(OUT, 'window-topbar.png');

const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq 'E:\\QQ Agent\\QQ Agent.exe' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output 'NO_WINDOW'; exit 2 }
Write-Output ("PID=" + $p.Id)
Write-Output ("TITLE=" + $p.MainWindowTitle)
$h = $p.MainWindowHandle
[W]::ShowWindow($h, 9) | Out-Null      # SW_RESTORE
[W]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 900
$r = New-Object W+RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
Write-Output ("RECT=" + $r.Left + "," + $r.Top + "," + $w + "," + $ht)
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
# flag 2 = PW_RENDERFULLCONTENT：Electron/Chromium 合成窗口必须用这个
[W]::PrintWindow($h, $dc, 2) | Out-Null
$g.ReleaseHdc($dc)
$g.Dispose()
$bmp.Save('${full.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
# 裁一条顶部（标题栏区域）
$ch = [Math]::Min(140, $ht)
$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $ch)
$top = $bmp.Clone($rect, $bmp.PixelFormat)
$top.Save('${crop.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose(); $top.Dispose()
Write-Output 'OK'
`;

const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
  encoding: 'utf8', windowsHide: true, timeout: 60_000
});
console.log(out.trim());
console.log(`\n完整窗口：${full}`);
console.log(`顶部裁切：${crop}`);
