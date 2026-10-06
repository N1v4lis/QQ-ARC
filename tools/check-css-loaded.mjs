// 逐字节检查 CSS 文件是否真的被浏览器解析：规则数 + 前若干条选择器。
// "看着对但不生效"最后基本都落在两件事上：文件加载失败（404/CSP）或解析中断（编码/语法）。
// 用法：node tools/check-css-loaded.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || `http://127.0.0.1:3400/?t=${Date.now()}`;

await withPage({ url: URL_, width: 1440, height: 900, onConsole: (l) => { if (/css|CSP|Content Security|stylesheet/i.test(l)) console.log('C>', l.slice(0, 240)); } }, async (page) => {
  await sleep(2600);
  const out = await page.eval(`(() => {
    const rows = [];
    for (const sheet of document.styleSheets) {
      let n = -1, err = null, sample = [];
      try {
        const rules = sheet.cssRules;
        n = rules.length;
        sample = [...rules].slice(0, 3).map(r => (r.selectorText || r.conditionText || r.cssText || '').slice(0, 60));
      } catch (e) { err = e.message; }
      rows.push({ href: (sheet.href || '(inline)').replace(location.origin, ''), rules: n, err, sample });
    }
    return rows;
  })()`);
  for (const r of out) {
    console.log(`${String(r.rules).padStart(4)} rules  ${r.href}${r.err ? '  ← ' + r.err : ''}`);
    for (const s of r.sample) console.log(`            · ${s}`);
  }
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
