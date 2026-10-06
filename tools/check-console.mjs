// 最终体检：真实运行中的控制台还有没有控制台报错、CSP 违规、资源 404。
// 验收"上线后没问题"必须包含这一项 —— 页面能看 ≠ 没有报错。
// 用法：node tools/check-console.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
// ⚠️ 2026-10-04：'snowluma' 页签已并入「设置 → OneBot（SnowLuma）」，从列表移除。
//    新增页签时也要同步这里，否则"控制台干净"这条会漏测新页。
const TABS = ['dashboard', 'sessions', 'chats', 'memory', 'usage', 'skills', 'plugins', 'accounts', 'settings'];

const problems = [];
const all = [];

await withPage({
  url: URL_, width: 1600, height: 900,
  onConsole: (line) => {
    all.push(line);
    // 过滤掉"预期内"的噪声：favicon 已修好，这里只留真正的告警
    if (/error|exception|violat|refused|failed to load/i.test(line)) problems.push(line);
  }
}, async (page) => {
  await sleep(3000);
  for (const tab of TABS) {
    await page.click(`#tabs .tab[data-tab="${tab}"]`);
    await sleep(1000);
  }
});

console.log(`控制台消息共 ${all.length} 条，其中疑似问题 ${problems.length} 条：\n`);
if (!problems.length) console.log('（无）');
for (const p of [...new Set(problems)]) console.log('  ' + p.slice(0, 220));
console.log(problems.length ? '\n结论：还有告警需要看。' : '\n结论：控制台干净。');
process.exit(problems.length ? 2 : 0);
