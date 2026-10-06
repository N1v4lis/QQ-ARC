// 导航栏颜色连续性：逐元素列出导航相关元素的实测底色，
// 只要出现"和全站底色不同的填充"就报出来。
// 用户要求：导航栏颜色连续（不是每一段深浅不一样）。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3400/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1440, height: 900 }, async (page) => {
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
  await sleep(2800);
  for (const theme of ['light', 'dark']) {
    await page.eval(`(() => { try { localStorage.setItem('qqa-theme-pref', ${JSON.stringify(theme)}); } catch (e) {} return 1; })()`);
    await page.send('Page.navigate', { url: URL_ });
    // ⚠️ 刷新后必须**等启动完成**，不能再用固定 sleep。
    //    原来这里是 sleep(2600)：正常启动够用，但如果上一次套件把应用留在
    //    「设置」页（启动要加载 config/skills 等），2600ms 可能还没把 .active 建立起来
    //    → 第一条结果里 active=null → 报"异色填充块"与"激活页签没用主色"两条假失败。
    //    实测：单独跑必过、紧跟在"侧边栏重组"套件之后必失败，就是这个时序。
    await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
      { timeout: 30000, label: `${theme} 刷新后启动完成` });
    await sleep(600);
    // 逐个页签都查一遍：激活态会换元素，必须覆盖
    // ⚠️ 2026-10-04：'snowluma' 页签已并入「设置 → OneBot（SnowLuma）」，从列表移除。
    const tabs = ['dashboard', 'sessions', 'chats', 'memory', 'usage', 'skills', 'plugins', 'accounts', 'settings'];
    const results = [];
    for (const tab of tabs) {
      await page.click(`#tabs .tab[data-tab="${tab}"]`);
      await sleep(650);
      results.push(await page.eval(`(() => {
        const bg = (el) => { if (!el) return null; const b = getComputedStyle(el).backgroundColor; return b === 'rgba(0, 0, 0, 0)' ? 'transparent' : b; };
        const active = document.querySelector('#tabs .tab.active');
        const hoverish = document.querySelector('#tabs .tab:not(.active)');
        return {
          tab: ${JSON.stringify(tab)},
          base: bg(document.getElementById('q-shell')),
          topbar: bg(document.getElementById('topbar')),
          toolbar: bg(document.querySelector('.q-body > .q-tb-status')),
          sidebar: bg(document.querySelector('.q-sidebar')),
          foot: bg(document.querySelector('.q-side-foot')),
          navBtn: bg(document.querySelector('#tabs')),
          activeTab: bg(active),
          idleTab: bg(hoverish),
          activeTabColor: active ? getComputedStyle(active).color : null,
          // 分隔线：侧栏内部与外框上的可见边线
          sidebarBorders: (() => { const s = getComputedStyle(document.querySelector('.q-sidebar')); return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].join('/'); })(),
          footBorderTop: getComputedStyle(document.querySelector('.q-side-foot')).borderTopWidth,
          mainBorderLeft: getComputedStyle(document.getElementById('layout')).borderLeftWidth,
          // 分隔线：分为「分组之间是否有可见边线」。
          // ⚠️ 2026-10-04 改版：分组从 nth-child(4)/(6) 改成显式 .q-side-group 容器，
          //    所以这里也改成查"分组容器/其子项上有没有边框"——
          //    继续用 nth-child(4)/(6) 只会匹配到已不存在的结构，恒为 0（假通过）。
          groupBorders: (() => {
            const groups = [...document.querySelectorAll('#tabs .q-side-group')];
            return groups.reduce((n, g) => {
              const s = getComputedStyle(g);
              return n + [s.borderTopWidth, s.borderBottomWidth, s.borderLeftWidth, s.borderRightWidth]
                .filter((w) => parseFloat(w) > 0).length;
            }, 0);
          })(),
          tabBorders: [...document.querySelectorAll('#tabs .tab')].reduce((n, t) => {
            const s = getComputedStyle(t);
            return n + [s.borderTopWidth, s.borderBottomWidth].filter((w) => parseFloat(w) > 0).length;
          }, 0)
        };
      })()`));
    }
    // 汇总：所有页签下，这些"面"必须与全站底色**视觉等价**。
    // ⚠️ `transparent` 要与底色等价 —— 它合成到父元素后就是底色本身，
    //    把它当成"不同颜色"是断言写错（第一版就这么误报了 9 次）。
    const equivalent = (a, b) => a === b || a === 'transparent';
    const surfaces = ['topbar', 'toolbar', 'sidebar', 'foot'];
    const bad = [];
    for (const r of results) {
      for (const s of surfaces) {
        if (!equivalent(r[s], r.base)) bad.push(`${r.tab}.${s}=${r[s]}`);
      }
    }
    console.log(`\n══════ 主题=${theme} ══════`);
    console.log(`  全站底色 base=${results[0].base}`);
    for (const r of results) {
      const fills = [];
      if (r.activeTab !== 'transparent') fills.push(`当前页签填充=${r.activeTab}`);
      if (r.idleTab !== 'transparent') fills.push(`普通页签填充=${r.idleTab}`);
      console.log(`  [${r.tab.padEnd(9)}] 顶栏=${r.topbar} 功能条=${r.toolbar} 侧栏=${r.sidebar} 侧栏底=${r.foot} 导航容器=${r.navBtn}`);
      console.log(`      侧栏边框(上/右/下/左)=${r.sidebarBorders}  侧栏底 borderTop=${r.footBorderTop}  内容区 borderLeft=${r.mainBorderLeft}  当前页签文字色=${r.activeTabColor}`);
      if (fills.length) console.log(`      页签填充：${fills.join('  ')}`);
    }
    ok(`[${theme}] 顶栏/功能条/侧栏/侧栏底 与全站底色一致`, bad.length === 0, bad.join('  ') || `全部 = ${results[0].base}`);
    const anyFill = results.some((r) => r.activeTab !== 'transparent' || r.idleTab !== 'transparent');
    ok(`[${theme}] 导航项没有"异色填充块"`, anyFill === false,
      anyFill ? results.map((r) => `${r.tab}:${r.activeTab}/${r.idleTab}`).filter((s) => !s.endsWith('transparent/transparent')).join(' ') : '全部透明');
    ok(`[${theme}] 侧栏没有可见边框线`, results.every((r) => r.sidebarBorders === '0px/0px/0px/0px' && r.footBorderTop === '0px' && r.mainBorderLeft === '0px'),
      results[0].sidebarBorders + ' footTop=' + results[0].footBorderTop + ' mainLeft=' + results[0].mainBorderLeft);
    ok(`[${theme}] 激活页签用主色文字表达（不是换底色）`,
      results.every((r) => r.activeTabColor && r.activeTabColor !== 'rgb(0, 0, 0)'), results[0].activeTabColor);
  }
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n导航栏颜色连续性验收通过。');
process.exit(failed ? 2 : 0);
