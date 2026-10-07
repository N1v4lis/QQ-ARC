// One controlled host restart; temporary probes are restored byte-for-byte in finally.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host='E:/QQ Agent/resources/app';
const noPrewarm=process.argv.includes('--no-prewarm');
const report=path.join(repo,'shots/cold-startup',noPrewarm?'profile-no-prewarm.jsonl':'profile.jsonl');
fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,'');
const originals=new Map();
const asyncStartup=fs.readFileSync(path.join(host,'electron/main.js'),'utf8').includes('// ARCFOX async startup v1');
const snowProbe=asyncStartup?'__isPortOpenRaw':'isPortOpen';
const parallelPlugins=fs.readFileSync(path.join(host,'src/plugin-loader.js'),'utf8').includes('// ARCFOX ordered parallel imports v1');
function edit(relative,changes){const target=path.join(host,relative),original=fs.readFileSync(target);originals.set(target,original);let source=original.toString().replaceAll('\r\n','\n');for(const [before,after] of changes){if(source.split(before).length!==2)throw Error('Startup probe anchor changed: '+relative+' '+before.slice(0,70));source=source.replace(before,after);}fs.writeFileSync(target,original.toString().includes('\r\n')?source.replaceAll('\n','\r\n'):source);}
try{
  edit('electron/main.js',[
    ["import { dataDirName, describeInstance } from '../src/profile.js';",`import { dataDirName, describeInstance } from '../src/profile.js';\nglobalThis.__qqaBootProfile=(event,extra={})=>{try{fs.appendFileSync(${JSON.stringify(report)},JSON.stringify({at:Date.now(),event,...extra})+'\\n');}catch{}};\nglobalThis.__qqaBootProfile('main-entry');`],
    ["bootDiag('whenReady 已触发');","bootDiag('whenReady 已触发');globalThis.__qqaBootProfile('electron-ready');"],
    ["bootDiag('src/app.js 已导入');","bootDiag('src/app.js 已导入');globalThis.__qqaBootProfile('core-imported');"],
    ['core = createApp({ log: (...args) => console.log(...args) });',"globalThis.__qqaBootProfile('create-app-start');core = createApp({ log: (...args) => console.log(...args) });globalThis.__qqaBootProfile('create-app-done');"],
    ...(asyncStartup?[
      ['coreStartupPromise = core.start({',"globalThis.__qqaBootProfile('core-start');coreStartupPromise = core.start({"],
      ['const port = await coreStartupPromise;',"const port = await coreStartupPromise;globalThis.__qqaBootProfile('core-ready');"]
    ]:[['const port = await core.start();',"globalThis.__qqaBootProfile('core-start');const port = await core.start();globalThis.__qqaBootProfile('core-ready');"]]),
    ['function createWindow(port) {',"function createWindow(port) {globalThis.__qqaBootProfile('window-create');"],
    ["mainWindow.once('ready-to-show', () => {","mainWindow.once('ready-to-show', () => {globalThis.__qqaBootProfile('window-show');"],
    ["mainWindow.webContents.on('did-finish-load', () => {","mainWindow.webContents.on('did-finish-load', () => {globalThis.__qqaBootProfile('page-loaded');"]
  ]);
  edit('src/app.js',[
    ['    if (port == null) throw lastError',"    globalThis.__qqaBootProfile?.('http-listening',{port});\n    if (port == null) throw lastError"],
    ["    collectUsageRows({ range: '7' }).catch(() => {});",noPrewarm?"    globalThis.__qqaBootProfile?.('usage-prewarm-skipped');":"    globalThis.__qqaBootProfile?.('usage-prewarm-start');collectUsageRows({ range: '7' }).then(()=>globalThis.__qqaBootProfile?.('usage-prewarm-done')).catch(() => {});"],
    ["const pluginResult = await reloadSkills({ reason: 'boot' });","globalThis.__qqaBootProfile?.('plugins-start');const pluginResult = await reloadSkills({ reason: 'boot' });globalThis.__qqaBootProfile?.('plugins-done',{count:pluginResult.loaded.length});"],
    ["const snowlumaReady = (async () => {","const snowlumaReady = (async () => {globalThis.__qqaBootProfile?.('snowluma-start');"],
    [`        if (!(await ${snowProbe}('127.0.0.1', webuiPort))) {`,`        const snowProbeStart=Date.now(),snowAlreadyUp=await ${snowProbe}('127.0.0.1', webuiPort);globalThis.__qqaBootProfile?.('snowluma-first-probe',{running:snowAlreadyUp,ms:Date.now()-snowProbeStart});\n        if (!snowAlreadyUp) {`],
    ['await Promise.all([skillsReady, snowlumaReady]);',"await Promise.all([skillsReady, snowlumaReady.then(()=>globalThis.__qqaBootProfile?.('snowluma-done'))]);globalThis.__qqaBootProfile?.('prerequisites-ready');"],
    ['    if (syncSnowlumaTokens()) {',"    globalThis.__qqaBootProfile?.('token-sync-start');\n    if (syncSnowlumaTokens()) {"],
    ['    await onebot.connect();',"    globalThis.__qqaBootProfile?.('token-sync-done');await onebot.connect();globalThis.__qqaBootProfile?.('onebot-connect-scheduled');"]
  ]);
  edit('src/plugin-loader.js',[
    parallelPlugins?
      ['    mod = prepared?.mod ?? await import(`${entryUrl}?t=${Date.now()}`);',"    const phaseStart=performance.now();mod = prepared?.mod ?? await import(`${entryUrl}?t=${Date.now()}`);if(!prepared?.mod)globalThis.__qqaBootProfile?.('plugin-import',{name:path.basename(dir),ms:performance.now()-phaseStart});"]:
      ['    mod = await import(`${entryUrl}?t=${Date.now()}`);',"    const phaseStart=performance.now();mod = await import(`${entryUrl}?t=${Date.now()}`);globalThis.__qqaBootProfile?.('plugin-import',{name:path.basename(dir),ms:performance.now()-phaseStart});"],
    ['    if (setupFn) await setupFn(apiWithCollect);',"    const phaseStart=performance.now();if (setupFn) await setupFn(apiWithCollect);globalThis.__qqaBootProfile?.('plugin-setup',{name:path.basename(dir),ms:performance.now()-phaseStart});"],
    parallelPlugins?
      ['(dir, prepared) => loadSkillDir(dir, { log, kind, prepared })',"async (dir, prepared) => {const profileStart=performance.now();const result=await loadSkillDir(dir, {log,kind,prepared});globalThis.__qqaBootProfile?.('plugin-load',{name:path.basename(dir),ms:Math.round(performance.now()-profileStart)});return result;}"]:
      ['results.push(await loadSkillDir(dir, { log, kind }));',"const profileStart=performance.now();results.push(await loadSkillDir(dir, { log, kind }));globalThis.__qqaBootProfile?.('plugin-load',{name:path.basename(dir),ms:Math.round(performance.now()-profileStart)});"]
  ]);
  if(parallelPlugins)edit('src/arcfox-plugin-imports.mjs',[
    ['    const mod=await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}-${++generation}`);',"    const phaseStart=performance.now();const mod=await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}-${++generation}`);globalThis.__qqaBootProfile?.('plugin-import',{name:path.basename(dir),ms:performance.now()-phaseStart});"]
  ]);
  const {stdout}=await promisify(execFile)(process.execPath,[path.join(repo,'tools/restart-agent.mjs'),'--apply'],{cwd:repo,windowsHide:true,timeout:90000,maxBuffer:1024*1024});console.log(stdout);
  const deadline=Date.now()+30000;
  while(Date.now()<deadline&&(!fs.readFileSync(report,'utf8').includes('window-show')||!fs.readFileSync(report,'utf8').includes('core-ready')))await new Promise(r=>setTimeout(r,200));
  const events=fs.readFileSync(report,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)),origin=events.find(e=>e.event==='main-entry')?.at;
  console.log(JSON.stringify(events.map(e=>({...e,elapsed:e.at-origin,at:undefined})),null,2));
}finally{for(const [target,original]of originals){fs.writeFileSync(target,original);if(!fs.readFileSync(target).equals(original))throw Error('Could not restore '+target);}console.log('Host probe source restored byte-for-byte.');}
