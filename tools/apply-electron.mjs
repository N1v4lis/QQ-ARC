// 把工作区里改好的 Electron 外壳文件装进安装目录（app/electron/main.js、preload.cjs）。
//
// 为什么需要它：Electron 的 main.js / preload.cjs 是**进程启动时**从安装目录读的，
// 工作区里改好并不会自动生效。手工复制有三个坑：
//   1) 覆盖前没有备份 —— 装坏了回不去，用户就得重装；
//   2) 用编辑器「复制粘贴」会改字节 —— 这两个文件的换行风格并不一致
//      （main.js 是 CRLF、preload.cjs 是 LF），任何「读成字符串再写回」的步骤
//      都可能顺手把换行/编码统一掉，于是「逐字节一致」这条验收永远对不上；
//   3) 写到一半失败会留下半个文件，Electron 下次启动直接白屏，且旧文件已被毁。
// 对策：先备份 → 写临时文件 → 原子 rename 顶替 → 立刻回读校验 sha256，失败自动还原。
//
// 用法：
//   node tools/apply-electron.mjs                       # 预览（默认不写盘）
//   node tools/apply-electron.mjs --apply               # 备份并安装
//   node tools/apply-electron.mjs --rollback <时间戳>    # 回滚到那次安装之前的状态
//   node tools/apply-electron.mjs --list                # 列出全部备份
//   node tools/apply-electron.mjs --install-dir "D:\x"  # 指定别的安装目录
//
// 本脚本**只写文件**：不启动、不重启、不结束任何 QQ Agent 进程。
// 装完之后，正在运行的旧进程仍在跑旧代码；什么时候重启由人来决定（见文末提示）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── 受管文件表 ────────────────────────────────────────────────────────────
// src 相对工作区，dst 相对安装目录。装到 resources/app/electron/ 下是因为
// 安装版就是这个目录布局（resources/app 是真目录，不是 app.asar）。
const FILES = [
  { name: 'main.js', src: 'app/electron/main.js', dst: 'resources/app/electron/main.js' },
  { name: 'preload.cjs', src: 'app/electron/preload.cjs', dst: 'resources/app/electron/preload.cjs' }
];

const SCHEMA = 1;

function usage() {
  console.log(`用法：
  node tools/apply-electron.mjs [--apply] [--install-dir <目录>]
  node tools/apply-electron.mjs --rollback <时间戳>
  node tools/apply-electron.mjs --list`);
}

function parseArgs(argv) {
  const out = { apply: false, list: false, rollback: null, installDir: process.env.QQ_AGENT_INSTALL_DIR || 'E:\\QQ Agent' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--list') out.list = true;
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else if (a === '--rollback') { out.rollback = argv[i + 1]; i += 1; if (!out.rollback) { console.error('✗ --rollback 后面要跟时间戳，例如 20261003-221500'); process.exit(2); } }
    else if (a === '--install-dir') { out.installDir = argv[i + 1]; i += 1; if (!out.installDir) { console.error('✗ --install-dir 后面要跟目录'); process.exit(2); } }
    else { console.error('✗ 不认识的参数：' + a); usage(); process.exit(2); }
  }
  return out;
}

const BACKUP_ROOT = path.join(ROOT, '_backup');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function short(h) {
  return h ? h.slice(0, 12) : '(不存在)';
}

// 时间戳用本地时间、不含冒号（Windows 路径里不能用冒号）。
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function uniqueBackupDir(ts) {
  let dir = path.join(BACKUP_ROOT, `electron-${ts}`);
  let n = 2;
  while (fs.existsSync(dir)) { dir = path.join(BACKUP_ROOT, `electron-${ts}-${n}`); n += 1; }
  return dir;
}

// 只看「进程在不在」用于提醒，绝不 kill。
// 返回 true / false / null（null = 查不出来，比如 tasklist 不可用）。
function qqAgentRunning() {
  try {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq QQ Agent.exe', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    if (r.error || r.status !== 0 || !r.stdout) return null;
    return /QQ Agent\.exe/i.test(r.stdout);
  } catch { return null; }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_ROOT)) { console.log('（还没有任何备份）'); return; }
  const dirs = fs.readdirSync(BACKUP_ROOT).filter((d) => d.startsWith('electron-')).sort().reverse();
  if (!dirs.length) { console.log('（还没有任何备份）'); return; }
  for (const d of dirs) {
    const mf = path.join(BACKUP_ROOT, d, 'manifest.json');
    let note = '';
    try {
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      note = `  ${m.createdAt}  安装目录 ${m.installDir}`;
      for (const f of m.files) note += `\n      ${f.name}: ${short(f.beforeSha256)} → ${short(f.afterSha256)}${f.existed ? '' : '（原先不存在）'}`;
    } catch { note = '  （manifest.json 缺失或损坏）'; }
    console.log(`- _backup/${d}${note}`);
  }
}

function plan(installDir) {
  return FILES.map((f) => {
    const src = path.join(ROOT, f.src.split('/').join(path.sep));
    const dst = path.join(installDir, f.dst.split('/').join(path.sep));
    if (!fs.existsSync(src)) { console.error('✗ 工作区源文件不存在：' + src); process.exit(1); }
    const srcHash = sha256(src);
    const existed = fs.existsSync(dst);
    const dstHash = existed ? sha256(dst) : null;
    return { ...f, src, dst, srcHash, dstHash, existed, same: existed && srcHash === dstHash };
  });
}

function printPlan(rows) {
  for (const r of rows) {
    console.log(`${r.same ? '=' : '→'} ${r.name.padEnd(12)} ${short(r.dstHash)} → ${short(r.srcHash)}  ${r.same ? '（已一致，无需写入）' : ''}`);
    console.log(`  工作区 ${r.src}`);
    console.log(`  安装版 ${r.dst}${r.existed ? '' : '  （不存在，将新建）'}`);
  }
}

// 原子落盘：先写同目录临时文件，再 rename 顶替。
// 同目录保证 rename 不跨卷（跨卷 rename 会退化成复制，就不是原子的了）。
function atomicCopy(src, dst) {
  const tmp = dst + '.qqa-tmp-' + process.pid;
  try {
    fs.copyFileSync(src, tmp);          // 字节级复制，不经过字符串/编码转换
    fs.renameSync(tmp, dst);            // Windows 上 rename 覆盖已存在文件是允许的
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* 清理失败不影响结果 */ }
  }
}

function doApply(rows, installDir) {
  const todo = rows.filter((r) => !r.same);
  if (!todo.length) {
    console.log('\n已是最新版本，未写入任何文件，也未产生备份。');
    return 0;
  }
  const running = qqAgentRunning();
  if (running === true) {
    console.log('\n⚠ 检测到 QQ Agent 正在运行。本脚本不会结束它 —— 文件是"下次启动"才生效的。');
    console.log('  运行中按 F5/Ctrl+R 会重新加载渲染层并**重新读取新的 preload.cjs**，');
    console.log('  而主进程仍是旧代码（不认 qqa-window / qqa-window-state）。');
    console.log('  已核实：安装版 ui/ 只调用 refocus / captchaNetProbe / captchaInterceptorStatus，');
    console.log('  不碰新增的 controls / windowState，所以 F5 不会出事；');
    console.log('  但等到会调 controls.* 的新 UI 也装上去之后，就必须先重启才能混用。');
    console.log('  验证新外壳请让用户自己从托盘退出后重开，不要替他杀进程。');
  }

  const ts = stamp();
  const backupDir = uniqueBackupDir(ts);
  fs.mkdirSync(backupDir, { recursive: true });

  const manifest = {
    schema: SCHEMA,
    timestamp: path.basename(backupDir).replace(/^electron-/, ''),
    createdAt: new Date().toISOString(),
    workspaceRoot: ROOT,
    installDir,
    host: os.hostname(),
    note: '安装前备份。回滚：node tools/apply-electron.mjs --rollback ' + path.basename(backupDir).replace(/^electron-/, ''),
    files: []
  };

  // 备份：**先把 manifest 写出来**，再动安装目录。
  // 顺序很关键：万一写第二个文件的瞬间断电，盘上仍有完整的回滚依据。
  for (const r of rows) {
    if (r.existed) fs.copyFileSync(r.dst, path.join(backupDir, r.name));
    manifest.files.push({
      name: r.name,
      target: r.dst,
      existed: r.existed,
      beforeSha256: r.dstHash,
      beforeBytes: r.existed ? fs.statSync(r.dst).size : 0,
      action: r.same ? 'unchanged' : 'write',
      afterSha256: r.srcHash
    });
  }
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('\n备份目录：_backup/' + path.basename(backupDir));

  // 写入 + 立刻回读校验
  const written = [];
  try {
    for (const r of todo) {
      atomicCopy(r.src, r.dst);
      const got = sha256(r.dst);
      if (got !== r.srcHash) throw new Error(`${r.name} 写后校验不一致：${short(got)} != ${short(r.srcHash)}`);
      written.push(r);
      console.log(`✓ ${r.name} 已安装（sha256 ${short(got)}）`);
    }
  } catch (error) {
    console.error('\n✗ 安装失败：' + (error?.message ?? error));
    console.error('  正在从本次备份自动还原……');
    for (const r of rows) {
      try {
        if (r.existed) {
          fs.copyFileSync(path.join(backupDir, r.name), r.dst);
          const back = sha256(r.dst);
          if (back !== r.dstHash) console.error(`  ✗ ${r.name} 还原后校验仍不一致，请手工处理`);
          else console.log(`  ✓ ${r.name} 已还原`);
        } else if (fs.existsSync(r.dst)) {
          fs.unlinkSync(r.dst);
          console.log(`  ✓ ${r.name} 已删除（安装前本来就不存在）`);
        }
      } catch (e2) {
        console.error(`  ✗ ${r.name} 还原失败：` + (e2?.message ?? e2));
      }
    }
    return 1;
  }

  console.log('\n安装完成。文件已就位，但**正在运行的进程不会自动生效**。');
  console.log('回滚命令：node tools/apply-electron.mjs --rollback ' + manifest.timestamp);
  return 0;
}

function doRollback(ts, installDir) {
  const dir = path.join(BACKUP_ROOT, `electron-${ts}`);
  const mf = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mf)) {
    console.error('✗ 找不到备份：' + mf);
    console.error('  可先运行 node tools/apply-electron.mjs --list 看有哪些备份');
    return 1;
  }
  let m;
  try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); }
  catch (e) { console.error('✗ manifest.json 解析失败：' + (e?.message ?? e)); return 1; }
  if (m.schema !== SCHEMA) { console.error(`✗ manifest schema=${m.schema}，本脚本只认 ${SCHEMA}`); return 1; }

  const root = path.resolve(installDir);
  console.log(`回滚到 ${m.createdAt} 之前的状态（安装目录 ${installDir}）`);
  for (const f of m.files) {
    // 防呆：manifest 是可以被手改的。只允许写回它自己记录的安装目录之内，
    // 否则一个被篡改的 manifest 就能变成"往任意路径写文件"的工具。
    const target = path.resolve(f.target);
    if (!target.startsWith(root + path.sep)) {
      console.error(`✗ 拒绝回滚 ${f.name}：目标 ${target} 不在安装目录 ${root} 之内`);
      return 1;
    }
    if (f.action === 'unchanged') { console.log(`= ${f.name} 本次未改动，跳过`); continue; }
    if (!f.existed) {
      if (fs.existsSync(target)) { fs.unlinkSync(target); console.log(`✓ ${f.name} 已删除（安装前不存在）`); }
      else console.log(`= ${f.name} 本来就不存在，跳过`);
      continue;
    }
    const bak = path.join(dir, f.name);
    if (!fs.existsSync(bak)) { console.error(`✗ 备份文件缺失：${bak}`); return 1; }
    const bakHash = sha256(bak);
    if (f.beforeSha256 && bakHash !== f.beforeSha256) {
      console.error(`✗ 备份文件自身校验失败（${f.name}）：${short(bakHash)} != ${short(f.beforeSha256)}`);
      return 1;
    }
    atomicCopy(bak, target);
    const got = sha256(target);
    if (f.beforeSha256 && got !== f.beforeSha256) { console.error(`✗ ${f.name} 回滚后校验不一致`); return 1; }
    console.log(`✓ ${f.name} 已回滚（sha256 ${short(got)}）`);
  }
  console.log('\n回滚完成。同样地：正在运行的进程要重启后才会读到旧代码。');
  return 0;
}

const args = parseArgs(process.argv.slice(2));
if (!fs.existsSync(args.installDir)) {
  console.error('✗ 安装目录不存在：' + args.installDir);
  console.error('  （QQ Agent 没装在这里？用 --install-dir 指定，或 --help 看用法）');
  process.exit(2);
}

if (args.list) { listBackups(); process.exit(0); }
if (args.rollback) process.exit(doRollback(args.rollback, args.installDir));

const rows = plan(args.installDir);
console.log('安装目录：' + args.installDir);
console.log(args.apply ? '模式：写入（--apply）\n' : '模式：预览（不会写盘；要真装加 --apply）\n');
printPlan(rows);

if (!args.apply) {
  console.log('\n预览结束。确认无误后执行：node tools/apply-electron.mjs --apply');
  process.exit(0);
}
process.exit(doApply(rows, args.installDir));
