// 侧边栏重组 + SnowLuma 整合验收：
//   ① 导航顺序：仪表盘 / 会话 存档 记忆 用量 / 技能 插件 / 账号 设置
//   ② 用量紧跟记忆之后
//   ③ 技能与插件在同一分组容器里
//   ④ 间距收紧（组间距、项间距、项内边距）
//   ⑤ SnowLuma 独立页签与视图已移除；面板出现在「设置 → OneBot」里且能渲染
//   ⑥ 原来指向 SnowLuma 页签的入口（就绪圆点 / 仪表盘 OneBot 卡 / 工具栏胶囊）
//      现在都落脚到设置页的 OneBot 区块
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
let failed = 0;
const ok = (n, p, d) => { console.log(`${p ? '✔' : '✗'} ${n}${d ? ' — ' + d : ''}`); if (!p) failed += 1; };

await withPage({ url: URL_, width: 1600, height: 1000 }, async (page) => {
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`, { timeout: 30000, label: '应用启动完成' });
  await sleep(1200);

  // ── ①②③ 导航顺序与分组 ──────────────────────────────────────────────
  const nav = await page.eval(`(() => {
    const scroll = document.querySelector('#tabs .q-side-scroll');
    const groups = [...scroll.querySelectorAll(':scope > .q-side-group')];
    return {
      groupCount: groups.length,
      groups: groups.map((g) => [...g.querySelectorAll(':scope > .tab')].map((t) => t.dataset.tab)),
      // 全部页签按 DOM 顺序
      order: [...scroll.querySelectorAll('.tab')].map((t) => t.dataset.tab),
      // 是否还有直接挂在 scroll 下的裸 .tab（应该没有，都进组了）
      looseTabs: [...scroll.querySelectorAll(':scope > .tab')].length,
      snowlumaTab: !!scroll.querySelector('.tab[data-tab="snowluma"]'),
      snowlumaView: !!document.getElementById('view-snowluma')
    };
  })()`);
  console.log('   分组：', JSON.stringify(nav.groups));
  console.log('   顺序：', JSON.stringify(nav.order));
  ok('导航分为 4 组', nav.groupCount === 4, `${nav.groupCount} 组`);
  ok('顺序为 仪表盘/会话·存档·记忆·用量/技能·插件/账号·设置',
    JSON.stringify(nav.order) === JSON.stringify(['dashboard', 'sessions', 'chats', 'memory', 'usage', 'skills', 'plugins', 'accounts', 'settings']),
    JSON.stringify(nav.order));
  const usageIdx = nav.order.indexOf('usage');
  const memIdx = nav.order.indexOf('memory');
  ok('用量紧跟记忆之后', usageIdx === memIdx + 1, `记忆 idx=${memIdx}，用量 idx=${usageIdx}`);
  const skGroup = nav.groups.findIndex((g) => g.includes('skills'));
  const plGroup = nav.groups.findIndex((g) => g.includes('plugins'));
  ok('技能与插件在同一分组', skGroup >= 0 && skGroup === plGroup, `技能组=${skGroup}，插件组=${plGroup}`);
  ok('没有裸露在分组外的页签', nav.looseTabs === 0, `${nav.looseTabs} 个`);

  // ── ④ 间距收紧 ───────────────────────────────────────────────────────
  const sp = await page.eval(`(() => {
    const scroll = document.querySelector('#tabs .q-side-scroll');
    const g = document.querySelector('#tabs .q-side-group');
    const tab = document.querySelector('#tabs .tab');
    const cs = getComputedStyle(scroll); const cg = getComputedStyle(g); const ct = getComputedStyle(tab);
    // 相邻两项的实际垂直距离（用矩形算，比读 gap 更接近体感）
    const tabs = [...document.querySelectorAll('#tabs .q-side-group')][1].querySelectorAll('.tab');
    const a = tabs[0].getBoundingClientRect(); const b = tabs[1].getBoundingClientRect();
    const gapActual = Math.round(b.top - a.bottom);
    const tabH = Math.round(a.height);
    return { groupGap: cs.rowGap || cs.gap, itemGap: cg.rowGap || cg.gap, tabPad: ct.paddingTop, gapActual, tabH };
  })()`);
  console.log(`   组间距=${sp.groupGap} 项间距=${sp.itemGap} 项内边距(上)=${sp.tabPad} 实测相邻间距=${sp.gapActual}px 项高=${sp.tabH}px`);
  // ⚠️ 间距的"预期值"变过两次，这里不再写死单边上限，改成判**关系**：
  //    用户先要求"间距缩小"，后又要求"分类间隔可以大一点" ——
  //    前者针对组内、后者针对组间。真正稳定的需求是这两个层级要有**明显区分**：
  //      · 组内紧凑（同分类条目挨着）
  //      · 组间舒展（分类之间留白）
  //    写死 "≤6px" 这种单边阈值的代价是：每次调间距都要回来改测试
  //    （本轮就是这么红了一次）。改成判"组间 > 组内"，调数值不会误报。
  const gGap = parseFloat(sp.groupGap);
  const iGap = parseFloat(sp.itemGap);
  ok('分类之间（组间）留白大于同分类内（组内）条目间距', gGap > iGap, `组间 ${sp.groupGap} vs 组内 ${sp.itemGap}`);
  ok('组间留白足以形成分类边界（≥ 组内的 3 倍）', gGap >= iGap * 3, `${sp.groupGap} / ${sp.itemGap}`);
  ok('组间留白不至于把侧栏撑散（≤ 项高的一半）', gGap <= sp.tabH / 2, `组间 ${sp.groupGap}，项高 ${sp.tabH}px`);
  ok('项间距本身仍然紧凑（≤2px）', iGap <= 2, sp.itemGap);
  ok('项内边距仍然紧凑（≤6px）', parseFloat(sp.tabPad) <= 6, sp.tabPad);
  ok('单项仍有足够可点高度（≥26px）', sp.tabH >= 26, `${sp.tabH}px`);

  // ── ⑤ SnowLuma 独立页签/视图已移除，面板在设置里 ──────────────────────
  ok('SnowLuma 页签已移除', nav.snowlumaTab === false, '');
  ok('SnowLuma 独立视图已移除', nav.snowlumaView === false, '');

  // 进设置 → OneBot，等面板**内容**渲染。
  // ⚠️ 等待条件必须是"面板里有东西"，不能只等 #snowluma-page 存在 ——
  //    那个容器是设置页 HTML 里就写好的（渲染前后都在），只等它等于没等，
  //    断言会在面板还是空的时候跑（实测读到 len=0 / 没有启停按钮）。
  await page.eval(`(() => { if (typeof openSettingsSection === 'function') openSettingsSection('onebot'); return 1; })()`);
  // 同下：判据要含"有内容"，否则会在第一次（会被作废的）渲染瞬间就满足
  await page.waitFor(`(() => {
    const host = document.querySelector('#settings-form #snowluma-page');
    return !!host && host.innerHTML.length > 1000 && !!host.querySelector('#sl-start-btn') && !!host.querySelector('#sl-logs-view');
  })()`, { timeout: 25000, label: 'SnowLuma 面板内容渲染' });
  await sleep(1500);
  const panel = await page.eval(`(() => {
    const host = document.getElementById('snowluma-page');
    const inSettings = !!document.querySelector('#settings-form #snowluma-page');
    return {
      inSettings,
      len: host ? host.innerHTML.length : -1,
      tab: state.tab,
      section: state.settingsSection,
      // 面板里的关键控件与日志框
      hasStartBtn: !!document.getElementById('sl-start-btn'),
      hasLogs: !!document.getElementById('sl-logs-view'),
      hasAppLogs: !!document.getElementById('app-logs-view'),
      hasWebui: !!document.getElementById('sl-open-webui-btn'),
      logsNone: (document.getElementById('sl-logs-view') || {}).textContent === '暂无日志',
      // 标题去重：**不能只看 h2 是否可见** —— h2 现在是刻意显示的
      // （它才是"卡里那块内容"的标题）。真正的不重复判据是：
      // 区块标题在卡头只出现一次，表单里的那枚同名 h3 被涂透明（保留锚点占位）。
      // 背景：autoFoldSettings 会把区块标题复制进卡头，于是同一文案有两处；
      // 那枚 h3 同时是仪表盘高亮的锚点，不能删，只能涂透明。
      titleDedup: (() => {
        const h3 = document.getElementById('settings-onebot');
        const h4 = [...document.querySelectorAll('#settings-form h4')].find((h) => /OneBot/.test(h.textContent));
        const h2 = host ? host.querySelector('h2') : null;
        const transparent = (el) => el ? getComputedStyle(el).color === 'rgba(0, 0, 0, 0)' : false;
        return {
          bodyH3Transparent: transparent(h3),
          cardH4Visible: !!h4 && !transparent(h4),
          panelH2Visible: !!h2 && getComputedStyle(h2).display !== 'none' && !transparent(h2),
          anchorStillThere: !!h3          // 锚点必须在（否则高亮找不到目标）
        };
      })()
    };
  })()`);
  ok('面板挂在「设置 → OneBot」容器内', panel.inSettings === true && panel.tab === 'settings' && panel.section === 'onebot',
    `tab=${panel.tab} section=${panel.section} inSettings=${panel.inSettings}`);
  ok('面板完整渲染（启停按钮 + 运行日志 + 应用日志 + WebUI）',
    panel.hasStartBtn && panel.hasLogs && panel.hasAppLogs && panel.hasWebui, JSON.stringify(panel));
  ok('运行日志有真实内容（不是"暂无日志"）', panel.logsNone === false, `logsNone=${panel.logsNone}`);
  ok('标题不重复（卡头一处 + 面板标题），且高亮锚点仍在',
    panel.titleDedup && panel.titleDedup.bodyH3Transparent && panel.titleDedup.cardH4Visible
      && panel.titleDedup.panelH2Visible && panel.titleDedup.anchorStillThere,
    JSON.stringify(panel.titleDedup));

  // ── ⑥ 各入口都落到 OneBot 区块 ───────────────────────────────────────
  // 仪表盘 OneBot 卡
  // ⚠️ switchTab('dashboard') 会触发 loadDashboard({force})：先画骨架、再拉 5 个接口。
  //    实测骨架可能持续 3~6 秒（/api/usage/breakdown 很慢），
  //    只等一小会儿就会读到骨架卡（标签是 &nbsp;、没有 data-goto）→ 假失败。
  //    判据同别处：等 `.dash-box[data-goto] .db-label:not(.ds-ph)`。
  await page.eval(`(() => { switchTab('dashboard'); return 1; })()`);
  await page.waitFor(`document.querySelector('#dashboard-page .dash-box[data-goto] .db-label:not(.ds-ph)')`, { timeout: 40000, label: '仪表盘真实卡片' });
  await sleep(500);
  // ⚠️ 在**所有** .dash-boxes 行里找，不要写死第一行：
  //    「OneBot 连接」是第二排的卡（第一排是 5 张用量卡）。
  //    第一版只取 [0] 那一行 → 找不到 → null，看着像"卡不存在"。
  const findCard = `(() => {
    const card = [...document.querySelectorAll('#dashboard-page .dash-box')]
      .find((c) => ((c.querySelector('.db-label') || {}).textContent || '').trim() === 'OneBot 连接');
    return card || null;
  })()`;
  const chip = await page.eval(`(() => {
    const card = [...document.querySelectorAll('#dashboard-page .dash-box')]
      .find((c) => ((c.querySelector('.db-label') || {}).textContent || '').trim() === 'OneBot 连接');
    return card ? { goto: card.dataset.goto, flash: card.dataset.flash } : null;
  })()`);
  ok('仪表盘 OneBot 卡指向设置/onebot', chip && chip.goto === 'settings' && chip.flash === 'onebot',
    JSON.stringify(chip));
  if (chip) {
    await page.eval(`(() => {
      const card = [...document.querySelectorAll('#dashboard-page .dash-box')]
        .find((c) => ((c.querySelector('.db-label') || {}).textContent || '').trim() === 'OneBot 连接');
      card.click();
      return 1;
    })()`);
    void findCard;
    // ⚠️ 这里必须等**一个同时成立的复合条件**，不能"先等面板、再单独读一次"。
    //    设置页的保存守卫 / SSE 状态事件都会触发重渲染：面板会短暂被清空再重建。
    //    分两步读就会出现"等的时候有、读的时候没了"→ hasPanel=false 的假失败
    //    （单独跑同样的操作序列时面板一直都在，正说明这是时序问题）。
    //    所以把"页签对 + 区块对 + 面板就绪"放进同一个等待条件里。
    //    注意 page.waitFor 只回 true/false（不回被等表达式的值），
    //    要取值得用 page.eval 再读一次 —— 此时条件已成立，读到的就是稳定态。
    // ⚠️ 这里必须等**一个同时成立的复合条件**，不能"先等面板、再单独读一次"。
    //    设置页的保存守卫 / SSE 状态事件 / autoFoldSettings 都会重排这块 DOM，
    //    面板会短暂被清空再重建。所以采用**轮询直到稳定**的写法：
    //    连续两次采样都拿到"页签+区块+面板内容"才算数。
    //    （历史：单次快照的写法会读到"清空的那一瞬"，假失败约 2/3。）
    let after = null;
    for (let i = 0; i < 60 && !after; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const s = await page.eval(`(() => {
        const host = document.getElementById('snowluma-page');
        const inForm = document.querySelector('#settings-form #snowluma-page');
        const ready = !!(inForm && inForm.querySelector('#sl-start-btn') && host && host.innerHTML.length > 1000);
        return {
          tab: state.tab, section: state.settingsSection, ready,
          hostLen: host ? host.innerHTML.length : -1,
          inForm: !!inForm,
          hasStartBtn: !!(inForm && inForm.querySelector('#sl-start-btn'))
        };
      })()`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(400);
      const s2 = await page.eval(`(() => {
        const host = document.getElementById('snowluma-page');
        const inForm = document.querySelector('#settings-form #snowluma-page');
        return {
          tab: state.tab, section: state.settingsSection,
          ready: !!(inForm && inForm.querySelector('#sl-start-btn') && host && host.innerHTML.length > 1000)
        };
      })()`);
      if (s.ready && s2.ready && s.tab === 'settings' && s.section === 'onebot') {
        after = { tab: s.tab, section: s.section, hasPanel: true, hostLen: s.hostLen, stable: true };
      }
    }
    ok('点它确实进到「设置 → OneBot」，且面板稳定渲染出来',
      !!(after && after.tab === 'settings' && after.section === 'onebot' && after.hasPanel),
      after ? JSON.stringify(after) : '轮询 60 轮仍未看到稳定的面板内容');
  }

  await page.screenshot('shots/final/sidebar-regrouped.png');
  console.log('\n截图：shots/final/sidebar-regrouped.png');
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

console.log(failed ? `\n${failed} 项未通过。` : '\n侧边栏重组与 SnowLuma 整合验收通过。');
process.exit(failed ? 2 : 0);
