// 四项验收：
//   ① 信息卡主要信息字号变小（.db-value）
//   ② 会话排行是**柱形图**（存在 .dc-bar-chart 与 .dc-bar）
//   ③ 用量趋势顶点悬停有**可见的提示**（自绘 .dc-tip，不是原生 <title>）
//   ④ 用量趋势的纵轴刻度是 CNY 写法（¥ 前缀、无两位小数）
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1600, height: 1000 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '应用启动完成' });
  await page.waitFor(`document.querySelector('#dashboard-page .dash-box[data-goto] .db-label:not(.ds-ph)')`, { timeout: 40000, label: '真实卡片' });
  await page.waitFor(`document.querySelector('#dashboard-page .dc-line')`, { timeout: 20000, label: '趋势折线' });
  await sleep(1200);

  // ── ① 卡片主字字号 ───────────────────────────────────────────────────
  const fs = await page.eval(`(async () => {
    const v = document.querySelector('#dashboard-page .db-value');
    return { value: getComputedStyle(v).fontSize, label: getComputedStyle(document.querySelector('#dashboard-page .db-label')).fontSize };
  })()`);
  const px = parseFloat(fs.value);
  ok('信息卡主字号已调小（≤22px）', px <= 22, `.db-value=${fs.value}（.db-label=${fs.label}）`);

  // ── ④ 纵轴刻度是 CNY 写法 ────────────────────────────────────────────
  // ⚠️ 必须**只取折线图**的刻度。原来写的是 `.dc-chart .dc-ytick`，
  //    而柱形图也带 .dc-chart 类 → 把"4546 / 3410"（次数）一起抓进来了，
  //    于是"刻度都带 ¥"这条断言被自己的选择器搞失败。
  //    折线图的选择器用 .dc-wrap 里的 svg（柱形图没有 .dc-wrap）。
  const ticks = await page.eval(`[...document.querySelectorAll('#dashboard-page .dc-wrap .dc-ytick')].map((t) => t.textContent.trim())`);
  console.log('   折线图纵轴刻度：', JSON.stringify(ticks));
  ok('折线图纵轴刻度带 ¥（人民币计量）', ticks.length > 0 && ticks.every((t) => t === '0' || t.startsWith('¥')), JSON.stringify(ticks));
  // 用户明确说"不应该用小数点后两位" —— 检查是否还有 x.xx 这种刻度
  const twoDec = ticks.filter((t) => /\.\d{2}$/.test(t));
  ok('纵轴刻度不再出现两位小数', twoDec.length === 0, twoDec.length ? `仍有 ${JSON.stringify(twoDec)}` : '无');

  // ── ③ 悬停提示 ───────────────────────────────────────────────────────
  // 把鼠标移到某个点的命中区中心，检查 .dc-tip 是否出现且内容非空
  const hover = await page.eval(`(async () => {
    const wrap = document.querySelector('#dashboard-page .dc-wrap');
    const hit = wrap.querySelector('.dc-hit');
    if (!hit) return { missing: 'hit' };
    const r = hit.querySelector('rect').getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // 派发真实 mousemove（处理函数用 elementFromPoint 取元素，所以坐标要对）
    wrap.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
    await new Promise((r2) => setTimeout(r2, 250));
    const tip = wrap.querySelector('.dc-tip');
    return {
      on: tip.classList.contains('on'),
      text: tip.textContent.replace(/\\s+/g, ' ').trim(),
      visible: getComputedStyle(tip).display !== 'none',
      dotsOn: wrap.querySelectorAll('.dc-hit.on').length,
      hasTip: !!tip,
      hitH: Math.round(hit.querySelector('rect').getBoundingClientRect().height),
      // 折线图内还有几个原生 <title>（期望 0 —— 已改自绘）
      lineTitle: wrap.querySelectorAll('title').length
    };
  })()`);
  if (hover.missing) { ok('折线图有命中区', false, hover.missing); }
  else {
    ok('悬停后提示出现且可见', hover.on && hover.visible, `on=${hover.on} display-visible=${hover.visible}`);
    ok('提示内容有实际信息（日期+数值）', hover.text.length > 3, `内容「${hover.text}」`);
    ok('命中的点被高亮（参考线/高亮点）', hover.dotsOn >= 1, `高亮 ${hover.dotsOn} 个`);
    // ⚠️ 只查**折线图**里的 title。柱形图里保留 <title> 是刻意的（柱子上悬停看精确值），
    //    用户抱怨的是折线图"顶点放上去没有信息"。
    //    原来这条断言写 .dc-chart title，把柱形图的 4 个 title 也算进来了 →
    //    一个正确的实现被判失败，纯粹是选择器范围写错。
    ok('折线图已不再依赖原生 <title> 提示（改用自绘 .dc-tip）',
      hover.lineTitle === 0 && hover.hasTip === true,
      `折线图内 title ${hover.lineTitle} 个，自绘提示元素 ${hover.hasTip ? '存在' : '缺失'}`);
    // ⚠️ 这条断言随设计变更更新过：命中区**故意**从"整高竖带"收紧成顶点附近的小方块
    //    （用户反馈判定太松）。所以这里改判"足够点中但不夸张"，
    //    而不是原来那条"必须有 100px 高"——那条现在与设计相反。
    ok('折线图命中区大小合理（够点中但不夸张）',
      hover.hitH >= 20 && hover.hitH <= 48, `命中区高 ${hover.hitH}px`);
  }

  // ── ② 会话排行是柱形图 ───────────────────────────────────────────────
  const bar = await page.eval(`(() => {
    const card = [...document.querySelectorAll('#dashboard-page .dash-card')].find((c) => /会话排行/.test(c.textContent));
    if (!card) return { missing: 'card' };
    const svg = card.querySelector('svg.dc-bar-chart');
    const bars = card.querySelectorAll('.dc-bar');
    const names = [...card.querySelectorAll('.dc-bar-name')].map((t) => t.textContent.trim());
    const vals = [...card.querySelectorAll('.dc-bar-val')].map((t) => t.textContent.trim());
    // 柱子确实有高度差（真的是"柱形"而不是一条线）
    const heights = [...bars].map((b) => Number(b.getAttribute('height'))).filter((n) => n > 0);
    return {
      hasSvg: !!svg, bars: bars.length, names, vals,
      heights: heights.slice(0, 6),
      distinct: new Set(heights.map((h) => Math.round(h))).size,
      // 旧的进度条列表形态应该已经不在
      legacyProgress: card.querySelectorAll('.dp-list').length
    };
  })()`);
  ok('会话排行渲染为柱形图（svg.dc-bar-chart）', bar.hasSvg === true, `svg=${bar.hasSvg}`);
  ok('柱形数量与数据条数一致（≥3）', bar.bars >= 3, `${bar.bars} 根柱子`);
  ok('柱高有差异（是真柱形图，不是等高）', bar.distinct >= 2, `不同高度 ${bar.distinct} 种：${JSON.stringify(bar.heights)}`);
  ok('每根柱子都带名字与数值', bar.names.length === bar.bars && bar.vals.length === bar.bars,
    `名字 ${bar.names.length} / 数值 ${bar.vals.length}`);
  ok('旧的进度条列表形态已移除', bar.legacyProgress === 0, `残留 .dp-list ${bar.legacyProgress} 个`);
  console.log(`   柱名：${JSON.stringify(bar.names.slice(0, 4))}`);
  console.log(`   柱值：${JSON.stringify(bar.vals.slice(0, 4))}`);

  await page.screenshot('shots/final/dashboard-charts.png');
  console.log('\n截图：shots/final/dashboard-charts.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n字号/柱形图/悬停提示/CNY 刻度验收通过。');
process.exit(failed ? 2 : 0);
