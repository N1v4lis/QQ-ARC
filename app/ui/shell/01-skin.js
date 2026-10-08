// ═══════════════════════════════════════════════════════════════════════════
// 01-skin.js — 皮肤（skin）维度：default / minecraft
// ═══════════════════════════════════════════════════════════════════════════
// 需求（用户原话）："个性化中单独加一个卡页：主题" + "帮我设计一个 Minecraft 风格的主题"。
//
// ── 为什么把"皮肤"和"亮度"拆成两个维度 ────────────────────────────────────
// 现有 shell/00-theme.js 管 `auto / light / dark`（写在 `<html data-theme>`）。
// 如果直接把 Minecraft 塞成第 4 档，会立刻撞上一个语义问题：
//   **"Minecraft 的暗色"和"暗色主题"是两回事** ——
//   前者是 Minecraft 那套配色变暗，后者是默认配色的暗色版。
// 所以拆成两个正交属性：
//   <html data-skin="default|minecraft"   皮肤：换配色体系 / 图标 / 字体 / 背景 / 音效
//         data-theme="light|dark">        亮度：每套皮肤各自解析
// 这样"MC 主题跟随系统明暗"也能成立：选 MC 皮肤 + 亮度跟随系统
// → 白天 MC 亮色、晚上 MC 暗色。用户确认过这个口径（"Minecraft主题有独立的亮暗配色"）。
//
// ── 为什么不写进 00-theme.js ──────────────────────────────────────────────
// 那个文件顶部已写明它存在的理由："主题是新 UI 的需求，与移植层分开"。
// 皮肤是**又一层**概念，且两件事的生命周期不同：
//   · 亮度可能**自动变**（跟随系统）；
//   · 皮肤只会被用户**手动改**。
// 混在一个函数里会让 cycleTheme() 那套"跳过空转档"的逻辑变复杂，
// 而那是踩过坑才写对的（见 00-theme.js 里关于空转的注释）。
//
// 存储：
//   localStorage['qqa-skin'] = 'default' | 'minecraft'
//   同时写后端 config.ui.skin，供其它设备参考（与 theme 同策略：只写不读，
//   理由见 00-theme.js 末尾"与后端的关系"——启动时以本地为准）。
'use strict';

(function skinRuntime() {
  const root = document.documentElement;
  const VALUES = ['default', 'minecraft'];
  const KEY = 'qqa-skin';
  const DEFAULT = 'default';

  /** 用户偏好。非法值/隐私模式一律回落默认。 */
  function getPref() {
    try {
      const v = localStorage.getItem(KEY);
      if (VALUES.includes(v)) return v;
    } catch { /* 隐私模式 */ }
    return DEFAULT;
  }

  /** 皮肤元信息。卡页用它渲染选择卡片，避免文案散落在两处。 */
  const META = {
    default: {
      id: 'default',
      name: '默认',
      desc: 'QQ Agent 原生外观：扁平、克制、跟随亮暗',
      icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2.6" y="3.4" width="14.8" height="13.2" rx="2.2"/><path d="M2.6 7.6h14.8"/></svg>',
      /** 是否需要二级设置（Minecraft 有：音效/背景/字体） */
      customColors: true,
      hasSub: false
    },
    minecraft: {
      id: 'minecraft',
      name: 'Minecraft',
      desc: '像素风界面：方块边框、拉杆开关、交互音效与游戏背景图',
      icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.4 17 6.2v7.6L10 17.6 3 13.8V6.2z"/><path d="M3 6.2l7 3.8 7-3.8M10 10v7.6"/></svg>',
      customColors: false,
      hasSub: true
    }
  };

  /**
   * 落地皮肤（不含动效）。
   * 只写属性 + 持久化 + 广播事件；具体长什么样全由 CSS 的
   * `html[data-skin='minecraft']` 规则决定 —— 这样"换皮肤"不需要 JS 参与视觉。
   */
  function commit(skin) {
    root.setAttribute('data-skin', skin);
    try { localStorage.setItem(KEY, skin); } catch { /* 忽略 */ }
    try {
      window.dispatchEvent(new CustomEvent('qqa-skin-change', { detail: { skin } }));
    } catch { /* 老环境 */ }
  }

  /**
   * 应用皮肤。
   * opts.animate === false 时不做任何过渡 —— 与 applyTheme 同一约定：
   * 需要"立刻拿到终态"的调用方（自动化验证）别靠 sleep 猜时长。
   */
  function apply(skin, opts) {
    const next = VALUES.includes(skin) ? skin : getPref();
    commit(next);
    return next;
  }

  /** 切换皮肤（供设置页调用）。写回后端失败不打扰用户：本地已生效。 */
  function set(skin) {
    if (!VALUES.includes(skin)) return getPref();
    const prev = getPref();
    const next = apply(skin);
    if (next !== prev) {
      try {
        fetch('/api/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-console-token': 'qq-agent-console' },
          body: JSON.stringify({ ui: { skin: next } })
        }).catch(() => {});
      } catch { /* ignore */ }
    }
    return next;
  }

  // 启动即应用（首屏防闪由 index.html 的内联脚本负责，那里必须在 CSS 之前跑）
  apply(getPref());

  window.qqaSkin = {
    VALUES,
    META,
    KEY,
    getPref,
    set,
    apply,
    get: () => root.getAttribute('data-skin') || DEFAULT,
    isMinecraft: () => (root.getAttribute('data-skin') || DEFAULT) === 'minecraft'
  };
})();
