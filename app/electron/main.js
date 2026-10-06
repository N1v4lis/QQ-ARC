// Electron 桌面壳：启动核心服务器（同一进程），打开会话式控制台窗口。
// 傻瓜式：托盘常驻、关窗不退出、可选开机自启。
import { app, BrowserWindow, Tray, Menu, nativeImage, session, shell, dialog, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dataDirName, describeInstance } from '../src/profile.js';


// ── 硬件加速（2026-10-04 重新决策）──────────────────────────────────────
// 旧版无条件 disableHardwareAcceleration()，理由是"部分显卡驱动会导致渲染进程黑屏"。
// 代价是整窗走软件合成：拖动窗口/滚动时肉眼可见地卡顿（用户反馈"拖动卡卡的"）。
//
// 现在的取舍：**默认开启硬件加速**（拖动流畅），并把旧行为保留为逃生开关 ——
//   QQ_AGENT_DISABLE_GPU=1 时退回软件渲染。
// 为什么可以这么改：黑屏是"部分驱动"的旧问题；一旦真的遇到，用户/支持者只要
// 设这个环境变量就能回到旧的稳妥状态，不必改代码。相比"所有人都卡"，
// 这个默认值更合理。
// ⚠️ app.disableHardwareAcceleration() 必须在 app ready 之前调用，这里位置正确。
if (process.env.QQ_AGENT_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  console.warn('[gpu] 已按 QQ_AGENT_DISABLE_GPU=1 关闭硬件加速（软件渲染，拖动可能卡顿）');
} else {
  console.log('[gpu] 硬件加速保持开启（如需关闭请设 QQ_AGENT_DISABLE_GPU=1）');
}

// 主进程兜底：未捕获异常不应静默吞掉。
// headless 入口（src/server.js）exit(1) 的理由在那里不成立 —— 那个有外层
// 守护重启。Electron 没有外层守护，进程挂掉后用户只能看到"托盘图标消失"。
// 折衷：拉起一个可见的错误对话框把异常亮给用户（至少知道为什么挂了），
// 确认后再退出 —— "半死不活地挂着"（定时器丢失/连接悬空但窗口还在）
// 是最难排查的状态，宁可死得明明白白。
process.on('unhandledRejection', (error) => {
  console.error('[未处理异常]', error);
});
process.on('uncaughtException', (error) => {
  console.error('[未捕获异常]', error);
  try {
    // dialog 在 app ready 前也允许调用（Electron 文档保证）。
    dialog.showErrorBox(
      'QQ Agent 发生未捕获错误',
      '程序遇到无法恢复的错误，即将退出。\n\n' +
      String(error?.stack ?? error?.message ?? error) +
      '\n\n完整日志见 data/logs/ 下的当日日志文件。'
    );
  } catch { /* 弹窗失败不拦截退出 */ }
  app.exit(1);
});

// AppUserModelID：让 Windows 把窗口归到「QQ Agent」身份下（任务栏分组/图标/通知），
// 否则 dev 模式下会被当成裸 electron.exe，钉任务栏变成 electron 图标
app.setAppUserModelId('cn.kondius.qq-agent');

// ── 验证码网络诊断（2026-09-26）──
// 渲染层（Chromium 栈）访问 alicdn/aliyuncs 失败但 kondius.cn 通、系统 curl 直连却正常。
// 主进程 Node 层（undici，独立于 Chromium 网络服务）做同款探测：
//   Node 通 + Chromium 挂 → 问题锁定在 Chromium 网络栈（本机安全软件/WFP 过滤按进程压制），
//   两层都挂 → 机器出口对这些域有整体问题。
let captchaInterceptorActive = false;
ipcMain.handle('qqa-captcha-net-probe', async () => {
  const targets = [
    ['node:o.alicdn.com', 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js'],
    ['node:aliyuncs验签', 'https://captcha.cn-shanghai.aliyuncs.com/'],
    ['node:aliyuncs-open', 'https://163stu.captcha-open.aliyuncs.com/'],
    ['node:kondius.cn', 'https://kondius.cn/api/community/health'],
  ];
  const out = [];
  for (const [name, url] of targets) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      out.push(`${name}:通(HTTP ${res.status},${Date.now() - t0}ms)`);
    } catch (e) {
      out.push(`${name}:失败(${String(e?.cause?.code || e?.message || e).slice(0, 60)},${Date.now() - t0}ms)`);
    }
  }
  return out.join(' ');
});
// 拦截器注册状态：渲染层报错时显示 —— 老进程（未重启）上它必然是"未注册"，
// 用来一眼区分"方案没生效"和"根本没跑到新代码"。
ipcMain.handle('qqa-captcha-interceptor-status', () =>
  captchaInterceptorActive ? '拦截器已注册' : '拦截器未注册（跑的是老进程，需托盘退出后重启）');

// ── 数据目录：始终固定在「应用根目录/data」──
// Kondius 钦定：所有数据都存在安装目录下，不往 %APPDATA% 塞。
//   压缩包用户：data 本来就在压缩包目录里，直接用（项目内 data/）；
//   安装版用户：安装目录/exe 旁边的 data/。选压缩包目录当安装目录时
//   天然接管里面的 data/（config、记忆、聊天记录、telemetry id 全保留），零迁移零 bug。
// NSIS 覆盖安装只替换它自己装的文件，运行时生成的 data/ 不在清单里 → 升级不丢数据。
// 兼容兜底：外置 %APPDATA% 时期（2026-09-06 短命版本）的数据自动搬回安装目录。
function resolveDataDir() {
  if (process.env.QQ_AGENT_DATA_DIR) return process.env.QQ_AGENT_DATA_DIR;
  // 开发模式（.bat 直起 node_modules 里的 electron.exe + 项目目录）：项目内 data/
  if (!app.isPackaged) return path.resolve(fileURLToPath(import.meta.url), '..', '..', dataDirName());
  const portable = path.join(path.dirname(app.getPath('exe')), dataDirName());
  try {
    if (!fs.existsSync(portable)) {
      // 仅主实例接管旧版遗留；第二实例绝不能把主实例旧数据复制进 data-2。
      if (dataDirName() !== 'data') return portable;
      // 接管旧版遗留：%APPDATA%/qq-agent/data（外置期版本）→ 搬回安装目录
      const legacy = path.join(app.getPath('userData'), 'data');
      if (fs.existsSync(legacy) && fs.readdirSync(legacy).length > 0) {
        fs.cpSync(legacy, portable, { recursive: true });
        console.log('[data] 已从 %APPDATA% 迁回安装目录:', legacy, '→', portable);
      }
    }
  } catch (error) {
    console.error('[data] 旧数据迁移失败（不影响启动，将从空数据开始）:', error?.message ?? error);
  }
  return portable;
}
process.env.QQ_AGENT_DATA_DIR = resolveDataDir();

// ── 前端目录默认值：在 __dirname 声明之后调用 ────────────────────────────
// 定义见下方（applyUiDirDefault）。这里只放调用点，并把"为什么不能在文件顶部调用"
// 记在这里：
//   ⚠️ 第一版把探测逻辑与调用都写在了文件顶部，而 __dirname 是在下面才声明的。
//   ESM 里 const 是 TDZ（不是 undefined 的提升），于是抛 ReferenceError，
//   Electron 在 whenReady 之前就静默退出 —— boot-diag.log 连"main.js 已加载"
//   都没写，taskkill 之后双击毫无反应，现象和"单实例锁没释放"一模一样。
//   启动期代码的声明顺序必须自己排，不能靠阅读顺序想当然。
// 真正的前端目录探测在 __dirname 声明之后立刻执行。


// ── Chromium userData 落位（2026-09-23 修复"双击打不开"）──
// 原先 Electron 的 userData 用默认的 %APPDATA%\qq-agent。Chromium 的单实例
// 锁（lockfile）与网络服务缓存都写在那里；一旦该目录不可写（安全软件拦截 /
// ACL 损坏 / 低完整性上下文），启动链会两条腿同时断：
//   1. process_singleton_win.cc: "Lock file can not be created! Error code: 5"
//      → requestSingleInstanceLock() 返回 false → app.quit() → 窗口从未出现；
//   2. network_sandbox.cc: "Failed to grant sandbox access" → 一串 0x5 拒绝访问。
// 修复：userData 一律放应用自己的 data/ 下（与业务数据同源、同备份路径），
// 不再依赖 %APPDATA% 的可写性。app.setPath 必须在 app ready 之前调用。
app.setPath('userData', path.join(process.env.QQ_AGENT_DATA_DIR, 'electron-user-data'));

// ── 启动诊断（2026-09-23）：逐阶段写 data/boot-diag.log，排查"双击后毫无反应" ──
// appendFileSync 同步落盘：进程秒退/被强杀时日志也不会丢。问题解决后可整体删除。
const BOOT_DIAG_FILE = path.join(process.env.QQ_AGENT_DATA_DIR, 'boot-diag.log');
function bootDiag(msg) {
  try { fs.appendFileSync(BOOT_DIAG_FILE, `${new Date().toISOString()} ${msg}\n`); } catch { /* ignore */ }
}
bootDiag('main.js 已加载');

// 单实例锁：重复启动（双击 .bat）不产生第二个实例，而是唤出已有窗口。
// 没有锁的话第二个实例会双份连 SnowLuma，群消息会被双重回复。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 2026-09-23 修复：拿不到锁直接静默退出，用户看到的就是"双击没反应"。
  // 两种情况要区分：
  //   a) 真有主实例在跑 → 静默退出是正确行为（second-instance 已唤出主窗口）；
  //   b) 锁文件/锁管道创建失败（目录不可写、安全软件拦截）→ 之前同样静默退出，
  //      用户完全无从得知。现在把原因弹出来 + 写进 boot-diag.log。
  bootDiag('单实例锁获取失败，准备退出（可能已有实例，也可能锁创建失败）');
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}
bootDiag('单实例锁已检查 gotLock=' + gotLock);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_PATH = path.resolve(__dirname, '..', 'assets', 'icon.png');

// ── 前端目录：默认用新 UI（ui-next），可一键切回老控制台（2026-10-03）──────
// 背景：控制台做了一次整站重构（自绘标题栏 + DSH 基底配色 + 时间轴详情），
// 新版落在 resources/app/ui-next/，老版 resources/app/ui/ 原封不动保留。
// src/app.js 里新加的 QQ_AGENT_UI_DIR 决定伺服哪一个。这里给出默认值：
//   · 只要 ui-next/index.html 存在就用新版（首次启动即生效，用户不用配环境变量）；
//   · 不存在（没装新版 / 装坏了 / 用户手动删了）就**自动回落**老控制台 ——
//     控制台打不开是致命故障，宁可回到旧界面也不能白屏。
//   · 显式设了 QQ_AGENT_UI_DIR 的以环境变量为准（方便 A/B 对照排查）。
// 想切回老控制台：删掉 ui-next 目录，或把环境变量指向 ui。
//
// ⚠️ 位置要求：必须在 __dirname 声明**之后**。第一版把它写在文件顶部（__dirname 之前），
//    ESM 的 TDZ 直接抛 ReferenceError → Electron 在 whenReady 前静默退出，
//    boot-diag.log 连"main.js 已加载"都没写，现象和"单实例锁没释放"一模一样。
function applyUiDirDefault() {
  if (process.env.QQ_AGENT_UI_DIR) {
    console.log(`[ui] 使用环境变量指定的前端目录：${process.env.QQ_AGENT_UI_DIR}`);
    return;
  }
  try {
    const appRoot = path.resolve(__dirname, '..');
    const next = path.join(appRoot, 'ui-next');
    if (fs.existsSync(path.join(next, 'index.html'))) {
      process.env.QQ_AGENT_UI_DIR = next;
      console.log(`[ui] 前端目录：新 UI（${next}）`);
      return;
    }
    console.log('[ui] 未发现 ui-next，回落到内置控制台 ui/');
  } catch (error) {
    console.error('[ui] 前端目录探测失败，回落到内置控制台：', error?.message ?? error);
  }
}
applyUiDirDefault();

let mainWindow = null;
// 焦点回收（2026-09-26）：原生 alert/confirm 关闭后窗口不认领回键盘焦点
// （electron/electron#41602 —— "弹过任意弹窗后所有输入框打不了字"）。
// 渲染层的 focus() 救不回来，可靠解是这里做 OS 级 BrowserWindow.focus()。
// 触发者：ui/app/00-core.js 的对话框包装层（经 preload 的 qqAgentShell.refocus）。
// 2026-10-03 重写外壳：窗口改成 frame:false 后，标题栏点击不再是"系统行为"，
//   最小化态的识别也换了 —— 之前 isMinimized() 在无边框窗口上恒为 false，
//   于是"最小化后弹对话框 → 窗口不回来"。现在按实际的三个状态分别处理。
ipcMain.on('app-refocus', () => {
  try {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
  } catch { /* 焦点回收失败不致命 */ }
});

// ── 自绘标题栏的窗口控制（2026-10-03）─────────────────────────────────────
// 需求：不使用 Windows 自带的任务栏（关闭/最小化按钮）。做法是 BrowserWindow
// frame:false —— 原生标题栏连同它的三个按钮一起消失，页面里那条 .q-titlebar
// 就是唯一的"标题栏"。代价是这三个动作要自己实现，就在下面。
//
// 关闭的语义保持原样：交给 mainWindow.close()，由既有的 'close' 监听器按
//   config.server.closeToTray 决定"缩到托盘"还是"真退出"。
// 不在这里直接 hide/quit —— 那会绕过用户配置，也会漏掉 before-quit 的清理链。
function windowState() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { maximized: false, fullScreen: false, visible: false, focused: false };
    }
    return {
      maximized: mainWindow.isMaximized(),
      fullScreen: mainWindow.isFullScreen(),
      visible: mainWindow.isVisible(),
      focused: mainWindow.isFocused()
    };
  } catch { return { maximized: false, fullScreen: false, visible: false, focused: false }; }
}

function pushWindowState() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('qqa-window-state', windowState());
  } catch { /* 窗口正在销毁时发不出去，正常 */ }
}

ipcMain.on('qqa-window', (event, action) => {
  const w = mainWindow;
  if (!w || w.isDestroyed()) return;
  try {
    switch (String(action)) {
      case 'minimize':
        w.minimize();
        break;
      case 'toggle-maximize':
        if (w.isMaximized()) w.unmaximize(); else w.maximize();
        break;
      case 'maximize':
        w.maximize();
        break;
      case 'unmaximize':
        w.unmaximize();
        break;
      case 'close':
        w.close();
        break;
      default:
        break;
    }
  } catch (error) {
    console.error('[window] 窗口控制失败:', action, error?.message ?? error);
  }
  pushWindowState();
});

ipcMain.handle('qqa-window-state', () => windowState());
let core = null;
let tray = null;
let quitting = false;

function applyAutoStart() {
  if (!core) return;
  const cfg = core.getConfig();
  app.setLoginItemSettings({ openAtLogin: !!cfg.server?.autoStart });
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow(core?.lastPort ?? 3210);
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(icon);
  tray.setToolTip(describeInstance());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: () => showWindow() },
    { label: '暂停 / 恢复', click: () => core?.orchestrator.setPaused(!core.orchestrator.paused) },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: !!core.getConfig().server?.autoStart,
      click: (item) => {
        core.updateConfig({ server: { autoStart: item.checked } });
        applyAutoStart();
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => showWindow());
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: describeInstance(),
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    icon: ICON_PATH,
    show: false,
    // ── 不使用 Windows 自带的任务栏（2026-10-03 需求）────────────────────
    // frame:false 去掉原生标题栏与右上角 关闭/最小化/最大化 三个按钮，
    //   页面里的 .q-titlebar 成为唯一的标题栏（拖动、双击最大化、三个按钮都自绘）。
    // 注意这里**没有**开 skipTaskbar：那是"不在任务栏显示应用按钮"，
    //   会让窗口消失后用户无从找回；用户要的是不要原生标题栏按钮，托盘图标照旧常驻。
    frame: false,
    // Windows 上无边框窗口默认带系统阴影与直角；圆角交给页面 CSS，
    // 这里关掉阴影避免最大化时四周出现一条桌面缝隙。
    hasShadow: false,
    // 无边框窗口三键自绘后，缩放的系统热区也要自己留（默认已含，显式写出便于以后审阅）
    thickFrame: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });
  Menu.setApplicationMenu(null);
  // F5 / Ctrl+R / Ctrl+Shift+R 刷新：应用菜单被移除后默认快捷键随之失效，
  // 用 before-input-event 手动接管（不恢复菜单条，外观不变）。
  // 开发改完 ui/ 下的前端文件后 F5 即可生效，不用重启整个程序。
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const isF5 = key === 'f5';
    const isCtrlR = (input.control || input.metaKey) && key === 'r';
    if (isF5 || isCtrlR) {
      event.preventDefault();
      mainWindow?.webContents.reloadIgnoringCache();
    }
  });
  // 窗口打开先显示 loading 壳，等页面真正加载完成再亮相，避免白屏和用户反复双击
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      pushWindowState();          // 自绘标题栏首次同步"是否最大化"
    }
  });
  // 自绘标题栏要跟着窗口状态变：最大化/还原按钮的图标、最大化时的圆角处理
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'show', 'focus', 'blur']) {
    mainWindow.on(ev, pushWindowState);
  }
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[window] 页面加载失败:', code, desc, url);
    setTimeout(() => mainWindow?.loadURL(`http://127.0.0.1:${port}/`).catch(() => {}), 2000);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[window] 渲染进程崩溃:', JSON.stringify(details));
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`).catch((error) => console.error('[window] loadURL 失败:', error));
  // 外部链接（金句墙/意见墙/上传成功提示里的网址等）一律交给系统默认浏览器，不在应用内弹新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // 主窗口只应停留在本机控制台。没有这道拦截时，页面里一个普通 <a href> 或
  // location.href=... 就能把主窗口导航到外部站点（脱离 127.0.0.1 源、
  // 控制台也不再指向本机）。外链改走系统浏览器。
  const isLocalConsole = (u) => /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\//.test(String(u || ''));
  const guardNavigation = (event, url) => {
    if (isLocalConsole(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(String(url || ''))) shell.openExternal(url);
  };
  mainWindow.webContents.on('will-navigate', guardNavigation);
  mainWindow.webContents.on('will-redirect', guardNavigation);
  // 关窗默认缩到托盘（真正退出走托盘菜单），符合"常驻机器人"的使用习惯
  mainWindow.on('close', (event) => {
    if (!quitting && core?.getConfig().server?.closeToTray !== false) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  bootDiag('whenReady 已触发');
  try {
    // 应用只访问本机回环地址：强制直连，防止系统代理（Clash/加速器等）劫持 127.0.0.1 导致白/黑屏
    await session.defaultSession.setProxy({ mode: 'direct' });
    // ── 验证码域重定向（2026-09-26）──
    // 部分用户机器上 Chromium 网络栈访问 *.alicdn.com / *.aliyuncs.com 被本机
    // 安全软件按进程+域名压制（同机 Node 层与系统 curl 均正常），而 kondius.cn 可达。
    // 在 session 层把这两族域的请求重定向到 kondius.cn 的白名单反代：
    //   /qq-agent/captcha-sdk/...  （SDK 主脚本）
    //   /qq-agent/captcha-api/...  （SDK 接口，nginx 按域名后缀转发到真实域）
    // webRequest 覆盖主文档/iframe/worker/XHR 的所有请求形态，比 Service Worker 可靠。
    // 只匹配这两族域名后缀（正则收尾锚定），其余请求一律放行。
    captchaInterceptorActive = true;
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      try {
        const m = /^https:\/\/([a-zA-Z0-9.-]+\.(?:aliyuncs|alicdn)\.com)(\/.*)$/.exec(details.url);
        if (m) {
          return callback({
            redirectURL: `https://kondius.cn/qq-agent/captcha-api/${m[1]}${m[2]}`
          });
        }
      } catch { /* 解析异常按放行处理 */ }
      callback({});
    });
    bootDiag('setProxy 完成');
    console.log('[window] 代理模式：direct（绕过系统代理）');
    const { createApp } = await import('../src/app.js');
    bootDiag('src/app.js 已导入');
    core = createApp({ log: (...args) => console.log(...args) });
    // 先启动服务拿到真实端口，再开窗口。
    // 原先是 createWindow(core.lastPort ?? 3210) 在前、core.start() 在后 ——
    // 此时 lastPort 尚未赋值，窗口恒按 3210 加载；若端口被占用顺延到 3211+，
    // 首屏必然加载失败，只能靠 did-fail-load 2 秒重试兜底。
    const port = await core.start();
    core.lastPort = port;
    bootDiag('核心已启动 port=' + port);
    await createWindow(port);
    applyAutoStart();
    createTray();
    bootDiag('窗口与托盘就绪');
  } catch (error) {
    console.error('[electron] 启动失败:', error);
    bootDiag('启动失败: ' + String(error?.stack ?? error));
    // 2026-09-23：启动失败必须可见。之前只 quit，用户看到的是"双击没反应"。
    try {
      dialog.showErrorBox(
        'QQ Agent 启动失败',
        '核心服务启动失败，程序即将退出。\n\n' +
        String(error?.stack ?? error?.message ?? error) +
        '\n\n详细日志见 data/logs/ 下的当日日志与 data/boot-diag.log。'
      );
    } catch { /* 弹窗失败不拦截退出 */ }
    app.exit(1);
  }
});

// 退出清理：core.stop() 是 async（要 abortAll / 关 SSE / 关 server / 释放单实例锁），
// 而 before-quit 是同步事件 —— 直接调它会让进程在 await 让出后就被销毁，
// 清理链跑一半：锁文件可能残留、会话最后一次进度可能丢、SnowLuma 子进程可能变孤儿。
// 正确做法：拦下这次退出，等 stop() 真正跑完再 app.quit()。
let shuttingDown = false;
app.on('before-quit', (event) => {
  quitting = true;
  if (shuttingDown || !core) return;      // 第二次进入（自己触发的 quit）直接放行
  event.preventDefault();
  shuttingDown = true;
  Promise.resolve()
    .then(() => core.stop())
    .catch((error) => console.error('[electron] 退出清理失败:', error?.message ?? error))
    .finally(() => app.quit());
});
