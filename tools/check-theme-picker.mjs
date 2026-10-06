// 设置页主题选择器验证：必须能选到"跟随系统"，且三档都已渲染。
// 为什么单独测这个：顶栏那颗按钮只是"循环切换"，如果设置页里没有 auto 选项，
// 用户就没有任何**入口**把主题切回自动 —— 属于"功能其实缺了一块"。
// 用法：node tools/check-theme-picker.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (name, pass, detail) => { console.log(`${pass ? '✔' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!pass) failed += 1; };

await withPage({ url: URL_, width: 1600, height: 900 }, async (page) => {
  // ⚠️ 用 waitFor 而不是固定 sleep（2026-10-04 修）：启动默认落在「仪表盘」，
  //    loadSettings() 要拉 config + skills，二级菜单出现要 2 秒以上；
  //    固定 sleep 之后点 `.settings-menu-item[data-section=desktop]` 会落空
  //    （返回 not-found），于是"主题选择器不存在" —— 是等待问题，不是功能坏了。
  // ⚠️ 启动门禁：等应用**启动完成**再操作。
  //    启动默认落在「仪表盘」，整个启动链路（含 loadDashboard 的请求）走完之前
  //    去点设置页签会和启动期的状态更新交错 —— 实测表现为"点到了 chat，
  //    但 #ac-editor 还是空的"，是典型的启动竞态，不是功能坏了。
  //    判据：导航高亮已建立（switchTab 跑过）且启动遮罩已摘除。
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '应用启动完成' });
  // ⚠️ 必须等启动遮罩摘除再操作：它是 z-index:999 的全屏层，
  //    page.click 按坐标派发真实鼠标事件 → 点会被遮罩吃掉，后续断言全部超时。
  await page.waitFor(`!document.getElementById('loading-overlay')`, { timeout: 30000, label: '启动遮罩摘除' });
  await page.waitFor(`document.querySelector('#tabs .tab[data-tab="settings"]')`, { timeout: 20000, label: '导航' });
  await page.click('#tabs .tab[data-tab="settings"]');
  await page.waitFor(`document.querySelector('.settings-menu-item[data-section="desktop"]')`, { timeout: 25000, label: '设置菜单' });
  // 「界面」区在"桌面端"分区里
  const clicked = await page.click('.settings-menu-item[data-section="desktop"]');
  await page.waitFor(`document.getElementById('theme-picker')`, { timeout: 20000, label: '主题选择器' });

  const info = await page.eval(`(() => {
    const picker = document.getElementById('theme-picker');
    if (!picker) return { found: false, sectionClicked: ${JSON.stringify(clicked)} };
    const opts = [...picker.querySelectorAll('[data-theme-opt]')].map((el) => ({
      opt: el.dataset.themeOpt,
      label: (el.textContent || '').trim(),
      on: el.classList.contains('on')
    }));
    return { found: true, opts, pref: document.documentElement.getAttribute('data-theme-pref') };
  })()`);

  if (!info.found) { ok('设置页存在主题选择器', false, JSON.stringify(info)); return; }
  const opts = info.opts.map((o) => o.opt);
  // ⚠️ 2026-10-05 用户要求去掉「跟随系统」，只留两档直接切换。
  //    这条原来断言"渲染了三档"、并点 auto 验证偏好变成 auto ——
  //    规格变了断言就要跟着变，否则它测的是历史规格。
  ok('主题选择器渲染了两档（亮色 / 暗色）', opts.length === 2, `实际：${opts.join(', ')}`);
  ok('包含亮色与暗色两档', opts.includes('light') && opts.includes('dark'), `data-theme-opt=${opts.join(',')}`);
  ok('不再包含「跟随系统」', !opts.includes('auto'), `data-theme-opt=${opts.join(',')}`);

  // 点"暗色"必须真的切到 dark
  await page.click('[data-theme-opt="dark"]');
  await sleep(600);
  const after = await page.eval(`(() => ({
    pref: document.documentElement.getAttribute('data-theme-pref'),
    theme: document.documentElement.getAttribute('data-theme'),
    on: document.querySelector('[data-theme-opt="dark"]')?.classList.contains('on'),
    stored: (() => { try { return localStorage.getItem('qqa-theme-pref'); } catch (e) { return null; } })()
  }))()`);
  ok('点"暗色"后偏好变成 dark', after.pref === 'dark' && after.stored === 'dark', JSON.stringify(after));
  ok('选中的档位高亮', after.on === true, `on=${after.on}`);
  ok('实际主题落到 dark', after.theme === 'dark', `data-theme=${after.theme}`);

  // 再点"亮色"应立刻切回
  await page.click('[data-theme-opt="light"]');
  await sleep(500);
  const light = await page.eval('document.documentElement.getAttribute("data-theme")');
  ok('点"亮色"立刻生效', light === 'light', `data-theme=${light}`);
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n主题选择器全部通过。');
process.exit(failed ? 2 : 0);
