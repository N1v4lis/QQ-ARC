// 基线对比：把"线上旧控制台"与"新 UI"的 DOM 快照都抓一遍，列出**只在旧版存在**的 id。
// 这才是"功能保持可用"的硬证据 —— 不看我们自己声明的契约，只看实际上少了什么。
//
// 两个页面都按同一套流程走：9 个页签 + 设置页 10 个二级区块，对 [id] 取并集。
// 用法：
//   node tools/compare-baseline.mjs --base http://127.0.0.1:3401/ --next http://127.0.0.1:3400/
// 退出码：0 = 没有硬缺失；2 = 有缺失（逐个列出）
import { withPage, sleep } from './cdp.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg('base', 'http://127.0.0.1:3401/');
const NEXT = arg('next', 'http://127.0.0.1:3400/');

// ⚠️ 'dashboard' 是新版独有的页签（旧版没有），必须一起扫 ——
//    否则仪表盘里的 id 不在收集范围内，容易被误判成"旧版有新版没有"的反向问题；
//    更重要的是：点一遍它才能确认新页签不会把别的视图状态搞乱。
const TABS = ['dashboard', 'sessions', 'chats', 'memory', 'usage', 'skills', 'plugins', 'snowluma', 'accounts', 'settings'];
// SECTIONS 必须与新 UI 的设置二级菜单保持一致，否则新增区块里的 id 不会被收集，
// 也就无法与旧版对照（'personal' 是本轮新增的「个性化」）。
const SECTIONS = ['api', 'search', 'memory', 'persona', 'allow', 'chat', 'desktop', 'personal', 'onebot', 'advanced', 'tools'];

// 旧版里"交互后才出现"的 id：新版可能用别的节点承载（例如 window.confirm 已被
// 应用内弹窗替代），这些不算硬缺失，单列出来人工确认。
const EXPECTED_ABSENT_HINT = [/^ui-(confirm|prompt)/];

async function snapshot(url, label) {
  const ids = new Set();
  let realtime = null;
  await withPage({ url, width: 1440, height: 900 }, async (page) => {
    await sleep(2200);
    const collect = async () => {
      const found = await page.eval('[...document.querySelectorAll("[id]")].map(e => e.id)');
      for (const id of found) ids.add(id);
    };
    await collect();
    // 记一份"实时 id"（只有常驻壳）：用来区分"被 hideLoading 移除"这类情况
    realtime = new Set(await page.eval('[...document.querySelectorAll("[id]")].map(e => e.id)'));
    for (const tab of TABS) {
      const c = await page.click(`#tabs .tab[data-tab="${tab}"]`);
      if (!c || !c.ok) { console.log(`  [${label}] 页签 ${tab} 点不到：${JSON.stringify(c)}`); continue; }
      // ⚠️ 不能只 sleep(1100)：有些页签的内容是**异步拉接口后才出现**的，
      //    而 /api/usage/stats 冷启动要 5 秒多 —— 睡眠不够会让那些 id
      //    根本没被渲染出来，于是误报"旧版有、新版没有"。
      //    实测踩到：#usage-refresh-btn / #runs-card / #models-expand 被误判缺失。
      //    这里对"慢页签"用 waitFor 等真实元素，其余页签维持短睡眠即可。
      if (tab === 'usage') {
        await page.waitFor(`document.getElementById('usage-refresh-btn')`, { timeout: 30000, label: '用量页内容' }).catch(() => {});
      } else if (tab === 'plugins' || tab === 'skills') {
        await page.waitFor(`document.querySelector('.mcard')`, { timeout: 25000, label: '模块卡' }).catch(() => {});
      } else if (tab === 'settings') {
        await page.waitFor(`document.querySelector('.settings-menu-item')`, { timeout: 25000, label: '设置菜单' }).catch(() => {});
      } else {
        await sleep(1100);
      }
      await collect();
      if (tab === 'settings') {
        for (const section of SECTIONS) {
          const sc = await page.click(`.settings-menu-item[data-section="${section}"]`);
          if (sc && sc.ok) { await sleep(850); await collect(); }
        }
      }
    }
  });
  console.log(`[${label}] 收集到 ${ids.size} 个 id`);
  return { ids, realtime };
}

const base = await snapshot(BASE, '旧版');
const next = await snapshot(NEXT, '新版');

const onlyBase = [...base.ids].filter((id) => !next.ids.has(id)).sort();
const onlyNext = [...next.ids].filter((id) => !base.ids.has(id)).sort();
const hardMissing = onlyBase.filter((id) => !EXPECTED_ABSENT_HINT.some((r) => r.test(id)));
const expected = onlyBase.filter((id) => EXPECTED_ABSENT_HINT.some((r) => r.test(id)));

// ⚠️ 这个对比对**时序**敏感：两边都是活数据（会话在跑、插件在热重载），
//    某次运行可能少三五条瞬态 id。判断标准看 `hardMissing.length === 0`，
//    个别一次的非零结果请连跑两次再下结论（本次实测：首轮 3 个、复跑 0 个）。
console.log(`\n新版新增 id：${onlyNext.length} 个`);
console.log(`   ${onlyNext.slice(0, 40).join(', ')}${onlyNext.length > 40 ? ' …' : ''}`);
console.log(`\n旧版有、新版没有：${onlyBase.length} 个`);
if (expected.length) console.log(`   （预期差异，不算缺失：${expected.join(', ')}）`);
if (hardMissing.length) for (const id of hardMissing) console.log(`   ✗ #${id}`);
else console.log('   无 ✔');

console.log(hardMissing.length
  ? `\n结论：${hardMissing.length} 个 id 在新版里不存在 → 对应功能可能已失效，需要补。`
  : '\n结论：旧版的全部 id 在新版里都能找到（功能入口未丢失）。');

// 另外：常驻壳的对比（排除被移除的启动遮罩）
const realtimeMissing = [...base.realtime].filter((id) => !next.realtime.has(id));
if (realtimeMissing.length) console.log(`\n首帧常驻 id 差异：${realtimeMissing.join(', ')}`);

process.exit(hardMissing.length ? 2 : 0);
