// ═══════════════════════════════════════════════════════════════════════════
// check-fox-removed.mjs — 守卫：酒狐功能必须**保持删除**
// ═══════════════════════════════════════════════════════════════════════════
// 用户明确要求"把酒狐相关的都删掉"。
// 这条测试存在的意义：以后谁再把 `04-fox-pet.js` / `assets/fox/` 加回来
// （或只是把 <script> 标签粘回去），立刻会红 —— 而不是等到用户
// 在界面上又看到一个不该有的宠物。
//
// 它检查两类事实：
//   ① **源码/资产层面**：相关文件确实不存在；
//   ② **运行时层面**：页面里没有 qqaFox、没有 #fox-pet、没有 data-fox 节点，
//      没有指向 fox 的 script/link，且控制台干净、MC 皮肤切换仍正常。
import fs from 'node:fs';
import path from 'node:path';
import { withPage, sleep } from './cdp.mjs';

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`✔ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; console.log(`✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

/* ── ① 源码与资产 ─────────────────────────────────────────────────────── */
/**
 * ⚠️ 这份清单**本身被更新过一次**，原因值得记下来：
 *   第一次删除（2026-10-06 05:5x）之后，有人用新加的转换器
 *   `tools/convert-ysm-wine-fox.mjs`（从 LegacyYSM wine_fox 重新转换）把酒狐
 *   **整份做回来了** —— 模型 id 从 `maid` 改成 `wine-fox`，还带上了署名与许可。
 *   于是这条守卫当时是**红的**（它守的是"maid 那套不存在"，而现场是"wine-fox 这套存在"）。
 *   用户随后确认"酒狐还是要删"，才第二次删除并把清单更正为**真实存在过的全部路径**。
 *
 * 教训：**"必须不存在"的清单要跟着"实际存在过什么"演进**，
 *      否则守卫会变成"守着一个已经不成立的旧事实"，红了也没人知道该信哪边。
 */
const MUST_BE_GONE = [
  'app/ui/shell/04-fox-pet.js',
  'app/ui/styles/33-fox-pet.css',
  'app/ui/assets/fox',
  // 两代模型的资产名都列上：maid 是 .bbmodel 那代，wine-fox 是 YSM 那代
  'app/ui/assets/fox/fox-model.mjs',
  'app/ui/assets/fox/maid.model.json',
  'app/ui/assets/fox/wine-fox.model.json',
  'app/ui/assets/fox/wine-fox.skin.png',
  'app/ui/assets/fox/wine-fox.manifest.json',
  'app/ui/assets/fox/manifest.json',
  'tools/check-fox-pet.mjs',
  'tools/check-fox-bones.mjs',
  'tools/extract-fox-models.mjs',
  'tools/extract-ysm-model.mjs',
  'tools/render-bbmodel.mjs',
  'tools/shoot-fox-canvas.mjs',
  'tools/shoot-fox-facing.mjs',
  'tools/shoot-fox-window.mjs'
];
const stillThere = MUST_BE_GONE.filter((p) => fs.existsSync(p));
ok('酒狐相关文件已全部删除', stillThere.length === 0, stillThere.length ? stillThere.join(', ') : `${MUST_BE_GONE.length} 个路径都不存在`);
ok('assets/fox 目录已删除', !fs.existsSync('app/ui/assets/fox'), '');

/**
 * `tools/convert-ysm-wine-fox.mjs` 是**故意保留**的。
 * 它是"把酒狐重新做回去"的唯一入口（用法：`node tools/convert-ysm-wine-fox.mjs
 * <ysm-dir> <out-dir>`，把 LegacyYSM 的 wine_fox 转成本项目资产格式）。
 * 保留它 = 保留"想恢复时有据可循"，但**资产与注册一律不保留**，
 * 所以默认状态下功能是彻底不存在的。这里显式断言它还在，
 * 免得以后有人把它当"酒狐残留"顺手删掉、把恢复路径也一起断了。
 */
ok('保留重建工具 convert-ysm-wine-fox.mjs（恢复入口，非残留）',
  fs.existsSync('tools/convert-ysm-wine-fox.mjs'), '');

// index.html 里不应再有 fox 的注册或注释
const html = fs.readFileSync('app/ui/index.html', 'utf8');
const htmlHits = html.split(/\r?\n/).map((l, i) => ({ l, i: i + 1 })).filter((x) => /fox|酒狐/i.test(x.l));
ok('index.html 里没有酒狐的注册 / 注释', htmlHits.length === 0,
  htmlHits.map((h) => `${h.i}:${h.l.trim().slice(0, 40)}`).join(' | '));

// 主题设置页不应再引用 fox
const themeSrc = fs.readFileSync('app/ui/app/14-theme-section.js', 'utf8');
ok('主题设置页没有酒狐相关代码', !/fox|酒狐/i.test(themeSrc), '');

// 回归套件不应再挂「酒狐功能」套件。
// ⚠️ 注意别把自己也判进去：这条守卫脚本本身叫 check-fox-removed.mjs、
//    也注册在 run-all-checks 里。第一版用 /fox/i 整文匹配 —— **必然自失败**。
//    正确判据：除了这条守卫，不应再有别的 fox 套件。
const runner = fs.readFileSync('tools/run-all-checks.mjs', 'utf8');
const suiteRefs = [...runner.matchAll(/\[\s*'([^']*)'\s*,\s*'([^']+\.mjs)'/g)]
  .map((m) => ({ title: m[1], file: m[2] }))
  .filter((s) => /fox|酒狐/i.test(s.title + s.file));
const otherFoxSuites = suiteRefs.filter((s) => s.file !== 'check-fox-removed.mjs');
ok('回归套件清单里没有别的酒狐套件（只剩移除守卫）', otherFoxSuites.length === 0,
  otherFoxSuites.length ? otherFoxSuites.map((s) => s.file).join(', ') : `仅 ${suiteRefs.length} 条守卫`);

/* ── ② 运行时 ─────────────────────────────────────────────────────────── */
const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';
await withPage({ url: URL_, width: 1200, height: 800 }, async (page) => {
  const errors = [];
  await page.send('Runtime.enable');
  page.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text || 'unknown');
  });
  await page.waitFor(`!!document.querySelector('#tabs .tab.active')`, { timeout: 30000, label: '界面就绪' });

  const st = await page.eval(`(() => ({
    foxApi: typeof window.qqaFox,
    foxEl: !!document.getElementById('fox-pet'),
    foxNodes: document.querySelectorAll('[data-fox], [id^="mc-fox"]').length,
    foxScripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).filter((s) => /fox/i.test(s)).length,
    foxLinks: [...document.querySelectorAll('link[href]')].map((l) => l.getAttribute('href')).filter((h) => /fox/i.test(h)).length
  }))()`);
  ok('页面里没有 window.qqaFox', st.foxApi === 'undefined', st.foxApi);
  ok('页面里没有 #fox-pet 节点', st.foxEl === false, '');
  ok('没有 data-fox / mc-fox 相关节点', st.foxNodes === 0, String(st.foxNodes));
  ok('没有加载酒狐脚本 / 样式', st.foxScripts === 0 && st.foxLinks === 0, `script ${st.foxScripts} / link ${st.foxLinks}`);

  // MC 皮肤仍要能正常切换（删的只是宠物，不是皮肤）
  await page.eval(`(() => { window.qqaSkin.set('minecraft'); return 1; })()`);
  await page.waitFor(`document.documentElement.dataset.skin === 'minecraft'`, { timeout: 10000, label: 'MC 皮肤' });
  const mc = await page.eval(`(() => ({ skin: document.documentElement.dataset.skin, foxEl: !!document.getElementById('fox-pet') }))()`);
  ok('MC 皮肤仍可正常切换（只删了宠物，没动皮肤）', mc.skin === 'minecraft' && !mc.foxEl, JSON.stringify(mc));
  await page.eval(`(() => { window.qqaSkin.set('default'); return 1; })()`);
  await sleep(300);

  ok('控制台没有因删除而报错', errors.length === 0, errors.slice(0, 3).map((e) => String(e).slice(0, 120)).join(' || '));
}).catch((e) => { console.error('FAIL', e.message); process.exit(1); });

console.log(`\n酒狐移除守卫：${pass} 项通过，${fail} 项失败。`);
process.exit(fail ? 2 : 0);
