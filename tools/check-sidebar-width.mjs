// 侧栏收窄后：底部入口与顶部折叠按钮是否还在舒适区间（有没有被 ellipsis 截断）。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1500, height: 980 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: 'boot' });
  await sleep(1200);

  const r = await page.eval(`(() => {
    const sb = document.querySelector('.q-sidebar');
    const sbW = Math.round(sb.getBoundingClientRect().width);
    // 判断是否被 ellipsis 截断：scrollWidth > clientWidth 即为截断
    const clipped = (el) => el.scrollWidth > el.clientWidth + 1;
    const nav = [...document.querySelectorAll('#tabs .tab')].map((t) => ({
      label: (t.querySelector('.tab-tx') || {}).textContent || '',
      clipped: clipped(t.querySelector('.tab-tx') || t),
      txW: Math.round((t.querySelector('.tab-tx') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
      right: Math.round((t.querySelector('.tab-tx') || t).getBoundingClientRect().right)
    }));
    const foot = [...document.querySelectorAll('.q-side-foot .nav-btn')]
      .filter((b) => !b.classList.contains('hidden'))
      .map((b) => ({ label: b.textContent.trim(), clipped: clipped(b), w: Math.round(b.getBoundingClientRect().width) }));
    const toggle = document.querySelector('#q-side-toggle');
    return {
      sidebarW: sbW,
      navClipped: nav.filter((n) => n.clipped),
      navMaxRight: Math.max(...nav.map((n) => n.right)),
      footClipped: foot.filter((f) => f.clipped),
      footMinW: Math.min(...foot.map((f) => f.w)),
      toggleW: toggle ? Math.round(toggle.getBoundingClientRect().width) : null,
      toggleClipped: toggle ? clipped(toggle) : null
    };
  })()`);
  console.log(`   侧栏 ${r.sidebarW}px；导航文字最右 ${r.navMaxRight}px；折叠按钮宽 ${r.toggleW}px`);
  console.log(`   底部按钮宽度：最小 ${r.footMinW}px`);

  ok('侧栏已收窄到 ≤176px', r.sidebarW <= 176, `${r.sidebarW}px`);
  ok('导航项文字都没被截断', r.navClipped.length === 0,
    r.navClipped.length ? JSON.stringify(r.navClipped) : '全部完整');
  ok('底部入口文字都没被截断', r.footClipped.length === 0,
    r.footClipped.length ? JSON.stringify(r.footClipped) : `最小宽 ${r.footMinW}px`);
  ok('「收起导航」按钮没被截断', r.toggleClipped === false, `宽 ${r.toggleW}px`);

  // 折叠/展开往返仍然正常
  await page.click('#q-side-toggle');
  await sleep(900);
  const collapsed = await page.eval(`({ nav: document.documentElement.getAttribute('data-nav'), w: Math.round(document.querySelector('.q-sidebar').getBoundingClientRect().width) })`);
  await page.click('#q-side-toggle');
  await sleep(900);
  const back = await page.eval(`({ nav: document.documentElement.getAttribute('data-nav'), w: Math.round(document.querySelector('.q-sidebar').getBoundingClientRect().width) })`);
  ok('折叠/展开往返正常', collapsed.w === 60 && back.nav === 'expanded' && back.w === r.sidebarW,
    `折叠 ${collapsed.w}px → 展开 ${back.w}px`);

  await page.screenshot('shots/final/sidebar-168.png');
  console.log('\n截图：shots/final/sidebar-168.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n侧栏收窄（无截断）验收通过。');
process.exit(failed ? 2 : 0);
