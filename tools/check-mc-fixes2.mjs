// 验收（2026-10-05 第二轮用户反馈，共 7 项）：
//   ① 亮暗只两档直接切换（去掉「跟随系统」）
//   ② MC 皮肤下英文/数字更疏朗（字号+字距）
//   ③ Beta 提示条跟随主题换字体；默认皮肤仍是宋体/Bender；徽章不受影响
//   ④ 开关音里删掉木质/石质按钮，文件也不打包
//   ⑤ 拉杆音退役（改用菜单按钮，文件不打包）
//   ⑥ 点击音里删掉信标激活
//   ⑦ 二级设置最下方的"字体"分组已删
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1500, height: 980 }, async (page) => {
  await page.send('Page.navigate', { url: URL_.replace(/\/$/, '') + '/index.html' });
  await sleep(200);
  await page.eval(`(() => { localStorage.removeItem('qqa-skin'); localStorage.removeItem('qqa-mc'); localStorage.removeItem('qqa-theme-pref'); return 1; })()`);
  await page.send('Page.navigate', { url: URL_ });
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动完成' });
  await sleep(600);

  // ── ① 亮暗两档直接切换 ───────────────────────────────────────────────
  const cycle = await page.eval(`(() => {
    const root = document.documentElement;
    const seq = [];
    window.applyTheme('light', null, { animate: false });
    seq.push(root.getAttribute('data-theme'));
    for (let i = 0; i < 4; i += 1) {
      window.cycleTheme(null);
      seq.push(root.getAttribute('data-theme'));
      seq.push(root.getAttribute('data-theme-pref'));
    }
    return seq;
  })()`);
  console.log(`   cycleTheme 序列：${cycle.join(' → ')}`);
  ok('亮暗只在两档之间翻转（不经过 auto）',
    !cycle.includes('auto'), cycle.join(','));
  ok('每次点击主题都真的变了（亮→暗→亮→暗）',
    cycle[0] === 'light' && cycle[1] === 'dark' && cycle[3] === 'light' && cycle[5] === 'dark',
    cycle.join(','));

  await page.eval(`(() => { openSettingsSection('theme'); return 1; })()`);
  await page.waitFor(`document.querySelector('#settings-form .th-mode')`, { timeout: 25000, label: '亮度档' });
  await sleep(500);
  const modes = await page.eval(`(() => {
    const btns = [...document.querySelectorAll('#settings-form .th-mode[data-theme-pref]')];
    return { values: btns.map((b) => b.dataset.themePref), labels: btns.map((b) => b.textContent.trim()) };
  })()`);
  console.log(`   主题页亮度档：${modes.labels.join(' / ')}`);
  ok('主题页亮度只有两档（亮色 / 暗色），没有「跟随系统」',
    JSON.stringify(modes.values) === JSON.stringify(['light', 'dark']), modes.values.join(','));

  // 双向联动仍然成立（两档）
  await page.eval(`(() => { window.applyTheme('light', null, { animate: false }); document.getElementById('theme-btn').click(); return 1; })()`);
  await page.waitFor(`document.documentElement.getAttribute('data-theme') === 'dark'`, { timeout: 10000, label: '标题栏切暗' });
  await sleep(1100);
  const sync1 = await page.eval(`(() => {
    const on = document.querySelector('#settings-form .th-mode.is-on');
    return { pageMode: on ? on.dataset.themePref : null, header: document.getElementById('theme-btn').dataset.theme };
  })()`);
  ok('点标题栏 → 主题页同步到暗色', sync1.pageMode === 'dark' && sync1.header === 'dark', JSON.stringify(sync1));

  // ── ② MC 皮肤下正文更疏朗 ────────────────────────────────────────────
  await page.eval(`(() => { window.qqaSkin.set('minecraft'); return 1; })()`);
  await page.waitFor(`document.documentElement.getAttribute('data-skin') === 'minecraft'`, { timeout: 10000, label: 'MC' });
  await sleep(700);
  const mcText = await page.eval(`(() => {
    const cs = getComputedStyle(document.body);
    return { size: cs.fontSize, ls: cs.letterSpacing, color: cs.color };
  })()`);
  console.log(`   MC 皮肤正文：font-size=${mcText.size} letter-spacing=${mcText.ls} color=${mcText.color}`);
  ok('MC 皮肤正文字号放大到 15px', mcText.size === '15px', mcText.size);
  ok('MC 皮肤正文加了字距（数字串不糊在一起）',
    parseFloat(mcText.ls) > 0, mcText.ls);
  ok('MC 深色下前景压暗到 #d0d0d0',
    mcText.color.replace(/\s/g, '') === 'rgb(208,208,208)', mcText.color);

  // ── ③ Beta 提示条字体跟随主题 ────────────────────────────────────────
  const betaMc = await page.eval(`(() => {
    const line = document.querySelector('.dash-beta-line');
    const badge = document.querySelector('.dash-beta-badge svg');
    if (!line) return null;
    const cs = getComputedStyle(line);
    return {
      family: cs.fontFamily,
      badgeShapes: badge ? badge.querySelectorAll('path, polygon, rect, circle').length : 0,
      // 徽章是 SVG，不该受字体影响
      varTarkov: getComputedStyle(document.documentElement).getPropertyValue('--q-font-tarkov').trim()
    };
  })()`);
  console.log(`   MC 下 Beta 字体：${betaMc.family}`);
  ok('MC 皮肤下 Beta 提示条用 MC 字体',
    /Minecraft AE/i.test(betaMc.family), betaMc.family);
  ok('Beta 感叹号徽章仍是 SVG（不受字体影响，两主题一致）',
    betaMc.badgeShapes > 0, `${betaMc.badgeShapes} 个形状`);

  await page.eval(`(() => { window.qqaSkin.set('default'); return 1; })()`);
  await page.waitFor(`document.documentElement.getAttribute('data-skin') === 'default'`, { timeout: 10000, label: '回默认' });
  await sleep(700);
  const betaDef = await page.eval(`(() => {
    const line = document.querySelector('.dash-beta-line');
    return line ? { family: getComputedStyle(line).fontFamily } : null;
  })()`);
  console.log(`   默认下 Beta 字体：${betaDef.family}`);
  ok('默认皮肤下 Beta 提示条回到宋体/Bender（不是 MC 字体）',
    /SimSun|宋体|Bender|Songti|serif/i.test(betaDef.family) && !/Minecraft AE/i.test(betaDef.family),
    betaDef.family);

  // ── ④⑤⑥⑦ 音效与设置页 ──────────────────────────────────────────────
  await page.eval(`(() => { window.qqaSkin.set('minecraft'); openSettingsSection('theme'); return 1; })()`);
  await page.waitFor(`document.querySelector('#settings-form #card-mc')`, { timeout: 25000, label: 'MC 二级设置' });
  await sleep(700);

  const sfx = await page.eval(`(() => {
    const mc = window.qqaMcTheme;
    return { names: Object.keys(mc.SFX), files: mc.allFiles(), uses: mc.SFX_USES };
  })()`);
  console.log(`   音效清单（${sfx.names.length}）：${sfx.names.join(',')}`);
  console.log(`   音频文件（${sfx.files.length}）：${sfx.files.join(',')}`);
  console.log(`   点击=[${sfx.uses.click}]  开关=[${sfx.uses.toggle}]`);

  ok('④ 木质/石质按钮音效已从清单删除',
    !sfx.names.includes('wood') && !sfx.names.includes('stone'), sfx.names.join(','));
  ok('④ 退役音效的 wav 都不再打包',
    !sfx.files.some((f) => /^(wood|stone|note|lever|piston)\.wav$/.test(f)), sfx.files.join(','));
  ok('⑥ 点击音里已删掉信标激活',
    !sfx.uses.click.includes('beacon'), sfx.uses.click.join(','));
  ok('⑥ 信标仍在开关用途里（用户保留了这个）',
    sfx.uses.toggle.includes('beacon'), sfx.uses.toggle.join(','));

  // 实际文件是否真的取不到（确认没打包）
  const gone = await page.eval(`(async () => {
    const out = {};
    for (const f of ['wood.wav', 'stone.wav', 'note.wav', 'lever.wav', 'piston.wav']) {
      const r = await fetch('/assets/mc/sfx/' + f);
      out[f] = r.ok;
    }
    return out;
  })()`);
  ok('④ 已退役的 wav 在服务端确实 404', Object.values(gone).every((v) => v === false),
    JSON.stringify(gone));

  // ⑤ 拉杆音：**已退役**。
  //    ⚠️ 这一项在本轮被用户的新要求取代了："拉杆也是，改成菜单按钮，
  //       原有的音效删除不打包"。所以现在验的是**它确实不在了**，
  //       而不是"它被重做得更干净"。断言跟着规格走。
  const leverGone = await page.eval(`(async () => {
    const r = await fetch('/assets/mc/sfx/lever.wav');
    return r.ok;
  })()`);
  ok('⑤ 拉杆音已退役（文件不再打包，开关音改用菜单按钮）',
    leverGone === false, `lever.wav 可访问=${leverGone}`);
  const toggleDefault = await page.eval(`(() => window.qqaMcTheme.read().toggleSfx)()`);
  ok('⑤ 开关音默认已是菜单按钮', toggleDefault === 'menu', toggleDefault);

  // ⑦ 字体分组已删
  const fontGroup = await page.eval(`(() => ({
    hasCheckbox: !!document.getElementById('mc-font-on'),
    titles: [...document.querySelectorAll('#card-mc .pz-group-title')].map((e) => e.textContent.trim()),
    mentionsFont: /字体/.test(document.querySelector('#card-mc') ? document.querySelector('#card-mc').textContent : '')
  }))()`);
  console.log(`   二级设置分组：${fontGroup.titles.join(' / ')}`);
  ok('⑦ 二级设置里已无"字体"分组与开关',
    fontGroup.hasCheckbox === false && !fontGroup.titles.includes('字体'), fontGroup.titles.join(','));

  // 下拉里也不应再出现已删音效
  const opts = await page.eval(`(() => ({
    click: [...document.querySelectorAll('#mc-sfx-click option')].map((o) => o.value),
    toggle: [...document.querySelectorAll('#mc-sfx-toggle option')].map((o) => o.value),
    slider: [...document.querySelectorAll('#mc-sfx-slider option')].map((o) => o.value)
  }))()`);
  console.log(`   下拉：点击=${opts.click.join(',')}  开关=${opts.toggle.join(',')}  滑条=${opts.slider.join(',')}`);
  ok('④⑥ 三个下拉里都不再有 wood/stone/beacon（点击侧）',
    [opts.click, opts.toggle, opts.slider].every((l) => !l.includes('wood') && !l.includes('stone'))
    && !opts.click.includes('beacon'),
    `click=${opts.click} toggle=${opts.toggle}`);
  ok('开关下拉仍可选活塞与信标', opts.toggle.includes('piston') && opts.toggle.includes('beacon'), opts.toggle.join(','));

  // 全部音频仍可解码
  const dec = await page.eval(`(async () => {
    window.qqaMcTheme.loadSfx();
    const want = window.qqaMcTheme.allFiles().length;
    const t0 = Date.now();
    while (window.qqaMcTheme.loaded().length < want && Date.now() - t0 < 25000) {
      await new Promise((r) => setTimeout(r, 150));
    }
    return { want, got: window.qqaMcTheme.loaded().length };
  })()`);
  ok('剩余音效全部可解码', dec.got === dec.want, `${dec.got}/${dec.want}`);

  // 收尾
  await page.eval(`(() => {
    window.qqaSkin.set('default');
    window.applyTheme('light', null, { animate: false });
    localStorage.removeItem('qqa-mc');
    return 1;
  })()`);
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n第二轮反馈 7 项修复验收通过。');
process.exit(failed ? 2 : 0);
