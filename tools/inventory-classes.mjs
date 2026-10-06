// 类名清单：把每个页签渲染出来的 class 收集起来，标注"旧皮肤里有 / 没有"。
// 用途：写新版组件样式时知道要接管哪些选择器，哪些是旧皮肤独有的孤儿样式。
// 用法：node tools/inventory-classes.mjs [url]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPage, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LEGACY = path.join(ROOT, 'app', 'ui', 'styles', '_legacy-style.css');
const URL_ = process.argv[2] || `http://127.0.0.1:3400/?t=${Date.now()}`;

const TABS = ['sessions', 'chats', 'memory', 'usage', 'skills', 'plugins', 'snowluma', 'accounts', 'settings'];
const SECTIONS = ['api', 'search', 'memory', 'persona', 'allow', 'chat', 'desktop', 'onebot', 'advanced', 'tools'];

const legacyCss = fs.readFileSync(LEGACY, 'utf8');
const inLegacy = (cls) => new RegExp(`\\.${cls.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}(?![\\w-])`).test(legacyCss);

// 新样式（styles/ 下除旧皮肤以外的全部文件）里出现过的类名 ——
// 这样能区分"旧皮肤兜底但新样式已接管"和"两边都没有"。
const STYLES_DIR = path.join(ROOT, 'app', 'ui', 'styles');
const newCssText = fs.readdirSync(STYLES_DIR)
  .filter((f) => f.endsWith('.css') && f !== '_legacy-style.css')
  .map((f) => fs.readFileSync(path.join(STYLES_DIR, f), 'utf8'))
  .join('\n');
const newCss = new Set([...newCssText.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));

const all = new Map();   // class -> Set(tab)

await withPage({ url: URL_, width: 1440, height: 900 }, async (page) => {
  const collect = async (tag) => {
    const list = await page.eval('[...new Set([...document.querySelectorAll("*")].flatMap(e => [...e.classList]))]');
    for (const c of list) {
      if (!all.has(c)) all.set(c, new Set());
      all.get(c).add(tag);
    }
  };
  await sleep(2400);
  await collect('shell');
  for (const tab of TABS) {
    const c = await page.click(`#tabs .tab[data-tab="${tab}"]`);
    if (!c || !c.ok) continue;
    await sleep(1100);
    await collect(tab);
    if (tab === 'settings') {
      for (const s of SECTIONS) {
        const sc = await page.click(`.settings-menu-item[data-section="${s}"]`);
        if (sc && sc.ok) { await sleep(800); await collect('settings:' + s); }
      }
    }
  }
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

const rows = [...all.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const withLegacy = rows.filter(([c]) => inLegacy(c));
const without = rows.filter(([c]) => !inLegacy(c));

// 只打印"值得看的那些"：
//   · 缺样式 = 旧皮肤没有、新样式也没接管（会露出浏览器默认外观）→ 必须列全
//   · 有样式 = 数量太多，只给计数与文件清单（逐个打印会刷屏，找不到重点）
const missingStyle = rows.filter(([c]) => !inLegacy(c) && !newCss.has(c));
const longTail = withLegacy.filter(([c]) => !newCss.has(c));

console.log(`渲染出来的 class 共 ${rows.length} 个：旧皮肤有 ${withLegacy.length}，没有 ${without.length}`);
console.log(`其中新样式已接管 ${rows.length - missingStyle.length - longTail.length} 个\n`);

console.log(`=== ⚠️ 旧皮肤没有、新样式也没接管（${missingStyle.length}）—— 会露默认外观，优先处理 ===`);
for (const [c, tabs] of missingStyle) console.log(`  .${c}  [${[...tabs].join(',')}]`);

console.log(`\n=== 仍靠旧皮肤兜底（${longTail.length}）—— 逐个接管中 ===`);
console.log('  ' + longTail.map(([c]) => '.' + c).join('  '));

console.log(`\n=== 旧皮肤没有、新样式已接管（${without.filter(([c]) => newCss.has(c)).length}）===`);
console.log('  ' + without.filter(([c]) => newCss.has(c)).map(([c]) => '.' + c).join('  '));

fs.writeFileSync(path.join(ROOT, 'docs', 'class-inventory.txt'),
  rows.map(([c, tabs]) => {
    const where = newCss.has(c) ? 'new' : (inLegacy(c) ? 'legacy' : 'MISSING');
    return `${c}\t${where}\t${[...tabs].join(',')}`;
  }).join('\n') + '\n', 'utf8');
console.log('\n已写入 docs/class-inventory.txt（全量清单）');
console.log(missingStyle.length ? `\n结论：还有 ${missingStyle.length} 个 class 没有任何样式来源。` : '\n结论：所有渲染出来的 class 都有样式来源。');
