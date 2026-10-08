// Motion: default skin always enabled; Minecraft keeps its existing preference.
// System reduced-motion remains an accessibility exception in both skins.
'use strict';

(function motionRuntime() {
  const root = document.documentElement;
  const KEY = 'qqa-mc-motion';

  function getPref() {
    if(root.dataset.skin!=='minecraft')return 'on';
    try {
      const v = localStorage.getItem(KEY);
      return v === 'off' ? 'off' : 'on';       // 默认开（用户要求"带有一定程度的动效"）
    } catch { return 'on'; }
  }

  function apply(pref) {
    const next = root.dataset.skin==='minecraft' && pref === 'off' ? 'off' : 'on';
    root.setAttribute('data-motion', next);
    if(root.dataset.skin==='minecraft')try { localStorage.setItem(KEY, next); } catch { /* 隐私模式 */ }
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
  window.addEventListener('qqa-skin-change',()=>apply(getPref()));

  window.qqaMotion = {
    KEY, getPref, setPref, apply, isOn, systemReduced,
    /** 实际是否会有动效 = 用户开了 且 系统没要求减弱 */
    effective: () => getPref() === 'on' && !systemReduced()
  };
})();
