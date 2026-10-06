// 遮挡的最终判定：截图 + elementFromPoint 逐点命中。
// "几何相交"不等于"视觉遮挡"（祖先元素的 overflow:hidden 会裁掉）。
// 真正说明问题的是：滑条矩形内取若干点，看 hit-test 命中的是不是滑条自己。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
const OUT = process.argv[3] || 'shots/final/overlap-check.png';

await withPage({ url: URL_, width: 1400, height: 900 }, async (page) => {
  // 启动门禁：等启动链路走完再操作（启动默认落点是仪表盘）。
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '应用启动完成' });
  await page.click('#tabs .tab[data-tab="settings"]');
  await page.waitFor(`document.querySelector('.settings-menu-item[data-section="chat"]')`, { timeout: 25000, label: '设置菜单' });
  await page.click('.settings-menu-item[data-section="chat"]');
  // ⚠️ 峰谷滑条在「活跃设置」折叠卡内部，卡关闭时是 display:none ——
  //    必须先展开再量，否则永远"找不到滑条"（这正是之前那个遮挡 bug 的修法）。
  await page.waitFor(`document.getElementById('card-active-config')`, { timeout: 20000, label: '活跃设置卡' });
  await page.eval(`(() => {
    const card = document.getElementById('card-active-config');
    if (card && !card.classList.contains('open')) {
      const h = card.querySelector('.fold-head'); if (h) h.click();
    }
    return 1;
  })()`);
  await page.waitFor(`(() => {
    const s = document.querySelector('.ac-tier-wrap .tier-scale');
    if (!s) return false;
    const r = s.getBoundingClientRect();
    return r.width > 100 && r.height > 10;
  })()`, { timeout: 20000, label: '峰谷滑条可见' });

  const r = await page.eval(`(() => {
    const scale = document.querySelector('.ac-tier-wrap .tier-scale');
    if (!scale) return { missing: true };
    const sr = scale.getBoundingClientRect();
    const probes = [];
    // 在滑条矩形内均匀取点，看命中的最上层元素是不是滑条（或其子元素）
    for (const fx of [0.1, 0.5, 0.9]) {
      for (const fy of [0.2, 0.5, 0.8]) {
        const x = sr.left + sr.width * fx;
        const y = sr.top + sr.height * fy;
        const el = document.elementFromPoint(x, y);
        probes.push({
          at: fx + ',' + fy,
          hit: el ? (el.id || String(el.className || '').slice(0, 30) || el.tagName) : null,
          isScale: !!(el && (el === scale || scale.contains(el)))
        });
      }
    }
    // 关闭卡的 body 内容有没有真的被裁掉：取它下方 10px 处的点，看命中谁
    const closed = document.querySelector('#card-send-config .fold-inner');
    const cr = closed ? closed.getBoundingClientRect() : null;
    const below = cr ? document.elementFromPoint(cr.left + 40, cr.bottom + 12) : null;
    return {
      scaleBox: { x: Math.round(sr.x), y: Math.round(sr.y), w: Math.round(sr.width), h: Math.round(sr.height) },
      probes,
      allHitsScale: probes.every((p) => p.isScale),
      closedInnerBox: cr ? { y: Math.round(cr.y), h: Math.round(cr.height) } : null,
      belowClosedHit: below ? (below.id || String(below.className || '').slice(0, 40) || below.tagName) : null
    };
  })()`);

  if (r.missing) { console.log('✗ 找不到滑条'); return; }
  console.log('滑条框：', JSON.stringify(r.scaleBox));
  console.log('9 点命中测试：');
  for (const p of r.probes) console.log(`  (${p.at}) → ${p.hit}  在滑条内=${p.isScale}`);
  console.log(`\n全部命中滑条本身：${r.allHitsScale ? '是 ✔（没有东西压在滑条上）' : '否 ✗（有元素遮挡）'}`);
  console.log(`关闭卡 fold-inner：${JSON.stringify(r.closedInnerBox)}；其下方 12px 处命中：${r.belowClosedHit}`);

  await page.screenshot(OUT);
  console.log(`\n截图：${OUT}`);
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
