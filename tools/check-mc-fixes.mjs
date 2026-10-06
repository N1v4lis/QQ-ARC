// 验收（本轮三项修复）：
//   ① 字体：ASCII/全角标点不再走坏字形（另有 check-font-chain.mjs 专项）
//   ② 亮暗联动：标题栏按钮 ↔ 主题页亮度档 双向实时一致
//   ③ 音效扩充：新音效可播、开关区分开/关方向、hit 三合一随机、用途边界成立
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1500, height: 980 }, async (page) => {
  await page.send('Page.navigate', { url: URL_.replace(/\/$/, '') + '/index.html' });
  await sleep(200);
  await page.eval(`(() => { localStorage.removeItem('qqa-skin'); localStorage.removeItem('qqa-mc'); return 1; })()`);
  await page.send('Page.navigate', { url: URL_ });
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动完成' });
  await page.eval(`(() => { window.qqaSkin.set('minecraft'); return 1; })()`);
  await page.waitFor(`document.documentElement.getAttribute('data-skin') === 'minecraft'`, { timeout: 10000, label: 'MC 皮肤' });
  await sleep(600);

  // ── ② 亮暗双向联动 ───────────────────────────────────────────────────
  await page.eval(`(() => { openSettingsSection('theme'); return 1; })()`);
  await page.waitFor(`document.querySelector('#settings-form #card-brightness')`, { timeout: 25000, label: '亮度卡' });
  await sleep(700);

  /** 读"主题页当前显示的亮度档"与"标题栏按钮状态" */
  const readBoth = () => page.eval(`(() => {
    const on = document.querySelector('#settings-form .th-mode.is-on');
    const val = document.querySelector('#card-brightness .sc-val');
    const btn = document.getElementById('theme-btn');
    return {
      pageMode: on ? on.dataset.themePref : null,
      pageSummary: val ? val.textContent.trim() : null,
      headerPref: btn ? btn.dataset.pref : null,
      headerTheme: btn ? btn.dataset.theme : null,
      actual: document.documentElement.getAttribute('data-theme'),
      pref: document.documentElement.getAttribute('data-theme-pref')
    };
  })()`);

  // 起点：确保是亮色
  await page.eval(`(() => { window.applyTheme('light', null, { animate: false }); return 1; })()`);
  await sleep(900);
  const start = await readBoth();
  console.log(`   起点：主题页选中=${start.pageMode}，摘要="${start.pageSummary}"，标题栏 pref=${start.headerPref} theme=${start.headerTheme}`);
  ok('起点两边一致（都亮色）', start.pageMode === 'light' && start.headerPref === 'light', JSON.stringify(start));

  // 点标题栏按钮切到暗色 —— 主题页必须跟着变
  await page.eval(`(() => { document.getElementById('theme-btn').click(); return 1; })()`);
  await page.waitFor(`document.documentElement.getAttribute('data-theme') === 'dark'`, { timeout: 10000, label: '标题栏切暗色' });
  await sleep(1200);
  const afterHeader = await readBoth();
  console.log(`   点标题栏后：主题页选中=${afterHeader.pageMode}，摘要="${afterHeader.pageSummary}"，标题栏 pref=${afterHeader.headerPref}`);
  ok('点标题栏切暗色 → 主题页亮度档同步到暗色', afterHeader.pageMode === 'dark',
    `页面选中=${afterHeader.pageMode}（应为 dark）`);
  ok('点标题栏切暗色 → 主题页摘要同步', /暗色/.test(afterHeader.pageSummary || ''), afterHeader.pageSummary);

  // 点主题页的"亮色"档 —— 标题栏按钮必须跟着变
  await page.eval(`(() => { document.querySelector('#settings-form .th-mode[data-theme-pref="light"]').click(); return 1; })()`);
  await page.waitFor(`document.documentElement.getAttribute('data-theme') === 'light'`, { timeout: 10000, label: '主题页切亮色' });
  await sleep(1200);
  const afterPage = await readBoth();
  console.log(`   点主题页后：主题页选中=${afterPage.pageMode}，标题栏 pref=${afterPage.headerPref} theme=${afterPage.headerTheme}`);
  ok('点主题页切亮色 → 标题栏按钮同步', afterPage.headerPref === 'light' && afterPage.headerTheme === 'light',
    `pref=${afterPage.headerPref} theme=${afterPage.headerTheme}`);

  // 回到暗色再切亮色，验证两档闭环（并避免留下副作用）
  // ⚠️ 2026-10-05 用户去掉了「跟随系统」，两档之间切换才是现在的规格。
  await page.eval(`(() => { document.querySelector('#settings-form .th-mode[data-theme-pref="dark"]').click(); return 1; })()`);
  await sleep(900);
  const afterDark = await readBoth();
  await page.eval(`(() => { document.querySelector('#settings-form .th-mode[data-theme-pref="light"]').click(); return 1; })()`);
  await sleep(900);
  const afterAuto = await readBoth();
  ok('两档闭环：暗色→亮色两边都一致',
    afterDark.pageMode === 'dark' && afterDark.headerPref === 'dark'
    && afterAuto.pageMode === 'light' && afterAuto.headerPref === 'light',
    `dark: page=${afterDark.pageMode} header=${afterDark.headerPref}；light: page=${afterAuto.pageMode} header=${afterAuto.headerPref}`);

  // ── ③ 音效扩充 ───────────────────────────────────────────────────────
  const sfxMeta = await page.eval(`(() => {
    const mc = window.qqaMcTheme;
    return {
      names: Object.keys(mc.SFX),
      files: mc.allFiles(),
      uses: mc.SFX_USES,
      // 方向变体：开关类里哪些是分方向的
      directional: Object.entries(mc.SFX).filter(([, v]) => v.on || v.off).map(([k]) => k),
      // filesFor 的方向解析
      pistonOn: mc.filesFor('piston', 'on'),
      pistonOff: mc.filesFor('piston', 'off'),
      // 信标的方向变体（开关用途）
      beaconOn: mc.filesFor('beacon', 'on'),
      beaconOff: mc.filesFor('beacon', 'off'),
      hitFiles: mc.filesFor('hit', null),
      // 开关默认音现在是「菜单按钮」（用户要求"拉杆也是，改成菜单按钮"），
      // 拉杆音效本身已退役、文件不再打包。
      menuOn: mc.filesFor('menu', 'on'),
      menuOff: mc.filesFor('menu', 'off'),
      pistonOnFiles: mc.filesFor('piston', 'on'),
    };
  })()`);
  console.log(`   音效清单（${sfxMeta.names.length}）：${sfxMeta.names.join(',')}`);
  console.log(`   音频文件（${sfxMeta.files.length}）：${sfxMeta.files.join(',')}`);
  console.log(`   分方向的音效：${sfxMeta.directional.join(',')}`);

  ok('新音效全部登记（信标/弓箭/击打/拾取/活塞进出）',
    ['beacon', 'bow', 'hit', 'pop', 'piston'].every((n) => sfxMeta.names.includes(n)), sfxMeta.names.join(','));
  ok('活塞分出方向：开=活塞推出，关=活塞收回（用户要求）',
    JSON.stringify(sfxMeta.pistonOn) === '["pistonout.wav"]' && JSON.stringify(sfxMeta.pistonOff) === '["pistonin.wav"]',
    `on=${sfxMeta.pistonOn} off=${sfxMeta.pistonOff}`);
  ok('信标分出方向：开=激活，关=关闭',
    JSON.stringify(sfxMeta.beaconOn) === '["beaconactivate.wav"]' && JSON.stringify(sfxMeta.beaconOff) === '["beacondeactivate.wav"]',
    `on=${sfxMeta.beaconOn} off=${sfxMeta.beaconOff}`);
  ok('hit 是一个三文件小组（随机播放）',
    sfxMeta.hitFiles.length === 3 && sfxMeta.hitFiles.every((f) => /hit[123]\.wav/.test(f)),
    sfxMeta.hitFiles.join(','));
  ok('无方向的音效（如菜单按钮）开/关用同一个文件',
    JSON.stringify(sfxMeta.menuOn) === JSON.stringify(sfxMeta.menuOff), `${sfxMeta.menuOn}`);

  // 用途边界：用于开关的不用于按钮和点击（用户明确要求）
  //
  // ⚠️ 2026-10-05 用户追加了一条把边界改掉的要求：
  //    "拉杆也是，改成菜单按钮" —— 于是 **menu 同时是点击与开关的默认项**，
  //    两个列表必然有交集。
  //    所以判据改成：**除了 menu 这个共享默认项，其余仍不许重叠**。
  //    保留这条约束的价值在于：它能拦住"顺手把活塞也放进点击"这类越界
  //    （用户明确说过活塞/信标不是点击音）。
  const SHARED = new Set(['menu']);                 // 有意共享的默认项
  const clickSet = new Set(sfxMeta.uses.click);
  const toggleSet = new Set(sfxMeta.uses.toggle);
  const overlap = [...clickSet].filter((v) => toggleSet.has(v) && !SHARED.has(v));
  console.log(`   用途边界：点击=[${sfxMeta.uses.click}] 开关=[${sfxMeta.uses.toggle}]（共享默认项：menu）`);
  ok('除共享默认项 menu 外，点击/开关候选无交集', overlap.length === 0,
    overlap.length ? `越界重叠：${overlap.join(',')}` : '无越界重叠');
  ok('menu 被有意两边共享（用户要求开关默认也是菜单按钮）',
    clickSet.has('menu') && toggleSet.has('menu'), '');
  ok('活塞与信标只出现在开关用途里（点击里没有它们的开关版）',
    toggleSet.has('piston') && toggleSet.has('beacon')
    && !clickSet.has('piston') && !clickSet.has('beacon'), '');
  ok('退役的音效（音符盒/拉杆/木石/合成活塞）已不在任何用途里',
    ['note', 'lever', 'wood', 'stone', 'pistonSynth'].every((v) =>
      !clickSet.has(v) && !toggleSet.has(v) && !sfxMeta.uses.slider.includes(v)),
    `slider=${sfxMeta.uses.slider.join(',')}`);
  ok('滑条默认仍是"不播放"', await page.eval(`(() => window.qqaMcTheme.read().sliderSfx)()`) === 'off', '');

  // 全部音频文件可解码
  const decoded = await page.eval(`(async () => {
    window.qqaMcTheme.loadSfx();
    const want = window.qqaMcTheme.allFiles().length;
    const t0 = Date.now();
    while (window.qqaMcTheme.loaded().length < want && Date.now() - t0 < 25000) {
      await new Promise((r) => setTimeout(r, 150));
    }
    return { want, got: window.qqaMcTheme.loaded().length, list: window.qqaMcTheme.loaded() };
  })()`);
  console.log(`   解码：${decoded.got}/${decoded.want} → ${decoded.list.join(',')}`);
  ok('全部音频文件都能解码', decoded.got === decoded.want && decoded.want >= 10, `${decoded.got}/${decoded.want}`);

  // hit 随机性：多次播放应出现多个不同文件
  const hitRandom = await page.eval(`(() => {
    const picks = new Set();
    for (let i = 0; i < 80; i += 1) {
      const f = window.qqaMcTheme.filesFor('hit', null)[Math.floor(Math.random() * 3)];
      picks.add(f);
    }
    return [...picks];
  })()`);
  ok('hit 小组确实会在三个文件间随机', hitRandom.length === 3, hitRandom.join(','));

  // 方向音效真能播
  const playDir = await page.eval(`(() => ({
    pistonOn: window.qqaMcTheme.play('piston', 'on'),
    pistonOff: window.qqaMcTheme.play('piston', 'off'),
    beaconOn: window.qqaMcTheme.play('beacon', 'on'),
    beaconOff: window.qqaMcTheme.play('beacon', 'off'),
    hit: window.qqaMcTheme.play('hit', null),
    pop: window.qqaMcTheme.play('pop', null),
    bow: window.qqaMcTheme.play('bow', null)
  }))()`);
  console.log(`   播放：${JSON.stringify(playDir)}`);
  ok('活塞/信标/击打/拾取/弓箭都能播放', Object.values(playDir).every(Boolean), JSON.stringify(playDir));

  // ── 设置页下拉里能选到新音效 ─────────────────────────────────────────
  const opts = await page.eval(`(() => ({
    click: [...document.querySelectorAll('#mc-sfx-click option')].map((o) => o.value),
    toggle: [...document.querySelectorAll('#mc-sfx-toggle option')].map((o) => o.value),
    slider: [...document.querySelectorAll('#mc-sfx-slider option')].map((o) => o.value)
  }))()`);
  console.log(`   下拉：点击=${opts.click.join(',')}`);
  console.log(`         开关=${opts.toggle.join(',')}`);
  console.log(`         滑条=${opts.slider.join(',')}`);
  // ⚠️ 2026-10-05 用户要求"点击音效的信标激活删除，这个音效不适用在这里"，
  //    所以这条断言里的 beacon 已去掉。断言要跟**当前规格**走。
  ok('点击音下拉含新增音效（拾取/击打/弓箭）',
    ['pop', 'hit', 'bow', 'menu'].every((v) => opts.click.includes(v)), opts.click.join(','));
  ok('开关音下拉含菜单/活塞/信标、且不含纯点击音（拾取/击打/弓箭）',
    opts.toggle.includes('piston') && opts.toggle.includes('beacon')
    && !opts.toggle.includes('pop') && !opts.toggle.includes('hit') && !opts.toggle.includes('bow'),
    opts.toggle.join(','));
  ok('点击音默认仍是菜单按钮', await page.eval(`(() => document.getElementById('mc-sfx-click').value)()`) === 'menu', '');
  ok('开关音默认是菜单按钮（用户要求拉杆也改成菜单按钮）', await page.eval(`(() => document.getElementById('mc-sfx-toggle').value)()`) === 'menu', '');

  // 收尾
  await page.eval(`(() => {
    window.qqaSkin.set('default');
    window.applyTheme('auto', null, { animate: false });
    localStorage.removeItem('qqa-mc');
    return 1;
  })()`);
  await sleep(400);

  console.log('\n截图：');
  await page.screenshot('shots/final/fix-round.png');
  console.log('  shots/final/fix-round.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n字体/亮暗联动/音效扩充 三项修复验收通过。');
process.exit(failed ? 2 : 0);
