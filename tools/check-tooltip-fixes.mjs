// 悬停提示四项修正的验收：
//   ① 成本不再是 4 位小数（统一 ¥x.xx）
//   ② 顶点判定收严：命中区只覆盖顶点附近，不再"整条竖带任意高度都触发"
//   ③ 有出现/消失的轻动效（opacity + transform 过渡）
//   ④ 提示框不遮挡曲线：与顶点之间有净空，且带指向箭头
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1600, height: 1000 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '应用启动完成' });
  await page.waitFor(`document.querySelector('#dashboard-page .dc-wrap .dc-hit')`, { timeout: 40000, label: '折线图命中区' });
  await sleep(1000);

  // ── ② 命中区收紧 ─────────────────────────────────────────────────────
  const hit = await page.eval(`(() => {
    const wrap = document.querySelector('#dashboard-page .dc-wrap');
    const svg = wrap.querySelector('.dc-chart');
    const hits = [...wrap.querySelectorAll('.dc-hit')];
    const box = svg.getBoundingClientRect();
    const rects = hits.map((g) => { const r = g.querySelector('rect').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
    return {
      count: hits.length,
      rects,
      chartH: Math.round(box.height),
      // 命中区高度不应接近整图高度（那是上一版的"整条竖带"）
      maxHitH: Math.max(...rects.map((r) => r.h)),
      maxHitW: Math.max(...rects.map((r) => r.w))
    };
  })()`);
  console.log(`   命中区：${JSON.stringify(hit.rects)}，图高 ${hit.chartH}px`);
  ok('命中区不再覆盖整条竖带（高度远小于图高）', hit.maxHitH < hit.chartH * 0.5,
    `最大命中区高 ${hit.maxHitH}px / 图高 ${hit.chartH}px`);
  ok('命中区足够点中但不夸张（26~40px 量级）', hit.maxHitW <= 40 && hit.maxHitH <= 40,
    `${hit.maxHitW}x${hit.maxHitH}px`);

  // ── ① 成本两位小数 ──────────────────────────────────────────────────
  // 悬停到某个顶点，读提示里的成本文本
  const tip = await page.eval(`(async () => {
    const wrap = document.querySelector('#dashboard-page .dc-wrap');
    const hit = wrap.querySelector('.dc-hit');
    const r = hit.querySelector('rect').getBoundingClientRect();
    wrap.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    await new Promise((r2) => setTimeout(r2, 300));
    const el = wrap.querySelector('.dc-tip');
    return { text: el.textContent.replace(/\\s+/g, ' ').trim(), cls: el.className };
  })()`);
  console.log(`   提示内容：「${tip.text}」`);
  // 找所有 ¥ 后面的数字，检查小数位不超过 2
  const money = [...tip.text.matchAll(/¥([\d.]+)/g)].map((m) => m[1]);
  ok('提示里有金额', money.length > 0, `金额：${JSON.stringify(money)}`);
  const over2 = money.filter((m) => (m.split('.')[1] || '').length > 2);
  ok('成本不再是 4 位小数（统一 ≤2 位）', over2.length === 0,
    over2.length ? `仍有 ${JSON.stringify(over2)}` : `全部合规：${JSON.stringify(money)}`);

  // ── ④ 提示框不遮挡曲线 ───────────────────────────────────────────────
  const geom = await page.eval(`(() => {
    const wrap = document.querySelector('#dashboard-page .dc-wrap');
    const tip = wrap.querySelector('.dc-tip');
    const on = wrap.querySelector('.dc-hit.on');
    if (!on) return { missing: 'no-on-hit' };
    const t = tip.getBoundingClientRect();
    const dot = on.querySelector('.dc-dot-hi').getBoundingClientRect();
    const wrapBox = wrap.getBoundingClientRect();
    // 垂直净空：提示框底边与顶点顶边之间（上方放置时为正）
    const above = tip.classList.contains('dc-tip-above');
    const gap = above ? (dot.top - t.bottom) : (t.top - dot.bottom);
    return {
      above,
      gap: Math.round(gap),
      tipBox: { l: Math.round(t.left - wrapBox.left), t: Math.round(t.top - wrapBox.top), w: Math.round(t.width), h: Math.round(t.height) },
      dot: { x: Math.round(dot.left - wrapBox.left + dot.width / 2), y: Math.round(dot.top - wrapBox.top + dot.height / 2) },
      wrapH: Math.round(wrapBox.height),
      // 提示框是否与顶点垂直重叠（重叠 = 遮住了那个点）
      overlaps: !(t.bottom <= dot.top + 1 || t.top >= dot.bottom - 1),
      hasArrow: !!getComputedStyle(tip, '::after').content && getComputedStyle(tip, '::after').content !== 'none'
    };
  })()`);
  if (geom.missing) { ok('悬停命中了一个顶点', false, geom.missing); }
  else {
    console.log(`   顶点 (${geom.dot.x},${geom.dot.y})，提示框 ${JSON.stringify(geom.tipBox)}，${geom.above ? '在顶点上方' : '在顶点下方'}，净空 ${geom.gap}px`);
    ok('提示框不与顶点垂直重叠（没盖住那个点）', geom.overlaps === false, `overlaps=${geom.overlaps}`);
    ok('与顶点之间有净空（≥8px，避开曲线）', geom.gap >= 8, `${geom.gap}px`);
    ok('提示框整体在图表范围内（不溢出卡片）',
      geom.tipBox.l >= -1 && geom.tipBox.t >= -1 && geom.tipBox.t + geom.tipBox.h <= geom.wrapH + 4,
      `top=${geom.tipBox.t}，h=${geom.tipBox.h}，容器高 ${geom.wrapH}`);
    ok('有指向顶点的小箭头', geom.hasArrow, `::after content=${geom.hasArrow}`);
  }

  // ── ③ 动效（过渡） ──────────────────────────────────────────────────
  const anim = await page.eval(`(() => {
    const tip = document.querySelector('#dashboard-page .dc-tip');
    const cs = getComputedStyle(tip);
    return {
      transition: cs.transitionProperty,
      duration: cs.transitionDuration,
      opacity: cs.opacity,
      // 变体：hover 时有更强的 shadow / 更实的颜色
      hasShadow: cs.boxShadow !== 'none'
    };
  })()`);
  console.log(`   过渡：${anim.transition} / ${anim.duration}`);
  ok('提示框有 opacity 过渡（淡入淡出）', /opacity/.test(anim.transition), anim.transition);
  ok('提示框有 transform 过渡（轻微位移/缩放）', /transform/.test(anim.transition), anim.transition);
  const firstDur = String(anim.duration).split(',')[0].trim();
  ok('过渡时长非零（真的会动，不是瞬切）', parseFloat(firstDur) > 0, firstDur);

  // ── 顺带回归：整卡不与提示冲突 ──────────────────────────────────────
  await page.screenshot('shots/final/dashboard-tip.png');
  console.log('\n截图：shots/final/dashboard-tip.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n悬停提示四项修正验收通过。');
process.exit(failed ? 2 : 0);
