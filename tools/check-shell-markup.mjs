// 结构自检：功能工具栏搬家后，关键 id 必须各出现一次、且位置正确、标签配对。
import fs from 'node:fs';

const raw = fs.readFileSync('app/ui/index.html', 'utf8');
// ⚠️ 先去掉 HTML 注释再数标签：注释里出现的 `<main>`（例如"见下方 <main> 里的…"）
//    会把配对计数算歪（第一次跑就报 <main> 2 vs 1，其实是注释）。
//    同时注释里的 id 也不该被当成"重复 id"。
const s = raw.replace(/<!--[\s\S]*?-->/g, '');
let bad = 0;
const check = (name, pass, detail) => { console.log(`${pass ? '✔' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!pass) bad += 1; };

// 这些是 **id**：应当恰好一次
const IDS = ['onebot-dot', 'onebot-label', 'account-switch', 'model-label', 'usage-label',
  'search-count-label', 'readiness-dots', 'theme-btn', 'pause-btn',
  'q-winctl', 'q-tb-drag', 'topbar', 'layout', 'tabs', 'q-shell', 'q-side-toggle'];
for (const id of IDS) {
  const n = (s.match(new RegExp(`id="${id}"`, 'g')) || []).length;
  check(`id="${id}" 恰好出现 1 次`, n === 1, n === 1 ? '' : `实际 ${n} 次`);
}
// 这些是 **class**（没有 id 属性）—— 按 class 计数
for (const cls of ['q-tb-spacer', 'q-tb-status', 'q-sidebar', 'q-main']) {
  const n = (s.match(new RegExp(`class="[^"]*\\b${cls}\\b`, 'g')) || []).length;
  check(`class="${cls}" 出现且仅出现一次`, n === 1, n === 1 ? '' : `实际 ${n} 次`);
}

const headerOpen = s.indexOf('<header id="topbar"');
const headerClose = s.indexOf('</header>');
const mainOpen = s.indexOf('<main id="layout"');
const statusPos = s.indexOf('class="q-tb-status"');

// ⚠️ 2026-10-04「无痕」改版：工具栏是 .q-body 的第一个子项、横跨整窗
//    （含侧栏上方），**不在** <main> 里面 —— 放 main 里会在侧栏右界处断出凹口。
check('工具栏 .q-tb-status 在 <header> 之外', !(statusPos > headerOpen && statusPos < headerClose),
  `header 范围 ${headerOpen}~${headerClose}，工具栏在 ${statusPos}`);
check('工具栏在 <main id="layout"> 之外（横跨整窗）', statusPos < mainOpen,
  `main 起点 ${mainOpen} / 工具栏 ${statusPos}`);

// 标题栏里应当**只剩**品牌区 + 拖动占位 + 窗口按钮
const headerHtml = s.slice(headerOpen, headerClose);
for (const gone of ['onebot-dot', 'account-switch', 'usage-label', 'theme-btn', 'pause-btn', 'readiness-dots']) {
  check(`标题栏里不再有 #${gone}`, !headerHtml.includes(gone));
}
for (const keep of ['q-tb-drag', 'q-tb-brand', 'q-winctl', 'data-qwin="minimize"', 'data-qwin="toggle-maximize"', 'data-qwin="close"']) {
  check(`标题栏保留 ${keep}`, headerHtml.includes(keep));
}

// 标签配对（粗查）
for (const [open, close] of [['<div', '</div>'], ['<span', '</span>'], ['<header', '</header>'], ['<main', '</main>'], ['<nav', '</nav>'], ['<section', '</section>'], ['<button', '</button>'], ['<select', '</select>']]) {
  const o = (s.match(new RegExp(`${open}\\b`, 'g')) || []).length;
  const c = (s.match(new RegExp(close, 'g')) || []).length;
  check(`标签配对 ${open} / ${close}`, o === c, `${o} vs ${c}`);
}

process.exit(bad ? 2 : 0);
