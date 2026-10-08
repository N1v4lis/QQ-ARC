// ═══════════════════════════════════════════════════════════════════════════
// 00-theme.js — 三档主题（自动 / 亮色 / 暗色）
// ═══════════════════════════════════════════════════════════════════════════
// 需求（用户原话）："默认亮色模式，并且可以根据系统的主题来选择自动切换亮色/暗色模式"。
// 两句同时成立的口径：
//   · 默认 = 自动（auto）→ 系统是亮色时，首启就是亮色；用户没做选择前一直跟随系统。
//   · 用户手动选过 light / dark 之后不再跟随（**显式选择永远优先**），
//     这正是所有主流应用（VS Code / GitHub / Windows 设置）的行为。
//
// 为什么单独一个文件，而不是接着改 app/00-core.js：
//   app/ 下那 12 段是从线上控制台原样移植的逻辑层，diff 越干净，
//   "功能没被改坏"这件事越容易验证。主题是**新 UI 的**需求，所以放新文件里。
//   ⚠️ 加载顺序：必须在 app/00-core.js **之后**（它里面旧的两档 applyTheme 会先执行，
//      本文件随后覆盖 window 上的同名函数）。见 index.html 的脚本顺序。
//
// 存储：
//   localStorage['qqa-theme'] = 'auto' | 'light' | 'dark'   （前端偏好，首屏内联脚本读它）
//   同时写后端 config.ui.theme，让其它设备/浏览器打开时也是同一个选择。
//   注意：config.ui.theme 的历史值只有 dark/light，没有 auto —— 读回来时当作"已显式选择"。
'use strict';

(function themeRuntime() {
  const root = document.documentElement;
  const VALUES = ['auto', 'light', 'dark'];
  const LABEL = { auto: '跟随系统', light: '亮色', dark: '暗色' };
  // 图标用内联 SVG 而不是 emoji：emoji 在不同字体下大小/基线差异很大，
  // 标题栏里那颗按钮会跟着抖。
  // 三个图标共用同一套几何约定（viewBox 20×20、stroke-width 1.6、round 线帽），
  // 这样亮色/暗色切换时视觉重量一致，不会一个粗一个细。
  const ICON = {
    // 跟随系统：一台显示器（仅作"另一套主题"的兜底图标，正常不会再显示）
    auto: '<svg data-theme-icon="auto" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2.6" y="3" width="14.8" height="11" rx="1.8"/><circle cx="10" cy="8.5" r="3.1"/><path d="M10 5.4a3.1 3.1 0 0 1 0 6.2z" fill="currentColor" stroke="none"/><path d="M10 14v3M6.5 17h7"/></svg>',
    // 亮色：太阳（圆心 + 8 道光芒，与月亮的线宽一致）
    light: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="3.6"/><path d="M10 2.4v2M10 15.6v2M2.4 10h2M15.6 10h2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M15.4 4.6L14 6M6 14l-1.4 1.4"/></svg>',
    // 暗色：月亮（与太阳同一粗细、同一圆角风格）
    dark: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16.6 11.8A6.9 6.9 0 0 1 8.2 3.4a7 7 0 1 0 8.4 8.4z"/></svg>'
  };

  const media = (() => {
    try { return window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null; }
    catch { return null; }
  })();

  /** 用户偏好：显式选择优先，其次旧版本遗留值，最后默认 auto。 */
  function getPref() {
    try {
      const explicit = localStorage.getItem('qqa-theme-pref');
      if (VALUES.includes(explicit)) return explicit;
      const legacy = localStorage.getItem('qqa-theme');   // 旧版本只有这个 key
      if (legacy === 'light' || legacy === 'dark') return legacy;
    } catch { /* 隐私模式 */ }
    return 'auto';
  }

  /** 把偏好解析成实际主题。 */
  function resolve(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return media && media.matches ? 'dark' : 'light';
  }

  /** 画按钮的图标与提示。
   *  图标跟着**当前实际主题**（而不是偏好档位）走：
   *    · 亮色 → 太阳（☀ 线稿，与暗色的月亮同一套线宽/尺寸）
   *    · 暗色 → 月亮
   *  为什么按实际主题而不是 "auto/light/dark" 三套图标：
   *    用户要的是"亮色模式下显示太阳"。auto 档在系统为亮色时，用户看到的就是亮色界面，
   *    此时显示"跟随系统"的显示器图标会让人以为没生效（实测反馈即如此）。
   *    现在 auto 档也显示太阳/月亮，只是 title 里额外说明"跟随系统"。 */
  function paintButton(pref, actual) {
    const btn = document.getElementById('theme-btn');
    if (!btn) return;
    const icon = pref === 'auto' ? ICON.auto : ICON[actual];
    btn.innerHTML = icon;
    btn.title = `主题：${LABEL[pref] || LABEL.auto}${pref === 'auto' ? `（当前${LABEL[actual]}）` : ''}　左键切换亮暗，右键选择模式`;
    btn.setAttribute('aria-label', btn.title);
    btn.dataset.pref = pref;
    btn.dataset.theme = actual;
  }

  /** 真正落地主题（不含动效）：写 <html> 属性 + 持久化 + 通知。 */
  function commitTheme(next, actual) {
    root.setAttribute('data-theme', actual);
    root.setAttribute('data-theme-pref', next);
    try {
      // 两个 key 分工见 index.html 内联脚本的注释：
      //   qqa-theme-pref = 显式选择（只有这里写）；qqa-theme = 实际生效值（兼容旧版读取）
      localStorage.setItem('qqa-theme-pref', next);
      localStorage.setItem('qqa-theme', actual);
    } catch { /* 忽略 */ }
    paintButton(next, actual);
    // 让依赖颜色的代码（图表/内联 SVG 计算）有机会重算
    try { window.dispatchEvent(new CustomEvent('qqa-theme-change', { detail: { pref: next, actual } })); } catch { /* 老环境 */ }
  }

  /**
   * 应用主题。pref 省略 = 沿用当前偏好。
   * sourceEl 给了就播"从该元素扩散"的切换动效（用户要求）；
   * 不给（启动、系统跟随）则直接切，不做动效 —— 启动时闪一个圆圈很怪。
   *
   * ⚠️ 有动效时切换是**异步**的（遮罩铺满后才 commit，约 420ms）。
   *    需要"立刻拿到终态"的调用方（自动化验证、需要在切换后同步读值的逻辑）
   *    请传 opts.animate = false 绕过动效 —— 不要靠 sleep 猜时长，
   *    那样测试会随动效时长变化而随机失败（实测已踩到）。
   */
  function applyTheme(pref, sourceEl, opts) {
    const next = VALUES.includes(pref) ? pref : getPref();
    const actual = resolve(next);
    const changed = root.getAttribute('data-theme') !== actual;
    const wantAnim = !(opts && opts.animate === false);

    // 只有"用户主动切换且主题真的变了"才播动效
    if (changed && sourceEl && wantAnim && !vtBusy) {
      themeRipple(actual, sourceEl, () => commitTheme(next, actual));
      return actual;
    }
    commitTheme(next, actual);
    return actual;
  }

  /**
   * 点一下：在**亮色 ↔ 暗色**之间直接切换。
   *
   * ⚠️ 2026-10-05 用户要求改掉三档循环：
   *    "亮暗联动不是要改成跟随系统，而是直接亮色和暗色切换，
   *      而不是暗色-跟随系统"。
   *   原来是 auto → light → dark 三档，用户点两下才回到想要的档，
   *   而且中间会经过"跟随系统"这个他并不想要的中间态。
   *   现在只在两档之间翻转，行为与"亮暗开关"一致、可预期。
   *
   *   实际主题（data-theme）仍是 auto 偏好解析出来的那个：
   *   启动时若偏好是 auto（老用户的历史值 / 首启），先跟随系统定一次；
   *   之后用户任何一次点击都会把它固定成 light 或 dark。
   */
  function cycleTheme(sourceEl) {
    const nowTheme = root.getAttribute('data-theme');
    const next = nowTheme === 'dark' ? 'light' : 'dark';
    applyTheme(next, sourceEl);
    // 后端同步（跨设备一致）。失败不打扰用户：localStorage 已经生效。
    try {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-console-token': 'qq-agent-console' },
        body: JSON.stringify({ ui: { theme: next } })
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  // ── 切换主题时的"从按钮扩散"动效 ──────────────────────────────────────
  //
  // 用户要求（2026-10-04）："切换亮色暗色时，颜色不要盖住界面，从按钮出发，
  //   扩散到界面并不阻拦任何元素"。
  // 上一版是"在按钮位置放一个不透明的圆、放大到铺满整屏，铺满后才换主题"。
  // 它确实不拦点击（pointer-events:none），但**视觉上整屏被一块颜色盖住了**
  // —— 用户要的是"界面本身从按钮处一圈圈变成新主题"，不是"被一块布盖住"。
  //
  // 正确做法：**View Transitions API + clip-path 圆形揭示**。
  //   · 浏览器把"切换前后"各拍一张快照；
  //   · 我们让**新状态**从按钮位置以圆形 clip-path 展开，旧状态原地不动；
  //   · 于是"扩散"的就是界面本身：不会多出任何一层颜色、任何元素都不会被遮挡，
  //     也没有任何东西被拦截（快照层由浏览器管理、本身不可交互）。
  // 不支持的浏览器（老 Chromium / 关掉动效）走"直接切换"的退化路径 ——
  //   宁可没有动效，也不要退回"盖住界面"的做法。
  //
  // 参考：https://developer.chrome.com/docs/web-platform/view-transitions/
  let vtBusy = false;

  /** 是否允许播动效（用户开关 + 系统减弱动态效果）。 */
  function motionEnabled() {
    if (root.getAttribute('data-motion') === 'off') return false;
    try { return !matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return true; }
  }

  /** 取扩散圆心：优先用触发元素（主题按钮 / 设置页色卡），拿不到就用右上角。 */
  function origin(sourceEl) {
    let rect = null;
    try { rect = sourceEl && sourceEl.getBoundingClientRect ? sourceEl.getBoundingClientRect() : null; } catch { /* ignore */ }
    if (rect && rect.width) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return { x: window.innerWidth - 40, y: 24 };
  }

  /** 半径：圆心到最远角的距离（保证圆形能覆盖整屏）。 */
  function coverRadius(x, y) {
    return Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  }

  /**
   * 播"从按钮扩散"的主题切换。
   * @param {string} actualTheme 目标主题（'light' | 'dark'）
   * @param {Element|null} sourceEl 扩散原点
   * @param {() => void} done 真正提交主题的回调
   */
  function themeRipple(actualTheme, sourceEl, done) {
    // 不支持 View Transitions / 不允许动效：直接切，不做任何覆盖式动画
    if (!motionEnabled() || typeof document.startViewTransition !== 'function' || vtBusy) {
      done();
      return;
    }

    const { x, y } = origin(sourceEl);
    const radius = coverRadius(x, y);
    vtBusy = true;

    let transition;
    try {
      transition = document.startViewTransition(() => { done(); });
    } catch {
      vtBusy = false;
      done();
      return;
    }

    // ::view-transition-new(root) 就是"切换后的界面快照"。
    // 让它的可见区域从按钮处的一个点扩成整屏圆的半径 —— 扩散的是界面本身。
    try {
      transition.ready.then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          {
            duration: 420,
            easing: 'cubic-bezier(.22, 1, .36, 1)',
            pseudoElement: '::view-transition-new(root)'
          }
        );
      }).catch(() => { /* ready 失败就用默认交叉淡入，也是无害的 */ });
      transition.finished.finally(() => { vtBusy = false; });
    } catch {
      vtBusy = false;
    }
  }

  // ── 系统主题变化时，只有 auto 模式跟着变 ──────────────────────────────
  const onSystemChange = () => { if (getPref() === 'auto') applyTheme('auto'); };
  try {
    if (media) {
      if (media.addEventListener) media.addEventListener('change', onSystemChange);
      else if (media.addListener) media.addListener(onSystemChange);   // 老 Chromium
    }
  } catch { /* ignore */ }

  // ── 覆盖移植层里的同名函数 ─────────────────────────────────────────────
  // app/00-core.js 定义了 applyTheme / cycleTheme / getThemePref（两档语义）。
  // 这里用同名的 window 属性覆盖：顶层 function 声明在普通脚本里会挂到 window 上，
  //   app/11-init.js 调用的是裸标识符 → 词法查找先命中它自己的那一份，
  //   所以**必须**覆盖 window 上的同名属性才能生效。
  //   这也是为什么 index.html 把本文件排在 00-core.js 之后、11-init.js 之前。
  try {
    window.applyTheme = applyTheme;
    window.cycleTheme = cycleTheme;
    window.getThemePref = getPref;
    window.resolveTheme = resolve;
  } catch { /* ignore */ }

  // ── 绑定按钮 + 首次应用 ────────────────────────────────────────────────
  function openThemeMenu(btn) {
    document.querySelector('#theme-context-menu')?.themeClose?.();
    const menu = document.createElement('div');
    menu.id='theme-context-menu';menu.className='theme-context-menu';menu.setAttribute('role','menu');
    for(const pref of ['light','dark','auto']) {
      const item=document.createElement('button');item.type='button';item.dataset.themeChoice=pref;
      item.setAttribute('role','menuitemradio');item.setAttribute('aria-checked',String(pref===getPref()));
      item.innerHTML=ICON[pref]+'<span>'+LABEL[pref]+'</span><span class="theme-choice-check">'+(pref===getPref()?'✓':'')+'</span>';
      item.addEventListener('click',()=>{close();applyTheme(pref,btn);btn.focus();});menu.appendChild(item);
    }
    const close=()=>{menu.remove();btn.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keys);window.removeEventListener('resize',close);};
    const outside=e=>{if(!menu.contains(e.target))close();};
    const keys=e=>{if(e.key==='Escape'){close();btn.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=[...menu.children],index=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}};
    menu.themeClose=close;
    document.body.appendChild(menu);const r=btn.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(r.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.min(r.bottom+8,innerHeight-menu.offsetHeight-8)+'px';
    btn.setAttribute('aria-expanded','true');menu.children[0].focus();document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keys);window.addEventListener('resize',close);
  }
  function bind() {
    const btn = document.getElementById('theme-btn');
    if (btn && !btn.dataset.themeBound) {
      btn.dataset.themeBound = '1';
      // 传按钮本身作为动效原点：主题从这颗按钮扩散出去（用户要求的效果）
      btn.addEventListener('click', () => cycleTheme(btn));
      btn.setAttribute('aria-haspopup','menu');btn.setAttribute('aria-expanded','false');
      btn.addEventListener('contextmenu',e=>{e.preventDefault();openThemeMenu(btn);});
      // 键盘触发（Enter/Space）同样给原点，动效一致
      btn.addEventListener('keydown', (e) => {
        if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();openThemeMenu(btn);return;}
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycleTheme(btn); }
      });
    }
    // ⚠️ 双击陷阱（2026-10-03 实测踩到）：
    //   app/11-init.js 里也有一句 `$('#theme-btn')?.addEventListener('click', cycleTheme)`。
    //   两处都绑 = 每点一次切两档（auto→light 变成 auto→dark），而且**结果依赖注册顺序**。
    //   这里打一个标记，11-init.js 据此跳过绑定（见那边的一行判断）。
    //   这样做而不是去 removeEventListener：旧回调是匿名箭头函数，拿不到引用。
    window.__qqaThemeBound = true;
    applyTheme(getPref());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();

  // ── 与后端的关系（有意为之的取舍）────────────────────────────────────
  // 只**写**不**读**：
  //   · 写：用户显式切换时 POST 到 config.ui.theme，让别的设备/浏览器有个参考值。
  //   · 不读：启动时不以 config.ui.theme 覆盖本地偏好。
  // 为什么不读（2026-10-03 实测踩到）：移植层的 00-core.js 每次启动都会把
  //   `ui.theme='dark'` POST 上去（旧版是两档、默认暗色）。如果新 UI 启动时
  //   把这个值读回来当"用户的选择"，那么**全新安装也会直接变暗色**，
  //   "默认亮色 / 跟随系统"永远不生效 —— 而且现象极像"内联脚本没跑"。
  //   主题本质是**每台设备**的观感偏好（VS Code / GitHub 都是这么做的），
  //   以本地为准是更合理的默认，代价只是"换设备不会同步主题"。
  // 想恢复跨设备同步的话：需要先把后端里的历史值迁移成 'auto'，
  //   并且给"用户没选过"和"用户选了暗色"两个状态分别存不同的值。

})();
