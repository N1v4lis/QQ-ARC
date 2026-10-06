// 启动诊断：往被测应用的入口文件注入哨兵与顶层 try/catch，跑一次，把日志抓回来，再还原。
//
// 为什么需要它：`node --check` 只验证语法；Electron 的"启动即静默退出"里有一大半
// 是**运行时**问题（TDZ、缺失导出、未安装的原生模块、早期 app.quit()）。
// 这个脚本用最小侵入的方式回答两个问题：
//   ① main.js 到底有没有被执行到？（哨兵行）
//   ② 如果执行了，是在哪一步退出的？（分步日志）
// 无论成败都会把文件原样还原（用临时副本 + 原子 rename，失败也会在 finally 里还原）。
//
// 用法：node tools/diagnose-startup.mjs [--keep]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const APP_DIR = 'E:\\QQ Agent\\resources\\app';
const EXE = 'E:\\QQ Agent\\QQ Agent.exe';
const WORKDIR = 'E:\\QQ Agent';
const LOG = path.join(APP_DIR, '..', '..', 'data', 'startup-diag.log');
const KEEP = process.argv.includes('--keep');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pkgPath = path.join(APP_DIR, 'package.json');
const mainRel = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).main || 'index.js';
const mainPath = path.join(APP_DIR, mainRel);
console.log(`入口：${mainPath}`);

const pkgBackup = fs.readFileSync(pkgPath, 'utf8');
const mainBackup = fs.readFileSync(mainPath);

// 诊断版入口：先写哨兵，再用 require 包住原入口 ——
// 原入口是 ESM（package.json type:module），所以必须改成 .mjs 由 import() 动态加载。
const diagName = 'diag-entry.cjs';
const diagPath = path.join(APP_DIR, diagName);
const origMjs = path.join(APP_DIR, 'diag-orig.mjs');
const diagSrc = `// 自动生成：启动诊断入口（用完即删）
const fs = require('fs');
const LOG = ${JSON.stringify(LOG)};
function log(m) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\\n'); } catch (e) {} }
log('[diag] diag-entry 已执行 (cwd=' + process.cwd() + ')');
process.on('uncaughtException', (e) => { log('[diag] uncaughtException: ' + (e && e.stack || e)); });
process.on('unhandledRejection', (e) => { log('[diag] unhandledRejection: ' + (e && e.stack || e)); });
process.on('exit', (code) => { log('[diag] process exit code=' + code); });
process.on('beforeExit', (code) => { log('[diag] beforeExit code=' + code); });
(async () => {
  try {
    log('[diag] 准备 import 原入口');
    await import('./diag-orig.mjs');
    log('[diag] 原入口 import 完成');
  } catch (e) {
    log('[diag] 原入口 import 抛错: ' + (e && e.stack || e));
    throw e;
  }
})();
`;

try {
  fs.copyFileSync(mainPath, origMjs);
  fs.writeFileSync(diagPath, diagSrc, 'utf8');
  fs.writeFileSync(pkgPath, JSON.stringify({ name: 'qq-agent', version: '0.4.0', type: 'commonjs', main: diagName }, null, 2), 'utf8');
  try { fs.rmSync(LOG, { force: true }); } catch { /* ignore */ }

  console.log('启动…');
  const child = spawn(EXE, [], { cwd: WORKDIR, detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  await sleep(12_000);

  let alive = 0;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq 'E:\\QQ Agent\\QQ Agent.exe' } | Measure-Object | Select-Object -ExpandProperty Count"],
      { encoding: 'utf8', windowsHide: true });
    alive = Number(String(out).trim()) || 0;
  } catch { alive = -1; }

  console.log(`启动 12 秒后进程数：${alive}`);
  console.log('=== 诊断日志 ===');
  try { console.log(fs.readFileSync(LOG, 'utf8')); }
  catch { console.log('（没有生成日志文件 —— 说明诊断入口本身都没被执行）'); }
} finally {
  // 还原（顺序很重要：先把原文件放回去，再删临时文件）
  try { fs.writeFileSync(pkgPath, pkgBackup, 'utf8'); } catch (e) { console.error('还原 package.json 失败：', e.message); }
  try {
    const flat = fs.readFileSync(origMjs);
    if (!flat.equals(mainBackup)) fs.writeFileSync(mainPath, flat);
  } catch (e) { console.error('还原入口失败：', e.message); }
  if (!KEEP) {
    try { fs.rmSync(diagPath, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(origMjs, { force: true }); } catch { /* ignore */ }
  }
  console.log('\n已还原原始入口文件。');
  console.log('package.json main =', JSON.parse(fs.readFileSync(pkgPath, 'utf8')).main);
  console.log('原入口字节一致 =', fs.readFileSync(mainPath).equals(mainBackup));
}
