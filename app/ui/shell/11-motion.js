// ═══════════════════════════════════════════════════════════════════════════
// 11-motion.js — "是否启用动效"开关
// ═══════════════════════════════════════════════════════════════════════════
// 需求（用户原话）："把是否启动动效做成开关 给用户选择"。
//
// 实现：一个属性 + 一条 CSS 兜底。
//   · localStorage['qqa-motion'] = 'on' | 'off'
//   · <html data-motion="off"> 时，01-motion.css 的兜底规则把所有
//     animation/transition 压到 0.001ms（与"系统减弱动态效果"同一条机制，
//     只是这条由用户显式控制）。
//   · 为什么用 CSS 而不是逐处 JS 判断：动效散落在几十条规则里，
//     逐个加 if 既漏又难维护；一条属性 + 一条 `[data-motion='off'] *` 规则，
//     新加的动效自动也被覆盖。
//
// 与"系统 减弱动态效果"的关系：两者取**或** —— 用户关了就关，
//   系统关了也关。用户开了但系统关了，仍然尊重系统（无障碍优先）。
'use strict';

(function motionRuntime() {
  const root = document.documentElement;
  const KEY = 'qqa-motion';

  function getPref() {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'off' ? 'off' : 'on';       // 默认开（用户要求"带有一定程度的动效"）
    } catch { return 'on'; }
  }

  function apply(pref) {
    const next = pref === 'off' ? 'off' : 'on';
    root.setAttribute('data-motion', next);
    try { localStorage.setItem(KEY, next); } catch { /* 隐私模式 */ }
    try { window.dispatchEvent(new CustomEvent('qqa-motion-change', { detail: { motion: next } })); } catch { /* 老环境 */ }
    return next;
  }

  function setPref(pref) { return apply(pref); }
  function isOn() { return getPref() === 'on'; }

  /** 系统是否要求减弱动态效果（UI 上要如实告诉用户，避免"我开了怎么还没动效"）。 */
  function systemReduced() {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }

  apply(getPref());

  window.qqaMotion = {
    KEY, getPref, setPref, apply, isOn, systemReduced,
    /** 实际是否会有动效 = 用户开了 且 系统没要求减弱 */
    effective: () => getPref() === 'on' && !systemReduced()
  };
})();
