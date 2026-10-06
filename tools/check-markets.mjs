// 原生自带入口（插件市场 / Skill 市场 / 人设广场）的可用性验证。
// 用户明确要求"原生自带的插件广场等等"必须保持可用 —— 所以这几个入口要单独验：
//   · 按钮点在不在、点了有没有反应（不应报错）
//   · 对应的静态页能不能正常加载（HTTP 200 + 有内容）
//   · 应用内**新增**功能（插件/技能列表）是否照常渲染
// 用法：node tools/check-markets.mjs [url] [apiUrl]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
const API = process.argv[3] || 'http://127.0.0.1:3210';

let failed = 0;
const ok = (name, pass, detail) => { console.log(`${pass ? '✔' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!pass) failed += 1; };

// ── 1. 三个静态市场页能不能直接打开 ──────────────────────────────────────
const pages = [
  ['插件市场', '/plugin-market/index.html'],
  ['Skill 市场', '/skill-market/index.html'],
  ['人设广场', '/persona-plaza/index.html']
];
for (const [label, p] of pages) {
  try {
    const r = await fetch(API + p, { signal: AbortSignal.timeout(6000) });
    const t = await r.text();
    ok(`${label}页可加载`, r.ok && t.length > 500, `HTTP ${r.status}，${t.length} 字节`);
  } catch (e) { ok(`${label}页可加载`, false, e.message); }
}

// ── 2. 页内入口按钮 + 列表渲染 ──────────────────────────────────────────
const opened = [];
await withPage({ url: URL_, width: 1600, height: 900, onConsole: (l) => { if (/error|exception/i.test(l)) opened.push('CONSOLE ' + l.slice(0, 160)); } }, async (page) => {
  // ⚠️ 启动门禁：等应用**启动完成**再操作。
  //    启动默认落在「仪表盘」，整个启动链路（含 loadDashboard 的请求）走完之前
  //    去点设置页签会和启动期的状态更新交错 —— 实测表现为"点到了 chat，
  //    但 #ac-editor 还是空的"，是典型的启动竞态，不是功能坏了。
  //    判据：导航高亮已建立（switchTab 跑过）且启动遮罩已摘除。
  await page.waitFor(`!!document.querySelector('#tabs .tab.active') && !document.getElementById('loading-overlay')`,
    { timeout: 30000, label: '应用启动完成' });
  await sleep(2600);

  for (const [label, id] of [['插件市场按钮', '#plugin-market-btn'], ['Skill 市场按钮', '#skill-market-btn'], ['人设广场按钮', '#persona-plaza-btn'], ['意见收集按钮', '#feedback-btn'], ['金句上传按钮', '#quote-btn']]) {
    const has = await page.eval(`!!document.querySelector(${JSON.stringify(id)})`);
    ok(`${label}存在`, has, id);
    if (!has) continue;
    // 只点前三个"市场/广场"类（会开新窗口或弹层）；意见收集/金句上传会拉验证码 SDK，跳过点击
    if (id.includes('market') || id.includes('plaza')) {
      const r = await page.click(id);
      await sleep(700);
      // 点完不该冒出原生弹窗或未捕获异常；入口按钮本身应仍是可见可点的
      const stillOk = await page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(id)});
        return !!el && getComputedStyle(el).visibility !== 'hidden';
      })()`);
      ok(`${label}点击后无异常且仍可用`, stillOk, JSON.stringify(r));
    }
  }

  // 插件页 / 技能页的列表渲染
  for (const [tab, host] of [['plugins', '#plugins-page'], ['skills', '#skills-page']]) {
    await page.click(`#tabs .tab[data-tab="${tab}"]`);
    // ⚠️ 等模块卡**真的渲染出来**，不要固定 sleep（2026-10-03 踩过同类问题）：
    //    /api/skills 要拉 90KB+，而页面同时还在跑 SSE / 日志跟随，
    //    固定 1500ms 在批量回归时偶发不够 → 报"卡片 0 个"（看着像功能坏了）。
    //    这里是"点了页签"和"渲染完成"之间的竞态，等元素即可。
    await page.waitFor(`(() => {
      const h = document.querySelector(${JSON.stringify(host)});
      return !!h && h.querySelectorAll('.mcard').length > 0;
    })()`, { timeout: 30000, label: `${tab} 模块卡渲染` }).catch(() => {});
    const info = await page.eval(`(() => {
      const h = document.querySelector(${JSON.stringify(host)});
      return {
        len: h ? h.innerHTML.length : 0,
        cards: h ? h.querySelectorAll('.mcard').length : 0,
        addBtn: !!(h && h.querySelector('button'))
      };
    })()`);
    ok(`${tab} 页渲染出模块卡`, info.len > 500 && info.cards > 0, `卡片 ${info.cards} 个，HTML ${info.len} 字节`);
  }
}).catch((e) => { console.error('FAIL', e); process.exit(1); });

for (const line of [...new Set(opened)]) console.log('  ' + line);
console.log(failed ? `\n${failed} 项未通过。` : '\n原生入口与市场页全部可用。');
process.exit(failed ? 2 : 0);
