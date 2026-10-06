// 三项验收：
//   ① Beta 徽章尺寸（用户已三次要求放大）
//   ② 仪表盘 5 张信息卡在**不同窗口宽度下位置不变**（用户要"固定在同一个位置"）
//   ③ 这 5 张卡点击后跳用量页，且**对应区块**高亮闪烁（次数 = --q-flash-count）
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

// 5 张卡各自的 (标签, 期望高亮的 data-card 集合)
const CARDS = [
  ['调用次数', ['runs']],
  ['估算成本', ['cost']],
  ['Token 总量', ['prompt', 'completion']],
  ['缓存命中率', ['rate']],
  ['联网搜索', ['search']]
];

await withPage({ url: URL_, width: 1600, height: 1000 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '应用启动完成' });
  // ⚠️ 必须先等**真实卡片**（不是骨架）：仪表盘会先画一批 .dash-box 骨架
  //    （带 .ds-ph、没有 data-goto、标签是 &nbsp;），数据回来后才整页重建。
  //    只等 `.dash-box` 存在会命中骨架 → 标签读出来是空、data-goto 也是 null，
  //    于是"卡片不存在"这种假失败。判据用 data-goto（只有真实卡片才有）。
  await page.waitFor(`document.querySelector('#dashboard-page .dash-box[data-goto] .db-label:not(.ds-ph)')`, { timeout: 40000, label: '信息卡真实数据渲染' });
  await sleep(800);

  // ── ① 徽章尺寸 ───────────────────────────────────────────────────────
  const badge = await page.eval(`(() => {
    const b = document.querySelector('#dashboard-page .dash-beta-badge');
    if (!b) return { missing: true };
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  ok('Beta 徽章已放大（≥70px）', badge.w >= 70 && badge.h >= 70, `${badge.w}x${badge.h}px`);

  // ── ② 位置稳定性：三种宽度下量 5 张卡的中心点 ────────────────────────
  // "位置会移动"的判据：卡片的**列序**与**相对顺序**在宽度变化时保持不变。
  // 记录每张卡的 (列, 行)：用第一排 5 张卡的 left 排序得出列号。
  const measure = async (w, h) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    return page.eval(`(() => {
      const boxes = [...document.querySelectorAll('#dashboard-page .dash-boxes')][0];
      if (!boxes) return { missing: true };
      const cards = [...boxes.querySelectorAll('.dash-box')];
      const rows = cards.map((c) => { const r = c.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), label: (c.querySelector('.db-label') || {}).textContent || '' }; });
      // 按 top 分组得到行，再按 left 排序得到列 → (row, col) 位置坐标
      const tops = [...new Set(rows.map((r) => r.t))].sort((a, b) => a - b);
      return {
        pos: cards.map((c, i) => {
          const r = rows[i];
          return { label: r.label, row: tops.indexOf(r.t), col: rows.filter((x) => x.t === r.t).sort((a, b) => a.l - b.l).findIndex((x) => x.l === r.l), w: r.w };
        }),
        count: cards.length
      };
    })()`);
  };
  const wide = await measure(1600, 1000);
  const mid = await measure(1180, 900);
  const narrow = await measure(1000, 900);

  ok('第一排固定 5 张卡', wide.count === 5, `实测 ${wide.count} 张`);
  const seq = (m) => (m.pos || []).map((p) => `${p.row}:${p.col}:${p.label}`).join(' | ');
  console.log(`   1600px：${seq(wide)}`);
  console.log(`   1180px：${seq(mid)}`);
  console.log(`   1000px：${seq(narrow)}`);
  // 位置稳定 = 三档下每张卡的 (row, col) 完全一致
  const posOf = (m) => (m.pos || []).map((p) => `${p.row},${p.col}`).join(';');
  ok('窗口变窄时卡片位置不变（row/col 一致）', posOf(wide) === posOf(mid) && posOf(mid) === posOf(narrow),
    `${posOf(wide)} vs ${posOf(mid)} vs ${posOf(narrow)}`);

  // 恢复宽窗口
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(700);

  // ── ③ 点击跳转 + 目标区块高亮 ────────────────────────────────────────
  const flashCount = await page.eval(`getComputedStyle(document.documentElement).getPropertyValue('--q-flash-count').trim()`);
  ok('闪烁次数令牌为 2', flashCount === '2', `--q-flash-count=${flashCount}`);

  for (const [label, expectCards] of CARDS) {
    // 回仪表盘
    await page.click('#tabs .tab[data-tab="dashboard"]');
    await page.waitFor(`document.querySelector('#dashboard-page .dash-box[data-goto] .db-label:not(.ds-ph)')`, { timeout: 30000, label: '仪表盘真实卡片' });
    await sleep(500);
    const clicked = await page.eval(`(() => {
      const boxes = [...document.querySelectorAll('#dashboard-page .dash-boxes')][0];
      const card = [...boxes.querySelectorAll('.dash-box')].find((c) => (c.querySelector('.db-label') || {}).textContent === ${JSON.stringify(label)});
      if (!card) return { missing: true };
      card.click();
      return { flash: card.dataset.flash || null, goto: card.dataset.goto || null };
    })()`);
    if (clicked.missing) { ok(`「${label}」卡存在且可点`, false); continue; }

    // 跳到用量页并等目标卡出现 + 高亮类被加上
    const got = await page.eval(`(async () => {
      const t0 = performance.now();
      const want = ${JSON.stringify(expectCards)};
      let hit = [];
      while (performance.now() - t0 < 12000) {
        await new Promise((r) => setTimeout(r, 120));
        const flashing = [...document.querySelectorAll('.is-flash-target')]
          .map((el) => el.dataset.card || el.dataset.block || el.dataset.table || '');
        if (want.every((w) => flashing.includes(w))) { hit = flashing; break; }
      }
      return {
        tab: state.tab,
        hit,
        // 顺手记下动画名与次数，确认真的在"闪"
        anim: (() => { const el = document.querySelector('.is-flash-target'); return el ? getComputedStyle(el).animationName : null; })(),
        iter: (() => { const el = document.querySelector('.is-flash-target'); return el ? getComputedStyle(el).animationIterationCount : null; })()
      };
    })()`);
    ok(`「${label}」→ 跳用量页并高亮 [${expectCards.join('+')}]`,
      got.tab === 'usage' && expectCards.every((w) => got.hit.includes(w)),
      `tab=${got.tab}，实际高亮=${JSON.stringify(got.hit)}，动画=${got.anim}×${got.iter}，卡的 flash=${clicked.flash}`);
  }

  // 等闪烁收尾，确认类被摘掉（不留残影）
  await sleep(2600);
  const leftover = await page.eval(`document.querySelectorAll('.is-flash-target').length`);
  ok('闪烁结束后不残留高亮类', leftover === 0, `残留 ${leftover} 个`);

  await page.screenshot('shots/final/dashboard-fixed-cards.png');
  console.log('\n截图：shots/final/dashboard-fixed-cards.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n信息卡定位与跳转高亮验收通过。');
process.exit(failed ? 2 : 0);
