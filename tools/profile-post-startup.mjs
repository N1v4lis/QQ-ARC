import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host='E:/QQ Agent/resources/app';
const report=path.join(repo,'shots/post-startup/profile.jsonl');
fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,'');
const originals=new Map();
function edit(rel,changes){const file=path.join(host,rel),original=fs.readFileSync(file);originals.set(file,original);let s=original.toString().replaceAll('\r\n','\n');for(const [before,after]of changes){if(s.split(before).length!==2)throw Error('Stall probe anchor changed: '+before.slice(0,70));s=s.replace(before,after);}fs.writeFileSync(file,original.toString().includes('\r\n')?s.replaceAll('\n','\r\n'):s);}
let ws;
try{
  edit('electron/main.js',[
    ["import { dataDirName, describeInstance } from '../src/profile.js';",`import { dataDirName, describeInstance } from '../src/profile.js';
globalThis.__qqaStall=(event,extra={})=>{try{fs.appendFileSync(${JSON.stringify(report)},JSON.stringify({at:Date.now(),event,...extra})+'\\n');}catch{}};
globalThis.__qqaStall('entry');let __beat=performance.now();setInterval(()=>{const now=performance.now(),lag=now-__beat-100;__beat=now;if(lag>40)globalThis.__qqaStall('main-lag',{ms:Math.round(lag)});},100).unref();`],
    ["bootDiag('窗口已显示');","bootDiag('窗口已显示');globalThis.__qqaStall('window-show');"]
  ]);
  edit('src/app.js',[
    ['  async function start({ onListening, signal } = {}) {',`  async function start({ onListening, signal } = {}) {
    server.on('request',(req,res)=>{const begin=performance.now();const raw=String(req.url).split('?')[0];const route=['/api/usage/stats','/api/usage/breakdown','/api/status','/api/startup'].includes(raw)?raw:'other';res.once('finish',()=>{const ms=performance.now()-begin;if(ms>100||route.startsWith('/api/usage/'))globalThis.__qqaStall?.('request',{route,ms:Math.round(ms),code:res.statusCode});});});`],
    ["      collectUsageRows({ range: '7' }).catch(() => {});","      globalThis.__qqaStall?.('warmup-start');collectUsageRows({ range: '7' }).then(()=>globalThis.__qqaStall?.('warmup-done')).catch(() => {});"],
    ['async function refreshUsageArchive(dir, files, sig) {',"async function refreshUsageArchive(dir, files, sig) {\n  globalThis.__qqaStall?.('archive-request',{files:files.length});"],
    ['  usageArchive.sessions = next;',"  globalThis.__qqaStall?.('archive-complete',{files:files.length});\n  usageArchive.sessions = next;"]
  ]);
  const restart=promisify(execFile)(process.execPath,[path.join(repo,'tools/restart-agent.mjs'),'--apply','--cdp-port','9227'],{cwd:repo,windowsHide:true,timeout:90000,maxBuffer:1024*1024});
  // Attach while the restart helper is still verifying, not after a fixed UI wait.
  let target;const deadline=Date.now()+45000;
  while(Date.now()<deadline){try{if(fs.readFileSync(report,'utf8').includes('"event":"entry"')){const tabs=await(await fetch('http://127.0.0.1:9227/json/list')).json();target=tabs.find(t=>t.type==='page'&&t.url.startsWith('http://127.0.0.1:'));if(target)break;}}catch{}await new Promise(r=>setTimeout(r,200));}
  if(!target)throw Error('Electron debugging page unavailable');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let seq=0;const pending=new Map();
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timed out'));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  const observer=`globalThis.__stallObserver?.disconnect();globalThis.__stallTasks=[];globalThis.__stallObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())__stallTasks.push({start:Math.round(e.startTime),ms:Math.round(e.duration)});});__stallObserver.observe({type:'longtask',buffered:true});`;
  await send('Page.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:observer});
  await send('Runtime.evaluate',{expression:observer});
  await restart;
  const entry=fs.readFileSync(report,'utf8').trim().split('\n').map(JSON.parse).find(e=>e.event==='entry').at;
  while(Date.now()-entry<45000)await new Promise(r=>setTimeout(r,500));
  const result=await send('Runtime.evaluate',{expression:'JSON.stringify({tasks:globalThis.__stallTasks||[],animation:window.qqaStartup?.state()})',returnByValue:true});
  if(typeof result.result?.value!=='string')throw Error('Renderer profiling context unavailable');
  const data=JSON.parse(result.result.value);delete data.animation?.geometry;
  data.tasks=[...new Map(data.tasks.map(t=>[t.start+':'+t.ms,t])).values()];
  // Only durations and simple lifecycle fields, never DOM, account or session content.
  fs.appendFileSync(report,JSON.stringify({at:Date.now(),event:'renderer',tasks:data.tasks,animation:{disposed:data.animation?.disposed,duration:data.animation?.duration}})+'\n');
  const events=fs.readFileSync(report,'utf8').trim().split('\n').map(JSON.parse);
  console.log(JSON.stringify({events:events.map(e=>({...e,at:undefined,elapsed:e.at-entry})),maxMainLag:Math.max(0,...events.filter(e=>e.event==='main-lag').map(e=>e.ms)),rendererTasks:data.tasks},null,2));
}finally{
  ws?.close();for(const [file,original]of originals){fs.writeFileSync(file,original);if(!fs.readFileSync(file).equals(original))throw Error('Stall probe restore failed');}
  console.log('Temporary stall probes restored.');
}
