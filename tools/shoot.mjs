// 基线取证：当前（旧）UI 的每个页签截图 + 关键状态快照。
// 用法：node tools/shoot.mjs --url http://127.0.0.1:3400/ --out shots/before
import fs from 'node:fs';
import path from 'node:path';
import { withPage, sleep } from './cdp.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL_ = arg('url', 'http://127.0.0.1:3400/');
const OUT = path.resolve(arg('out', 'shots/before'));
// ⚠️ 视口默认 1600×900：必须 > 880px，否则会命中侧栏的窄窗口媒体查询
//    （导航变 rail、底栏入口变圆点），截出来的不是"正常桌面窗口"的样子。
const W = Number(arg('w', 1600));
const H = Number(arg('h', 900));

const TABS = ['sessions', 'chats', 'memory', 'usage', 'skills', 'plugins', 'snowluma', 'accounts', 'settings'];

fs.mkdirSync(OUT, { recursive: true });
const report = [];

await withPage({ url: URL_, width: W, height: H, onConsole: (l) => { if (/error|exception/i.test(l)) report.push(`CONSOLE ${l}`); } }, async (page) => {
  // 等首屏（loading 遮罩消失 + 主体挂载）
  for (let i = 0; i < 60; i += 1) {
    const ready = await page.eval(`(() => {
      const ov = document.getElementById('loading-overlay');
      const hidden = !ov || ov.classList.contains('hidden') || getComputedStyle(ov).display === 'none' || getComputedStyle(ov).opacity === '0';
      return { hidden, tabs: document.querySelectorAll('#tabs .tab').length, body: document.body.children.length };
    })()`).catch(() => null);
    if (ready?.hidden && ready.tabs > 0) break;
    await sleep(500);
  }
  await sleep(1500);

  await page.screenshot(path.join(OUT, '00-full-default.png'));

  for (const tab of TABS) {
    const clicked = await page.click(`#tabs .tab[data-tab="${tab}"]`);
    await sleep(1400);
    await page.screenshot(path.join(OUT, `tab-${tab}.png`));
    report.push(`tab ${tab}: ${JSON.stringify(clicked)}`);
  }

  // 关键 DOM 契约快照：后续新 UI 必须保持这些 id 可解析
  const ids = await page.eval(`(() => {
    const all = [...document.querySelectorAll('[id]')].map(e => e.id);
    return { count: all.length, ids: all.sort() };
  })()`);
  fs.writeFileSync(path.join(OUT, 'dom-ids.json'), JSON.stringify(ids, null, 2));

  const state = await page.eval(`(() => ({
    tabs: [...document.querySelectorAll('#tabs .tab')].map(b => ({ tab: b.dataset.tab, text: b.textContent.trim(), visible: b.offsetParent !== null })),
    navBtns: [...document.querySelectorAll('#tabs .nav-btn')].map(b => ({ id: b.id, text: b.textContent.trim(), visible: b.offsetParent !== null })),
    topbar: [...document.querySelectorAll('#topbar *')].map(e => ({ id: e.id, cls: e.className, tag: e.tagName })).slice(0, 40),
    views: [...document.querySelectorAll('#layout > section')].map(s => ({ id: s.id, active: s.classList.contains('active') }))
  }))()`);
  fs.writeFileSync(path.join(OUT, 'shell-state.json'), JSON.stringify(state, null, 2));

  console.log(`基线截图完成 → ${OUT}`);
  console.log(`DOM id 数量：${ids.count}`);
  console.log(`页签：${state.tabs.map((t) => t.tab + (t.visible ? '' : '(隐藏)')).join(', ')}`);
  return true;
});

for (const line of report.filter((l) => l.startsWith('CONSOLE'))) console.log(line);
