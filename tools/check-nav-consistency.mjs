// 导航栏体检：
//   1. 各页签下侧栏/顶栏/功能条的底色是否一致（用户说"不是每一个导航栏的颜色都是连续的"）
//   2. #q-side-foot 里的互动元素（金句上传/意见收集/市场/打开网站）在不在、可见不可见、
//      有没有被裁掉（用户说"会消失"）
// 逐页签 × 逐主题跑，把差异列出来。
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
// ⚠️ 2026-10-04：'snowluma' 页签已并入「设置 → OneBot（SnowLuma）」，从列表移除。
const TABS = ['dashboard', 'sessions', 'chats', 'memory', 'usage', 'skills', 'plugins', 'accounts', 'settings'];
const FOOT_IDS = ['quote-btn', 'feedback-btn', 'skill-market-btn', 'plugin-market-btn', 'persona-plaza-btn', 'open-site-btn'];

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
    await sleep(2600);
    console.log(`\n══════════ 主题=${theme} ══════════`);
    for (const tab of TABS) {
      const c = await page.click(`#tabs .tab[data-tab="${tab}"]`);
      if (!c || !c.ok) { console.log(`  [${tab}] 点不到`); continue; }
      await sleep(700);
      const r = await page.eval(`(() => {
        const bg = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : null; };
        const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height), l: Math.round(b.left), w: Math.round(b.width) }; };
        const FOOT = ${JSON.stringify(FOOT_IDS)};
        const footItems = FOOT.map((id) => {
          const el = document.getElementById(id);
          if (!el) return { id, exists: false };
          const b = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          // 是否被祖先裁掉：取元素中心点做命中测试
          const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
          let hit = null;
          try { const h = document.elementFromPoint(cx, cy); hit = h ? (h.id || String(h.className || h.tagName).slice(0, 24)) : null; } catch (e) {}
          return {
            id, exists: true,
            visible: b.width > 0 && b.height > 0,
            display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
            box: { t: Math.round(b.top), b: Math.round(b.bottom) },
            insideViewport: b.top >= 0 && b.bottom <= window.innerHeight + 1,
            hitTest: hit,
            hittable: hit === id || (hit && String(hit).includes(id))
          };
        });
        return {
          tab: ${JSON.stringify(tab)},
          bg: {
            shell: bg('#q-shell'), topbar: bg('#topbar'), toolbar: bg('.q-body > .q-tb-status'),
            body: bg('.q-body'), sidebar: bg('.q-sidebar'), main: bg('#layout'),
            view: bg('.view.active'), sideFoot: bg('.q-side-foot')
          },
          sidebarBox: box('.q-sidebar'),
          footBox: box('.q-side-foot'),
          viewBox: box('.view.active'),
          scrollH: document.documentElement.scrollHeight,
          innerH: window.innerHeight,
          footItems
        };
      })()`);
      const bg = r.bg;
      const sideVsToolbar = bg.sidebar === bg.toolbar ? '同' : '异';
      const sideVsMain = bg.sidebar === bg.main ? '同' : '异';
      const sideVsFoot = bg.sideFoot === bg.sidebar ? '同' : '异';
      const gone = r.footItems.filter((f) => !f.exists || !f.visible || !f.hittable).map((f) => f.id);
      console.log(`  [${r.tab.padEnd(9)}] 侧栏=${bg.sidebar}`);
      console.log(`      顶栏=${bg.topbar} 功能条=${bg.toolbar} 内容区=${bg.main} 侧栏底=${bg.sideFoot}`);
      console.log(`      侧栏 vs 功能条:${sideVsToolbar}  侧栏 vs 内容区:${sideVsMain}  侧栏 vs 侧栏底:${sideVsFoot}`);
      console.log(`      侧栏盒 y ${r.sidebarBox.t}~${r.sidebarBox.b} (h${r.sidebarBox.h})  foot 盒 ${r.footBox ? `y ${r.footBox.t}~${r.footBox.b} (h${r.footBox.h})` : '(无)'}  视口高 ${r.innerH}`);
      console.log(`      互动元素异常: ${gone.length ? '❗ ' + gone.join(', ') : '无 ✔'}`);
      for (const f of r.footItems) {
        if (!f.exists) { console.log(`         - ${f.id}: 不存在`); continue; }
        const flag = (!f.visible || !f.hittable || !f.insideViewport) ? '  ❗' : '';
        console.log(`         - ${f.id.padEnd(18)} 可见=${String(f.visible).padEnd(5)} 在视口内=${String(f.insideViewport).padEnd(5)} 可点中=${String(f.hittable).padEnd(5)} y ${f.box.t}~${f.box.b} hit=${f.hitTest}${flag}`);
      }
    }
  }
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
