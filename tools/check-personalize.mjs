// 个性化 + 动效开关 + 主题扩散动效的验收。
// 用法：node tools/check-personalize.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
let failed = 0;
const ok = (name, pass, detail) => { console.log(`${pass ? '✔' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!pass) failed += 1; };

await withPage({ url: URL_, width: 1600, height: 1000 }, async (page) => {
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
  await sleep(2600);

  // ── 1. API 是否就位 ──────────────────────────────────────────────────
  const api = await page.eval(`(() => ({
    colors: typeof window.qqaColors,
    motion: typeof window.qqaMotion,
    items: window.qqaColors ? window.qqaColors.ITEMS.length : 0,
    groups: window.qqaColors ? window.qqaColors.GROUPS : []
  }))()`);
  ok('window.qqaColors 已加载', api.colors === 'object', `可自定义 ${api.items} 项`);
  ok('window.qqaMotion 已加载', api.motion === 'object', '');
  ok('颜色项按分组组织', api.groups.length >= 3, api.groups.join(' / '));

  // ── 2. 设置页有「个性化」入口且能打开 ────────────────────────────────
  await page.click('#tabs .tab[data-tab="settings"]');
  // ⚠️ 等菜单**真的渲染出来**再断言（2026-10-04 修偶发失败）：
  //    loadSettings() 要拉 config + skills，菜单出现需要 1~2 秒，
  //    固定 sleep(1400) 在批量跑套件时会不够 → "二级菜单里没有个性化" 假失败。
  const hasMenu = await page.waitFor(`document.querySelector('.settings-menu-item[data-section="personal"]')`,
    { timeout: 25000, label: '设置菜单（个性化入口）' }).then(() => true).catch(() => false);
  ok('二级菜单里有「个性化」', hasMenu, 'data-section=personal');
  if (!hasMenu) throw new Error('设置菜单未渲染出「个性化」入口，后续用例无法继续');
  await page.click('.settings-menu-item[data-section="personal"]');
  // ⚠️ 等**配色区块真的渲染出来**再断言（2026-10-04 修偶发失败）：
  //    `page.click` 返回只代表点到了，renderSettings() 可能还没跑完
  //    （批量跑套件时更明显）。不等就会读到 "0 行 / 取色器 undefined" ——
  //    看着像功能坏了，其实是没渲染完。
  await page.waitFor(`document.querySelectorAll('.pz-row').length > 10 && !!document.querySelector('.pz-picker')`,
    { timeout: 25000, label: '个性化区块渲染' });

  const ui = await page.eval(`(() => ({
    rows: document.querySelectorAll('.pz-row').length,
    pickers: document.querySelectorAll('.pz-picker').length,
    // 三种格式全部罗列（HEX / RGB / HSL），且每个颜色项各一套 —— 用户要求
    hexInputs: document.querySelectorAll('.pz-in-hex').length,
    rgbInputs: document.querySelectorAll('.pz-in-rgb').length,
    hslInputs: document.querySelectorAll('.pz-in-hsl').length,
    resets: document.querySelectorAll('.pz-reset').length,
    motionBox: !!document.getElementById('cfg-motion-on'),
    groups: document.querySelectorAll('.pz-group').length,
    hasCopy: !!document.getElementById('pz-copy-css'),
    hasResetAll: !!document.getElementById('pz-reset-all'),
    // 没有"切换格式"的小按钮（用户明确不要）
    fmtToggles: document.querySelectorAll('.pz-fmt-toggle, .pz-tabs, [data-pz-switch-fmt]').length,
    hasFormatApi: typeof window.qqaColorFormat
  }))()`);
  ok('渲染出配色项（色块 + 三格式 + 恢复）',
    ui.rows > 10 && ui.pickers === ui.rows && ui.resets === ui.rows
    && ui.hexInputs === ui.rows && ui.rgbInputs === ui.rows && ui.hslInputs === ui.rows,
    `${ui.rows} 行 / ${ui.groups} 组 / HEX·RGB·HSL 各 ${ui.hexInputs} 个`);
  ok('没有"切换格式"的小按钮（三格式直接罗列）', ui.fmtToggles === 0, `切换按钮 ${ui.fmtToggles} 个`);
  ok('颜色格式互转模块已加载', ui.hasFormatApi === 'object', 'window.qqaColorFormat');

  // 色块要显示"当前实际颜色"而不是一块灰 —— 否则用户看不出这项影响什么颜色。
  // 判据：取若干未自定义项的色点 computedStyle，不能全是同一个灰色。
  const swatches = await page.eval(`(() => {
    const dots = [...document.querySelectorAll('.pz-dot')].slice(0, 12);
    const colors = dots.map((d) => getComputedStyle(d).backgroundColor);
    const uniq = [...new Set(colors)];
    return { count: dots.length, uniq: uniq.length, sample: colors.slice(0, 5) };
  })()`);
  ok('未自定义项的色块也显示真实默认色（不是一片灰）',
    swatches.count >= 8 && swatches.uniq >= 5,
    `${swatches.count} 个色点里 ${swatches.uniq} 种颜色：${swatches.sample.join(' / ')}`);
  ok('动效开关存在', ui.motionBox, '');
  ok('有"全部恢复"与"复制 CSS"', ui.hasCopy && ui.hasResetAll, '');

  // ── 3. 改色即时生效 + 三格式自动互填 ────────────────────────────────
  const before = await page.eval("getComputedStyle(document.documentElement).getPropertyValue('--q-accent').trim()");
  // 在 HEX 框里填一个值 → 期望 RGB / HSL 框被自动补齐
  const applied = await page.eval(`(() => {
    const hexInput = document.querySelector('.pz-in-hex[data-pz-var="--q-accent"]');
    if (!hexInput) return { error: 'no-hex-input' };
    hexInput.value = '#ff00aa';
    hexInput.dispatchEvent(new Event('input', { bubbles: true }));
    hexInput.dispatchEvent(new Event('change', { bubbles: true }));
    const row = hexInput.closest('.pz-row');
    return {
      inline: document.documentElement.style.getPropertyValue('--q-accent'),
      computed: getComputedStyle(document.documentElement).getPropertyValue('--q-accent').trim(),
      stored: (() => { try { return JSON.parse(localStorage.getItem('qqa-colors') || '{}')['--q-accent'] || null; } catch { return null; } })(),
      attr: document.documentElement.getAttribute('data-personalized'),
      hexFilled: row.querySelector('.pz-in-hex').value,
      rgbFilled: row.querySelector('.pz-in-rgb').value,
      hslFilled: row.querySelector('.pz-in-hsl').value,
      pickerVal: row.querySelector('.pz-picker').value
    };
  })()`);
  ok('改色写入 inline 变量', applied.inline === '#ff00aa' || applied.inline === 'rgb(255, 0, 170)', JSON.stringify(applied));
  ok('计算值跟着变', applied.computed === '#ff00aa', `${before} → ${applied.computed}`);
  ok('已持久化到 localStorage', applied.stored === '#ff00aa', `stored=${applied.stored}`);
  ok('标记 data-personalized=1', applied.attr === '1', '');
  ok('填 HEX → 自动补齐 RGB', /255.*0.*170/.test(String(applied.rgbFilled)), `rgb="${applied.rgbFilled}"`);
  ok('填 HEX → 自动补齐 HSL', /^hsl/.test(String(applied.hslFilled)), `hsl="${applied.hslFilled}"`);
  ok('取色器同步为该色', String(applied.pickerVal).toLowerCase() === '#ff00aa', `picker=${applied.pickerVal}`);

  // 反向：在 RGB 框里填一个值 → 期望 HEX / HSL 被自动补齐
  // ⚠️ 先等输入框在 DOM 里：设置页会因自动保存/守卫而重渲染，
  //    上一次 layout 取到的引用可能已经被换掉（实测偶发取到 null）。
  await page.waitFor(`document.querySelector('.pz-in-rgb[data-pz-var="--q-accent"]')`, { timeout: 20000, label: 'RGB 输入框' });
  const reverse = await page.eval(`(() => {
    const rgbInput = document.querySelector('.pz-in-rgb[data-pz-var="--q-accent"]');
    if (!rgbInput) return { missing: 'rgb-input' };
    rgbInput.value = 'rgb(18, 52, 86)';
    rgbInput.dispatchEvent(new Event('input', { bubbles: true }));
    rgbInput.dispatchEvent(new Event('change', { bubbles: true }));
    const row = rgbInput.closest('.pz-row');
    return {
      hex: row.querySelector('.pz-in-hex').value,
      rgb: row.querySelector('.pz-in-rgb').value,
      hsl: row.querySelector('.pz-in-hsl').value,
      inline: document.documentElement.style.getPropertyValue('--q-accent'),
      stored: (() => { try { return JSON.parse(localStorage.getItem('qqa-colors') || '{}')['--q-accent'] || null; } catch { return null; } })()
    };
  })()`);
  if (reverse.missing) { ok('取到 RGB 输入框', false, reverse.missing); }
  ok('填 RGB → 自动补齐 HEX', String(reverse.hex).toLowerCase() === '#123456', `hex="${reverse.hex}"`);
  ok('填 RGB → 保持 RGB 框（不打断输入）', /18.*52.*86/.test(String(reverse.rgb)), `rgb="${reverse.rgb}"`);
  ok('填 RGB → 自动补齐 HSL', /^hsl/.test(String(reverse.hsl)), `hsl="${reverse.hsl}"`);
  ok('RGB 输入也落库为规范 HEX', String(reverse.stored).toLowerCase() === '#123456', `stored=${reverse.stored}`);

  // 非法输入：标红但不落库、不破坏已存值
  const invalid = await page.eval(`(() => {
    const hexInput = document.querySelector('.pz-in-hex[data-pz-var="--q-accent"]');
    const before = (() => { try { return JSON.parse(localStorage.getItem('qqa-colors') || '{}')['--q-accent'] || null; } catch { return null; } })();
    hexInput.value = 'not-a-color';
    hexInput.dispatchEvent(new Event('input', { bubbles: true }));
    hexInput.dispatchEvent(new Event('change', { bubbles: true }));
    return { invalidClass: hexInput.classList.contains('pz-invalid'), before, after: (() => { try { return JSON.parse(localStorage.getItem('qqa-colors') || '{}')['--q-accent'] || null; } catch { return null; } })() };
  })()`);
  ok('非法输入被标红且不落库', invalid.invalidClass === true && invalid.after === invalid.before,
    `invalid=${invalid.invalidClass} stored 未变=${invalid.after === invalid.before}`);

  // 真正影响到了组件：**像素级/终值**验证。
  // 为什么不直接查 getComputedStyle：`.tab-ico` 上有 `transition: … color …`，
  // 改完变量立刻读到的可能是过渡**当前帧**（实测读到的是改色前的值），
  // 于是"功能其实正常"却被判成失败 —— 查了两轮才定位到是测量方式的问题。
  // 改用三种不依赖过渡的证据：
  //   ① 关掉动效后再读计算值（没有过渡 → 直接是终值）
  //   ② 读一个带 accent 底色、且没有 color 过渡的元素（选中项 ::before 强调条）
  //   ③ 直接数像素（另见 tools/check-accent-pixel.mjs）
  // ⚠️ 期望值要取**当前实际存的值**，不能写死上一小节的 #ff00aa ——
  //    上面刚做过"填 RGB"的反向用例，已把值改成 #123456。
  const expectHex = await page.eval(`(() => { try { return JSON.parse(localStorage.getItem('qqa-colors') || '{}')['--q-accent'] || null; } catch { return null; } })()`);
  const expectRgb = 'rgb(18, 52, 86)';       // #123456
  await page.eval(`(() => { window.qqaMotion && window.qqaMotion.setPref('off'); return 1; })()`);
  await sleep(500);
  const colorEvidence = await page.eval(`(() => {
    const ico = document.querySelector('#tabs .tab.active .tab-ico');
    const active = document.querySelector('#tabs .tab.active');
    return {
      iconColor: ico ? getComputedStyle(ico).color : null,
      accentVar: getComputedStyle(document.documentElement).getPropertyValue('--q-accent').trim(),
      tabBeforeBg: active ? getComputedStyle(active, '::before').backgroundColor : null
    };
  })()`);
  ok('关掉动效后激活页签图标就是新主色', colorEvidence.iconColor === expectRgb,
    `icon=${colorEvidence.iconColor} var=${colorEvidence.accentVar}（期望 ${expectHex}）`);
  ok('激活页签的强调条也用新主色', colorEvidence.tabBeforeBg === expectRgb,
    `::before background=${colorEvidence.tabBeforeBg}`);
  await page.eval(`(() => { window.qqaMotion && window.qqaMotion.setPref('on'); return 1; })()`);

  // ── 4. 刷新后仍然生效（持久化）───────────────────────────────────────
  await page.send('Page.navigate', { url: `${URL_}?p=${Date.now()}` });
  // ⚠️ 刷新后必须重新走一遍"启动门禁 + 等设置区块渲染" ——
  //    沿用刷新前的等待时长会偶发落到"设置页还没渲染完"的时刻，
  //    后面 getElementById('cfg-motion-on') 就是 null（实测踩到）。
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '刷新后启动完成' });
  const afterReload = await page.eval(`(() => ({
    computed: getComputedStyle(document.documentElement).getPropertyValue('--q-accent').trim(),
    attr: document.documentElement.getAttribute('data-personalized')
  }))()`);
  ok('刷新后自定义仍然生效', afterReload.computed === expectHex && afterReload.attr === '1',
    JSON.stringify({ ...afterReload, expect: expectHex }));

  // ── 5. 恢复默认 ─────────────────────────────────────────────────────
  await page.click('#tabs .tab[data-tab="settings"]');
  await page.waitFor(`document.querySelector('.settings-menu-item[data-section="personal"]')`, { timeout: 25000, label: '设置菜单' });
  await page.click('.settings-menu-item[data-section="personal"]');
  await page.waitFor(`document.querySelector('.pz-reset[data-pz-reset="--q-accent"]')`, { timeout: 20000, label: '个性化区块' });
  const reset = await page.eval(`(() => {
    const btn = document.querySelector('.pz-reset[data-pz-reset="--q-accent"]');
    if (!btn) return { error: 'no-btn' };
    btn.click();
    return {
      inline: document.documentElement.style.getPropertyValue('--q-accent'),
      attr: document.documentElement.getAttribute('data-personalized'),
      stored: (() => { try { return JSON.parse(localStorage.getItem('qqa-colors') || '{}')['--q-accent'] || null; } catch { return null; } })()
    };
  })()`);
  await sleep(500);
  ok('单项恢复后不再有该覆盖', !reset.inline && !reset.stored, JSON.stringify(reset));

  // ── 6. 动效开关：关闭后动画时长归零 ─────────────────────────────────
  await page.waitFor(`document.getElementById('cfg-motion-on')`, { timeout: 20000, label: '动效开关' });
  const motionCheck = await page.eval(`(() => {
    const box = document.getElementById('cfg-motion-on');
    if (!box) return { error: 'no-box' };
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      attr: document.documentElement.getAttribute('data-motion'),
      stored: (() => { try { return localStorage.getItem('qqa-motion'); } catch { return null; } })()
    };
  })()`);
  await sleep(600);
  const dur = await page.eval(`(() => {
    const el = document.querySelector('#tabs .tab');
    const view = document.querySelector('.view.active');
    return {
      tabTransition: el ? getComputedStyle(el).transitionDuration : null,
      viewAnimation: view ? getComputedStyle(view).animationName : null,
      viewOpacity: view ? getComputedStyle(view).opacity : null,
      moved: window.qqaMotion ? window.qqaMotion.getPref() : null
    };
  })()`);
  ok('关闭动效后 data-motion=off 且已持久化', motionCheck.attr === 'off' && motionCheck.stored === 'off',
    JSON.stringify(motionCheck));
  // 过渡时长被压到 0.001ms —— 注意浏览器把它序列化成 **1e-06s**（科学计数法），
  // 只匹配 "0.001ms" 会误判成没生效。
  ok('关闭动效后过渡时长归零', /^(0s|1e-06s|0\.001ms)/.test(String(dur.tabTransition)), `duration=${dur.tabTransition}`);
  ok('关闭动效后不再有入场动画', dur.viewAnimation === 'none', `animation-name=${dur.viewAnimation}`);
  ok('但内容仍然可见（不会停在 opacity:0）', dur.viewOpacity === '1', `opacity=${dur.viewOpacity}`);

  // 打开回来
  const reOn = await page.eval(`(() => {
    window.qqaMotion.setPref('on');
    return document.documentElement.getAttribute('data-motion');
  })()`);
  ok('可以重新打开动效', reOn === 'on', `data-motion=${reOn}`);

  // ── 7. 主题扩散动效 ───────────────────────────────────────────────────
  // ⚠️ 实现已按用户要求改过（2026-10-04）：不再往界面上盖一层颜色，
  //    而是用 **View Transitions + clip-path 圆形揭示** —— 扩散的是界面本身。
  //    所以这里断言的是"clip-path 圆形 + 不拦指针 + 无覆盖节点"，
  //    而不是旧版的 `.q-theme-ripple` 节点（那个已经删掉了，别再照着它写）。
  //    详细的"不盖住/不拦截"验证在 check-tier-buttons-theme.mjs。
  await page.send('Page.navigate', { url: `${URL_}?r=${Date.now()}` });
  // ⚠️ 必须等页面**真的可用**，不能 sleep 猜时长。
  //    实测批量跑时这里读到 `#theme-btn` 还是 null → "Cannot read properties of null (reading 'click')"
  //    整条用例静默失败。判据：内联脚本已写好 data-theme（documentElement 就绪）
  //    且主题按钮已被 00-theme.js 的 bind() 挂上（DOMContentLoaded 之后才绑）。
  await page.waitFor(`(() => {
    const r = document.documentElement;
    return !!document.body && !!r.getAttribute('data-theme') && !!document.getElementById('theme-btn');
  })()`, { timeout: 30000, label: '页面可用（主题按钮就绪）' });
  await sleep(400);
  const ripple = await page.eval(`(() => {
    const supported = typeof document.startViewTransition === 'function';
    if (!supported) return { supported: false, before: document.documentElement.getAttribute('data-theme') };
    return new Promise((resolve) => {
      const btn = document.getElementById('theme-btn');
      const before = document.documentElement.getAttribute('data-theme');
      btn.click();
      setTimeout(() => {
        const ps = window.getComputedStyle(document.documentElement, '::view-transition-new(root)');
        const po = window.getComputedStyle(document.documentElement, '::view-transition-old(root)');
        resolve({
          supported: true,
          before,
          clip: ps.clipPath,
          newPointer: ps.pointerEvents,
          oldPointer: po.pointerEvents,
          overlayNode: !!document.querySelector('.q-theme-ripple'),
          after: document.documentElement.getAttribute('data-theme')
        });
      }, 220);
    });
  })()`);
  await sleep(1000);
  const afterTheme = await page.eval('document.documentElement.getAttribute("data-theme")');
  const vtGone = await page.eval(`(() => !document.querySelector('.q-theme-ripple') && document.documentElement.getAnimations().filter(a => String(a.effect?.pseudoElement||'').includes('view-transition')).length === 0)()`);
  ok('支持 View Transitions 扩散（界面本身展开，不是盖一层）', ripple.supported === true, '');
  ok('扩散是 clip-path 圆形揭示', /circle\(/.test(String(ripple.clip)), `clip-path=${ripple.clip}`);
  ok('过渡层不拦任何元素', ripple.newPointer === 'none' && ripple.oldPointer === 'none',
    `new=${ripple.newPointer} old=${ripple.oldPointer}`);
  ok('没有覆盖式遮罩节点', ripple.overlayNode === false, `.q-theme-ripple=${ripple.overlayNode}`);
  ok('过渡结束后不留残留动画', vtGone === true, `残留=${!vtGone}`);
  ok('一次点击就能看出变化（不会落在空转档）', ripple.before !== afterTheme, `${ripple.before} → ${afterTheme}`);
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n个性化 / 动效开关 / 主题扩散 全部通过。');
process.exit(failed ? 2 : 0);
