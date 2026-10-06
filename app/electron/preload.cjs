// QQ Agent 渲染层 ↔ 主进程的桥。
//
// 2026-10-03 新 UI：窗口改成 frame:false（不使用 Windows 自带标题栏），
// 于是「最小化 / 最大化 / 关闭」这三个动作必须由页面里的自绘按钮发起 ——
// 主进程的 qqa-window / qqa-window-state 两个通道就是给它们用的。
//
// 原有能力（refocus / 验证码探测）一律**保持原样**：它们是移植过来的
// 逻辑层（ui/app/00-core.js、10-feedback.js）正在调用的接口，改名就是破坏兼容。
//
// 用 CommonJS：preload 在各 Electron 版本下都稳，不冒险用 ESM preload。
const { contextBridge, ipcRenderer } = require('electron');

const WINDOW_ACTIONS = new Set(['minimize', 'maximize', 'unmaximize', 'toggle-maximize', 'close']);

contextBridge.exposeInMainWorld('qqAgentShell', {
  // ── 原有 ──────────────────────────────────────────────────────────────
  // 焦点回收：给 ui/app/00-core.js 的对话框包装层调用。
  // 背景（electron/electron#41602「Confirm/Alert popups break focus」，Windows）：
  // Electron 把 alert/confirm/prompt 渲染成系统同步对话框，关闭后窗口不认领回键盘焦点。
  refocus: () => {
    try { ipcRenderer.send('app-refocus'); } catch { /* ignore */ }
  },
  // 主进程（Node 网络栈）连通性探测：与渲染层 fetch 结果对照。
  captchaNetProbe: () => ipcRenderer.invoke('qqa-captcha-net-probe'),
  // session 层阿里域重定向拦截器的注册状态（判断新代码是否真的在跑）。
  captchaInterceptorStatus: () => ipcRenderer.invoke('qqa-captcha-interceptor-status'),

  // ── 自绘标题栏（新增）──────────────────────────────────────────────────
  // controls.minimize() / .maximize() / .unmaximize() / ['toggle-maximize']() / .close()
  // close 走主进程的 close → 由 config.server.closeToTray 决定缩托盘还是退出，
  // 与旧版点原生关闭按钮的行为完全一致。
  controls: {
    minimize: () => { try { ipcRenderer.send('qqa-window', 'minimize'); } catch { /* ignore */ } },
    maximize: () => { try { ipcRenderer.send('qqa-window', 'maximize'); } catch { /* ignore */ } },
    unmaximize: () => { try { ipcRenderer.send('qqa-window', 'unmaximize'); } catch { /* ignore */ } },
    'toggle-maximize': () => { try { ipcRenderer.send('qqa-window', 'toggle-maximize'); } catch { /* ignore */ } },
    close: () => { try { ipcRenderer.send('qqa-window', 'close'); } catch { /* ignore */ } },
    // 通用入口：动作名不在白名单里直接忽略（不让渲染层拿到任意 IPC）
    send: (action) => {
      if (!WINDOW_ACTIONS.has(String(action))) return;
      try { ipcRenderer.send('qqa-window', String(action)); } catch { /* ignore */ }
    }
  },
  windowState: () => ipcRenderer.invoke('qqa-window-state'),  // 订阅窗口状态变化（最大化/还原/全屏）。返回取消订阅函数。
  onMaximizeChange: (fn) => {
    if (typeof fn !== 'function') return () => {};
    const handler = (_event, state) => {
      try { fn(!!(state && state.maximized), state || {}); } catch { /* 回调抛错不影响主进程 */ }
    };
    ipcRenderer.on('qqa-window-state', handler);
    return () => { try { ipcRenderer.removeListener('qqa-window-state', handler); } catch { /* ignore */ } };
  }
});
