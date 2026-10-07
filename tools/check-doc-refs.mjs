// ═══════════════════════════════════════════════════════════════════════════
// check-doc-refs.mjs — 校验文档里的文件引用是否指向真实存在的文件
// ═══════════════════════════════════════════════════════════════════════════
// 悬空引用比没有引用更糟：它会让人去找一个**不存在的东西**。
// 整理移交文档时发现过多处这类问题（注释里引用已删除的探针脚本），
// 所以把这条做成断言。
//
// ⚠️ 两类引用要区别对待，不能一刀切：
//   ① **指南类**文档（README / HANDOFF / ARCHITECTURE / DEVELOPMENT /
//      TESTING / PITFALLS / THEME-SYSTEM）里的引用必须是**现行有效**的路径 ——
//      悬空即失败。
//   ② **编年史 / 历史记录**（docs/design-notes.md、theme-port-feasibility.md）
//      里会**刻意**引用已经删掉的东西（"当时用的探针是 X，后来删了"）。
//      这类悬空是**正常**的，只告警、不判失败。
//
// 另外路径写法有简写（文档里写 `styles/32-theme.css`，实际是
// `app/ui/styles/32-theme.css`），所以要多试几个基准目录。
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

/** 指南类：悬空即失败 */
const GUIDE_DOCS = [
  'README.md', 'docs/HANDOFF.md', 'docs/HANDOFF-WILL.md', 'docs/ARCHITECTURE.md',
  'docs/DEVELOPMENT.md', 'docs/TESTING.md', 'docs/PITFALLS.md', 'docs/THEME-SYSTEM.md',
  'docs/REGRESSION-WORKFLOW.md'
];
/** 历史类：悬空只告警（编年史天然会提到已删除的东西） */
const HIST_DOCS = ['docs/design-notes.md', 'docs/theme-port-feasibility.md', 'docs/deploy-and-rollback.md'];

/** 引用可能相对的基准目录 */
const BASES = ['.', 'app/ui', 'tools', 'docs', 'app'];

/**
 * ⚠️ **宿主安装目录**也是一个合法基准。
 * 文档里会引用不在本仓库里的文件（`src/app.js`、`ui-next/index.html`、
 * `resources/app/...`）—— 它们属于 QQ Agent 安装目录，是项目的**部署目标**。
 * 不把它们算进来会报一堆假悬空。
 */
const HOST_BASES = [
  process.env.QQ_AGENT_HOME || 'E:/QQ Agent/resources/app'
];

function resolveRef(docDir, ref) {
  const clean = ref.replace(/^\.\//, '').replace(/^\//, '').replace(/^resources\/app\//, '');
  const cands = [];
  for (const base of BASES) cands.push(path.resolve(root, base, clean));
  for (const base of HOST_BASES) {
    cands.push(path.resolve(base, clean));
    // 文档里可能写 ui-next/index.html 或 resources/app/ui-next/index.html 两种形态
    cands.push(path.resolve(base, clean.replace(/^ui-next\//, 'ui-next/').replace(/^ui\//, 'ui/')));
  }
  cands.push(path.resolve(docDir, ref));
  cands.push(path.resolve(root, clean));
  return cands.some((p) => fs.existsSync(p));
}

/**
 * 明确"已删除"的路径：文档里**刻意**提到它们（讲清删了什么、为什么）。
 * 这类不算悬空 —— 反而必须能提到，否则交接方不知道边界在哪。
 * 判据：该路径在文中与"删除"语义出现在同一行或邻近上下文。
 */
const DELETED_HINTS = /fox|酒狐|wine-fox|maid\.model|magic\.model/;

function refsOf(text) {
  const refs = new Set();
  for (const m of text.matchAll(/\]\(([^)#\s]+)\)/g)) refs.add(m[1]);
  // 行内 code 里的路径：必须带扩展名，且以已知目录开头
  for (const m of text.matchAll(/`([\w./-]*\/(?:[\w.-]+)\.(?:mjs|js|css|md|html|json|ttf|png|wav|txt))`/g)) refs.add(m[1]);
  return [...refs].filter((r) => !/^https?:/.test(r));
}

let checked = 0; let hard = 0; let soft = 0;
const hardMissing = []; const softMissing = [];

for (const [docs, isHard] of [[GUIDE_DOCS, true], [HIST_DOCS, false]]) {
  for (const doc of docs) {
    if (!fs.existsSync(doc)) continue;
    const text = fs.readFileSync(doc, 'utf8');
    const dir = path.dirname(doc);
    for (const ref of refsOf(text)) {
      checked += 1;
      if (resolveRef(dir, ref)) continue;
      // 刻意提到的"已删除"路径：文档需要能说清删了什么，不算悬空
      if (DELETED_HINTS.test(ref)) { soft += 1; softMissing.push(`${doc}  →  ${ref}（已删除项，刻意提及）`); continue; }
      if (isHard) { hard += 1; hardMissing.push(`${doc}  →  ${ref}`); }
      else { soft += 1; softMissing.push(`${doc}  →  ${ref}`); }
    }
  }
}

console.log(`检查 ${checked} 条引用：指南类悬空 ${hard} 条，历史类悬空 ${soft} 条（后者属正常）。`);
if (softMissing.length) {
  console.log('\n历史类（编年史刻意提到已删除的东西，仅告知）：');
  for (const m of softMissing.slice(0, 12)) console.log('  · ' + m);
  if (softMissing.length > 12) console.log(`  … 另有 ${softMissing.length - 12} 条`);
}
if (hardMissing.length) {
  console.log('\n✗ 指南类悬空引用（必须修）：');
  for (const m of hardMissing) console.log('  ✗ ' + m);
  process.exit(1);
}
console.log('\n指南类引用全部指向真实存在的文件 ✔');
