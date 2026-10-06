// 检查 <link> 顺序与文档顺序是否一致 —— 排查"后加载的样式没赢"这类诡异现象。
// CSS 层叠里同特指度比的是**文档顺序**（样式表在文档中出现的位置），不是请求完成顺序。
// 用法：node tools/check-link-order.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || `http://127.0.0.1:3400/?t=${Date.now()}`;

await withPage({ url: URL_, width: 1200, height: 800 }, async (page) => {
  await sleep(2400);
  const out = await page.eval(`(() => {
    const links = [...document.querySelectorAll('link[rel=stylesheet]')].map((l, i) => ({
      i, href: (l.getAttribute('href') || '').replace(/^\\//, ''),
      inHead: !!l.closest('head'), sheetOrder: -1
    }));
    // styleSheets 的顺序 = 浏览器认定的文档顺序
    const order = [...document.styleSheets].map((s) => (s.href || '(inline)').replace(location.origin + '/', ''));
    links.forEach((l) => { l.sheetOrder = order.findIndex((h) => h.endsWith(l.href.split('/').pop())); });
    return { links, order, htmlHead: document.head.innerHTML.slice(0, 120) };
  })()`);
  console.log('=== document.styleSheets 顺序（浏览器认定的层叠顺序，后面的赢）===');
  out.order.forEach((h, i) => console.log(`  ${String(i).padStart(2)}  ${h}`));
  console.log('\n=== <link> 出现顺序 ===');
  for (const l of out.links) console.log(`  link#${l.i}  sheet#${l.sheetOrder}  ${l.href}`);
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
