// 极简 CDP 客户端（Node 内置 WebSocket，无需 puppeteer/playwright 依赖）。
//
// 用途：
//   · 截图（Page.captureScreenshot）—— 新 UI 的视觉验收
//   · 在真实页面里跑断言（Runtime.evaluate）—— 「原有功能仍可用」的取证
//
// 用法（被其它脚本 import）：
//   import { withPage } from './cdp.mjs';
//   const r = await withPage({ url, width, height }, async (page) => { ... });
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];

export function findBrowser() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('找不到 Edge/Chrome 可执行文件');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 60, gap = 250) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch (e) { last = e; }
    await sleep(gap);
  }
  throw new Error(`CDP 端点不可用：${url}${last ? ` (${last.message})` : ''}`);
}

class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.listeners = new Set();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        this.events.push(msg);
        for (const fn of this.listeners) { try { fn(msg); } catch { /* ignore */ } }
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }
      }, 30_000);
    });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** 在页面里求值，返回值直接 JSON 化回来。 */
  async eval(expression, { awaitPromise = true } = {}) {
    let r;
    try {
      r = await this.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise, userGesture: true
      });
    } catch (e) {
      /**
       * ⚠️ 超时时**必须带上出错的表达式**。
       *    否则只看到"CDP 超时：Runtime.evaluate"，完全不知道是哪一句 ——
       *    我在排查某个套件尾部超时时就被这一点坑了很久（日志停在某条断言，真正的卡点却在它后面的某个 eval）：
       *    最后打印的日志停在某条断言，而真正的卡点其实在它后面的某个 eval。
       */
      const one = String(expression).replace(/\s+/g, ' ').slice(0, 160);
      throw new Error(`${e.message}  ← 出错的表达式：${one}`);
    }
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`页面内异常：${d.exception?.description || d.text}`);
    }
    return r.result?.value;
  }

  async screenshot(file, { fullPage = false } = {}) {
    const params = { format: 'png', captureBeyondViewport: !!fullPage };
    if (fullPage) {
      const m = await this.send('Page.getLayoutMetrics');
      const size = m.cssContentSize || m.contentSize;
      params.clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
    }
    const { data } = await this.send('Page.captureScreenshot', params);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  async click(selector, { index = 0 } = {}) {
    return this.eval(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els[${index}];
      if (!el) return { ok: false, reason: 'not-found', count: els.length };
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { ok: true, count: els.length, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 40) };
    })()`);
  }

  async waitFor(expression, { timeout = 8000, gap = 120, label = '' } = {}) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      try {
        last = await this.eval(`!!(${expression})`);
        if (last) return true;
      } catch (e) { last = e.message; }
      await sleep(gap);
    }
    throw new Error(`等待超时：${label || expression}（最后结果 ${JSON.stringify(last)}）`);
  }
}

/**
 * 起一个 headless 浏览器 + 一个页面，跑完回调后全部清理。
 * opts: { url, width=1440, height=900, profileDir, keepProfile=false, deviceScaleFactor=1, onConsole }
 *
 * ⚠️ 这里起的是**独立的 headless Edge**，它去加载目标 URL。
 *    所以对"QQ Agent 的 Electron 窗口"做断言时，量到的是 Edge 的渲染结果，
 *    而不是真实窗口 —— 两者在"data-shell / window.qqAgentShell / 窗口按钮"上必然不同
 *    （例如真实 Electron 里 data-shell=electron，Edge 里是 browser）。
 *    凡是要验证真实窗口的桥接与无边框行为，用 `--electron` 模式（见 withElectronPage）。
 */
export async function withPage(opts, fn) {
  const {
    url, width = 1440, height = 900, deviceScaleFactor = 1,
    profileDir = path.join(os.tmpdir(), `qqa-cdp-${process.pid}-${Date.now()}`),
    onConsole = null, extraArgs = []
  } = opts;

  // ⚠️ 调试端口不能与已有的 Chrome/Edge 撞车（撞了会连到别人的浏览器，
  //    表现是"fetch failed"或抓到的页面完全不对）。这里在 9333~9788 之间随机取一个，
  //    并显式排除最常见的 9222（很多工具默认占它）。
  //
  // ⚠️ 随机还不够（2026-10-04）：批量跑套件时偶发 "CDP 端点不可用：…/json/version (fetch failed)"，
  //    原因是随机到的端口刚好被上一条还没退干净的 Edge 占着（或系统在 TIME_WAIT），
  //    而 `--remote-debugging-port` 拿不到端口时浏览器进程会**直接退出**，
  //    于是我们再去 fetch 就必然失败。所以这里加重试：换端口 + 重启浏览器，
  //    最多 4 次。比让调用方重跑整个套件省事得多。
  const pickPort = () => 9333 + Math.floor(Math.random() * 456);
  const buildArgs = (p) => [
    '--headless=new',
    `--remote-debugging-port=${p}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${deviceScaleFactor}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--disable-features=Translate',
    '--hide-scrollbars=false',
    'about:blank',
    ...extraArgs
  ];

  let port = 0;
  let child = null;
  let version = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    port = pickPort();
    child = spawn(findBrowser(), buildArgs(port), { stdio: 'ignore', windowsHide: true });
    try {
      // fetchJson 内部自己有重试间隔；这里等它把端点拉起来
      version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      break;
    } catch (e) {
      lastErr = e;
      try { child.kill(); } catch { /* ignore */ }
      child = null;
      version = null;
    }
  }
  if (!version) throw new Error(`CDP 端点起不来（已重试 4 次）：${lastErr && lastErr.message}`);

  let ws = null;
  try {
    const wsUrl = version.webSocketDebuggerUrl;

    // 用 Target.createTarget 开页，比 /json/new 更可控（后者在新版 Chrome 需要 PUT）
    const browser = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      browser.addEventListener('open', resolve, { once: true });
      browser.addEventListener('error', reject, { once: true });
    });
    let bid = 0;
    const bsend = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++bid;
      const onMsg = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.id !== id) return;
        browser.removeEventListener('message', onMsg);
        if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
      };
      browser.addEventListener('message', onMsg);
      browser.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { browser.removeEventListener('message', onMsg); reject(new Error(`CDP 浏览器超时 ${method}`)); }, 20_000);
    });

    // 注意：createTarget 不接受 width/height（"Target position can only be set for new windows"），
    // 视口尺寸走 Emulation.setDeviceMetricsOverride。
    const { targetId } = await bsend('Target.createTarget', { url: 'about:blank' });
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const target = list.find((t) => t.id === targetId);
    if (!target?.webSocketDebuggerUrl) throw new Error('拿不到页面 target 的 ws 地址');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    const page = new Page(ws);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Log.enable').catch(() => {});
    // 允许调用方注入"每次导航前执行"的脚本（探针用；必须在 navigate 之前装）
    for (const src of (opts.initScripts || [])) {
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
    }
    await page.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor, mobile: false
    });
    // ⚠️ 无头浏览器默认 prefers-reduced-motion: reduce。
    // 00-tokens.css 里有一条「尊重减弱动态效果」的全局兜底（把动画/过渡压到 0.001ms），
    // 于是截图里所有动效都静止、所有过渡时长都是 0.001ms —— 校验"有没有动效"会全线误判。
    // 默认强制 no-preference，需要测 reduced 行为时用 opts.motion = 'reduce'。
    const motion = opts.motion === 'reduce' ? 'reduce' : 'no-preference';
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: motion }]
    });

    const consoleLines = [];
    page.on((msg) => {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
        const line = `[${msg.params.type}] ${text}`;
        consoleLines.push(line);
        if (onConsole) onConsole(line);
      } else if (msg.method === 'Log.entryAdded') {
        const e = msg.params.entry;
        const line = `[log:${e.level}] ${e.text}${e.url ? ` (${e.url})` : ''}`;
        consoleLines.push(line);
        if (onConsole) onConsole(line);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        const line = `[exception] ${d.exception?.description || d.text}`;
        consoleLines.push(line);
        if (onConsole) onConsole(line);
      }
    });

    await page.send('Page.navigate', { url });
    const result = await fn(page, consoleLines);
    return result;
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(150);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export { sleep };
