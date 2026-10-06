// 回归自检：移植逻辑要用到的选择器，在新壳里是否都能解析到？
// 这是"功能保持可用"的第一道闸 —— 缺一个 id，对应功能就会静默失效。
//
// 做法：把 9 个页签**逐个点开**，每个页签约等一段时间让 loadXxx() 渲染完，
// 对全量选择器取并集。只在某个页签里存在的节点（例如 #sl-start-btn 只在
// SnowLuma 页、#theme-picker 只在设置页）因此都能被覆盖到。
// 只查一次首页会把它们全部误报成"缺失"（实测第一版就是这样）。
//
// 用法：node tools/check-dom-contract.mjs [url] [--baseline <旧控制台url>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPage, sleep } from './cdp.mjs';

/** 取 --key value 形式的参数（本工具的 url 仍是第一个位置参数）。 */
function arg(key, dflt = '') {
  const i = process.argv.indexOf(`--${key}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.join(ROOT, 'app', 'ui', 'app');
const URL_ = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : `http://127.0.0.1:3400/?t=${Date.now()}`;

// ⚠️ 'dashboard' 是新版独有的页签（旧版没有），扫描时一并点开。
// ⚠️ 2026-10-04：'snowluma' 页签已并入「设置 → OneBot（SnowLuma）」，
//    从页签列表移除 —— 它的 id 仍然会被扫到，因为 SECTIONS 里有 'onebot'。
const TABS = ['dashboard', 'sessions', 'chats', 'memory', 'usage', 'skills', 'plugins', 'accounts', 'settings'];
// 设置页是"一次只渲染一个区块"（点左侧二级菜单整页重建，见 06-settings-render.js:75-86），
// 所以必须把 10 个区块逐个点开才能收全 —— 否则会误报 80+ 个 id 缺失。
const SECTIONS = ['api', 'search', 'memory', 'persona', 'allow', 'chat', 'desktop', 'personal', 'onebot', 'advanced', 'tools'];

// 从移植层的 JS 里抽出所有 $('…') / $$('…') / getElementById('…') 的选择器
const selectors = new Set();
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.js'))) {
  const s = fs.readFileSync(path.join(DIR, f), 'utf8');
  for (const m of s.matchAll(/(?<![\w$.])\$\$?\(\s*'([^']+)'/g)) selectors.add(m[1]);
  for (const m of s.matchAll(/getElementById\(\s*'([^']+)'/g)) selectors.add('#' + m[1]);
}

// 只在**用户操作后**才出现的节点（弹窗/进度/输入框等）：首屏与页签渲染都不会有。
// 逐个标注理由，避免把"本来就没有"当成回归。
const RUNTIME_ONLY = [
  '#app-alert-ok', '#ui-confirm-ok', '#ui-confirm-cancel', '#ui-prompt-ok',
  '#ui-prompt-cancel', '#ui-prompt-input', '#banner-resume-btn', '#banner-resume-read-btn',
  '.model-modal-overlay', '.model-modal', '.app-alert-text'
];
const isRuntimeOnly = (sel) => RUNTIME_ONLY.some((p) => sel === p || sel.startsWith(p));

// 外壳必须常驻的容器：这些一旦缺了就是结构性回归（不看页签、不看时机）
const MUST_EXIST = [
  '#q-shell', '#topbar', '#tabs', '#layout', '#banner', '#q-tb-drag',
  '#onebot-dot', '#onebot-label', '#account-switch', '#model-label', '#usage-label',
  '#search-count-label', '#readiness-dots', '#theme-btn', '#pause-btn', '#q-winctl',
  '#session-items', '#session-detail', '#chat-items', '#chat-detail', '#memory-items',
  '#memory-detail', '#usage-page', '#skills-page', '#plugins-page', '#snowluma-page',
  '#view-accounts', '#settings-sidebar', '#settings-form',
  '#quote-btn', '#feedback-btn', '#skill-market-btn', '#plugin-market-btn',
  '#persona-plaza-btn', '#open-site-btn', '#quote-confirm-btn'
];

const staticIds = [...selectors].filter((s) => /^#[A-Za-z][\w-]*$/.test(s) && !isRuntimeOnly(s)).sort();
const others = [...selectors].filter((s) => !/^#[A-Za-z][\w-]*$/.test(s) && !isRuntimeOnly(s)).sort();

await withPage({ url: URL_, width: 1600, height: 900 }, async (page) => {
  await sleep(2000);

  // ⚠️ 环境自适应：控制台有两种运行形态，外壳元素不同 ——
  //   · 浏览器（dev-server）：99-shell-boot.js 会**移除** #q-winctl（没有窗口可控制）
  //   · Electron（真实应用）：#q-winctl 必须在，否则"自绘关闭/最小化"就没了
  //   把这两个判反过是最容易犯的错（"缺失 #q-winctl"其实说明正跑在浏览器里）。
  const env = await page.eval('document.documentElement.getAttribute("data-shell")');
  const isElectron = env === 'electron';
  const mustExist = MUST_EXIST.filter((s) => (s === '#q-winctl' ? isElectron : true));
  console.log(`运行环境：${env || '(未知)'} → ${isElectron ? '要求自绘窗口按钮存在' : '不要求自绘窗口按钮'}\n`);

  // 启动遮罩：hideLoading() 会把它整个 remove()，所以必须在最早的一次检查里看
  const hadOverlay = await page.eval('!!document.getElementById("loading-overlay")');
  const mustMissing = await page.eval(`(() => {
    const must = ${JSON.stringify(mustExist)};
    return must.filter((s) => !document.querySelector(s));
  })()`);

  const seen = new Set();
  const collect = async () => {
    const found = await page.eval(`(() => {
      const ids = ${JSON.stringify(staticIds)};
      const others = ${JSON.stringify(others)};
      const out = [];
      for (const s of ids) if (document.querySelector(s)) out.push(s);
      for (const s of others) { try { if (document.querySelector(s)) out.push(s); } catch { /* 非法 */ } }
      return out;
    })()`);
    for (const f of found) seen.add(f);
  };

  await collect();
  for (const tab of TABS) {
    await page.click(`#tabs .tab[data-tab="${tab}"]`);
    await sleep(1100);
    await collect();
    // 设置页再逐个点开 10 个二级区块（每个区块的表单是独立渲染的）
    if (tab === 'settings') {
      for (const section of SECTIONS) {
        const ok = await page.click(`.settings-menu-item[data-section="${section}"]`);
        if (ok && ok.ok) { await sleep(900); await collect(); }
      }
    }
  }

  const missingIds = staticIds.filter((s) => !seen.has(s));
  const missingOthers = others.filter((s) => !seen.has(s));

  console.log(`静态 id 选择器 ${staticIds.length} 个 → 命中 ${staticIds.length - missingIds.length}`);
  if (missingIds.length) { console.log('缺失：'); for (const s of missingIds) console.log(`  ✗ ${s}`); }
  console.log(`\n结构性选择器 ${others.length} 个 → 命中 ${others.length - missingOthers.length}`);
  if (missingOthers.length) { console.log('未命中（多为运行时才生成的形态）：'); for (const s of missingOthers) console.log(`  · ${s}`); }
  console.log(`\n启动遮罩首帧存在：${hadOverlay ? '✔' : '✗（hideLoading 已移除，属正常；此处记录以便区分）'}`);
  console.log(`外壳常驻容器：${mustMissing.length ? '缺失 ' + mustMissing.join(', ') : '全部存在 ✔'}`);

  // ── 与旧控制台对比（可选，但强烈建议）────────────────────────────────
  // ⚠️ 单看"缺失 N 个"是**没有意义**的：新 UI 里有一批 id 只存在于旧版的模态框/
  //    删除确认条/启动遮罩中，它们在新版由别的节点承载，静态扫描必然报"缺失"。
  //    实测：旧控制台自己跑同一个扫描也缺 43 个，而新版缺 39 个 —— **新版缺的是旧版缺失集的子集**。
  //    所以真正的判据是"新版有没有缺失旧版**确实有**的东西"。给了 --baseline 就直接算这个差集。
  const baselineUrl = arg('baseline', '');
  let baselineMissing = null;
  if (baselineUrl) {
    const scan = async (url) => {
      const found = new Set();
      await withPage({ url, width: 1440, height: 900 }, async (page) => {
        await sleep(2200);
        const collect = async () => {
          const hits = await page.eval(`(() => {
            const ids = ${JSON.stringify(staticIds)};
            return ids.filter((s) => document.querySelector(s));
          })()`);
          for (const h of hits) found.add(h);
        };
        await collect();
        for (const tab of TABS) {
          await page.click(`#tabs .tab[data-tab="${tab}"]`);
          await sleep(1000);
          await collect();
          if (tab === 'settings') {
            for (const section of SECTIONS) {
              const c = await page.click(`.settings-menu-item[data-section="${section}"]`);
              if (c && c.ok) { await sleep(800); await collect(); }
            }
          }
        }
      });
      return found;
    };
    const baseFound = await scan(baselineUrl);
    const newFound = new Set(staticIds.filter((s) => seen.has(s)));
    baselineMissing = staticIds.filter((s) => baseFound.has(s) && !newFound.has(s));
    console.log(`\n与旧控制台对比（${baselineUrl}）：`);
    console.log(`  旧版命中 ${baseFound.size} 个，新版命中 ${newFound.size} 个`);
    console.log(`  旧版有、新版没有：${baselineMissing.length ? baselineMissing.join(', ') : '无 ✔（功能入口未丢失）'}`);
  } else {
    console.log('\n提示：加 --baseline http://127.0.0.1:3401/ 可与旧控制台对比，'
      + '只看"缺失个数"会被旧版模态框里的 id 误导。');
  }

  const realMissing = baselineMissing ? baselineMissing.length : 0;
  const bad = realMissing + mustMissing.length;
  if (baselineMissing) {
    console.log(bad
      ? `\n结论：相对旧控制台有 ${bad} 处**真缺失**，需要补。`
      : '\n结论：DOM 契约完整 —— 旧版有的 id 新版全部保留，外壳容器齐全。');
  } else {
    console.log(missingIds.length + mustMissing.length
      ? `\n结论：静态扫描有 ${missingIds.length + mustMissing.length} 处未命中（未与旧版对比，不能据此判定缺失）。`
      : '\n结论：DOM 契约完整（页签全量扫描）。');
  }
  process.exit(bad ? 2 : 0);
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
