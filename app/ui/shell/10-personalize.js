// ═══════════════════════════════════════════════════════════════════════════
// 10-personalize.js — 个性化：让用户改所有取色
// ═══════════════════════════════════════════════════════════════════════════
// 需求（用户原话）："在设置里加一个'个性化'的选项：可以让用户自定义所有取色，
//   包括但不限于选中的按钮，启用的插件（有问题的插件等等）"。
//
// 实现思路：**不改一行 CSS**，只覆盖 CSS 变量的值。
//   整套 UI 的颜色都走 00-tokens.css 里的两层结构：
//     原始色阶 --s-*  →  语义别名 --q-*  →  组件里的 var(--q-…)
//   所以"换色"= 在 <html> 的 inline style 上写 --q-xxx 的覆盖值。
//   inline style 的优先级高于任何样式表规则，因此不用 !important、不用改文件，
//   而且**深浅两套主题都能被同一个覆盖值影响**（这正是"用户自定义"想要的效果）。
//
// 存的键：localStorage['qqa-colors'] = { 分组: { 变量名: 颜色 } }
//   每台设备各自保存（与主题同一口径：观感偏好是本机的）。
//
// 与"跟随系统主题"的关系：覆盖是**主题无关**的 —— 用户改的是语义色，
//   深色下和浅色下都会用这个值。想只改一套主题的话，用"分组里的亮/暗分别覆盖"
//   （第二层能力，见 COLORS 里带 .light / .dark 后缀的项）。
'use strict';

(function personalizeRuntime() {
  const root = document.documentElement;
  const KEY = 'qqa-colors';

  // ── 可自定义的颜色项 ─────────────────────────────────────────────────
  // 每项：{ group, var, label, hint, fallback }
  //   var  = 要覆盖的 CSS 变量名
  //   fallback = "恢复默认"时用的值（取自 00-tokens.css 的语义令牌）
  const ITEMS = [
    // —— 品牌与选中态 ——
    { group: '品牌与选中', var: '--q-accent', label: '主色', hint: '选中/主按钮/链接/激活的页签与设置项', fallback: 'var(--s-ds-450)' },
    { group: '品牌与选中', var: '--q-accent-hi', label: '主色（悬停）', hint: '主按钮悬停、强调文字', fallback: 'var(--s-ds-400)' },
    { group: '品牌与选中', var: '--q-accent-soft', label: '主色浅底', hint: '选中项背景、标签底色', fallback: '#5686fe26' },
    { group: '品牌与选中', var: '--q-accent-line', label: '主色描边', hint: '选中项边框、聚焦环', fallback: '#5686fe5c' },
    { group: '品牌与选中', var: '--q-bg-nav-active', label: '导航选中底', hint: '左侧导航当前项的背景', fallback: 'var(--s-nb-750)' },
    { group: '品牌与选中', var: '--q-bg-hover', label: '悬停底', hint: '行/按钮悬停背景', fallback: '#ffffff14' },

    // —— 插件与状态（用户特别提到的"启用的插件/有问题的插件"）——
    { group: '插件与状态', var: '--q-ok', label: '正常 / 已启用', hint: '已启用的插件左侧色条、成功徽标', fallback: 'var(--s-green-500)' },
    { group: '插件与状态', var: '--q-ok-soft', label: '正常底色', hint: '已启用插件的卡片底色', fallback: '#22c55e1f' },
    { group: '插件与状态', var: '--q-ok-line', label: '正常描边', hint: '成功状态的边框', fallback: '#22c55e59' },
    { group: '插件与状态', var: '--q-warn', label: '警告 / 待处理', hint: '等待中、峰谷时段、注意事项', fallback: 'var(--s-amber-500)' },
    { group: '插件与状态', var: '--q-warn-soft', label: '警告底色', hint: '警告提示条的背景', fallback: '#f59e0b1f' },
    { group: '插件与状态', var: '--q-err', label: '出错 / 加载失败', hint: '加载失败的插件、异常徽标、删除按钮', fallback: 'var(--s-red-400)' },
    { group: '插件与状态', var: '--q-err-soft', label: '出错底色', hint: '错误卡片的底色', fallback: '#f25a5a1f' },
    { group: '插件与状态', var: '--q-err-line', label: '出错描边', hint: '错误状态的边框', fallback: '#f25a5a59' },

    // —— 表面与文字 ——
    { group: '表面与文字', var: '--q-bg-base', label: '主背景', hint: '内容区背景', fallback: 'var(--s-nb-950)' },
    { group: '表面与文字', var: '--q-bg-1', label: '卡片背景', hint: '卡片/面板底色', fallback: 'var(--s-nb-875)' },
    { group: '表面与文字', var: '--q-bg-sidebar', label: '侧栏背景', hint: '左侧导航与标题栏', fallback: 'var(--s-nb-900)' },
    { group: '表面与文字', var: '--q-fg', label: '主文字', hint: '正文与标题', fallback: 'var(--s-nb-50)' },
    { group: '表面与文字', var: '--q-fg-2', label: '次要文字', hint: '说明、副标题', fallback: 'var(--s-nb-300)' },
    { group: '表面与文字', var: '--q-line-2', label: '描边', hint: '卡片/输入框边框', fallback: '#ffffff1f' }
  ];

  const GROUPS = [...new Set(ITEMS.map((i) => i.group))];
  const byVar = new Map(ITEMS.map((i) => [i.var, i]));

  // ── 读写 ─────────────────────────────────────────────────────────────
  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? obj : {};
    } catch { return {}; }
  }

  function writeAll(map) {
    try {
      if (!map || !Object.keys(map).length) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(map));
    } catch { /* 隐私模式忽略 */ }
  }

  /** 把一组覆盖值应用到 <html>（空值 = 移除该覆盖，回落默认）。 */
  function apply(map) {
    const clean = {};
    for (const [k, v] of Object.entries(map || {})) {
      if (!byVar.has(k)) continue;                 // 只认白名单里的变量，避免写入任意 CSS
      const val = String(v || '').trim();
      if (!val) continue;
      clean[k] = val;
      root.style.setProperty(k, val);
    }
    // 移除本次不再覆盖的（用户点了"恢复默认"或清空）
    for (const item of ITEMS) {
      if (!clean[item.var]) root.style.removeProperty(item.var);
    }
    root.setAttribute('data-personalized', Object.keys(clean).length ? '1' : '0');
    return clean;
  }

  /** 设为某个值（写 localStorage + 立即生效）。 */
  function setColor(varName, value) {
    if (!byVar.has(varName)) return;
    const map = readAll();
    const v = String(value || '').trim();
    if (!v) delete map[varName]; else map[varName] = v;
    writeAll(map);
    apply(map);
    // 通知打开着的设置页刷新"已改"标记
    try { window.dispatchEvent(new CustomEvent('qqa-colors-change', { detail: { var: varName, value: v } })); } catch { /* 老环境 */ }
  }

  /** 恢复单个默认。 */
  function resetOne(varName) { setColor(varName, ''); }

  /** 恢复全部默认。 */
  function resetAll() {
    apply({});
    writeAll({});
    try { window.dispatchEvent(new CustomEvent('qqa-colors-change', { detail: { resetAll: true } })); } catch { /* 老环境 */ }
  }

  /** 当前覆盖表（只含白名单内的键）。 */
  function current() {
    const map = readAll();
    const out = {};
    for (const k of Object.keys(map)) if (byVar.has(k)) out[k] = map[k];
    return out;
  }

  /** 导出成 CSS 文本，方便用户备份/分享。 */
  function toCssText() {
    const map = current();
    const lines = [':root {', '  /* QQ Agent 个性化配色（导出） */'];
    for (const item of ITEMS) {
      if (map[item.var]) lines.push(`  ${item.var}: ${map[item.var]};  /* ${item.label} */`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  // 启动即应用（必须在首屏之前尽量早，index.html 里紧随主题脚本之后加载）
  apply(readAll());

  window.qqaColors = {
    ITEMS, GROUPS, KEY,
    apply, setColor, resetOne, resetAll, current, toCssText, readAll
  };
})();
