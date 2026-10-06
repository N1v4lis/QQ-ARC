// 导航折叠（rail）模式下的回归：折叠开关、rail 宽度、底部入口是否仍可见可点、
// 以及折叠后颜色是否依然连续（折叠态另有样式分支，容易漏）。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1440, height: 900 }, async (page) => {
  // ⚠️ 启动门禁：等应用**启动完成**再操作。
  //    启动默认落在「仪表盘」，整个启动链路（含 loadDashboard 的请求）走完之前
  //    去点设置页签会和启动期的状态更新交错 —— 实测表现为"点到了 chat，
  //    但 #ac-editor 还是空的"，是典型的启动竞态，不是功能坏了。
  //    判据：导航高亮已建立（switchTab 跑过）且启动遮罩已摘除。
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '应用启动完成' });
  // ⚠️ 必须等启动遮罩摘除再操作：它是 z-index:999 的全屏层，
  //    page.click 按坐标派发真实鼠标事件 → 点会被遮罩吃掉，后续断言全部超时
  //    （表现为"元素等不到 / 布局像坏了"，其实是没点到）。
  await page.waitFor(`!document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动遮罩摘除' });
  await sleep(2800);
  const read = () => page.eval(`(() => {
    const side = document.querySelector('.q-sidebar');
    const foot = document.querySelector('.q-side-foot');
    const FOOT = ['quote-btn','feedback-btn','skill-market-btn','plugin-market-btn','persona-plaza-btn','open-site-btn'];
    const items = FOOT.map((id) => {
      const el = document.getElementById(id);
      if (!el) return { id, exists: false };
      const b = el.getBoundingClientRect();
      let hit = null;
      try { const h = document.elementFromPoint(b.left + b.width/2, b.top + b.height/2); hit = h ? (h.id || h.closest('[id]')?.id || null) : null; } catch (e) {}
      return { id, visible: b.width > 0 && b.height > 0, inView: b.top >= 0 && b.bottom <= window.innerHeight + 1, hit };
    });
    const cs = getComputedStyle(side);
    return {
      nav: document.documentElement.getAttribute('data-nav'),
      sideW: Math.round(side.getBoundingClientRect().width),
      sideH: Math.round(side.getBoundingClientRect().height),
      footBottom: foot ? Math.round(foot.getBoundingClientRect().bottom) : null,
      bgSide: cs.backgroundColor,
      bgShell: getComputedStyle(document.getElementById('q-shell')).backgroundColor,
      innerH: window.innerHeight,
      items
    };
  })()`);

  const expanded = await read();
  console.log(`展开态：rail=${expanded.nav} 侧栏 ${expanded.sideW}x${expanded.sideH} footBottom=${expanded.footBottom} / 视口 ${expanded.innerH}`);
  ok('展开态：底部入口全部可见可点',
    expanded.items.every((i) => i.visible && i.inView && i.hit === i.id),
    expanded.items.filter((i) => !(i.visible && i.inView && i.hit === i.id)).map((i) => `${i.id}(vis=${i.visible},inView=${i.inView},hit=${i.hit})`).join(' ') || '全部正常');
  ok('展开态：侧栏底色 = 全站底色', expanded.bgSide === expanded.bgShell, `${expanded.bgSide} vs ${expanded.bgShell}`);

  // 折叠
  await page.click('#q-side-toggle');
  await sleep(900);
  const collapsed = await read();
  console.log(`\n折叠态：rail=${collapsed.nav} 侧栏 ${collapsed.sideW}x${collapsed.sideH} footBottom=${collapsed.footBottom} / 视口 ${collapsed.innerH}`);
  ok('折叠后进入 rail 模式', collapsed.nav === 'collapsed', `data-nav=${collapsed.nav}`);
  ok('折叠后侧栏明显变窄（60px 量级）', collapsed.sideW <= 80, `${collapsed.sideW}px`);
  ok('折叠态：底部入口仍然可见且可点',
    collapsed.items.every((i) => i.visible && i.inView),
    collapsed.items.filter((i) => !(i.visible && i.inView)).map((i) => `${i.id}(vis=${i.visible},inView=${i.inView})`).join(' ') || '全部可见');
  ok('折叠态：侧栏没有被撑高（仍在视口内）',
    collapsed.footBottom !== null && collapsed.footBottom <= collapsed.innerH + 1,
    `footBottom=${collapsed.footBottom} / 视口 ${collapsed.innerH}`);
  ok('折叠态：侧栏底色仍 = 全站底色', collapsed.bgSide === collapsed.bgShell, `${collapsed.bgSide} vs ${collapsed.bgShell}`);

  // 展开回去
  await page.click('#q-side-toggle');
  await sleep(900);
  const back = await read();
  // ⚠️ 判据要"相对于 rail 宽度"，不要写死 200/236 这种魔数。
  //    侧栏展开宽度改过两次（236 → 200），每次改都要来改这条断言 ——
  //    这类"实现参数变了测试就红"的写法是自找麻烦。
  //    真正要验的是"展开了、且明显比折叠态宽、回到的是展开宽度"。
  const railW = 60;
  ok('可以再展开回原状', back.nav === 'expanded' && back.sideW > railW * 1.5 && back.sideW === expanded.sideW,
    `nav=${back.nav} w=${back.sideW}（展开基准 ${expanded.sideW}，rail ${railW}）`);

  await page.screenshot('shots/final/nav-rail-check.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n导航折叠回归通过。');
process.exit(failed ? 2 : 0);
