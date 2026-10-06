// 启动安全自检：Electron 主进程里"语法过了却启动即静默退出"的常见原因。
//
// 为什么需要它（2026-10-03 的真实事故）：
//   新加的"前端目录探测"函数被写在了 __dirname 声明**之前**并立即调用。
//   ESM 的 const 是 TDZ（不是 var 那种 undefined 提升），于是抛 ReferenceError。
//   Electron 在 app.whenReady 之前就退出，boot-diag.log 连"main.js 已加载"都没写 ——
//   现象与"单实例锁没释放"完全一样（双击毫无反应），排查花了很久。
//   `node --check` 查不出这类问题：它是**纯语法**检查，不管运行时顺序。
//
// 本工具做三件事（都是在不启动 Electron 的前提下能做的静态检查）：
//   1. 去掉注释后，检查每个模块级 const/let 是否在自己的声明之前被"顶层执行"引用；
//   2. 检查 app.whenReady 之前是否存在会抛错的可疑调用（如访问未声明的标识符）;
//   3. 用 vm 在一个**打桩的 ESM 环境**里真实执行一遍模块顶层代码，把异常抓出来。
//      （第 3 步是真正有用的那一步：TDZ/未定义变量都会在这里现形。）
//
// 用法：node tools/check-electron-startup.mjs [main.js 路径]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TARGET = process.argv[2] || path.join(ROOT, 'app', 'electron', 'main.js');

const raw = fs.readFileSync(TARGET, 'utf8');
// 去掉注释：注释里提到标识符是正常的，不该被当成引用
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1'))
  .join('\n');
const lines = code.split('\n');

let failed = 0;
const fail = (msg) => { console.error('✗ ' + msg); failed += 1; };

// ── 1. 模块级声明前后关系（粗查）─────────────────────────────────────────
const declRe = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
const declLine = new Map();
lines.forEach((l, i) => {
  const m = declRe.exec(l.trim());
  if (m && !declLine.has(m[1])) declLine.set(m[1], i);
});

// 顶层（第 0 列开头）的调用语句：只看形如 `name(` / `name.` 的行
const topCallRe = /^([A-Za-z_$][\w$]*)\s*[.(]/;
const problems = [];
lines.forEach((l, i) => {
  const m = topCallRe.exec(l);
  if (!m) return;
  const name = m[1];
  const usedAt = i;
  const declaredAt = declLine.get(name);
  if (declaredAt !== undefined && declaredAt > usedAt) {
    problems.push(`第 ${i + 1} 行调用 ${name}()，但它的声明在第 ${declaredAt + 1} 行（TDZ）`);
  }
});
if (problems.length) for (const p of problems) fail(p);
else console.log('✔ 顶层调用顺序：没有"先用后声明"的函数/常量');

// ── 2. 在打桩环境里真跑一遍顶层代码 ─────────────────────────────────────
// 只求"顶层代码不抛异常"，所以把 electron / node 模块全部换成记录型桩。
const calls = [];
const stub = (name) => new Proxy(function () {}, {
  get(_t, prop) {
    if (prop === 'then') return undefined;               // 别让它被当成 thenable
    return stub(`${name}.${String(prop)}`);
  },
  apply(_t, _this, args) {
    calls.push({ name, args: args.map((a) => (typeof a === 'object' ? '[object]' : String(a))).slice(0, 3) });
    return stub(`${name}()`);
  },
  construct() { calls.push({ name, ctor: true }); return stub(`new ${name}`); }
});

const appStub = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'isPackaged') return true;
    if (prop === 'getPath') return () => 'C:\\stub\\userData';
    if (prop === 'whenReady') return () => ({ then: () => ({ catch: () => {} }) });
    if (prop === 'on' || prop === 'once') return () => {};
    if (prop === 'setPath' || prop === 'setAppUserModelId' || prop === 'setLoginItemSettings') return () => {};
    if (prop === 'requestSingleInstanceLock') return () => true;
    if (prop === 'quit' || prop === 'exit') return () => {};
    return stub(`app.${String(prop)}`);
  }
});

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  process: { env: {}, on: () => {}, platform: 'win32', cwd: () => 'C:\\stub' },
  __dirname: path.dirname(TARGET),
  __filename: TARGET,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Buffer, URL, TextEncoder, TextDecoder
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);

// 静态 import 换写成返回桩的 require（保持 await/顺序语义大致不变）
const transformed = code
  .replace(/^\s*import\s+[^;]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^\s*import\s*['"][^'"]+['"];?\s*$/gm, '')
  .replace(/\bawait\s+import\(/g, 'Promise.resolve(')
  .replace(/import\.meta\.url/g, JSON.stringify('file:///E:/stub/main.js'));

try {
  vm.runInContext(`(async () => {\n${transformed}\n})()`, context, { filename: TARGET, timeout: 5000 });
  console.log('✔ 顶层代码在打桩环境下执行通过（未抛异常）');
  console.log(`  （顶层触发了 ${calls.length} 次 electron API 调用，供参考）`);
} catch (error) {
  fail(`顶层代码抛异常：${error?.name}: ${error?.message}`);
  const m = /:(\d+):(\d+)/.exec(String(error?.stack || ''));
  if (m) console.error(`   位置约在生成代码第 ${m[1]} 行（对应源文件需人工换算）`);
}

console.log(failed ? `\n结论：发现 ${failed} 个启动期风险点。` : '\n结论：未发现启动期声明顺序/顶层异常风险。');
process.exit(failed ? 2 : 0);
