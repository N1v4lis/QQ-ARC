// ═══════════════════════════════════════════════════════════════════════════
// 99-shell-boot.js — 新外壳的启动补丁（**不属于移植逻辑**）
// ═══════════════════════════════════════════════════════════════════════════
// 职责只有四件事，全部是"外壳"层面的：
//   1. 窗口控制：无边框窗口里自绘的最小化/最大化/关闭，以及浏览器下的降级；
//   2. 视图状态：把当前页签写到 <html data-view>，让 CSS 能按页签排版；
//   3. 侧栏折叠：状态持久化 + 平移进场动画；
//   4. 导航反馈：页签点击时的即时视觉反馈（不等后端数据回来）。
//
// 为什么单独一个文件而不是塞进 00-core.js：00-core.js 及 app/ 下其余 12 段是
// 从线上控制台原样移植的逻辑层，diff 越干净越容易验证"功能没被改坏"。
// 外壳新增的东西集中在这里，出问题可以直接整段禁用，不影响业务逻辑。
'use strict';

(function shellBoot() {
  const root = document.documentElement;

  /* ── 1. 窗口控制 ─────────────────────────────────────────────────────
     Electron 里 preload 暴露了 window.qqAgentShell.controls；
     普通浏览器打开时没有 —— 此时把整块窗口按钮从布局里摘掉
     （不是 display:none，而是移除节点，标题栏高度才能跟着收窄）。 */
  const shellBridge = window.qqAgentShell || null;
  const winCtl = shellBridge && shellBridge.controls ? shellBridge.controls : null;
  const ctlBox = document.getElementById('q-winctl');

  if (!winCtl) {
    if (ctlBox) ctlBox.remove();
    root.setAttribute('data-shell', 'browser');
  } else {
    root.setAttribute('data-shell', 'electron');

    if (ctlBox) {
      ctlBox.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-qwin]');
        if (!btn) return;
        const action = btn.dataset.qwin;
        // 关闭按钮：走主进程，主进程再按配置决定"收到托盘"还是"真退出"
        // （与旧版 main.js 的 close 行为完全一致，不在这里自作主张）
        try { winCtl[action](); } catch { /* 主进程没响应也不能让按钮卡住 */ }
      });
    }

    // 最大化状态 → <html data-maximized>：CSS 靠它切换"最大化/还原"图标，
    // 并在最大化时去掉圆角与阴影（Windows 最大化后圆角会露出桌面）。
    const applyMax = (v) => root.setAttribute('data-maximized', v ? '1' : '0');
    const syncMax = async () => {
      try {
        const st = await shellBridge.windowState?.();
        applyMax(!!st?.maximized);
      } catch { applyMax(false); }
    };
    void syncMax();
    try {
      // onMaximizeChange(fn) 把 (maximized, state) 一起回传
      shellBridge.onMaximizeChange?.((v) => applyMax(!!v));
    } catch { /* 老 preload 没有订阅能力时静默降级 */ }

    // 双击标题栏切换最大化（Windows 的默认习惯；frameless 窗口必须自己实现）
    const drag = document.getElementById('q-tb-drag');
    if (drag) {
      drag.addEventListener('dblclick', (e) => {
        if (e.target.closest('button, select, input, a')) return;
        try { winCtl['toggle-maximize'](); } catch { /* ignore */ }
      });
    }
  }

  /* ── 2. 视图状态：<html data-view="settings"> ─────────────────────────
     移植来的 switchTab 只维护 #view-*.active，不写 html 属性；
     而 CSS 里"哪个页签激活 → 内容区怎么排"需要这个信息（例如设置页要两栏、
     其余页签是单栏）。用 MutationObserver 跟随，避免改动移植代码。 */
  const layout = document.getElementById('layout');
  const tabs = document.getElementById('tabs');
  if (layout && tabs) {
    const syncView = () => {
      const active = layout.querySelector('.view.active');
      const name = active && active.id.startsWith('view-') ? active.id.slice(5) : '';
      if (name && root.getAttribute('data-view') !== name) root.setAttribute('data-view', name);
      // 页签高亮：switchTab 已经切了 .active，这里只补 aria 与滚动可见
      const btn = tabs.querySelector('.tab.active');
      if (btn) {
        tabs.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-current', t === btn ? 'page' : 'false'));
        if (btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };
    syncView();
    new MutationObserver(syncView).observe(layout, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  /* ── 3. 侧栏折叠 ─────────────────────────────────────────────────────
     两档：展开（默认）/ 收起（只剩图标，rail 模式）。
     收起状态存 localStorage，刷新后保持；窄窗口（< 880px）由 CSS 自动降级为 rail。 */
  const SIDE_KEY = 'qqa-nav-collapsed';
  const setCollapsed = (v) => {
    root.setAttribute('data-nav', v ? 'collapsed' : 'expanded');
    try { localStorage.setItem(SIDE_KEY, v ? '1' : '0'); } catch { /* 隐私模式忽略 */ }
  };
  try { setCollapsed(localStorage.getItem(SIDE_KEY) === '1'); } catch { setCollapsed(false); }

  const sideToggle = document.getElementById('q-side-toggle');
  const toggleNavigation = () => {
    const collapsed = root.getAttribute('data-nav') !== 'collapsed';
    setCollapsed(collapsed);
    window.qqaMcTheme?.playToggle(!collapsed);
  };
  sideToggle?.addEventListener('click', () => {
    toggleNavigation();
  });

  // Ctrl+B 折叠/展开（与多数编辑器一致；输入框里不抢键）
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (String(e.key || '').toLowerCase() !== 'b') return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    toggleNavigation();
  });

  /* ── 4. 导航反馈 + 进场动画 ──────────────────────────────────────────
     点击页签立刻给一个"按下"反馈（120ms），不必等 loadSessions 之类回来；
     内容区首次出现时播一次进场（由 CSS 的 pageIn 承担，这里只负责触发）。 */
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab, .nav-btn');
      if (!btn) return;
      btn.classList.remove('q-tap');
      void btn.offsetWidth;          // 强制回流，连点也能重播
      btn.classList.add('q-tap');
      setTimeout(() => btn.classList.remove('q-tap'), 180);
    });
  }

  /* ── 5. 标题栏副标题：跟着当前页签走 ─────────────────────────────────
     #q-tb-sub 是新加的装饰元素（旧页面没有），不参与任何业务逻辑。 */
  const sub = document.getElementById('q-tb-sub');
  const NAMES = {
    dashboard: '仪表盘',
    sessions: '会话', chats: '存档', memory: '记忆', usage: '用量',
    skills: '技能', plugins: '插件',
    accounts: '账号', persona: '人设', settings: '设置'
  };
  if (sub) {
    const paint = () => { sub.textContent = NAMES[root.getAttribute('data-view') || ''] || '控制台'; };
    paint();
    new MutationObserver(paint).observe(root, { attributes: true, attributeFilter: ['data-view'] });
  }
})();
