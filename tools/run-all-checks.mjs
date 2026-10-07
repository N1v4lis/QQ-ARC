// 一键跑完整回归：依次执行所有验收工具，汇总通过/失败。
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
let URL_ = 'http://127.0.0.1:3210/', profile = 'full', listOnly = false, only = '', failedOnly = false;
function usage() {
  console.log('用法：node tools/run-all-checks.mjs [url] [--profile full|quick|static] [--only 6,30|startup,wine-fox] [--failed] [--list]');
  console.log('full：完整43套（兼容旧命令）；quick：日常9套；static：5套无浏览器检查。--failed重跑上次失败，--list只列流程。');
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
if (!['full', 'quick', 'static'].includes(profile)) invalid('profile必须为full、quick或static');
if (cli.includes('--only') && !only) invalid('--only需要套件编号或名称');
if (only && failedOnly) invalid('--only与--failed不能同时使用');

const CHECKS = [
  // 静态结构检查放最前：它们不需要浏览器、秒级完成，
  // 而且能拦住"样式规则被写成孤儿声明"这类浏览器**静默丢弃**的错误 ——
  // 那种错误跑其它套件时只会表现为"某个样式莫名失效"，很难反推。
  ['样式表结构', 'check-css-structure.mjs', []],
  /**
   * 文档引用校验（纯 Node）。
   * ⚠️ 为什么值得单独一套：移交给别的 Agent 时，**悬空引用比没有引用更糟** ——
   *    它会让人去找一个不存在的东西。整理移交文档时实测发现多处
   *    （注释里引用已删除的探针脚本；index.html 与 99-legacy-layer.css
   *     对 @layer 的说法还互相矛盾）。
   *    这套会区分"指南类悬空（必须修）"与"编年史里刻意的历史提及（正常）"。
   */
  ['文档引用校验', 'check-doc-refs.mjs', []],
  /**
   * 宿主插件注入守卫（纯 Node）。
   * ⚠️ 背景：`plugins/theme-mode` 会往部署的 ui-next/index.html 注入
   *    `<script src="/theme-switcher.js">`，而 `apply-ui` 是整目录镜像、
   *    工作区没有这一行 → **每次部署都会冲掉插件的注入**。
   *    这套把该事实变成可见断言（环境不具备时自动跳过，不会在别的机器上误红）。
   */
  ['宿主插件注入', 'check-plugin-inject.mjs', []],
  ['MC音效素材（清单↔磁盘一致）', 'check-mc-sfx.mjs', []],
  ['外壳静态结构', 'check-shell-markup.mjs', []],
  ['ARCFØX启动动画', 'check-startup.mjs', [URL_]],
  ['无痕（像素级）', 'check-seamless-pixels.mjs', [URL_]],
  ['导航颜色连续性', 'check-nav-color-continuity.mjs', [URL_]],
  ['导航底部入口', 'check-nav-consistency.mjs', [URL_]],
  ['导航折叠', 'check-nav-rail.mjs', [URL_]],
  ['外壳/工具栏', 'check-shell-toolbar.mjs', [URL_]],
  ['重载按钮', 'check-reload-button.mjs', [URL_]],
  ['Beta 提示条', 'check-dashboard-beta.mjs', [URL_]],
  ['Beta 通告钉住', 'check-beta-pin.mjs', [URL_]],
  ['仪表盘区间+侧栏分区间隔', 'check-dash-range.mjs', [URL_]],
  ['仪表盘/胶囊/按钮', 'check-dashboard.mjs', [URL_]],
  ['信息卡定位+跳转高亮', 'check-card-jump-highlight.mjs', [URL_]],
  ['侧边栏重组+SnowLuma整合', 'check-sidebar-regroup.mjs', [URL_]],
  ['侧栏宽度+日志折叠', 'check-log-fold.mjs', [URL_]],
  ['侧栏宽度（无截断）', 'check-sidebar-width.mjs', [URL_]],
  ['图表/字号/CNY刻度', 'check-dashboard-charts.mjs', [URL_]],
  ['悬停提示修正', 'check-tooltip-fixes.mjs', [URL_]],
  ['SnowLuma 运行日志', 'check-snowluma-logs.mjs', [URL_]],
  ['SnowLuma 实时滚动', 'check-snowluma-live.mjs', [URL_]],
  ['主题卡页+Minecraft皮肤', 'check-theme-page.mjs', [URL_]],
  ['MC图标/音效/拉杆/背景/字体', 'check-mc-theme.mjs', [URL_]],
  ['MC字体链（标点不乱码）', 'check-font-chain.mjs', [URL_]],
  ['MC三项修复（字体/联动/音效）', 'check-mc-fixes.mjs', [URL_]],
  ['MC二轮修复（两档/字重/Beta字体/音效清理）', 'check-mc-fixes2.mjs', [URL_]],
  /**
   * 用户在2026-10-07明确要求移植最新酒狐。替代旧删除守卫，验证
   * 按需加载、启停清理、真实输入、情绪、完整动画及主线程调度。
   */
  ['酒狐互动宠物', 'check-wine-fox.mjs', [URL_]],
  /**
   * 设置页交互修复（2026-10-06）：输入框等宽对齐、撤销按钮高度中性且贴标题、
   * 重渲染后按钮仍能复活。这三条都是"看着像没问题、其实一直错着"的典型
   * （尤其撤销按钮那条还有 isConnected 的隐性 bug），用坐标与高度数据锁住。
   */
  ['设置页交互修复', 'check-settings-fixes.mjs', [URL_]],
  ['样式断言', 'check-styles.mjs', [URL_]],
  ['主题三档', 'check-theme.mjs', [URL_]],
  ['主题选择器', 'check-theme-picker.mjs', [URL_]],
  ['动效', 'check-motion.mjs', [URL_]],
  ['档位几何/对比度', 'check-tier-buttons-theme.mjs', [URL_]],
  ['读数行布局', 'check-readout-layout.mjs', [URL_]],
  ['滑条与开关', 'check-slider-switch.mjs', [URL_]],
  ['颜色格式互转', 'check-color-format.mjs', [URL_]],
  ['个性化', 'check-personalize.mjs', [URL_]],
  ['原生入口与市场', 'check-markets.mjs', [URL_]],
  ['遮挡测试', 'check-occlusion.mjs', [URL_]],
  ['控制台报错', 'check-console.mjs', [URL_]]
];

const results = [];
const QUICK = new Set(['check-shell-toolbar.mjs', 'check-dashboard.mjs', 'check-markets.mjs', 'check-console.mjs']);
let selected = CHECKS.map((entry, index) => ({ entry, id: index + 1 }));
if (profile === 'static') selected = selected.filter(({ id }) => id <= 5);
if (profile === 'quick') selected = selected.filter(({ entry, id }) => id <= 5 || QUICK.has(entry[1]));
function selectFiles(tokens) {
  const files = new Set();
  for (const value of tokens) {
    const token = String(value).trim();
    const file = 'check-' + token.replace(/^tools\//, '').replace(/^check-/, '').replace(/\.mjs$/, '') + '.mjs';
    const found = CHECKS.find(([name, tool], i) => token === String(i + 1) || token === name || tool === file);
    if (!found) invalid('未识别的套件：' + token);
    files.add(found[1]);
  }
  selected = selected.filter(({ entry }) => files.has(entry[1]));
}
if (only) selectFiles(only.split(','));
if (failedOnly) {
  const file = 'shots/final/last-failures.json';
  if (!fs.existsSync(file)) invalid('没有上次失败记录，请先运行所需检查');
  const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!previous.failures.length) { console.log('上次没有失败套件，无需重跑。'); process.exit(0); }
  selectFiles(previous.failures);
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
  omitted: CHECKS.filter(([, tool]) => !results.some(r => r.tool === tool)).map(([, tool]) => tool),
  results
}, null, 2));
// A passing quick/static run must not erase failures from suites it never ran.
const failureFile = 'shots/final/last-failures.json';
const outstanding = new Set(fs.existsSync(failureFile) ? JSON.parse(fs.readFileSync(failureFile, 'utf8')).failures : []);
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
