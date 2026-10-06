// QQ Agent 重启助手（新 UI 上线用）。
//
// 为什么要独立脚本而不是直接在会话里 taskkill：
//   1. 关不干净会导致新实例被**单实例锁**挡掉 —— 表现是"双击没反应"，
//      而日志里什么也没有（main.js 拿不到锁就静默 quit）。所以必须"杀干净再启动"，
//      并逐秒复核进程真的没了。
//   2. 关之前要给它机会把会话/配置刷盘（CloseMainWindow → 再退）。
//   3. 起来之后要**验证**：端口在听、返回的 HTML 是新 UI（含 q-titlebar）、
//      /api/status 正常。不验证的重启等于没重启。
//
// 用法：
//   node tools/restart-agent.mjs            预演（只报告将要做什么）
//   node tools/restart-agent.mjs --apply    执行
//   node tools/restart-agent.mjs --status   只看当前状态
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const EXE = 'E:\\QQ Agent\\QQ Agent.exe';
const WORKDIR = 'E:\\QQ Agent';
const PORT_GUESS = [3210, 3211, 3212, 3213];
const UI_MARKER = 'q-titlebar';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const STATUS_ONLY = args.includes('--status');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ps(script) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, timeout: 30_000
    }).trim();
  } catch (e) { return `ERR ${e.message}`; }
}

function listProcs() {
  const out = ps(`Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq '${EXE}' } | ForEach-Object { "{0}|{1}" -f $_.Id, $_.StartTime.ToString('HH:mm:ss') }`);
  if (!out || out.startsWith('ERR')) return [];
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [id, started] = l.split('|');
    return { id: Number(id), started };
  });
}

async function probeUi() {
  for (const p of PORT_GUESS) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) continue;
      const html = await r.text();
      return { port: p, isNewUi: html.includes(UI_MARKER), len: html.length };
    } catch { /* 下一个端口 */ }
  }
  return null;
}

const procs = listProcs();
const ui = await probeUi();

console.log('=== QQ Agent 当前状态 ===');
console.log(`进程：${procs.length ? procs.map((p) => `${p.id}@${p.started}`).join(', ') : '(未运行)'}`);
console.log(`控制台：${ui ? `http://127.0.0.1:${ui.port}/ （${ui.isNewUi ? '新 UI' : '老控制台'}）` : '不可达'}`);

// 新 UI 是否已经装好
const uiNext = 'E:\\QQ Agent\\resources\\app\\ui-next\\index.html';
console.log(`ui-next 安装：${fs.existsSync(uiNext) ? '已就位' : '尚未安装（先跑 tools/apply-ui.mjs --apply）'}`);

if (STATUS_ONLY) process.exit(0);

if (!fs.existsSync(EXE)) { console.error(`✗ 找不到 ${EXE}`); process.exit(1); }

if (!APPLY) {
  console.log('\n预演：将会依次执行');
  console.log('  1) 给主窗口发关闭消息，等 4 秒让它把数据刷盘');
  console.log('  2) 对残留进程 taskkill /F /T（连渲染进程一起）');
  console.log('  3) 等进程真正消失（最多 30 秒）—— 否则新实例会被单实例锁挡掉');
  console.log(`  4) Start-Process "${EXE}"`);
  console.log('  5) 轮询 127.0.0.1:3210~3213，校验返回的 HTML 含 ' + UI_MARKER);
  console.log('  6) 校验 /api/status 可用');
  console.log('\n执行请加 --apply');
  process.exit(0);
}

// ── 1. 优雅关闭 ─────────────────────────────────────────────────────────
if (procs.length) {
  console.log('\n[1/5] 请求主窗口关闭（给它时间刷盘）…');
  ps(`Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq '${EXE}' -and $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.CloseMainWindow() | Out-Null }`);
  await sleep(4000);
}

// ── 2/3. 树杀 + 复核 ────────────────────────────────────────────────────
let left = listProcs();
if (left.length) {
  console.log(`[2/5] 仍在运行 ${left.map((p) => p.id).join(', ')}，执行树杀…`);
  for (const p of left) {
    ps(`taskkill.exe /F /T /PID ${p.id} 2>&1 | Out-Null`);
  }
}
console.log('[3/5] 等待进程完全退出…');
let waited = 0;
while (waited < 30 && listProcs().length) { await sleep(1000); waited += 1; }
left = listProcs();
if (left.length) {
  console.error(`✗ 仍有进程未退出：${left.map((p) => p.id).join(', ')} —— 不启动，否则会被单实例锁挡掉。`);
  process.exit(3);
}
console.log('      已全部退出 ✔');

// ── 4. 启动 ─────────────────────────────────────────────────────────────
// ⚠️ 必须清掉 ELECTRON_RUN_AS_NODE（2026-10-04 踩了一个多小时）：
//    这个环境变量会让 Electron 二进制**退化成普通 Node 进程** ——
//    不初始化 Chromium、不读 resources/app、不执行 main.js，直接以 code 0 退出。
//    现象是"双击毫无反应、boot-diag.log 一个字都没有、双击 exe 也不报错"，
//    和"单实例锁没释放"几乎一模一样，极难定位。
//    DSH（本 Agent 宿主）自己就设了这个变量，所以从 Agent 的 shell 里 spawn 出来的
//    Electron 一定会被污染；用户手动双击则不受影响。
//    结论：凡是**从 Agent 环境**启动 Electron，都必须显式剔除它。
console.log(`[4/5] 启动：${EXE}`);
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
delete childEnv.ELECTRON_NO_ATTACH_CONSOLE;
console.log(`      ELECTRON_RUN_AS_NODE 已剔除（原值=${process.env.ELECTRON_RUN_AS_NODE ?? '(未设置)'}）`);
spawn(EXE, [], {
  cwd: WORKDIR, detached: true, stdio: 'ignore', windowsHide: false, env: childEnv
}).unref();

// ── 5. 验证 ─────────────────────────────────────────────────────────────
console.log('[5/5] 等待控制台就绪并校验…');
let good = null;
for (let i = 0; i < 40; i += 1) {
  await sleep(2000);
  const u = await probeUi();
  if (u) { good = u; break; }
}
if (!good) { console.error('✗ 60 秒内控制台没有起来'); process.exit(4); }

const marker = good.isNewUi ? '新 UI（含自绘标题栏）' : '老控制台';
console.log(`      HTTP 已就绪：http://127.0.0.1:${good.port}/ → ${marker}`);
if (!good.isNewUi) {
  console.error('✗ 返回的页面不是新 UI —— 检查 QQ_AGENT_UI_DIR / ui-next 是否就位；');
  console.error('  想回退：删掉 resources/app/ui-next 目录即可自动回落老控制台。');
  process.exit(5);
}

try {
  const r = await fetch(`http://127.0.0.1:${good.port}/api/status`, { signal: AbortSignal.timeout(6000) });
  const j = await r.json();
  console.log(`      /api/status：OneBot ${j.onebot?.connected ? '已连接' : '未连接'}${j.onebot?.self?.nickname ? `（${j.onebot.self.nickname}）` : ''}`);
} catch (e) {
  console.warn('      /api/status 暂不可用（可能还在连 SnowLuma）：' + e.message);
}

console.log('\n✔ 重启完成。若窗口外观仍是老样子，请确认 Electron 进程确实是新起的（上面已打印启动时间）。');
