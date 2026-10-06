// 〔页签切换 / 启动〕——M9 拆分第 12 段（末段）
'use strict';
// ── 标签页切换 ──
// ⚠️ 必须统一走 switchTab：曾经这里把切换逻辑 inline 复制了一份，
//    结果漏了 usage 分支 —— 点「用量」页签只切了视图、从不加载内容，
//    页面永远空白（轮询走的是"只更新数值"路径，骨架从未建立也救不回来）。
//    两条路径各维护一份必然再次分叉，所以这里只准调 switchTab。
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// 顶栏「人设/模型设置」标签 = 跳到 设置 → 人设（每个会话的模型也在那一页配）
$('#model-label')?.addEventListener('click', () => openPersonaSettings());

/* ── 顶栏另两个胶囊也是入口（2026-10-04 加）────────────────────────────────
   用户要求：
     · 「OneBot 已连接」点击 → 设置 → OneBot（SnowLuma）
     · 「今日：… 搜索：…」点击 → 用量页
   两个都是**整个胶囊可点**，所以监听挂在胶囊容器上（内部 span 由 01-boot.js
   刷新文字，直接挂在内层会被替换掉）。键盘也支持 Enter / Space。 */
function bindToolbarChip(sel, action) {
  const el = $(sel);
  if (!el) return;
  el.addEventListener('click', action);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); }
  });
}
// `openSettingsSection('onebot')` 内部已经自己 switchTab('settings') + 渲染，
// 所以这里直接调它 —— 不要再手动 switchTab 一次（那会多跑一遍加载）。
bindToolbarChip('#onebot-chip', () => openSettingsSection('onebot'));
bindToolbarChip('#usage-chip', () => switchTab('usage'));

/* ── 标题栏「重载界面」按钮（2026-10-04 加）──────────────────────────────
   用户要求：不再每次去按 Ctrl+Shift+R。
   用 location.reload() 而不是拉主进程做 webContents.reload()：
     · 这是**页面级**动作（刷新 DOM / 样式 / 脚本），走渲染层最直接；
     · 不必为它给 preload 的 WINDOW_ACTIONS 白名单加一项 ——
       那套动作的语义是"窗口操作"，混进 reload 会模糊边界。

   为什么先播一段旋转再刷新（而不是立刻 reload）：
     刷新会立刻销毁页面，用户看不到任何"点到了"的反馈，会以为按钮没反应
     而反复点。先转 360°（420ms）再刷新，既有确认感，也不至于让人等。
     动效可被 html[data-motion=off] 与系统"减弱动态效果"关掉 ——
     那种情况下直接刷新，不延迟（见下面的 motionOff 分支）。 */
(function bindReloadButton() {
  const btn = document.getElementById('q-reload-btn');
  if (!btn) return;
  let busy = false;
  const doReload = () => {
    busy = true;
    btn.disabled = true;
    try { location.reload(); } catch { window.location.href = window.location.href; }
  };
  const trigger = () => {
    if (busy) return;
    const motionOff = document.documentElement.getAttribute('data-motion') === 'off';
    let reduced = false;
    try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
    if (motionOff || reduced) { doReload(); return; }
    // 有关效：转一圈再刷新。定时器兜底，避免 animationend 没触发时卡住不刷新。
    let done = false;
    const go = () => { if (done) return; done = true; doReload(); };
    btn.classList.add('is-spinning');
    btn.addEventListener('animationend', go, { once: true });
    setTimeout(go, 460);
  };
  btn.addEventListener('click', trigger);
  // 键盘：这是个真 <button>，Enter/Space 本来就会触发 click，不需要额外绑定。
})();

// ── 启动 ──
(async function init() {
  try {
    // 主题：三档（自动 / 亮色 / 暗色）由 shell/00-theme.js 接管 ——
    // 它排在 00-core.js 之后、本文件之前，已经把 applyTheme / cycleTheme 覆盖成三档语义。
    // ⚠️ 这里**不能**再 addEventListener('click', cycleTheme)：两处都绑会一次点切两档
    //    （2026-10-03 实测：auto→light 变成 auto→dark，而且结果依赖注册顺序）。
    //    标记由 00-theme.js 在绑定时打上。
    applyTheme(getThemePref());
    if (!window.__qqaThemeBound) $('#theme-btn')?.addEventListener('click', cycleTheme);

    // 启动 loading：先等 HTTP 服务可用（页面可能先于服务打开）
    setLoadingStatus('正在启动 QQ Agent 服务…');
    await bootLoop();
    runUpdateCheck();                                 // 启动时静默查一次（失败不打扰）
    setInterval(() => runUpdateCheck(), 3600_000);    // 之后每小时查一次

    // ⚠️ 这里原来有一段"以后端配置为准（跨设备同步）"的主题覆盖：
    //      const cfg0 = await api('/api/config'); if (THEME_VALUES.includes(cfg0.ui.theme)) applyTheme(...)
    //    2026-10-03 必须删掉，理由是它把新 UI 的"默认亮色/跟随系统"整条打死：
    //      旧版是两档、默认暗色，后端 config.ui.theme 里存的是 'dark'；
    //      每次启动这段都会把 'dark' 当成"用户的选择"应用回来 →
    //      全新安装也直接是暗色，且现象极像"内联主题脚本没生效"，极难定位。
    //    主题现在完全由 shell/00-theme.js 管：本地偏好优先（详见那个文件顶部的说明）。
    //    想恢复跨设备同步的话，需要先把后端历史值迁移成 'auto' 再启用。

    // 首启引导：关键配置（模型/白名单）没填就直接带去设置页
    try {
      const cfg = await api('/api/config');
      const ready = !!cfg.api.model && ((cfg.allow.groups?.length || cfg.allow.private?.length) || cfg.allowAllWhenEmpty);
      if (!ready) {
        switchTab('settings');
        connectSSE();
        refreshStatus();
        startStatusPoller();
        return;
      }
    } catch { /* 按默认流程走 */ }
    refreshStatus();
    startStatusPoller();
    connectSSE();
    /* ⚠️ 这里必须走 switchTab(...)，不能只调 loadSessions()（2026-10-04 修）：
       `.tab.active` 的高亮**只有 switchTab 会建立**（00-core.js:793 那行 toggle）。
       原来的写法只 loadSessions()，于是首屏出现一个很隐蔽的问题：
         左侧导航**没有任何一项是高亮的**，而右侧内容/状态/数据全都正常
         （data-view=sessions、view-sessions 有 .active、会话列表也有数据）。
       因为"能看能用"，肉眼很容易忽略；但控件状态与视口不一致，
       而且依赖 `.tab.active` 的逻辑（我的配色断言就是拿它取激活项的）会读错元素。
       走 switchTab 还有个附带好处：它负责 quoteMode / 交叉淡出的收尾，
       启动路径与用户点击路径从此**完全同一条**，不会再分叉。

       ⚠️ 2026-10-04 再改：默认落点从 sessions 换成 **dashboard**。
       「仪表盘」是总览入口，开机先看整体状态更合理（AdminLTE 也是先看板）。
       view-dashboard / 该 .tab 的 active 类在 index.html 里**不预置**，
       一律由这次 switchTab 建立 —— 保持"启动与点击同一条路径"这条约定。 */
    switchTab('dashboard');
    loadMemoryView();
    initSessionScrollLoader();
  } catch (err) {
    // 启动链路任何一步抛错都必须摘掉加载遮罩 —— 否则整窗被
    // z-index:999 的 loading-overlay 盖住，用户只看到一片空白。
    console.error('[init] 启动失败:', err);
    try { setLoadingStatus(`启动异常：${err?.message || err}`); } catch { /* ignore */ }
  } finally {
    try { hideLoading(); } catch { /* ignore */ }
  }
})();