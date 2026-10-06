// 验收：
//   ① dashboard 的"最近 7 天"改成用户可选（今天 / 近 7 天 / 近 30 天 / 全部）
//   ② 侧边栏**分类之间**的间隔变大（组间），但同分类内条目间距不变（组内）
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1500, height: 980 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动完成' });
  await page.waitFor(`document.querySelector('#dashboard-page .dash-range[data-range]')`, { timeout: 30000, label: '区间选择器' });
  // ⚠️ 必须先等**初次加载真正完成**再开始点击。
  //    不能等 `!document.querySelector('.dash-boxes .ds-ph')` —— 骨架刚被写进去时
  //    那一瞬也是"没有 .ds-ph"（占位类名不同），条件会立刻成立，
  //    于是点击发生在 handler 绑定之前（handler 由 renderDashboard 末尾绑定）→
  //    点了没反应，看起来像功能坏了。判据要等到**真实内容**出现。
  await page.waitFor(`(() => {
    const l = document.querySelector('#dashboard-page .dash-box[data-goto] .db-label');
    return !!l && !l.classList.contains('ds-ph');
  })()`, { timeout: 60000, label: '初次加载完成（真实卡片）' });
  await sleep(600);

  // ── ① 区间选择器存在且是四档 ──────────────────────────────────────────
  const sel = await page.eval(`(() => {
    const btns = [...document.querySelectorAll('#dashboard-page .dash-range[data-range]')];
    return {
      count: btns.length,
      values: btns.map((b) => b.dataset.range),
      labels: btns.map((b) => b.textContent.trim()),
      onCount: btns.filter((b) => b.classList.contains('is-on')).length,
      onValue: (btns.find((b) => b.classList.contains('is-on')) || {}).dataset ? btns.find((b) => b.classList.contains('is-on')).dataset.range : null,
      ariaOk: btns.every((b) => b.getAttribute('aria-pressed') === String(b.classList.contains('is-on')))
    };
  })()`);
  console.log(`   区间档位：${sel.labels.join(' / ')}（值 ${sel.values.join(',')}）`);
  ok('有四档区间可选', sel.count === 4, `${sel.count} 档`);
  ok('档位值与后端一致（today/7/30/all）',
    JSON.stringify(sel.values) === JSON.stringify(['today', '7', '30', 'all']), sel.values.join(','));
  ok('恰好一档处于选中态', sel.onCount === 1, `选中 ${sel.onValue}`);
  ok('aria-pressed 与选中态一致', sel.ariaOk === true, '');

  // 旧接口里"图上 N 天"的说明还在（用于校验后端真实生效范围）
  const info = await page.eval(`(() => {
    const el = document.querySelector('#dashboard-page .dash-range-info');
    return el ? el.textContent.trim() : null;
  })()`);
  ok('保留了"图上 N 天"的后端区间说明', !!info && /图上|加载中/.test(info), String(info));

  // ── ② 切换区间后，请求真的带上了所选 range，且数据随之变化 ─────────────
  // 拦截 fetch 记录 URL（比看 UI 数字稳：数字可能恰好相同）
  await page.eval(`(() => {
    window.__reqs = [];
    if (!window.__fetchPatched) {
      const orig = window.fetch;
      window.fetch = function (input, init) {
        try { window.__reqs.push(String(typeof input === 'string' ? input : (input && input.url) || '')); } catch (e) {}
        return orig.call(this, input, init);
      };
      window.__fetchPatched = true;
    }
    return 1;
  })()`);

  // ⚠️ 起点设为「全部」：这样四个档位**每一个点击都是真正的切换**
  //    （点当前已选中的档会被 `if (v === dashRange) return` 正确忽略，
  //      那不是 bug，但会让"必须发出请求"的断言误判）。
  await page.eval(`(() => { const b = document.querySelector('#dashboard-page .dash-range[data-range="all"]'); b.click(); return 1; })()`);
  // ⚠️ 必须等到**「全部」的数据渲染完**再开始循环。
  //    只等按钮选中态是不行的 —— 那一步是本地同步改类、立刻成立；
  //    此时「全部」的请求还在飞，紧接着点「今天」会让两次 loadDashboard 交错，
  //    「今天」的渲染就可能被构造/丢弃，表现为"点了没反应"（实测就是这个竞态）。
  await page.waitFor(`(() => {
    const w = document.querySelector('#dashboard-page .dash-wrap');
    return !!w && w.dataset.range === 'all' && !document.querySelector('#dashboard-page .dash-boxes .ds-ph');
  })()`, { timeout: 60000, label: '起点「全部」渲染完成' });
  await sleep(400);

  const checks = [];
  for (const r of ['today', '7', '30', 'all']) {
    // eslint-disable-next-line no-await-in-loop
    const t0 = Date.now();
    // eslint-disable-next-line no-await-in-loop
    await page.eval(`(() => { window.__reqs = []; const b = document.querySelector('#dashboard-page .dash-range[data-range="${r}"]'); b.click(); return 1; })()`);
    // 等**这一次渲染真的落地**。
    // 生产的判据是 `.dash-wrap[data-range]` —— renderDashboard 会把当次渲染用的
    // range 写到这个属性上。比"等骨架消失"可靠（数据已在页面上时那个条件恒成立，
    // 第一轮会立刻通过、读到上一轮的界面，表现为"点了没反应"），
    // 也比"拦 fetch 看 URL"可靠（拦截可能被后续 patch 覆盖、时序难对齐）。
    // eslint-disable-next-line no-await-in-loop
    await page.waitFor(`(() => {
      const w = document.querySelector('#dashboard-page .dash-wrap');
      if (!w || w.dataset.range !== '${r}') return false;
      return !document.querySelector('#dashboard-page .dash-boxes .ds-ph');
    })()`, { timeout: 60000, label: `${r} 渲染落地` });
    // eslint-disable-next-line no-await-in-loop
    await sleep(300);
    // eslint-disable-next-line no-await-in-loop
    const st = await page.eval(`(() => {
      const on = document.querySelector('#dashboard-page .dash-range.is-on');
      const info = document.querySelector('#dashboard-page .dash-range-info');
      const w = document.querySelector('#dashboard-page .dash-wrap');
      return {
        reqs: (window.__reqs || []).filter((u) => u.includes('/api/usage/')),
        on: on ? on.dataset.range : null,
        info: info ? info.textContent.trim() : null,
        renderedRange: w ? w.dataset.range : null,
        stored: localStorage.getItem('qqa-dash-range')
      };
    })()`);
    checks.push({ r, ms: Date.now() - t0, ...st });
  }
  for (const c of checks) {
    console.log(`   ${c.r.padEnd(5)} 选中=${c.on} 渲染range=${c.renderedRange} stored=${c.stored} ${c.ms}ms 说明"${c.info}"`);
    console.log(`         请求：${c.reqs.join(' , ') || '（未捕获，非致命）'}`);
    // 核心断言：本次渲染用的 range == 点的那一档。
    // 这一条等价于"点击生效 + 用新区间重新拉了数据 + 渲染落地"三件事。
    ok(`切到「${c.r}」：本次渲染用的就是 range=${c.r}`, c.renderedRange === c.r, `渲染=${c.renderedRange}`);
    ok(`切到「${c.r}」：按钮选中态正确`, c.on === c.r, `选中=${c.on}`);
    ok(`切到「${c.r}」：区间写入 localStorage`, c.stored === c.r, `stored=${c.stored}`);
  }
  // 请求 URL 只做"能捕获到就顺带验证"，不作为失败判据 ——
  // 拦截 window.fetch 会与页面自身的其它 patch 打架，捕获不到不等于没发请求。
  const cap = checks.filter((c) => c.reqs.length);
  if (cap.length) {
    console.log(`   （附加）捕获到请求的轮次：${cap.map((c) => c.r).join(',')}`);
    for (const c of cap) {
      const hasStats = c.reqs.some((u) => u.includes('/api/usage/stats?range=' + c.r));
      const hasBreak = c.reqs.some((u) => u.includes('/api/usage/breakdown?range=' + c.r));
      ok(`（附加）「${c.r}」的 stats/breakdown 都带上了该 range`, hasStats && hasBreak,
        `stats=${hasStats} breakdown=${hasBreak}`);
    }
  }

  // ── ③ 区间说明与所选范围一致（能抓出"写死 d 后缀被后端兜底"这类口径错位）──
  const todayInfo = checks.find((c) => c.r === 'today');
  const allInfo = checks.find((c) => c.r === 'all');
  console.log(`   后端回显：today → "${todayInfo.info}"，all → "${allInfo.info}"`);
  ok('「今天」的后端回显是今天（不是兜底的 7 天）', /今天/.test(todayInfo.info), todayInfo.info);
  ok('「全部」的后端回显是全部', /全部/.test(allInfo.info), allInfo.info);

  // ── ④ 侧边栏：组间变大、组内不变 ──────────────────────────────────────
  const gaps = await page.eval(`(() => {
    const scroll = document.querySelector('#tabs .q-side-scroll');
    const groups = [...document.querySelectorAll('#tabs .q-side-group')];
    const gapOf = (el) => parseFloat(getComputedStyle(el).rowGap || getComputedStyle(el).gap) || 0;
    // 实测相邻两组之间的视觉间距：用两组第一项/最后一项的矩形算，避免只信 CSS 值
    const rects = groups.map((g) => {
      const b = g.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), items: g.querySelectorAll('.tab').length };
    });
    const between = [];
    for (let i = 1; i < rects.length; i += 1) between.push(rects[i].top - rects[i - 1].bottom);
    // 组内相邻项间距
    const inGroup = [];
    groups.forEach((g) => {
      const items = [...g.querySelectorAll('.tab')];
      for (let i = 1; i < items.length; i += 1) {
        inGroup.push(Math.round(items[i].getBoundingClientRect().top - items[i - 1].getBoundingClientRect().bottom));
      }
    });
    return {
      groupGap: gapOf(scroll),
      itemGap: groups.length ? gapOf(groups[0]) : null,
      measuredBetween: between,
      measuredInGroup: inGroup.slice(0, 4),
      tabCount: document.querySelectorAll('#tabs .tab').length
    };
  })()`);
  console.log(`   CSS 组间 gap=${gaps.groupGap}px，实测相邻组间距=${gaps.measuredBetween.join(',')}px`);
  console.log(`   CSS 组内 gap=${gaps.itemGap}px，实测组内项间距=${gaps.measuredInGroup.join(',')}px`);
  // 约定值：组间 12px、组内 2px（见 03-sidebar.css 的说明）
  ok('组间间距已放大到 12px', gaps.groupGap === 12, `${gaps.groupGap}px`);
  ok('实测相邻分类间距 ≈ 组间 gap', gaps.measuredBetween.every((v) => Math.abs(v - gaps.groupGap) <= 1),
    gaps.measuredBetween.join(','));
  ok('组内条目间距保持 2px 不变', gaps.itemGap === 2, `${gaps.itemGap}px`);
  ok('组间距明显大于组内间距（分类成组感成立）', gaps.groupGap >= gaps.itemGap * 4,
    `组间 ${gaps.groupGap} vs 组内 ${gaps.itemGap}`);
  ok('所有导航项都还在（收窄/改间距没弄丢）', gaps.tabCount === 9, `${gaps.tabCount} 项`);

  await page.screenshot('shots/final/dash-range-sidebar-gap.png');
  console.log('\n截图：shots/final/dash-range-sidebar-gap.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n仪表盘区间可选 + 侧栏分类间隔验收通过。');
process.exit(failed ? 2 : 0);
