// ═══════════════════════════════════════════════════════════════════════════
// 03-mc-icons.js — Minecraft 皮肤的图标集（全新设计，像素网格）
// ═══════════════════════════════════════════════════════════════════════════
// 用户要求："侧边栏的图标元素，左上角的 QQ Agent 的 logo 均采用 MC 风格的全新图标
//            （不准用现有图标，也不可以按照旧图标重绘）"。
//
// 怎么做到"既不沿用、也不重绘"——靠**换一套几何语言**，而不是把旧图标改粗：
//   · 现有图标：20×20 viewBox、`stroke` 线稿、圆角线帽、曲线（circle/path 弧线）。
//   · 本图标集：**16×16 像素网格**、**纯填充矩形**、**零曲线**、**零 stroke**。
// 两者在实现层面没有任何共用的几何 —— 这是"重绘"和"新设计"的客观分界：
//   重绘 = 同样的圆/曲线换个粗细；这里 = 连绘制方式（线稿 vs 方块填充）都换了。
//
// 设计语言（对齐 MC 的物品图标）：
//   · 每格 1 单位，坐标全为整数 → 天然像素对齐，放大也不糊；
//   · 每个图标 2~4 个色阶（暗部/主体/亮部），模拟 MC 物品的斜面高光；
//   · 轮廓用自身暗色，**不描黑边**（MC 的 GUI 物品图标就是靠色阶分层的）。
// 题 material：每个图标对应一个真实存在的 MC 物品/方块，这样"MC 味"是有出处的：
//   仪表盘=工作台  会话=成书  存档=箱子  记忆=附魔书  用量=红石比较器
//   技能=工作台网格  插件=红石中继器  账号=玩家头颅  设置=石座拉杆
'use strict';

(function mcIcons() {
  // ── 色板（取自 MC 物品图标的实际色域）──────────────────────────────────
  const C = {
    ink: '#2b2b2b', ink2: '#141414',
    wood: '#9c7a4a', woodD: '#6b5432', woodL: '#b08c58',
    stone: '#a0a0a0', stoneD: '#6e6e6e', stoneL: '#c6c6c6',
    paper: '#e8e0cc', paperD: '#c9bfa6', pageLine: '#9a8f76',
    leather: '#8b5a2b', leatherD: '#5f3c1b', leatherL: '#a9713a',
    gold: '#f2c94c', goldD: '#b8912f',
    red: '#b02e26', redD: '#7d1f19',
    blue: '#3b6fd4', blueD: '#24488f',
    purple: '#8b4fd4', purpleD: '#5c3390',
    green: '#5d9c3c', greenD: '#3d6b26',
    copper: '#c07a4a', copperD: '#8a5230',
    skin: '#c99a6a', skinD: '#9a7248',
    hair: '#4a3421'
  };

  /** 一行矩形：`[color, [x,y,w,h], ...]` */
  const R = (col, ...rects) => rects.map((r) => ({ c: col, r }));

  // ── 九个导航图标 ────────────────────────────────────────────────────────
  // ⚠️ 键名必须与 index.html 里 `<button data-icon="…">` 的值**逐字一致**。
  //    第一版我按导航名（dashboard/sessions/…）命名，而 HTML 里写的是
  //    功能名（gauge/chat/archive/brain/chart/spark/plugin/users/gear）——
  //    结果查找全部落空、图标一个都没换，而且**不报错**，只是静默不换。
  //    以 index.html 为准；改那边要同步改这里。
  const NAV = {
    // 工作台：顶面木板 + 下方工具格
    gauge: [
      ...R(C.wood, [0, 0, 16, 11]),
      ...R(C.woodD, [0, 0, 16, 1], [0, 3, 16, 1], [0, 6, 16, 1], [0, 9, 16, 1]),
      ...R(C.woodL, [2, 2, 4, 2], [10, 5, 4, 2]),
      ...R(C.stoneD, [0, 11, 16, 5]),
      ...R(C.stone, [1, 12, 6, 3], [9, 12, 6, 3])
    ],
    // 成书：封面 + 书页边缘 + 书签带
    chat: [
      ...R(C.leather, [1, 0, 13, 16]),
      ...R(C.leatherD, [1, 0, 13, 1], [1, 15, 13, 1], [1, 0, 1, 16]),
      ...R(C.paper, [4, 2, 9, 12]),
      ...R(C.pageLine, [5, 4, 7, 1], [5, 6, 6, 1], [5, 8, 7, 1], [5, 10, 5, 1]),
      ...R(C.gold, [6, 0, 3, 3]),
      ...R(C.goldD, [6, 3, 3, 1])
    ],
    // 箱子：木箱体 + 铁扣 + 盖缝
    archive: [
      ...R(C.wood, [0, 1, 16, 14]),
      ...R(C.woodD, [0, 1, 16, 1], [0, 14, 16, 1], [0, 1, 1, 14], [15, 1, 1, 14], [0, 7, 16, 1]),
      ...R(C.woodL, [2, 3, 12, 3]),
      ...R(C.stone, [6, 5, 4, 6]),
      ...R(C.stoneD, [7, 7, 2, 2]),
      ...R(C.ink2, [7, 7, 1, 2])
    ],
    // 附魔书：紫皮封面 + 金色符文
    brain: [
      ...R(C.purple, [1, 0, 13, 16]),
      ...R(C.purpleD, [1, 0, 13, 1], [1, 15, 13, 1], [1, 0, 1, 16]),
      ...R(C.paper, [4, 2, 9, 12]),
      ...R(C.purple, [5, 5, 7, 1], [5, 8, 5, 1]),
      ...R(C.gold, [11, 0, 3, 3], [5, 10, 3, 2]),
      ...R(C.goldD, [11, 3, 3, 1])
    ],
    // 红石比较器：石座 + 红石火把 + 前端两点
    chart: [
      ...R(C.stone, [1, 3, 14, 11]),
      ...R(C.stoneD, [1, 3, 14, 1], [1, 13, 14, 1], [1, 3, 1, 11], [14, 3, 1, 11]),
      ...R(C.ink2, [3, 5, 10, 2]),
      ...R(C.woodD, [4, 7, 2, 5], [10, 7, 2, 5]),
      ...R(C.red, [4, 5, 2, 2], [10, 5, 2, 2]),
      ...R(C.gold, [6, 6, 4, 3])
    ],
    // 技能：工作台 3×3 网格（每格一个小工具色块）
    spark: [
      ...R(C.wood, [0, 0, 16, 16]),
      ...R(C.woodD, [0, 0, 16, 1], [0, 15, 16, 1], [0, 0, 1, 16], [15, 0, 1, 16], [5, 1, 1, 14], [10, 1, 1, 14], [1, 5, 14, 1], [1, 10, 14, 1]),
      ...R(C.stoneL, [2, 2, 3, 3]),
      ...R(C.gold, [7, 2, 3, 3]),
      ...R(C.stone, [12, 2, 2, 3]),
      ...R(C.green, [2, 7, 3, 3]),
      ...R(C.goldD, [7, 7, 3, 3]),
      ...R(C.red, [12, 7, 2, 3]),
      ...R(C.blue, [2, 12, 3, 2]),
      ...R(C.paper, [7, 12, 3, 2]),
      ...R(C.purple, [12, 12, 2, 2])
    ],
    // 插件：红石中继器（可插拔的"连接件"）
    plugin: [
      ...R(C.stone, [1, 4, 14, 9]),
      ...R(C.stoneD, [1, 4, 14, 1], [1, 12, 14, 1], [1, 4, 1, 9], [14, 4, 1, 9]),
      ...R(C.stoneL, [3, 6, 10, 2]),
      ...R(C.red, [6, 2, 4, 3]),
      ...R(C.gold, [4, 9, 3, 3], [9, 9, 3, 3]),
      ...R(C.green, [2, 6, 1, 2], [13, 6, 1, 2])
    ],
    // 账号：玩家头颅（正面）
    users: [
      ...R(C.skin, [2, 2, 12, 12]),
      ...R(C.skinD, [2, 2, 12, 1], [2, 13, 12, 1], [2, 2, 1, 12], [13, 2, 1, 12]),
      ...R(C.hair, [2, 2, 12, 3]),
      ...R(C.ink2, [5, 7, 2, 2], [10, 7, 2, 2]),
      ...R(C.skinD, [7, 10, 3, 1])
    ],
    // 设置：石座上的拉杆（正是用户要求"开关采用拉杆"的那个拉杆）
    gear: [
      ...R(C.stone, [1, 10, 14, 6]),
      ...R(C.stoneD, [1, 10, 14, 1], [1, 15, 14, 1], [1, 10, 1, 6], [14, 10, 1, 6]),
      ...R(C.stoneL, [3, 12, 10, 2]),
      ...R(C.wood, [7, 2, 3, 8]),
      ...R(C.woodD, [7, 2, 1, 8], [9, 2, 1, 8]),
      ...R(C.woodL, [8, 2, 1, 8]),
      ...R(C.stoneD, [5, 8, 7, 2])
    ]
  };

  /** 左上角品牌 logo：绿色草方块（MC 最标志性的方块） */
  const LOGO = [
    ...R(C.green, [0, 0, 24, 24]),
    ...R(C.greenD, [0, 18, 24, 6], [0, 0, 24, 1], [0, 0, 1, 24], [23, 0, 1, 24]),
    ...R('#7ab648', [1, 1, 22, 1], [1, 1, 1, 16]),
    // 草皮与泥土的交界（不规则，像真的草方块侧面）
    ...R(C.woodD, [0, 9, 3, 2], [3, 10, 2, 2], [5, 9, 4, 1], [9, 10, 3, 2], [12, 9, 3, 1], [15, 10, 4, 2], [19, 9, 5, 1]),
    ...R(C.wood, [0, 11, 24, 13]),
    ...R(C.woodL, [3, 13, 4, 3], [12, 15, 5, 3], [6, 18, 3, 2], [17, 12, 3, 2]),
    ...R(C.woodD, [9, 13, 2, 3], [15, 18, 4, 3], [2, 17, 4, 2])
  ];

  // ── 生成 SVG ────────────────────────────────────────────────────────────
  /**
   * 把矩形表渲染成 SVG 字符串。
   *
   * @param cls 必须带上原元素的 class（导航图标是 `tab-ico`）。
   *   ⚠️ 第一版忘了这个：`outerHTML = …` 替换后新节点没有 `tab-ico` 类，
   *      于是所有依赖 `#tabs .tab-ico` 的选择器全部落空 ——
   *      布局（.tab-ico 的尺寸规则）失效、后续查找也找不到图标。
   *      现象是"图标换了但变小/错位、连测试都选不中它"。
   *      outerHTML 替换是**整节点替换**，原节点上的 class/属性都不会保留。
   */
  function toSvg(rects, size, cls) {
    const body = rects.map(({ c, r }) => `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" fill="${c}"/>`).join('');
    const clsAttr = cls ? ` class="${cls}"` : '';
    return `<svg${clsAttr} viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true">${body}</svg>`;
  }

  const NAV_SVG = {};
  for (const [k, rects] of Object.entries(NAV)) NAV_SVG[k] = toSvg(rects, 16, 'tab-ico');
  const LOGO_SVG = toSvg(LOGO, 24, null);

  /**
   * 把页面上的导航图标换成 MC 版（或换回默认版）。
   * 为什么要"能换回"：皮肤是随时可切的，不能只在开启时替换 —— 关掉后必须复原，
   * 否则用户切回默认皮肤会看到 MC 图标残留在默认界面上。
   *
   * 实现方式：**把原图标 HTML 预先存进 data-orig**，复原时读回来。
   * 不重新拼一份默认图标的原因：默认图标在 index.html 里，是"唯一事实来源"，
   * 在这里复制一份就会有两份、以后改一处忘一处。
   */
  function applyToDom(on) {
    document.querySelectorAll('#tabs .tab[data-icon]').forEach((btn) => {
      const ico = btn.querySelector('.tab-ico');
      if (!ico) return;
      if (ico.dataset.orig === undefined) ico.dataset.orig = ico.outerHTML;
      const want = on ? NAV_SVG[btn.dataset.icon] : null;
      if (want) {
        if (ico.outerHTML !== want) ico.outerHTML = want;
      } else if (ico.dataset.orig) {
        ico.outerHTML = ico.dataset.orig;
      }
      // 换进来的新节点也要带上 data-orig，否则切来切去会丢原始版本
      const cur = btn.querySelector('.tab-ico');
      if (cur && cur.dataset.orig === undefined) cur.dataset.orig = ico.dataset.orig || '';
    });
    // 品牌 logo
    const logo = document.querySelector('#topbar .q-tb-logo');
    if (logo) {
      const svg = logo.querySelector('svg');
      if (svg) {
        if (svg.dataset.orig === undefined) svg.dataset.orig = svg.outerHTML;
        const want = on ? LOGO_SVG : null;
        if (want) {
          if (svg.outerHTML !== want) svg.outerHTML = want;
        } else if (svg.dataset.orig) {
          svg.outerHTML = svg.dataset.orig;
        }
        const cur = logo.querySelector('svg');
        if (cur && cur.dataset.orig === undefined) cur.dataset.orig = svg.dataset.orig || '';
      }
    }
  }

  // 初始应用 + 皮肤变化时跟随
  function sync() { applyToDom(document.documentElement.getAttribute('data-skin') === 'minecraft'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
  else sync();
  window.addEventListener('qqa-skin-change', sync);

  window.qqaMcIcons = { NAV: NAV_SVG, LOGO: LOGO_SVG, applyToDom, sync };
})();
