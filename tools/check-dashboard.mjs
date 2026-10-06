// 本轮四项需求的验收：
//   1. 账号页「刷新状态」与「添加账号」尺寸一致
//   2. 顶栏「OneBot 已连接」可点 → 设置 → OneBot（SnowLuma）
//   3. 顶栏「今日：… 搜索：…」合并为一枚胶囊，可点 → 用量页
//   4. 新增「仪表盘」页（AdminLTE index3 风格），可正常渲染
// 用法：node tools/check-dashboard.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1440, height: 900 }, async (page) => {
  // ⚠️ 等待要**足够长**：/api/usage/stats 冷启动实测 5.3 秒、/api/usage/breakdown 3.9 秒
  //    （后端遍历全部会话文件）。一开始我等 3 秒，断言全部失败 —— 那不是 bug，
  //    是数据还没回来。这里等 9 秒，并额外断言"骨架确实出现过"。
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
  await sleep(3000);

  // ── 骨架屏：用**刷新后立即采样**的方式测，不要"等 3 秒再看" ──────────────
  // ⚠️ 这里踩过一次假失败：原来写法是"启动门禁过了 → 等 3 秒 → 断言页面上有骨架"。
  //    但骨架是否存在取决于<span>数据是否已经回来</span>：
  //    热缓存时 /api/usage/stats 只要几百毫秒，3 秒后早就渲染完真实内容了，
  //    于是这条断言在"批量跑套件"（页面已热）时失败、单独跑（页面冷）时通过 ——
  //    典型的**断言耦合了时序**，不是功能问题。
  //    正确测法：刷新页面，然后在**同一轮事件循环内**连采样几帧，只要有一帧见到骨架
  //    就说明"加载期有占位、不是一片空白"。这样无论后端快慢都稳定。
  const skelSeen = await page.eval(`(() => new Promise(function (resolve) {
    // 先记录当前是否已有数据，避免把"已渲染完成"误判成"从没出现过骨架"
    const seen = [];
    const snap = function () {
      const hasSkel = !!document.querySelector('#dashboard-page .ds-ph, #dashboard-page .ds-chart-ph');
      const loading = /正在读取/.test((document.querySelector('#dashboard-page .dash-sub') || {}).textContent || '');
      seen.push(hasSkel || loading);
    };
    // 触发一次真正的重新加载（force = 忽略缓存）
    try { dashData = null; loadDashboard({ force: true }); } catch (e) { /* ignore */ }
    snap();                                   // 同一 tick：骨架应当已写入
    requestAnimationFrame(snap);
    setTimeout(function () { snap(); resolve(seen.slice()); }, 120);
  }))()`);
  const skeletonAppeared = Array.isArray(skelSeen) && skelSeen.some(Boolean);
  ok('重新加载时先出骨架（不是一片空白）', skeletonAppeared,
    `采样 ${Array.isArray(skelSeen) ? skelSeen.length : 0} 帧：${JSON.stringify(skelSeen)}`);

  await sleep(9000);

  // ── 4. 仪表盘：启动默认落在这一页 ────────────────────────────────────
  const boot = await page.eval(`(() => ({
    tab: state.tab,
    activeTab: document.querySelector('#tabs .tab.active')?.dataset?.tab ?? null,
    viewActive: [...document.querySelectorAll('.view.active')].map((v) => v.id),
    hasDashTab: !!document.querySelector('#tabs .tab[data-tab="dashboard"]'),
    dashTabText: document.querySelector('#tabs .tab[data-tab="dashboard"] .tab-tx')?.textContent ?? null,
    boxes: document.querySelectorAll('#dashboard-page .dash-box').length,
    cards: document.querySelectorAll('#dashboard-page .dash-card').length,
    linePts: document.querySelectorAll('#dashboard-page .dc-chart .dc-dot').length,
    donutSegs: document.querySelectorAll('#dashboard-page .dd-seg').length,
    hasRefresh: !!document.getElementById('dash-refresh-btn'),
    headText: document.querySelector('#dashboard-page .dash-head h2')?.textContent ?? null,
    emptyText: document.querySelector('#dashboard-page')?.textContent?.includes('暂无数据') ?? null
  }))()`);
  ok('导航里有「仪表盘」页签', boot.hasDashTab && boot.dashTabText === '仪表盘', `文字=${boot.dashTabText}`);
  ok('启动默认落在仪表盘', boot.tab === 'dashboard' && boot.activeTab === 'dashboard',
    `state.tab=${boot.tab} activeTab=${boot.activeTab} view=${boot.viewActive.join(',')}`);
  ok('仪表盘渲染出信息卡（AdminLTE small-box）', boot.boxes >= 6, `${boot.boxes} 张卡`);
  ok('仪表盘有折线/环形图卡片', boot.cards >= 3, `${boot.cards} 个卡片`);
  ok('折线图有数据点', boot.linePts > 0, `${boot.linePts} 个点`);
  ok('环形图有扇区', boot.donutSegs > 0, `${boot.donutSegs} 个扇区`);
  ok('有刷新按钮', boot.hasRefresh === true, '');

  // 仪表盘的指标切换
  const metric = await page.eval(`(() => {
    const btns = [...document.querySelectorAll('#dashboard-page [data-metric]')];
    return { count: btns.length, labels: btns.map((b) => b.textContent.trim()) };
  })()`);
  ok('折线图有「成本 / 调用次数」指标切换', metric.count === 2, metric.labels.join(' / '));
  const switched = await page.eval(`(() => {
    document.querySelector('#dashboard-page [data-metric="runs"]').click();
    // ⚠️ 切换指标会**整块重绘**，所以必须重新查询 .on 元素 ——
    //    第一版拿着点击前取到的元素引用去查 classList，永远读到旧节点，
    //    于是"功能正常"却被判失败。同理 y 轴刻度也要重新查。
    const onBtn = document.querySelector('#dashboard-page [data-metric].on');
    return {
      onMetric: onBtn ? onBtn.dataset.metric : null,
      yticks: [...document.querySelectorAll('#dashboard-page .dc-ytick')].map((t) => t.textContent).slice(0, 3)
    };
  })()`);
  await sleep(500);
  const afterSwitch = await page.eval(`(() => {
    const onBtn = document.querySelector('#dashboard-page [data-metric].on');
    return { onMetric: onBtn ? onBtn.dataset.metric : null };
  })()`);
  ok('点击「调用次数」后进入选中态（重绘后）', afterSwitch.onMetric === 'runs',
    `选中=${afterSwitch.onMetric} y 轴刻度=${switched.yticks.join(', ')}`);

  // 信息卡可跳转
  const goto = await page.eval(`(() => {
    const box = document.querySelector('#dashboard-page .dash-box[data-goto]');
    return { count: document.querySelectorAll('#dashboard-page .dash-box[data-goto]').length, first: box?.dataset?.goto ?? null, hasFoot: !!box?.querySelector('.db-foot') };
  })()`);
  ok('信息卡带「查看详情」条且可跳转', goto.count >= 5 && goto.hasFoot === true, `${goto.count} 张可跳转，首张→${goto.first}`);

  // ── 2/3. 顶栏胶囊 ────────────────────────────────────────────────────
  const chips = await page.eval(`(() => {
    const one = document.getElementById('onebot-chip');
    const usage = document.getElementById('usage-chip');
    const sepIn = document.querySelector('#usage-chip .sep-inline');
    // 用量与搜索必须在**同一枚**胶囊里
    const usageTxt = usage?.textContent?.replace(/\\s+/g, ' ').trim() ?? null;
    const searchInside = !!usage?.querySelector('#search-count-label');
    const usageInside = !!usage?.querySelector('#usage-label');
    const oldSepCount = document.querySelectorAll('.q-tb-status .top-chips > .sep').length;
    return {
      hasOne: !!one, hasUsage: !!usage, hasSepIn: !!sepIn,
      oneText: one?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      usageTxt, searchInside, usageInside,
      oneIsNav: one?.classList.contains('tb-nav') ?? false,
      usageIsNav: usage?.classList.contains('tb-nav') ?? false,
      oneTabIndex: one?.getAttribute('tabindex') ?? null
    };
  })()`);
  ok('OneBot 胶囊存在且是"可点"样式', chips.hasOne && chips.oneIsNav && chips.oneTabIndex === '0', `文字=${chips.oneText}`);
  ok('用量与搜索合并在同一枚胶囊里', chips.hasUsage && chips.usageInside && chips.searchInside,
    `胶囊文字="${chips.usageTxt}"`);
  ok('合并后的胶囊内有内联分隔符', chips.hasSepIn === true, '');

  // 点 OneBot → 设置 → onebot 区块
  await page.eval(`document.getElementById('onebot-chip').click()`);
  await sleep(1500);
  const afterOne = await page.eval(`(() => ({
    tab: state.tab,
    section: state.settingsSection,
    viewActive: [...document.querySelectorAll('.view.active')].map((v) => v.id),
    activeMenu: document.querySelector('.settings-menu-item.active')?.dataset?.section ?? null
  }))()`);
  ok('点 OneBot 胶囊 → 跳到 设置 → OneBot 区块',
    afterOne.tab === 'settings' && afterOne.section === 'onebot' && afterOne.viewActive.includes('view-settings'),
    `tab=${afterOne.tab} section=${afterOne.section} activeMenu=${afterOne.activeMenu}`);

  // 回仪表盘，再点用量胶囊 → 用量页
  await page.eval(`document.querySelector('#tabs .tab[data-tab="dashboard"]').click()`);
  await sleep(900);
  await page.eval(`document.getElementById('usage-chip').click()`);
  await sleep(1400);
  const afterUsage = await page.eval(`(() => ({
    tab: state.tab,
    viewActive: [...document.querySelectorAll('.view.active')].map((v) => v.id),
    usageLoaded: !!document.querySelector('#usage-page .usage-cards')
  }))()`);
  ok('点用量胶囊 → 跳到用量页并加载内容',
    afterUsage.tab === 'usage' && afterUsage.viewActive.includes('view-usage') && afterUsage.usageLoaded,
    `tab=${afterUsage.tab} 内容已加载=${afterUsage.usageLoaded}`);

  // ── 1. 账号页两个按钮等尺寸 ──────────────────────────────────────────
  await page.eval(`document.querySelector('#tabs .tab[data-tab="accounts"]').click()`);
  await sleep(1600);
  const btns = await page.eval(`(() => {
    const add = document.getElementById('accounts-add-btn');
    const rf = document.getElementById('accounts-refresh-btn');
    if (!add || !rf) return { found: false, add: !!add, rf: !!rf };
    const b = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { w: Math.round(r.width), h: Math.round(r.height), pad: cs.padding, fs: cs.fontSize, cls: el.className }; };
    return { found: true, add: b(add), rf: b(rf) };
  })()`);
  if (!btns.found) {
    ok('账号页找到两个按钮', false, `add=${btns.add} refresh=${btns.rf}`);
  } else {
    ok('「添加账号」与「刷新状态」高度一致', btns.add.h === btns.rf.h, `${btns.add.h}px vs ${btns.rf.h}px`);
    ok('两者内边距/字号一致', btns.add.pad === btns.rf.pad && btns.add.fs === btns.rf.fs,
      `pad ${btns.add.pad}/${btns.rf.pad}  fs ${btns.add.fs}/${btns.rf.fs}`);
    ok('两者 class 一致（不再一个 btn-small）', btns.add.cls === btns.rf.cls, `"${btns.add.cls}" vs "${btns.rf.cls}"`);
  }

  await page.screenshot('shots/final/dashboard.png');
  console.log('\n截图：shots/final/dashboard.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n四项需求验收通过。');
process.exit(failed ? 2 : 0);
