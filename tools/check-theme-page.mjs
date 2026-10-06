// 第 1 段验收：设置页新增「主题」卡页 + 皮肤/亮度两维选择 + 存储 + Minecraft 二级设置出现。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1500, height: 980 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动完成' });
  // ⚠️ 清状态必须发生在**页面脚本加载之前**，不能等页面起来再 removeItem。
  //    原因：shell/02-mc-theme.js 在加载时会把默认偏好落盘一次
  //    （ensurePersisted，为了让"从没动过设置"和"从没用过 MC"可区分）。
  //    如果先加载再删除，就把那次落盘擦掉了 —— 后续"切回默认皮肤后偏好仍在"
  //    这条永远为假，看着像功能没实现（本轮实测踩到）。
  //    做法：先导航到一个同源空白页清掉，再打开真正的界面。
  await page.send('Page.navigate', { url: URL_.replace(/\/$/, '') + '/index.html' });
  await sleep(200);
  await page.eval(`(() => {
    localStorage.removeItem('qqa-skin');
    localStorage.removeItem('qqa-mc');
    return 1;
  })()`);
  await page.send('Page.navigate', { url: URL_ });
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '重新启动完成' });
  await page.eval(`(() => { openSettingsSection('theme'); return 1; })()`);
  await page.waitFor(`document.querySelector('#settings-form #card-skin')`, { timeout: 25000, label: '主题卡页' });
  await sleep(800);

  // ── ① 卡页存在、二级菜单里有入口 ───────────────────────────────────────
  const nav = await page.eval(`(() => {
    const items = [...document.querySelectorAll('#settings-sidebar .settings-menu-item')];
    const theme = items.find((b) => (b.textContent || '').trim() === '主题');
    return {
      menuHasTheme: !!theme,
      menuLabels: items.map((b) => (b.textContent || '').trim()),
      section: state.settingsSection,
      hasSkinCard: !!document.getElementById('card-skin'),
      hasBrightnessCard: !!document.getElementById('card-brightness'),
      heading: (document.querySelector('#settings-form h3') || {}).textContent
    };
  })()`);
  console.log(`   二级菜单：${nav.menuLabels.join(' / ')}`);
  ok('二级菜单里有「主题」入口', nav.menuHasTheme === true, '');
  ok('「主题」在「个性化」之后（两者并列）',
    nav.menuLabels.indexOf('主题') === nav.menuLabels.indexOf('个性化') + 1,
    `个性化@${nav.menuLabels.indexOf('个性化')} 主题@${nav.menuLabels.indexOf('主题')}`);
  ok('卡页标题是「主题」', (nav.heading || '').trim() === '主题', nav.heading);
  ok('有皮肤卡与亮度卡', nav.hasSkinCard && nav.hasBrightnessCard, '');

  // ── ② 皮肤：两张卡、默认选中「默认」 ──────────────────────────────────
  const skins = await page.eval(`(() => {
    const btns = [...document.querySelectorAll('#settings-form .th-skin[data-skin]')];
    return {
      values: btns.map((b) => b.dataset.skin),
      onCount: btns.filter((b) => b.classList.contains('is-on')).length,
      onValue: (btns.find((b) => b.classList.contains('is-on')) || {}).dataset?.skin || null,
      attr: document.documentElement.getAttribute('data-skin'),
      hasPreview: btns.every((b) => !!b.querySelector('.th-skin-preview'))
    };
  })()`);
  console.log(`   皮肤卡：${skins.values.join(' / ')}，当前 ${skins.onValue}`);
  ok('有两张皮肤卡（默认 / Minecraft）',
    JSON.stringify(skins.values) === JSON.stringify(['default', 'minecraft']), skins.values.join(','));
  ok('默认选中「默认」皮肤', skins.onValue === 'default' && skins.attr === 'default', `on=${skins.onValue} attr=${skins.attr}`);
  ok('每张皮肤卡都有缩略预览', skins.hasPreview === true, '');

  // ── ③ 切到 Minecraft：属性、存储、二级设置出现 ────────────────────────
  const before = await page.eval(`({
    hasMcCard: !!document.getElementById('card-mc'),
    mcPref: localStorage.getItem('qqa-mc')
  })`);
  ok('默认皮肤下没有 Minecraft 二级设置', before.hasMcCard === false, '');

  await page.eval(`(() => { document.querySelector('#settings-form .th-skin[data-skin="minecraft"]').click(); return 1; })()`);
  await page.waitFor(`document.documentElement.getAttribute('data-skin') === 'minecraft'`, { timeout: 10000, label: '皮肤属性' });
  await page.waitFor(`document.querySelector('#settings-form #card-mc')`, { timeout: 25000, label: 'MC 二级设置' });
  await sleep(600);

  const mc = await page.eval(`(() => {
    const root = document.documentElement;
    const prefs = window.qqaMcTheme ? window.qqaMcTheme.read() : null;
    return {
      skinAttr: root.getAttribute('data-skin'),
      stored: localStorage.getItem('qqa-skin'),
      hasMcCard: !!document.getElementById('card-mc'),
      // 二级设置的控件
      hasSfxOn: !!document.getElementById('mc-sfx-on'),
      hasSfxVolume: !!document.getElementById('mc-sfx-volume'),
      hasClickSfx: !!document.getElementById('mc-sfx-click'),
      hasToggleSfx: !!document.getElementById('mc-sfx-toggle'),
      hasSliderSfx: !!document.getElementById('mc-sfx-slider'),
      hasBgOn: !!document.getElementById('mc-bg-on'),
      hasBgOpacity: !!document.getElementById('mc-bg-opacity'),
      hasBgList: !!document.getElementById('mc-bg-list'),
      hasFontOn: !!document.getElementById('mc-font-on'),
      // 用**分组标题**判，不用整卡文本 —— 卡头副标题会写"音效 · 背景"这类总述，
      // 那句是在说明"这套设置管哪些方面"，不是分组本身；用全文匹配会误判（实测踩到）。
      mcGroupTitles: [...document.querySelectorAll('#card-mc .pz-group-title')].map((e) => e.textContent.trim()),
      clickVal: (document.getElementById('mc-sfx-click') || {}).value,
      toggleVal: (document.getElementById('mc-sfx-toggle') || {}).value,
      sliderVal: (document.getElementById('mc-sfx-slider') || {}).value,
      sfxOn: (document.getElementById('mc-sfx-on') || {}).checked,
      volVal: (document.getElementById('mc-sfx-volume') || {}).value,
      bgOpVal: (document.getElementById('mc-bg-opacity') || {}).value,
      rootVars: {
        opacity: root.style.getPropertyValue('--mc-bg-opacity'),
        sfx: root.getAttribute('data-mc-sfx'),
        bg: root.getAttribute('data-mc-bg'),
        font: root.getAttribute('data-mc-font')
      },
      prefs
    };
  })()`);
  ok('皮肤属性切到 minecraft', mc.skinAttr === 'minecraft', mc.skinAttr);
  ok('皮肤选择写入 localStorage', mc.stored === 'minecraft', String(mc.stored));
  ok('出现「Minecraft 主题设置」二级卡片', mc.hasMcCard === true, '');

  // ── ④ 二级设置的默认值必须逐条对上需求原话 ────────────────────────────
  ok('音效总开关默认开启', mc.sfxOn === true, String(mc.sfxOn));
  ok('音量默认 60%', mc.volVal === '60', mc.volVal);
  ok('点击音默认「菜单按钮」', mc.clickVal === 'menu', mc.clickVal);
  ok('开关音可选且有默认（菜单按钮）', !!mc.hasToggleSfx && mc.toggleVal === 'menu', mc.toggleVal);
  ok('滑条音默认「不播放」', mc.sliderVal === 'off', mc.sliderVal);
  ok('背景默认开启、透明度 35%', mc.hasBgOn && mc.bgOpVal === '35', `bgOn=${mc.hasBgOn} op=${mc.bgOpVal}`);
  // ⚠️ 2026-10-05 用户要求"最下方的字体相关内容删掉"，
  //    所以二级设置里**不该再有**字体开关。这里改成反向断言：
  //    字体跟随皮肤自动生效，不需要（也不该有）单独开关。
  ok('二级设置里没有「字体」分组与开关（字体跟随皮肤）',
    mc.hasFontOn === false && !(mc.mcGroupTitles || []).includes('字体'),
    `hasFontOn=${mc.hasFontOn}，分组=[${(mc.mcGroupTitles || []).join(',')}]`);
  ok('偏好同步到根元素 CSS 变量/属性',
    mc.rootVars.sfx === 'on' && mc.rootVars.bg === 'on' && mc.rootVars.opacity === '0.35',
    JSON.stringify(mc.rootVars));

  // 背景清单：第 6 段已把 5 张素材打包进 assets/mc/bg/，所以这里应当列出 5 张缩略图。
  // ⚠️ 这条断言在第 1 段时写的是"必须有'素材未打包'占位"—— 那是当时的真实状态，
  //    素材到位后就**必须改**，否则测试在阻止功能完成。
  //    教训：别把"暂时的缺失"写成永久断言。
  const bgList = await page.eval(`(() => {
    const el = document.getElementById('mc-bg-list');
    const imgs = el ? [...el.querySelectorAll('img')] : [];
    return {
      count: imgs.length,
      srcs: imgs.map((i) => i.getAttribute('src')),
      thumbs: imgs.every((i) => /thumb\\.png$/.test(i.getAttribute('src') || '')),
      hasRadioRole: el ? el.getAttribute('role') : null,
      selected: el ? el.querySelectorAll('.th-bg.is-on').length : -1
    };
  })()`);
  console.log(`   背景清单：${bgList.count} 张，均用缩略图=${bgList.thumbs}`);
  ok('背景清单列出全部素材（5 张）', bgList.count === 5, `${bgList.count} 张`);
  ok('背景清单用缩略图而不是原图（避免一次拉 500KB）', bgList.thumbs === true, bgList.srcs.join(','));
  ok('背景选择是单选（有选中项）', bgList.hasRadioRole === 'radiogroup' && bgList.selected === 1,
    `role=${bgList.hasRadioRole} 选中=${bgList.selected}`);

  // ── ⑤ 切回默认皮肤：二级设置消失、属性复位 ────────────────────────────
  await page.eval(`(() => { document.querySelector('#settings-form .th-skin[data-skin="default"]').click(); return 1; })()`);
  await page.waitFor(`document.documentElement.getAttribute('data-skin') === 'default'`, { timeout: 10000, label: '切回默认' });
  await sleep(600);
  const back = await page.eval(`({
    skin: document.documentElement.getAttribute('data-skin'),
    hasMcCard: !!document.getElementById('card-mc'),
    stored: localStorage.getItem('qqa-skin'),
    // 二级偏好应当**保留**（切回默认不该清掉用户调好的音效/背景设置）
    mcPref: localStorage.getItem('qqa-mc')
  })`);
  ok('切回默认皮肤后二级设置消失', back.hasMcCard === false && back.skin === 'default', JSON.stringify(back));
  ok('Minecraft 的偏好被保留（切回不丢设置）', !!back.mcPref, String(back.mcPref));

  // ── ⑥ 亮度档存在且能切（每套皮肤各自解析） ────────────────────────────
  const modes = await page.eval(`(() => {
    const btns = [...document.querySelectorAll('#settings-form .th-mode[data-theme-pref]')];
    return { values: btns.map((b) => b.dataset.themePref), onCount: btns.filter((b) => b.classList.contains('is-on')).length };
  })()`);
  // ⚠️ 2026-10-05 用户要求去掉「跟随系统」："直接亮色和暗色切换"。
  //    这条断言原来写的是三档 ['auto','light','dark']，需求变了就必须跟着改 ——
  //    断言要表达**当前规格**，而不是历史规格。
  ok('两档亮度都在（亮色 / 暗色，无「跟随系统」）',
    JSON.stringify(modes.values) === JSON.stringify(['light', 'dark']), modes.values.join(','));
  ok('恰好一档选中', modes.onCount === 1, `${modes.onCount}`);

  await page.eval(`(() => { window.applyTheme('light', null, { animate: false }); return 1; })()`);
  await sleep(400);
  const lightVar = await page.eval(`(() => { const cs = getComputedStyle(document.documentElement); return { theme: document.documentElement.getAttribute('data-theme'), bg: cs.getPropertyValue('--q-bg-base').trim() }; })()`);
  await page.eval(`(() => { window.applyTheme('dark', null, { animate: false }); return 1; })()`);
  await sleep(400);
  const darkVar = await page.eval(`(() => { const cs = getComputedStyle(document.documentElement); return { theme: document.documentElement.getAttribute('data-theme'), bg: cs.getPropertyValue('--q-bg-base').trim() }; })()`);
  console.log(`   默认皮肤：light --q-bg-base=${lightVar.bg} / dark --q-bg-base=${darkVar.bg}`);
  ok('默认皮肤下亮暗底色不同', lightVar.bg !== darkVar.bg, `${lightVar.bg} vs ${darkVar.bg}`);

  // 切到 MC 皮肤后，同样的亮/暗应当给出**另一套**颜色（MC 自带配色）
  await page.eval(`(() => { window.qqaSkin.set('minecraft'); return 1; })()`);
  await sleep(400);
  await page.eval(`(() => { window.applyTheme('light', null, { animate: false }); return 1; })()`);
  await sleep(400);
  const mcLight = await page.eval(`getComputedStyle(document.documentElement).getPropertyValue('--q-bg-base').trim()`);
  await page.eval(`(() => { window.applyTheme('dark', null, { animate: false }); return 1; })()`);
  await sleep(400);
  const mcDark = await page.eval(`getComputedStyle(document.documentElement).getPropertyValue('--q-bg-base').trim()`);
  console.log(`   MC 皮肤：light --q-bg-base=${mcLight} / dark --q-bg-base=${mcDark}`);
  ok('MC 皮肤有自己独立的一套亮暗配色',
    mcLight !== lightVar.bg && mcDark !== darkVar.bg && mcLight !== mcDark,
    `默认(${lightVar.bg}/${darkVar.bg}) vs MC(${mcLight}/${mcDark})`);

  // ── ⑦ 像素风：MC 皮肤下圆角应当被清零 ────────────────────────────────
  const pixel = await page.eval(`(() => {
    const cs = getComputedStyle(document.documentElement);
    return { rMd: cs.getPropertyValue('--q-r-md').trim(), rLg: cs.getPropertyValue('--q-r-lg').trim() };
  })()`);
  ok('MC 皮肤是直角像素风（圆角变量为 0）', pixel.rMd === '0px' && pixel.rLg === '0px', JSON.stringify(pixel));

  // 收尾：恢复干净的默认状态，别把测试状态留给用户
  await page.eval(`(() => {
    window.qqaSkin.set('default');
    window.applyTheme('auto', null, { animate: false });
    localStorage.removeItem('qqa-mc');
    return 1;
  })()`);
  await sleep(300);

  await page.screenshot('shots/final/theme-page.png');
  console.log('\n截图：shots/final/theme-page.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n「主题」卡页与 Minecraft 皮肤（第 1 段）验收通过。');
process.exit(failed ? 2 : 0);
