// 验收：Beta 通告在 dashboard 滚动时钉在原位（位置完全不变）。
//
// 判据设计（这是本用例的重点）：
//   "钉住"不是"还看得见"，而是**屏幕坐标一字不差**。
//   所以对比的是 getBoundingClientRect().top 的**绝对值**，而不是"是否在视口内" ——
//   后者在"只滚一点点、通告还没到顶"时也会成立，会把未钉住的实现判通过。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

// ⚠️ 视口要"矮"一点，否则 dashboard 内容只比视口高十几像素、滚不动，
//    "钉住"这条就无从验证（1440×760 时实测只能滚 22px）。
//    560px 高大约能滚 130px+，足够覆盖"通告从起始位置滚到贴顶"的全过程。
await withPage({ url: URL_, width: 1440, height: 560 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '启动动画与应用就绪后检查通告' });
  await page.waitFor(`document.querySelector('#dashboard-page .dash-beta')`, { timeout: 30000, label: 'Beta 通告' });
  await sleep(1500);

  // ── 确认钉住的实现方式与前提 ──────────────────────────────────────────
  const impl = await page.eval(`(() => {
    const beta = document.querySelector('#dashboard-page .dash-beta');
    const pane = document.getElementById('dashboard-page');
    const wrap = beta.closest('.dash-wrap');
    const cs = getComputedStyle(beta);
    return {
      position: cs.position,
      top: cs.top,
      zIndex: cs.zIndex,
      // sticky 的前提：所有祖先的 overflow 必须是 visible（scroll 容器的 padding 除外）
      wrapOverflow: wrap ? getComputedStyle(wrap).overflowY : null,
      paneScrollable: pane.scrollHeight > pane.clientHeight + 4,
      paneOverflow: getComputedStyle(pane).overflowY,
      paneScrollH: pane.scrollHeight,
      paneClientH: pane.clientHeight
    };
  })()`);
  console.log(`   实现：position=${impl.position} top=${impl.top} z-index=${impl.zIndex}`);
  console.log(`   滚动容器 #dashboard-page：${impl.paneScrollH} / ${impl.paneClientH}px，可滚动=${impl.paneScrollable}`);
  ok('通告用 sticky 钉住', impl.position === 'sticky', `position=${impl.position}`);
  ok('sticky 的前提成立（.dash-wrap 无 overflow 裁剪）',
    impl.wrapOverflow === 'visible', `.dash-wrap overflowY=${impl.wrapOverflow}`);
  ok('dashboard 确实可滚动（否则"钉住"无从验证）', impl.paneScrollable === true,
    `${impl.paneScrollH} / ${impl.paneClientH}`);

  // ── 滚到底：通告的屏幕位置必须一字不变 ────────────────────────────────
  const before = await page.eval(`(() => {
    const b = document.querySelector('#dashboard-page .dash-beta').getBoundingClientRect();
    const head = document.querySelector('#dashboard-page .dash-head');
    return { top: b.top, left: b.left, w: b.width, h: b.height, headTop: head.getBoundingClientRect().top };
  })()`);

  // 分几步滚，每步都记录位置（能顺带看出是"全程不动"还是"滚一段才贴住"）
  const samples = await page.eval(`(async () => {
    const pane = document.getElementById('dashboard-page');
    const out = [];
    const snap = (why) => {
      const b = document.querySelector('#dashboard-page .dash-beta').getBoundingClientRect();
      out.push({ why, scrollTop: Math.round(pane.scrollTop), top: Math.round(b.top), left: Math.round(b.left) });
    };
    snap('起点');
    const max = pane.scrollHeight - pane.clientHeight;
    for (const frac of [0.25, 0.5, 0.75, 1]) {
      pane.scrollTop = Math.round(max * frac);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      snap('滚到 ' + Math.round(frac * 100) + '%');
    }
    // 再往回滚一点
    pane.scrollTop = Math.round(max * 0.4);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    snap('回滚到 40%');
    return out;
  })()`);
  console.log('   滚动采样：' + samples.map((s) => `${s.why} scroll=${s.scrollTop} top=${s.top}`).join(' | '));

  // 去掉起点（起点还没贴顶，top 本来就不同），只看"贴住之后"是否恒定
  const pinned = samples.slice(1);
  const tops = pinned.map((s) => s.top);
  const same = tops.every((t) => Math.abs(t - tops[0]) <= 1);
  ok('滚动后通告的屏幕 Y 坐标完全不变（±1px）', same, `贴顶后各次 top = ${tops.join(', ')}`);
  ok('通告钉住的位置就是可视区顶部', Math.abs(pinned[0].top - before.top) <= 1 || pinned[0].top <= before.top + 1,
    `起点 ${Math.round(before.top)} → 贴顶 ${pinned[0].top}`);

  // ── 确实"盖在"滚动内容之上（不是被内容压住） ─────────────────────────
  const overlap = await page.eval(`(() => {
    const beta = document.querySelector('#dashboard-page .dash-beta');
    const b = beta.getBoundingClientRect();
    // 通告中心点处的命中元素应该还是通告自己
    const hit = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
    return {
      hitInsideBeta: !!hit && beta.contains(hit),
      hitCls: hit ? (hit.className || hit.tagName) : null,
      pinnedClass: beta.classList.contains('is-pinned')
    };
  })()`);
  ok('通告浮在滚动内容之上（中心点命中自己）', overlap.hitInsideBeta === true, `命中 ${overlap.hitCls}`);
  ok('已钉住时加 .is-pinned（用于投影）', overlap.pinnedClass === true, '');

  // ── 通告本身内容没有被压扁/裁切 ──────────────────────────────────────
  // ⚠️ 判据要"相对内容"，不要写死一个猜测的高度区间。
  //    第一版写 84~110px 直接失败（实测 158px）—— 因为 158px 是**本来就有的**高度：
  //    徽章 72px + padding 30px ≈ 102px，但 .dash-beta-inner 实测 126px
  //    （宋体线条 + 行高的组合结果），这是钉住之前就存在的事实，与 sticky 无关。
  //    写死区间等于把"我猜的高度"当成需求，改一次字体就会红。
  //    真正要验的是"内容完整、没有被裁掉"。
  const intact = await page.eval(`(() => {
    const beta = document.querySelector('#dashboard-page .dash-beta');
    const badge = beta.querySelector('.dash-beta-badge');
    const inner = beta.querySelector('.dash-beta-inner');
    const text = beta.querySelector('.dash-beta-text');
    const b = beta.getBoundingClientRect();
    const cs = getComputedStyle(beta);
    const padT = parseFloat(cs.paddingTop), padB = parseFloat(cs.paddingBottom);
    const innerH = inner.getBoundingClientRect().height;
    return {
      h: Math.round(b.height),
      innerH: Math.round(innerH),
      // 内容高度 + 上下内边距 应该约等于元素高度（差值 >2px 说明内容被裁）
      expected: Math.round(innerH + padT + padB),
      badgeW: badge ? Math.round(badge.getBoundingClientRect().width) : null,
      textH: text ? Math.round(text.getBoundingClientRect().height) : null,
      lines: beta.querySelectorAll('.dash-beta-line').length,
      badgeOverflows: badge ? badge.getBoundingClientRect().bottom > b.bottom + 1 : null
    };
  })()`);
  ok('通告高度与内容一致（内容没有被裁）', Math.abs(intact.h - intact.expected) <= 2,
    `高 ${intact.h}px，内容+内边距 = ${intact.expected}px（徽章 ${intact.badgeW}px，文字块 ${intact.textH}px）`);
  ok('徽章与两行文字都还在', intact.badgeW > 0 && intact.lines === 2 && intact.badgeOverflows === false,
    `徽章 ${intact.badgeW}px，文字 ${intact.lines} 行`);

  // ── 滚回顶部后应恢复"未钉住"（不该一直带投影） ───────────────────────
  const restored = await page.eval(`(async () => {
    const pane = document.getElementById('dashboard-page');
    pane.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 600));
    const beta = document.querySelector('#dashboard-page .dash-beta');
    return { pinned: beta.classList.contains('is-pinned'), top: Math.round(beta.getBoundingClientRect().top) };
  })()`);
  ok('滚回顶部后取消钉住态（投影消失）', restored.pinned === false, `pinned=${restored.pinned} top=${restored.top}`);

  await page.eval(`(() => { const p = document.getElementById('dashboard-page'); p.scrollTop = p.scrollHeight; return 1; })()`);
  await sleep(500);
  await page.screenshot('shots/final/beta-pinned.png');
  console.log('\n截图：shots/final/beta-pinned.png（已滚到底）');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\nBeta 通告钉住验收通过。');
process.exit(failed ? 2 : 0);
