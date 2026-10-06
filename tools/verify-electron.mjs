// Electron 外壳（frame:false 无边框 + 自绘标题栏）验证器 —— 静态 + 运行时双路取证。
//
// 为什么不能只做静态 grep：grep 只能证明"源码里写了 frame: false"，
// 证明不了"主进程真的把 minimize 映射到了 BrowserWindow.minimize()"，
// 更证明不了"未知动作不会被转发"。而真机验证又有个硬约束：
// 用户正在用 QQ Agent，**不许重启、不许杀进程**（停了就没法测）。
//
// 解法：把工作区那两个文件的**真实字节**拷进临时目录，配一套 Electron 桩模块
// （只实现被用到的 API，每次调用都记账），用真实的 `import` / `require` 跑起来，
// 再对桩记账做断言。跑的是真代码，不是正则；进程一个都不碰。
//
// 用法：node tools/verify-electron.mjs [--skip-install]
//   --skip-install  跳过"安装目录 vs 工作区逐字节一致"这条（装之前先自查时用）
// 退出码：0 = 全部通过；1 = 有失败项。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INSTALL_DIR = process.env.QQ_AGENT_INSTALL_DIR || 'E:\\QQ Agent';
const SKIP_INSTALL = process.argv.includes('--skip-install');

const REL_MAIN = 'app/electron/main.js';
const REL_PRELOAD = 'app/electron/preload.cjs';
const SRC_MAIN = path.join(ROOT, REL_MAIN);
const SRC_PRELOAD = path.join(ROOT, REL_PRELOAD);
const DST_MAIN = path.join(INSTALL_DIR, 'resources', 'app', 'electron', 'main.js');
const DST_PRELOAD = path.join(INSTALL_DIR, 'resources', 'app', 'electron', 'preload.cjs');

// ── 结果收集 ──────────────────────────────────────────────────────────────
const failures = [];
let acceptNo = 0;
let currentSection = '';

// 章节编号跟任务书里的 6 条验收一一对应；桩机那节是附加取证，单独标。
function section(title) {
  acceptNo += 1;
  currentSection = `【验收${acceptNo}】${title}`;
  console.log('\n' + currentSection);
}
function extra(title) {
  currentSection = `【附加】${title}`;
  console.log('\n' + currentSection);
}
function ok(name, detail) {
  if (detail) console.log(`  ✓ ${name}  —— ${detail}`);
  else console.log(`  ✓ ${name}`);
}
function bad(name, detail) {
  failures.push(`${currentSection} ${name}${detail ? ' —— ' + detail : ''}`);
  if (detail) console.log(`  ✗ ${name}  —— ${detail}`);
  else console.log(`  ✗ ${name}`);
}
function info(text) { console.log(`  · ${text}`); }
function assert(cond, name, detail) { if (cond) ok(name, detail); else bad(name, detail); return !!cond; }

// ── 小工具 ────────────────────────────────────────────────────────────────
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const short = (h) => (h ? h.slice(0, 12) : '(不存在)');
const readUtf8 = (f) => fs.readFileSync(f, 'utf8');

/** 在源码里找匹配行，返回 [{line, text}]。text 去掉了行首缩进，便于贴进文档。 */
function grepLines(src, re) {
  const out = [];
  const arr = src.split(/\r?\n/);
  for (let i = 0; i < arr.length; i += 1) if (re.test(arr[i])) out.push({ line: i + 1, text: arr[i].trim() });
  return out;
}

function runNode(args, opts = {}) {
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8', windowsHide: true, timeout: opts.timeout ?? 60000, cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...(opts.env || {}) }
  });
  return { status: r.status, signal: r.signal, error: r.error, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// 语法检查的落点（见文档第 5 节）：
//   node --check <file>.js  对 ESM 是 **假绿** —— 同一份坏文件存成 .js 时它返回 0，
//   只有 .mjs 扩展名才会真正按模块语法解析。所以这里统一「拷贝成 .mjs 再 --check」，
//   好处还有一个：检查的是磁盘上的**原始字节**，不经过任何 shell 文本编码转换。
function syntaxCheck(src, tempDir, tag) {
  const copy = path.join(tempDir, tag + '.mjs');
  fs.copyFileSync(src, copy);
  const r = runNode(['--check', copy]);
  return { code: r.status, stderr: r.stderr.trim() };
}

// ── 读取源码 ──────────────────────────────────────────────────────────────
const mainSrc = readUtf8(SRC_MAIN);
const preloadSrc = readUtf8(SRC_PRELOAD);

console.log('QQ Agent 新 UI · Electron 无边框外壳验证');
console.log('工作区  ' + ROOT);
console.log('安装目录 ' + INSTALL_DIR);
console.log('被测文件 ' + REL_MAIN + ' / ' + REL_PRELOAD);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qqa-verify-'));
process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ } });

try {
  // ══════════════════════════════════════════════════════════════════════
  section('不使用 Windows 原生标题栏（frame:false / hasShadow:false / 不开 skipTaskbar）');
  // 只认「整行就是一个选项」的写法：注释里也写着 frame:false（讲解为什么要这么做），
  // 用宽松正则会把这些注释一起算进来，证据就不干净了。
  const frameHit = grepLines(mainSrc, /^\s*frame:\s*false\s*,?\s*$/);
  const frameComments = grepLines(mainSrc, /^\s*\/\/.*frame:\s*false/);
  assert(frameHit.length === 1, 'BrowserWindow 选项里有 frame: false',
    frameHit.map((h) => `${REL_MAIN}:${h.line}  ${h.text}`).join(' | ') +
    (frameComments.length ? `（另有 ${frameComments.length} 处是讲解注释，不计：行 ${frameComments.map((h) => h.line).join('/')}）` : ''));
  const shadowHit = grepLines(mainSrc, /^\s*hasShadow:\s*false\s*,?\s*$/);
  assert(shadowHit.length === 1, 'BrowserWindow 选项里有 hasShadow: false',
    shadowHit.map((h) => `${REL_MAIN}:${h.line}  ${h.text}`).join(' | '));
  const skipHits = grepLines(mainSrc, /skipTaskbar/);
  const skipTrueHits = grepLines(mainSrc, /skipTaskbar\s*:\s*(?!\/\/)\s*true/);
  assert(skipTrueHits.length === 0, '没有任何 skipTaskbar: true（窗口仍在任务栏可见/可找回）',
    skipHits.length ? `grep skipTaskbar 命中 ${skipHits.length} 处，均为注释：` +
      skipHits.map((h) => `${REL_MAIN}:${h.line} ${h.text}`).join(' | ') : '全文件 0 命中');
  const thickHit = grepLines(mainSrc, /thickFrame:\s*true/);
  info('无边框后缩放热区：' + (thickHit.length ? `${REL_MAIN}:${thickHit[0].line}  ${thickHit[0].text}` : '未显式写出（走默认）'));

  // ══════════════════════════════════════════════════════════════════════
  section('三个窗口动作在 qqa-window 里分别落到 minimize / maximize|unmaximize / close');
  // 把 switch 的每个 case 臂切出来，逐臂检查，避免"文件里存在某个调用"这种弱证据。
  // 必须先框定 switch 的范围：否则最后一个臂会一路吃到文件末尾，
  // 把 close 之外那些合法的 hide()/quit()（托盘菜单、closeToTray 分支）也算到它头上。
  const caseArms = (() => {
    const out = {};
    const switchStart = mainSrc.indexOf('switch (String(action))');
    if (switchStart < 0) return out;
    const switchStop = mainSrc.indexOf('} catch', switchStart);
    const switchText = mainSrc.slice(switchStart, switchStop > 0 ? switchStop : mainSrc.length);
    const baseLine = mainSrc.slice(0, switchStart).split(/\r?\n/).length;
    const marks = [...switchText.matchAll(/\n\s*(?:case\s+'([^']+)'|default)\s*:/g)];
    for (let i = 0; i < marks.length; i += 1) {
      const name = marks[i][1];
      if (!name) continue;
      const start = marks[i].index;
      const end = i + 1 < marks.length ? marks[i + 1].index : switchText.length;
      out[name] = {
        line: baseLine + switchText.slice(0, start).split(/\r?\n/).length - 1,
        text: switchText.slice(start, end)
      };
    }
    return out;
  })();
  const armCall = (arm, re) => {
    const m = arm && arm.text.match(re);
    if (!m) return null;
    return { line: arm.line + arm.text.slice(0, m.index).split(/\r?\n/).length - 1, text: m[0].trim() };
  };
  for (const [action, re] of [['minimize', /w\.minimize\(\)/], ['toggle-maximize', /w\.isMaximized\(\)\s*\)\s*w\.unmaximize\(\)\s*;\s*else\s*w\.maximize\(\)/], ['close', /w\.close\(\)/]]) {
    const arm = caseArms[action];
    if (!arm) { bad(`case '${action}' 存在`); continue; }
    const hit = armCall(arm, re);
    if (hit) ok(`case '${action}' → ${hit.text.replace(/\s+/g, ' ')}`, `${REL_MAIN}:${hit.line}`);
    else bad(`case '${action}' 的动作映射`, `未在 case 臂内匹配到 ${re}（臂起始行 ${arm.line}）`);
  }
  const closeArm = caseArms['close'];
  if (closeArm) {
    assert(!/\.hide\(\)/.test(closeArm.text) && !/app\.quit\(\)/.test(closeArm.text),
      "close 臂里没有 hide()/quit()（不绕过 closeToTray 与 before-quit 清理链）",
      closeArm.text.replace(/\s+/g, ' ').trim());
  }
  const closeToTrayHit = grepLines(mainSrc, /closeToTray\s*!==\s*false/);
  info('closeToTray 判定仍在 close 事件里：' + (closeToTrayHit.length
    ? `${REL_MAIN}:${closeToTrayHit[0].line}  ${closeToTrayHit[0].text}` : '未找到'));

  // ══════════════════════════════════════════════════════════════════════
  section('窗口状态回推（7 个事件 + 销毁时不抛错）');
  const evListHit = grepLines(mainSrc, /for\s*\(const ev of \[/);
  assert(evListHit.length === 1, '存在统一注册事件数组的 for-of',
    evListHit.map((h) => `${REL_MAIN}:${h.line}  ${h.text}`).join(' | '));
  if (evListHit.length) {
    const line = evListHit[0];
    const missing = ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'show', 'focus', 'blur']
      .filter((e) => !line.text.includes(`'${e}'`));
    assert(missing.length === 0, '7 个事件一个不少', missing.length ? '缺：' + missing.join(', ') : 'maximize/unmaximize/enter-full-screen/leave-full-screen/show/focus/blur');
    assert(/pushWindowState/.test(mainSrc.split(/\r?\n/)[line.line] || '') || /pushWindowState/.test(line.text),
      '这些事件绑定的都是 pushWindowState');
  }
  const pushFnHit = grepLines(mainSrc, /function pushWindowState\(\)/);
  assert(pushFnHit.length === 1, 'pushWindowState() 已定义',
    pushFnHit.map((h) => `${REL_MAIN}:${h.line}`).join(' '));
  const pushBody = (() => {
    const i = mainSrc.indexOf('function pushWindowState()');
    return i < 0 ? '' : mainSrc.slice(i, mainSrc.indexOf('\n}', i) + 2);
  })();
  assert(/isDestroyed\(\)/.test(pushBody) && /catch/.test(pushBody),
    'pushWindowState 有 isDestroyed 守卫 + try/catch（窗口销毁中不抛错）',
    pushBody.replace(/\s+/g, ' ').trim().slice(0, 120));

  // ══════════════════════════════════════════════════════════════════════
  section('预加载桥 window.qqAgentShell 的契约');
  for (const key of ['refocus', 'captchaNetProbe', 'captchaInterceptorStatus', 'controls', 'windowState', 'onMaximizeChange']) {
    const hit = grepLines(preloadSrc, new RegExp('(^|\\s)' + key + '\\s*:'));
    assert(hit.length >= 1, `暴露 ${key}`, hit.map((h) => `${REL_PRELOAD}:${h.line}`).join(' '));
  }
  const wlHit = grepLines(preloadSrc, /const WINDOW_ACTIONS = new Set\(/);
  assert(wlHit.length === 1, 'controls.send 走白名单集合', wlHit.map((h) => `${REL_PRELOAD}:${h.line}  ${h.text}`).join(''));
  const guardHit = grepLines(preloadSrc, /WINDOW_ACTIONS\.has\(/);
  assert(guardHit.length === 1, 'send() 入口做了白名单判断', guardHit.map((h) => `${REL_PRELOAD}:${h.line}  ${h.text}`).join(''));
  const ipcCallCount = grepLines(preloadSrc, /ipcMain|ipcRenderer\.(send|invoke)/).length;
  info(`ipcRenderer 调用点 ${ipcCallCount} 处；主进程侧通道：app-refocus / qqa-captcha-net-probe / qqa-captcha-interceptor-status / qqa-window / qqa-window-state`);

  // ══════════════════════════════════════════════════════════════════════
  section('语法与加载检查（含"假绿"负向对照）');
  const synMain = syntaxCheck(SRC_MAIN, tmpRoot, 'main-as-mjs');
  assert(synMain.code === 0, `main.js（拷成 .mjs 后 node --check）退出码 0`,
    synMain.stderr ? synMain.stderr.split('\n')[0] : '无输出');
  const synPre = runNode(['--check', SRC_PRELOAD]);
  assert(synPre.status === 0, `preload.cjs（node --check，CommonJS）退出码 0`,
    synPre.stderr.trim() ? synPre.stderr.trim().split('\n')[0] : '无输出');

  // 负向对照：证明 --check 不是空转，同时证明"直接对 .js 跑 --check"是假绿。
  const brokenSrc = "import path from 'node:path';\nconst x = ;\nexport function f( {\n";
  const brokenMjs = path.join(tmpRoot, 'broken.mjs');
  const brokenJs = path.join(tmpRoot, 'broken.js');
  fs.writeFileSync(brokenMjs, brokenSrc, 'utf8');
  fs.writeFileSync(brokenJs, brokenSrc, 'utf8');
  const rBrokenMjs = runNode(['--check', brokenMjs]);
  const rBrokenJs = runNode(['--check', brokenJs]);
  assert(rBrokenMjs.status !== 0, '负向对照：故意写坏的 .mjs 被拦下（退出码非 0）', `退出码 ${rBrokenMjs.status}`);
  info(`对照：同一份坏文件存成 .js 时 node --check 退出码 ${rBrokenJs.status}` +
    (rBrokenJs.status === 0 ? ' → 假绿，不能用来查 main.js（ESM）' : ''));

  // ══════════════════════════════════════════════════════════════════════
  extra('真实代码运行时验证（Electron 桩：跑真字节，不碰真进程）');
  const mainRun = runMainHarness();
  const preRun = runPreloadHarness();
  collectHarness('main.js', mainRun);
  collectHarness('preload.cjs', preRun);

  // 跨文件契约：preload 放行的动作必须都被主进程认。
  if (preRun.ok && mainRun.ok) {
    const handled = Object.keys(caseArms);
    const allowed = preRun.data.whitelist || [];
    const unhandled = allowed.filter((a) => !handled.includes(a));
    assert(unhandled.length === 0, 'preload 白名单动作 ⊆ 主进程 qqa-window 处理的动作',
      `放行 [${allowed.join(', ')}] / 主进程处理 [${handled.join(', ')}]`);
  }

  // ══════════════════════════════════════════════════════════════════════
  section('安装目录与工作区逐字节一致（sha256）');
  if (SKIP_INSTALL) {
    info('--skip-install：本条跳过');
  } else {
    for (const [rel, src, dst] of [[REL_MAIN, SRC_MAIN, DST_MAIN], [REL_PRELOAD, SRC_PRELOAD, DST_PRELOAD]]) {
      if (!fs.existsSync(dst)) { bad(`${rel} 已安装`, `${dst} 不存在`); continue; }
      const a = sha256(src), b = sha256(dst);
      assert(a === b, `${rel} sha256 一致`, `工作区 ${short(a)} / 安装版 ${short(b)}` + (a === b ? '（逐字节相同）' : '（不一致 → 需 node tools/apply-electron.mjs --apply）'));
    }
  }
} catch (error) {
  bad('验证器自身异常', String(error?.stack ?? error));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(64));
if (failures.length) {
  console.log(`结果：${failures.length} 项未通过`);
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
} else {
  console.log('结果：全部通过（验收 1–6，含附加的桩机运行时断言）');
  process.exit(0);
}

// ──────────────────────────────────────────────────────────────────────────
// 下面是两个桩机的生成与执行。桩代码用字符串拼接写，避免与外层模板字符串打架。
// ──────────────────────────────────────────────────────────────────────────

function electronStubSource() {
  return [
    "'use strict';",
    '// Electron 桩：只实现 main.js 用到的 API，每次调用都记账，供 harness 断言。',
    '// 刻意贴近真实语义的两处：',
    "//   1) close() 会派发 'close' 事件，preventDefault() 能阻止销毁 —— 这样 main.js",
    '//      的 closeToTray 分支才测得出真假；',
    '//   2) isMaximized/isVisible 等状态方法返回桩自己维护的布尔值，minimize/maximize/show',
    '//      这些动作会让它跟着变，于是"动作 → 状态 → 回推"这条链是通的。',
    'const rec = {',
    '  windows: [], ipcOn: {}, ipcHandle: {}, appOn: {}, appPaths: {},',
    '  dialogs: [], external: [], tray: null, trayMenu: null, quitCalled: false,',
    '  exitCode: null, loginItem: null, appUserModelId: null, singleInstance: null,',
    '  disableHW: false, proxy: null, webRequestHook: null, appMenuSet: false',
    '};',
    'globalThis.__QQA_STUB__ = rec;',
    'globalThis.__QQA_CFG__ = { server: { closeToTray: true, autoStart: false } };',
    '',
    'function bag(t, key, ev, fn) { if (!t[key]) t[key] = {}; if (!t[key][ev]) t[key][ev] = []; t[key][ev].push(fn); }',
    'function fire(t, key, ev, args) { const l = (t[key] && t[key][ev]) || []; for (const fn of l) fn.apply(null, args || []); }',
    '',
    'function WebContents() { this._on = {}; this._once = {}; this.sent = []; }',
    "WebContents.prototype.on = function (ev, fn) { bag(this, '_on', ev, fn); return this; };",
    "WebContents.prototype.once = function (ev, fn) { bag(this, '_once', ev, fn); return this; };",
    "WebContents.prototype.emit_ = function (ev) { const a = Array.prototype.slice.call(arguments, 1); fire(this, '_on', ev, a); fire(this, '_once', ev, a); };",
    'WebContents.prototype.send = function (ch, payload) { this.sent.push({ ch: ch, payload: payload }); };',
    'WebContents.prototype.focus = function () { this.focusCalls = (this.focusCalls || 0) + 1; };',
    'WebContents.prototype.reloadIgnoringCache = function () { this.reloads = (this.reloads || 0) + 1; };',
    'WebContents.prototype.setWindowOpenHandler = function (h) { this.openHandler = h; };',
    '',
    'function BrowserWindow(options) {',
    '  this.options = options; this._on = {}; this._once = {}; this.calls = [];',
    '  this.destroyed = false; this.minimized = false; this.maximized = false;',
    '  this.fullScreen = false; this.visible = false; this.focused = false;',
    '  this.webContents = new WebContents();',
    '  rec.windows.push(this);',
    '}',
    "BrowserWindow.prototype.on = function (ev, fn) { bag(this, '_on', ev, fn); return this; };",
    "BrowserWindow.prototype.once = function (ev, fn) { bag(this, '_once', ev, fn); return this; };",
    "BrowserWindow.prototype.emit_ = function (ev) { const a = Array.prototype.slice.call(arguments, 1); fire(this, '_on', ev, a); fire(this, '_once', ev, a); };",
    "BrowserWindow.prototype.minimize = function () { this.calls.push('minimize'); this.minimized = true; this.emit_('minimize'); };",
    "BrowserWindow.prototype.maximize = function () { this.calls.push('maximize'); this.maximized = true; this.emit_('maximize'); };",
    "BrowserWindow.prototype.unmaximize = function () { this.calls.push('unmaximize'); this.maximized = false; this.emit_('unmaximize'); };",
    "BrowserWindow.prototype.restore = function () { this.calls.push('restore'); this.minimized = false; };",
    "BrowserWindow.prototype.show = function () { this.calls.push('show'); this.visible = true; };",
    "BrowserWindow.prototype.hide = function () { this.calls.push('hide'); this.visible = false; };",
    "BrowserWindow.prototype.focus = function () { this.calls.push('focus'); this.focused = true; };",
    'BrowserWindow.prototype.close = function () {',
    "  this.calls.push('close');",
    '  const ev = { defaultPrevented: false, preventDefault: function () { this.defaultPrevented = true; } };',
    "  this.emit_('close', ev); this.lastCloseEvent = ev;",
    "  if (!ev.defaultPrevented) { this.destroyed = true; this.emit_('closed'); }",
    '};',
    'BrowserWindow.prototype.isMaximized = function () { return this.maximized; };',
    'BrowserWindow.prototype.isMinimized = function () { return this.minimized; };',
    'BrowserWindow.prototype.isFullScreen = function () { return this.fullScreen; };',
    'BrowserWindow.prototype.isVisible = function () { return this.visible; };',
    'BrowserWindow.prototype.isFocused = function () { return this.focused; };',
    'BrowserWindow.prototype.isDestroyed = function () { return this.destroyed; };',
    "BrowserWindow.prototype.loadURL = function (u) { this.calls.push('loadURL'); this.loadedURL = u; return Promise.resolve(); };",
    '',
    'const app = {',
    '  isPackaged: false,',
    '  whenReady: function () { return Promise.resolve(); },',
    '  disableHardwareAcceleration: function () { rec.disableHW = true; },',
    '  setAppUserModelId: function (id) { rec.appUserModelId = id; },',
    '  setPath: function (k, v) { rec.appPaths[k] = v; },',
    "  getPath: function (k) { return rec.appPaths[k] || ('C:/qqa-stub/' + k); },",
    '  requestSingleInstanceLock: function () { rec.singleInstance = true; return true; },',
    "  on: function (ev, fn) { bag(rec, 'appOn', ev, fn); return app; },",
    '  quit: function () { rec.quitCalled = true; },',
    '  exit: function (c) { rec.exitCode = c; },',
    '  setLoginItemSettings: function (o) { rec.loginItem = o; }',
    '};',
    '',
    'const session = { defaultSession: {',
    '  setProxy: function (o) { rec.proxy = o; return Promise.resolve(); },',
    '  webRequest: { onBeforeRequest: function (h) { rec.webRequestHook = h; } }',
    '} };',
    'const nativeImage = { createFromPath: function (p) { return { path: p }; } };',
    'function Tray(icon) { this.icon = icon; rec.tray = this; }',
    'Tray.prototype.setToolTip = function (t) { this.tip = t; };',
    'Tray.prototype.setContextMenu = function (m) { this.menu = m; };',
    "Tray.prototype.on = function (ev, fn) { bag(this, '_on', ev, fn); return this; };",
    'const Menu = {',
    "  setApplicationMenu: function () { rec.appMenuSet = true; },",
    '  buildFromTemplate: function (t) { rec.trayMenu = t; return t; }',
    '};',
    'const shell = { openExternal: function (u) { rec.external.push(u); } };',
    'const dialog = { showErrorBox: function (t, m) { rec.dialogs.push({ title: t, message: m }); } };',
    'const ipcMain = {',
    "  on: function (ch, fn) { bag(rec, 'ipcOn', ch, fn); },",
    "  handle: function (ch, fn) { rec.ipcHandle[ch] = fn; }",
    '};',
    '',
    'exports.app = app;',
    'exports.BrowserWindow = BrowserWindow;',
    'exports.Tray = Tray;',
    'exports.Menu = Menu;',
    'exports.nativeImage = nativeImage;',
    'exports.session = session;',
    'exports.shell = shell;',
    'exports.dialog = dialog;',
    'exports.ipcMain = ipcMain;',
    ''
  ].join('\n');
}

function mainHarnessSource() {
  return [
    "// 真实 import 工作区那份 main.js，断言 Electron 桩记录下来的行为。",
    'const results = [];',
    'function check(ok, name, detail) { results.push({ ok: !!ok, name: name, detail: detail == null ? "" : String(detail) }); }',
    'function finish() { console.log("\\n__QQA_JSON__" + JSON.stringify({ results: results })); }',
    '',
    '// 注意顺序：桩模块是 main.js 里那句 import "electron" 才被加载的，',
    '// 所以 __QQA_STUB__ 必须在这之后取，不能提前。',
    'await import("./electron/main.js");',
    'const stub = globalThis.__QQA_STUB__;',
    'const cfg = globalThis.__QQA_CFG__;',
    '',
    '// whenReady 的回调是掷出去的 Promise，等托盘建起来说明启动链跑完了。',
    'const t0 = Date.now();',
    'while (!stub.tray && Date.now() - t0 < 8000) await new Promise(function (r) { setTimeout(r, 5); });',
    '',
    'check(!!stub.tray, "启动链跑到底（窗口 + 托盘都建起来）");',
    'const win = stub.windows[0];',
    'check(stub.windows.length === 1, "只创建了 1 个主窗口", "实际 " + stub.windows.length);',
    'if (!win) { check(false, "拿到主窗口"); finish(); process.exit(0); }',
    '',
    '// ── 验收1：构造参数 ────────────────────────────────────────────────',
    'const o = win.options;',
    'check(o.frame === false, "运行时：BrowserWindow options.frame === false", "frame=" + JSON.stringify(o.frame));',
    'check(o.hasShadow === false, "运行时：options.hasShadow === false", "hasShadow=" + JSON.stringify(o.hasShadow));',
    'check(o.skipTaskbar !== true, "运行时：没有开启 skipTaskbar", "skipTaskbar=" + JSON.stringify(o.skipTaskbar));',
    'check(o.webPreferences && o.webPreferences.contextIsolation === true && o.webPreferences.nodeIntegration === false,',
    '  "运行时：contextIsolation=true / nodeIntegration=false 未被破坏");',
    'check(!!(o.webPreferences && typeof o.webPreferences.preload === "string" && /preload\\.cjs$/.test(o.webPreferences.preload)),',
    '  "运行时：preload 指向 preload.cjs", o.webPreferences && o.webPreferences.preload);',
    'check(stub.appMenuSet === true, "运行时：应用菜单已移除（Menu.setApplicationMenu 被调用）");',
    '',
    '// ── 验收2：qqa-window 动作派发 ─────────────────────────────────────',
    'const onList = stub.ipcOn["qqa-window"];',
    'check(Array.isArray(onList) && onList.length === 1, "主进程注册了 qqa-window 监听", "注册数 " + ((onList || []).length));',
    'const wHandler = (onList || [])[0];',
    'const stateSends = function () { return win.webContents.sent.filter(function (s) { return s.ch === "qqa-window-state"; }); };',
    'function act(action) { win.calls = []; const before = stateSends().length; wHandler({}, action); return { calls: win.calls.slice(), pushed: stateSends().length - before }; }',
    '',
    'let r = act("minimize");',
    'check(r.calls.indexOf("minimize") >= 0, "动作 minimize → BrowserWindow.minimize()", "调用序列 [" + r.calls.join(", ") + "]");',
    '// 一次动作至少回推一次：minimize() 自己会触发 minimize 事件推一次，',
    '// 处理函数末尾还会兜底再推一次（真机上事件是异步的，两次不算多）。',
    'check(r.pushed >= 1, "动作后回推了窗口状态", "pushed=" + r.pushed);',
    '',
    'win.maximized = false;',
    'r = act("toggle-maximize");',
    'check(r.calls.indexOf("maximize") >= 0, "未最大化时 toggle-maximize → maximize()", "调用序列 [" + r.calls.join(", ") + "]");',
    'win.maximized = true;',
    'r = act("toggle-maximize");',
    'check(r.calls.indexOf("unmaximize") >= 0, "已最大化时 toggle-maximize → unmaximize()", "调用序列 [" + r.calls.join(", ") + "]");',
    '',
    'win.maximized = false; cfg.server.closeToTray = true;',
    'r = act("close");',
    'check(r.calls.indexOf("close") >= 0, "动作 close → BrowserWindow.close()", "调用序列 [" + r.calls.join(", ") + "]");',
    'check(stub.quitCalled === false, "close 没有直接 app.quit()");',
    'check(r.calls.indexOf("hide") >= 0 && win.lastCloseEvent && win.lastCloseEvent.defaultPrevented === true && win.destroyed === false,',
    '  "closeToTray=true 时缩到托盘（close 事件被 preventDefault + hide，窗口未销毁）",',
    '  "hide=" + (r.calls.indexOf("hide") >= 0) + " prevented=" + !!(win.lastCloseEvent && win.lastCloseEvent.defaultPrevented));',
    'cfg.server.closeToTray = true;',
    'r = act("quit");',
    'check(r.calls.length === 0 && stub.quitCalled === false, "未知动作 quit 被忽略，不触发任何窗口调用", "调用序列 [" + r.calls.join(", ") + "]");',
    '',
    '// ── 验收3：状态回推 ───────────────────────────────────────────────',
    'const evs = ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "show", "focus", "blur"];',
    'for (const ev of evs) {',
    '  const before = stateSends().length;',
    '  win.emit_(ev);',
    '  check(stateSends().length === before + 1, "窗口事件 " + ev + " → 推送窗口状态");',
    '}',
    'win.webContents.callsBefore = win.webContents.sent.length;',
    'win.calls = [];',
    'win.webContents.emit_("did-finish-load");',
    'const last = stateSends()[stateSends().length - 1];',
    'check(!!last && ["maximized", "fullScreen", "visible", "focused"].every(function (k) { return typeof last.payload[k] === "boolean"; }),',
    '  "状态载荷是 {maximized,fullScreen,visible,focused} 四个布尔值", JSON.stringify(last && last.payload));',
    'check(win.calls.indexOf("show") >= 0 && win.calls.indexOf("focus") >= 0, "did-finish-load 时 show + focus + 首次同步状态",',
    '  "调用序列 [" + win.calls.join(", ") + "]");',
    'const handleState = stub.ipcHandle["qqa-window-state"];',
    'check(typeof handleState === "function", "主进程注册了 qqa-window-state 的 invoke 处理器");',
    'const snap = typeof handleState === "function" ? handleState() : null;',
    'check(!!snap && ["maximized", "fullScreen", "visible", "focused"].every(function (k) { return typeof snap[k] === "boolean"; }),',
    '  "qqa-window-state 返回状态快照", JSON.stringify(snap));',
    '',
    '// ── 销毁路径：不能抛错 ────────────────────────────────────────────',
    'cfg.server.closeToTray = false;',
    'r = act("close");',
    'check(r.calls.indexOf("close") >= 0 && r.calls.indexOf("hide") < 0 && win.destroyed === true,',
    '  "closeToTray=false 时 close 真的销毁窗口（不 hide）", "调用序列 [" + r.calls.join(", ") + "] destroyed=" + win.destroyed);',
    'let threw = false;',
    'try { win.emit_("focus"); } catch (e) { threw = true; }',
    'check(!threw, "窗口已销毁时再推状态：pushWindowState 不抛错");',
    'let threw2 = false;',
    'try { win.calls = []; wHandler({}, "minimize"); } catch (e) { threw2 = true; }',
    'check(!threw2 && win.calls.length === 0, "窗口已销毁时收到 qqa-window：静默返回，不抛错");',
    'let threw3 = false;',
    'try { handleState(); } catch (e) { threw3 = true; }',
    'check(!threw3, "窗口已销毁时查询 qqa-window-state：返回全 false 而不抛错");',
    '',
    'check(stub.exitCode === null && stub.dialogs.length === 0, "整条链上没有 fatal（uncaughtException 分支未触发）");',
    'check(stub.loginItem && stub.loginItem.openAtLogin === false, "托盘/自启等既有功能仍在（applyAutoStart 跑到）");',
    'check(!!stub.webRequestHook, "验证码域重定向拦截器仍注册（未回退）");',
    '',
    'finish();',
    'process.exit(0);',
    ''
  ].join('\n');
}

function preloadStubSource() {
  return [
    "'use strict';",
    '// Electron 桩（preload 用）：contextBridge 记账暴露的对象，ipcRenderer 记账通道。',
    'const rec = { exposed: {}, sends: [], invokes: [], listeners: {}, removed: [] };',
    'globalThis.__QQA_PRE__ = rec;',
    'const ipcRenderer = {',
    '  send: function (ch, payload) { rec.sends.push({ ch: ch, payload: payload }); },',
    '  invoke: function (ch, payload) { rec.invokes.push({ ch: ch, payload: payload }); return Promise.resolve("INVOKE:" + ch); },',
    '  on: function (ch, fn) { (rec.listeners[ch] = rec.listeners[ch] || []).push(fn); },',
    '  removeListener: function (ch, fn) { rec.removed.push(ch); const l = rec.listeners[ch] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },',
    '  emit_: function (ch) { const a = Array.prototype.slice.call(arguments, 1); const l = (rec.listeners[ch] || []).slice(); for (const fn of l) fn.apply(null, a); }',
    '};',
    'const contextBridge = { exposeInMainWorld: function (key, api) { rec.exposed[key] = api; } };',
    '// 把 ipcRenderer 也挂到 rec 上：harness 要主动 emit_ 一个 qqa-window-state',
    '// 来模拟主进程推状态，否则 onMaximizeChange 这条链测不到。',
    'rec.ipcRenderer = ipcRenderer;',
    'exports.contextBridge = contextBridge;',
    'exports.ipcRenderer = ipcRenderer;',
    ''
  ].join('\n');
}

function preloadHarnessSource() {
  return [
    "'use strict';",
    '// 同 main harness：桩要先 require 进来，全局记录对象才存在。',
    'require("./preload.cjs");',
    'const rec = globalThis.__QQA_PRE__;',
    'const results = [];',
    'function check(ok, name, detail) { results.push({ ok: !!ok, name: name, detail: detail == null ? "" : String(detail) }); }',
    'function finish(extra) {',
    '  const out = { results: results, whitelist: extra && extra.whitelist ? extra.whitelist : [] };',
    '  console.log("\\n__QQA_JSON__" + JSON.stringify(out));',
    '}',
    '',
    '(async function () {',
    '  const shell = rec.exposed.qqAgentShell;',
    '  check(!!shell, "contextBridge 暴露了 window.qqAgentShell");',
    '  if (!shell) { finish(); return; }',
    '  for (const k of ["refocus", "captchaNetProbe", "captchaInterceptorStatus", "controls", "windowState", "onMaximizeChange"]) {',
    '    check(typeof shell[k] !== "undefined", "契约字段存在：" + k, "typeof=" + typeof shell[k]);',
    '  }',
    '  check(typeof shell.controls === "object" && shell.controls !== null, "controls 是对象");',
    '',
    '  // 原有三个接口：改名即破坏移植逻辑，这里既查存在也查真调通。',
    '  const n0 = rec.sends.length;',
    '  shell.refocus();',
    '  check(rec.sends.length === n0 + 1 && rec.sends[n0].ch === "app-refocus", "refocus() → ipcRenderer.send(app-refocus)", rec.sends[n0] && rec.sends[n0].ch);',
    '  const probe = await shell.captchaNetProbe();',
    '  check(probe === "INVOKE:qqa-captcha-net-probe", "captchaNetProbe() → invoke(qqa-captcha-net-probe)", String(probe));',
    '  const st = await shell.captchaInterceptorStatus();',
    '  check(st === "INVOKE:qqa-captcha-interceptor-status", "captchaInterceptorStatus() → invoke(qqa-captcha-interceptor-status)", String(st));',
    '  const ws = await shell.windowState();',
    '  check(ws === "INVOKE:qqa-window-state", "windowState() → invoke(qqa-window-state)", String(ws));',
    '',
    '  // controls 的具体方法',
    '  for (const m of ["minimize", "maximize", "unmaximize", "toggle-maximize", "close"]) {',
    '    check(typeof shell.controls[m] === "function", "controls." + m + " 是函数");',
    '    const n = rec.sends.length;',
    '    shell.controls[m]();',
    '    const s = rec.sends[n];',
    '    check(!!s && s.ch === "qqa-window" && s.payload === m, "controls." + m + "() → send(qqa-window, " + m + ")", s && (s.ch + " / " + s.payload));',
    '  }',
    '',
    '  // send() 白名单：放行的必须是上面那 5 个，其余一律静默丢弃。',
    '  const candidates = ["minimize", "maximize", "unmaximize", "toggle-maximize", "close", "quit", "hide", "destroy", "reload", "devtools", "exec", "__proto__"];',
    '  const whitelist = [];',
    '  for (const a of candidates) {',
    '    const n = rec.sends.length;',
    '    shell.controls.send(a);',
    '    if (rec.sends.length === n + 1) whitelist.push(a);',
    '  }',
    '  const denied = candidates.filter(function (a) { return whitelist.indexOf(a) < 0; });',
    '  check(whitelist.length > 0, "controls.send 放行了白名单动作", "[" + whitelist.join(", ") + "]");',
    '  check(denied.length > 0, "controls.send 把非白名单动作全部挡掉", "拒绝 [" + denied.join(", ") + "]");',
    '  check(denied.indexOf("quit") >= 0 && denied.indexOf("hide") >= 0 && denied.indexOf("destroy") >= 0 && denied.indexOf("__proto__") >= 0,',
    '    "quit / hide / destroy / __proto__ 都在拒绝名单里");',
    '',
    '  // onMaximizeChange：订阅、回调、取消订阅、异常兜底',
    '  let got = null;',
    '  const off = shell.onMaximizeChange(function (m, s) { got = [m, s]; });',
    '  check(typeof off === "function", "onMaximizeChange 返回取消订阅函数");',
    '  rec.ipcRenderer.emit_("qqa-window-state", {}, { maximized: true, fullScreen: false, visible: true, focused: true });',
    '  check(!!got && got[0] === true && got[1] && got[1].visible === true, "收到 qqa-window-state 后回调 (maximized, state)", JSON.stringify(got));',
    '  got = null;',
    '  off();',
    '  rec.ipcRenderer.emit_("qqa-window-state", {}, { maximized: true });',
    '  check(got === null && rec.removed.indexOf("qqa-window-state") >= 0, "取消订阅后不再回调（removeListener 已调用）");',
    '  const off2 = shell.onMaximizeChange("not-a-function");',
    '  check(typeof off2 === "function", "onMaximizeChange 传非函数时返回空函数而不是抛错");',
    '  const off3 = shell.onMaximizeChange(function () { throw new Error("boom"); });',
    '  let threw = false;',
    '  try { rec.ipcRenderer.emit_("qqa-window-state", {}, { maximized: false }); } catch (e) { threw = true; }',
    '  check(!threw, "渲染层回调抛错被吞掉，不会把异常甩回主进程");',
    '  off3();',
    '',
    '  finish({ whitelist: whitelist });',
    '})().catch(function (e) {',
    '  results.push({ ok: false, name: "preload harness 崩溃", detail: String((e && e.stack) || e) });',
    '  finish({ whitelist: [] });',
    '});',
    ''
  ].join('\n');
}

/** 搭一个临时目录，把真实文件拷进去，配桩模块跑起来。 */
function buildHarness(kind, stubSource, harnessSource, harnessName, extraFiles) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, kind + '-'));
  const nm = path.join(dir, 'node_modules', 'electron');
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0-stub', main: 'index.js' }, null, 2), 'utf8');
  fs.writeFileSync(path.join(nm, 'index.js'), stubSource, 'utf8');
  for (const [rel, content] of Object.entries(extraFiles || {})) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  }
  fs.writeFileSync(path.join(dir, harnessName), harnessSource, 'utf8');
  return dir;
}

function runHarness(dir, harnessName, env) {
  const r = runNode([harnessName], { cwd: dir, env, timeout: 60000 });
  const line = (r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('__QQA_JSON__'));
  let data = null;
  if (line) { try { data = JSON.parse(line.slice('__QQA_JSON__'.length)); } catch { data = null; } }
  return { ok: !!data, data, status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error };
}

function runMainHarness() {
  // main.js 会补 '../src/profile.js'、'../src/app.js'，用同路径的替身喂它；
  // 数据目录指向临时目录，避免桩机往真实安装目录写 boot-diag.log。
  const dataDir = fs.mkdtempSync(path.join(tmpRoot, 'data-'));
  const dir = buildHarness('main', electronStubSource(), mainHarnessSource(), 'harness.mjs', {
    'package.json': JSON.stringify({ name: 'qqa-verify-tmp', type: 'module' }, null, 2),
    'src/profile.js': 'export function dataDirName() { return "data"; }\nexport function describeInstance() { return "QQ Agent（验证桩）"; }\n',
    'src/app.js': [
      'export function createApp() {',
      '  const cfg = globalThis.__QQA_CFG__;',
      '  return {',
      '    lastPort: 3210,',
      '    getConfig: function () { return cfg; },',
      '    updateConfig: function () {},',
      '    start: function () { return Promise.resolve(3399); },',
      '    stop: function () { globalThis.__QQA_STUB__.coreStopped = true; return Promise.resolve(); },',
      '    orchestrator: { paused: false, setPaused: function (v) { this.paused = v; } }',
      '  };',
      '}',
      ''
    ].join('\n')
  });
  // 真实 main.js 的字节级副本 —— 验证的就是要装上去的那份。
  fs.mkdirSync(path.join(dir, 'electron'), { recursive: true });
  fs.copyFileSync(SRC_MAIN, path.join(dir, 'electron', 'main.js'));
  return runHarness(dir, 'harness.mjs', { QQ_AGENT_DATA_DIR: dataDir });
}

function runPreloadHarness() {
  const dir = buildHarness('preload', preloadStubSource(), preloadHarnessSource(), 'harness.cjs', {});
  fs.copyFileSync(SRC_PRELOAD, path.join(dir, 'preload.cjs'));
  return runHarness(dir, 'harness.cjs', {});
}

function collectHarness(label, run) {
  if (!run.ok) {
    bad(`${label} 运行时桩机未能产出结果`,
      `退出码 ${run.status}${run.error ? ' / ' + run.error.message : ''}${run.stderr ? ' / stderr: ' + run.stderr.trim().split('\n').slice(-3).join(' ; ') : ''}`);
    if (run.stdout) info(`${label} stdout 末尾：` + run.stdout.trim().split('\n').slice(-3).join(' ; '));
    return;
  }
  const rows = run.data.results || [];
  let pass = 0;
  for (const r of rows) {
    if (r.ok) { pass += 1; ok(`[${label}] ${r.name}`, r.detail || undefined); }
    else bad(`[${label}] ${r.name}`, r.detail || undefined);
  }
  info(`[${label}] 桩机断言 ${pass}/${rows.length} 通过`);
}
