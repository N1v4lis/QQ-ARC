// 与"浏览器模拟页面"区分开：这个工具做的是——把**当前页面所在的那个浏览器**
// 的用户代理解析出来，明确指出我们到底在测谁。
//
// 为什么需要它（本轮踩到的混淆）：
//   验证工具默认起一个 headless Edge 去加载 http://127.0.0.1:3210/。
//   量到的却是 Edge 的渲染结果：`data-shell=browser`、`window.qqAgentShell` 为 undefined。
//   于是"自绘窗口按钮没接上"看起来像 bug —— 其实真实 Electron 窗口里它们完全正常
//   （截图里那三个按钮就在右上角）。
//   结论：**测真实窗口必须测真实窗口**，别用另一个浏览器冒充。
//   本工具输出"被测目标是谁"，避免下次再把两者混为一谈。
//
// 真实窗口的验证方式（本轮采用）：
//   · 视觉：tools/shot-window.mjs 用 PrintWindow 抓真实窗口的 OS 层像素
//   · 桥接：主进程侧日志（renderer console 会被 main.js 转发到 stdout）
//
// 用法：node tools/which-target.mjs [url]
import { withPage, sleep } from './cdp.mjs';

const URL_ = process.argv[2] || 'http://127.0.0.1:3210/';

await withPage({ url: URL_, width: 1200, height: 800 }, async (page) => {
  await sleep(2500);
  const info = await page.eval(`(() => ({
    userAgent: navigator.userAgent,
    isElectron: navigator.userAgent.includes('Electron'),
    dataShell: document.documentElement.getAttribute('data-shell'),
    hasBridge: typeof window.qqAgentShell !== 'undefined',
    winCtl: !!document.getElementById('q-winctl'),
    outerW: outerWidth, innerW: innerWidth,
    outerH: outerHeight, innerH: innerHeight
  }))()`);

  console.log('被测目标：', info.isElectron ? 'Electron 渲染进程' : '普通浏览器（headless Edge/Chrome）');
  console.log(JSON.stringify(info, null, 1));
  console.log(
    info.isElectron
      ? '\n→ 可以据此判断桥接与无边框行为。'
      : '\n→ ⚠️ 这不是真实窗口。data-shell=browser / 无 qqAgentShell 都是**这个浏览器**的正常表现，'
      + '\n   不能用来断言 Electron 侧的行为；真实窗口请用 tools/shot-window.mjs 取证。'
  );
}).catch((e) => { console.error('FAIL', e); process.exit(1); });
