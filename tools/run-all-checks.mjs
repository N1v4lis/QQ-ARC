// 用户指定的核心回归：仅原编号1、2、3、5、30；其他套件停用。
// 顺序上把"会改主题/改配色/滚动页面"的套件放后面，减少互相影响。
//
// 用法：node tools/run-all-checks.mjs [url]
//
// ⚠️ 排查某个套件"批量跑才失败"时：本脚本会把失败套件的所有 ✗ 行打出来，
//    并把完整日志写到 shots/final/regression-failures.txt。
//    只报一行摘要的话，这类偶发问题得再手工重跑一遍才能定位。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const cli = process.argv.slice(2);
let URL_ = 'http://127.0.0.1:3210/', profile = 'core', listOnly = false, only = '', failedOnly = false;
function usage() {
  console.log('用法：node tools/run-all-checks.mjs [url] [--profile core|static] [--only 1,2,3,5,30|wine-fox] [--failed] [--list]');
  console.log('core：默认5套；static：4套无浏览器检查。旧quick/full均映射core，不恢复已停用检查。--failed重跑上次失败，--list只列流程。');
}
function invalid(message) { console.error(message); usage(); process.exit(1); }
for (let i = 0; i < cli.length; i++) {
  const arg = cli[i];
  if (arg === '--help' || arg === '-h') { usage(); process.exit(0); }
  else if (arg === '--profile') profile = cli[++i];
  else if (arg === '--only') only = cli[++i] || '';
  else if (arg === '--failed') failedOnly = true;
  else if (arg === '--list') listOnly = true;
  else if (/^https?:\/\//.test(arg)) URL_ = arg;
  else invalid('未知参数：' + arg);
}
if (!['core', 'full', 'quick', 'static'].includes(profile)) invalid('profile必须为core或static');
if (profile === 'full' || profile === 'quick') profile = 'core';
if (cli.includes('--only') && !only) invalid('--only需要套件编号或名称');
if (only && failedOnly) invalid('--only与--failed不能同时使用');

// Stable IDs retain the user's original numbering. Removed suites are never auto-selected.
const CHECKS = [
  [1, '样式表结构', 'check-css-structure.mjs', []],
  [2, '文档引用校验', 'check-doc-refs.mjs', []],
  [3, '宿主插件注入', 'check-plugin-inject.mjs', []],
  [5, '外壳静态结构', 'check-shell-markup.mjs', []],
  [30, '酒狐互动宠物', 'check-wine-fox.mjs', [URL_]]
];
const activeFiles = new Set(CHECKS.map(([, , tool]) => tool));

const results = [];
let selected = CHECKS.map(([id, ...entry]) => ({ entry, id }));
if (profile === 'static') selected = selected.filter(({ id }) => id !== 30);
function selectFiles(tokens) {
  const files = new Set();
  for (const value of tokens) {
    const token = String(value).trim();
    const file = 'check-' + token.replace(/^tools\//, '').replace(/^check-/, '').replace(/\.mjs$/, '') + '.mjs';
    const found = CHECKS.find(([id, name, tool]) => token === String(id) || token === name || tool === file);
    if (!found) invalid('已停用或未识别的套件：' + token);
    files.add(found[2]);
  }
  selected = selected.filter(({ entry }) => files.has(entry[1]));
}
if (only) selectFiles(only.split(','));
if (failedOnly) {
  const file = 'shots/final/last-failures.json';
  if (!fs.existsSync(file)) invalid('没有上次失败记录，请先运行所需检查');
  const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  const failures = previous.failures.filter(tool => activeFiles.has(tool));
  if (!failures.length) { console.log('上次没有失败套件，无需重跑。'); process.exit(0); }
  selectFiles(failures);
}
if (!selected.length) invalid('选择结果为空，请检查profile与套件选择');
console.log(`模式 ${profile}${only ? '（指定套件）' : failedOnly ? '（失败重跑）' : ''}：${selected.length}/${CHECKS.length} 套，浏览器套件串行执行。`);
if (listOnly) {
  for (const { entry: [name, tool], id } of selected) console.log(`${String(id).padStart(2, '0')} ${name}  ${tool}${id <= 5 ? ' [无浏览器]' : ''}`);
  process.exit(0);
}
for (const { entry: [name, tool, args], id } of selected) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [`tools/${tool}`, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const ms = Date.now() - t0;
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const pass = r.status === 0;
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 抓一行最能说明结论的输出
  const summary = lines.filter((l) =>
    /全部|通过|正常|验收通过|干净|符合|命中|未通过|失败/.test(l)).slice(-1)[0] || '';
  // ⚠️ 失败时把该套件里所有 ✗ 行一并留下：
  //    只报一行摘要的话，"批量跑才失败"的偶发问题就得再手工重跑一遍才能定位 ——
  //    而它恰恰是最难复现的那类。这里一次性把证据留全。
  const failures = lines.filter((l) => l.includes('✗')).slice(0, 8);
  results.push({ id, name, tool, pass, ms, summary, failures, out });
  console.log(`${pass ? '✔' : '✗'} ${name.padEnd(18)} ${String(ms).padStart(6)}ms  ${summary}`);
  if (!pass) for (const f of failures) console.log(`      ${f}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 个套件通过（共 ${(results.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(0)} 秒）`);
console.log(`本次未运行 ${CHECKS.length - results.length} 套；结果只代表所选范围。`);
fs.mkdirSync('shots/final', { recursive: true });
fs.writeFileSync('shots/final/last-run.json', JSON.stringify({
  date: new Date().toISOString(), url: URL_, profile, registered: CHECKS.length,
  executed: results.length, passed: results.length - failed.length, failed: failed.length,
  omitted: CHECKS.filter(([, , tool]) => !results.some(r => r.tool === tool)).map(([, , tool]) => tool),
  results
}, null, 2));
// A passing quick/static run must not erase failures from suites it never ran.
const failureFile = 'shots/final/last-failures.json';
const outstanding = new Set((fs.existsSync(failureFile) ? JSON.parse(fs.readFileSync(failureFile, 'utf8')).failures : []).filter(tool => activeFiles.has(tool)));
for (const r of results) { if (r.pass) outstanding.delete(r.tool); else outstanding.add(r.tool); }
fs.writeFileSync(failureFile, JSON.stringify({date: new Date().toISOString(), failures: [...outstanding]}, null, 2));
if (failed.length) {
  console.log('\n未通过：');
  for (const f of failed) {
    console.log(`  ✗ ${f.name}  ${f.summary}`);
    for (const line of f.failures) console.log(`        ${line}`);
  }
  // 需要完整日志时写文件，避免刷屏
  try {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync('shots/final', { recursive: true });
    writeFileSync('shots/final/regression-failures.txt',
      failed.map((f) => `===== ${f.name} =====\n${f.out}`).join('\n\n'), 'utf8');
    console.log('\n完整失败日志：shots/final/regression-failures.txt');
  } catch { /* 忽略 */ }
}
process.exit(failed.length ? 2 : 0);
