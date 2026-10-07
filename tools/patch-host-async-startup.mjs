// Keep the host's normal start() completion contract; expose HTTP readiness separately.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const host='E:/QQ Agent/resources/app';
export function patchAsyncStartup(source,kind){
  if(source.includes('// ARCFOX async startup v1'))return source;
  const newline=source.includes('\r\n')?'\r\n':'\n';
  let output=source.replaceAll('\r\n','\n');
  const edits=kind==='main'?[
    ['let core = null;',`// ARCFOX async startup v1
let coreStartupPromise = null;
const startupAbort = new AbortController();
let core = null;`],
    ['    const port = await core.start();\n    core.lastPort = port;\n    bootDiag(\'核心已启动 port=\' + port);\n    await createWindow(port);\n    applyAutoStart();\n    createTray();\n    bootDiag(\'窗口与托盘就绪\');',`    coreStartupPromise = core.start({
      signal: startupAbort.signal,
      onListening(port) {
        if (quitting) return;
        core.lastPort = port;
        bootDiag('HTTP就绪，创建窗口 port=' + port);
        createWindow(port);
        applyAutoStart();
        createTray();
        bootDiag('窗口与托盘就绪，核心后台初始化中');
      }
    });
    const port = await coreStartupPromise;
    bootDiag('核心已启动 port=' + port);`],
    ["mainWindow.once('ready-to-show', () => {","mainWindow.once('ready-to-show', () => {\n    bootDiag('窗口已显示');"],
    ["    console.error('[electron] 启动失败:', error);","    if (quitting && startupAbort.signal.aborted) return;\n    console.error('[electron] 启动失败:', error);"],
    ['    .then(() => core.stop())',`    .then(async () => {
      startupAbort.abort();
      // Finish/cancel initialization before cleanup so late tasks cannot revive timers or sockets.
      await coreStartupPromise?.catch(() => {});
      await core.stop();
    })`]
  ]:[
    ['  async function start() {',`  // ARCFOX async startup v1
  const startupState = { ready: false, plugins: 'pending', snowluma: 'pending' };
  let usageWarmupTimer = null;
  async function start({ onListening, signal } = {}) {
    const checkStartup = () => signal?.throwIfAborted();
    checkStartup();`],
    ["      const method = req.method;",`      const method = req.method;
      if (pathname === '/api/startup' && method === 'GET') return json(res, 200, startupState);
      if (!startupState.ready && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        res.setHeader('Retry-After', '1');
        return json(res, 503, { error: '核心正在初始化，请稍后重试', code: 'CORE_STARTING' });
      }`],
    ["    if (port == null) throw lastError ?? new Error('无法监听端口');",`    if (port == null) throw lastError ?? new Error('无法监听端口');
    checkStartup();
    onListening?.(port);
    await new Promise(resolve => setImmediate(resolve));
    checkStartup();`],
    ['    sessions.reconcileInBackground();','    // Session reconciliation is scheduled with the deferred warmup below.'],
    ["    collectUsageRows({ range: '7' }).catch(() => {});",'    // Usage warmup is deferred until after initialization and the startup animation.'],
    ["        const pluginResult = await reloadSkills({ reason: 'boot' });","        const pluginResult = await reloadSkills({ reason: 'boot' });\n        startupState.plugins = pluginResult.failed.length ? 'partial' : 'ready';"],
    ["        log('[skill] 加载失败:', error?.message ?? error);","        startupState.plugins = 'failed';\n        log('[skill] 加载失败:', error?.message ?? error);"],
    ["      if (!getConfig().snowluma?.autoLaunch) return;","      if (!getConfig().snowluma?.autoLaunch) { startupState.snowluma = 'disabled'; return; }\n      startupState.snowluma = 'starting';"],
    ["        if (!(await isPortOpen('127.0.0.1', webuiPort))) {","        if (!(await __isPortOpenRaw('127.0.0.1', webuiPort))) {\n          checkStartup();"],
    ["for (let i = 0; i < 20 && !(await isPortOpen('127.0.0.1', webuiPort)); i++) {","for (let i = 0; i < 20 && !(await __isPortOpenRaw('127.0.0.1', webuiPort)); i++) {\n              checkStartup();"],
    ["        log('[snowluma] 自动启动失败:', error?.message ?? error);","        startupState.snowluma = 'failed';\n        log('[snowluma] 自动启动失败:', error?.message ?? error);"],
    ['    await Promise.all([skillsReady, snowlumaReady]);',`    await Promise.all([skillsReady, snowlumaReady]);
    checkStartup();
    if (startupState.snowluma === 'starting') {
      startupState.snowluma = await __isPortOpenRaw('127.0.0.1', snowlumaWebuiPort()) ? 'ready' : 'waiting';
    }
    checkStartup();`],
    ['    return port;\n  }',`    startupState.ready = true;
    emit('status', { startupReady: true });
    usageWarmupTimer = setTimeout(() => {
      if (signal?.aborted) return;
      sessions.reconcileInBackground();
      collectUsageRows({ range: '7' }).catch(() => {});
    }, 30_000);
    usageWarmupTimer.unref?.();
    return port;
  }`],
    ['  async function stop() {',`  async function stop() {
    if (usageWarmupTimer) clearTimeout(usageWarmupTimer);
    startupState.ready = false;`],
    ['const USAGE_PARSE_CHUNK = 50;','const USAGE_PARSE_CHUNK = 8;']
  ];
  for(const [before,after] of edits){
    if(output.split(before).length!==2)throw Error('Async startup anchor changed: '+kind+' '+before.slice(0,100));
    output=output.replace(before,after);
  }
  return newline==='\r\n'?output.replaceAll('\n','\r\n'):output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  // Validate all anchors before writing either file. Keep exact originals for rollback.
  const changes=[['electron/main.js','main'],['src/app.js','app']].map(([relative,kind])=>{
    const target=path.join(host,relative),original=fs.readFileSync(target);
    return {target,original,updated:patchAsyncStartup(original.toString(),kind)};
  });
  const written=[];
  try{
    for(const change of changes){
      if(change.updated===change.original.toString())continue;
      fs.writeFileSync(change.target+'.bak-async-startup-'+Date.now(),change.original);
      written.push(change);
      fs.writeFileSync(change.target,change.updated);
    }
  }catch(error){for(const change of written)fs.writeFileSync(change.target,change.original);throw error;}
  console.log('Async startup patch installed; restart to activate.');
}
