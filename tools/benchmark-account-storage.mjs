import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {performance} from 'node:perf_hooks';import {spawnSync} from 'node:child_process';import {pathToFileURL,fileURLToPath} from 'node:url';
import {patchStorageSources} from './patch-host-account-storage.mjs';
const self=fileURLToPath(import.meta.url),project=path.resolve(path.dirname(self),'..');
function bytes(dir){if(!fs.existsSync(dir))return 0;let n=0;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);n+=e.isDirectory()?bytes(f):fs.statSync(f).size;}return n;}
function fixture(root){for(const name of ['messages','memory','sessions'])fs.mkdirSync(path.join(root,name),{recursive:true});
 for(let c=0;c<8;c++){const key=(c%2?'private:':'group:')+(100+c),messages=Array.from({length:1000},(_,i)=>({id:i+1,mid:String(i),ts:1700000000000+i,senderId:'7',senderName:'模拟用户',text:'用于比较存储性能的模拟消息，包含普通对话及少量工具记录。 '+i,self:false,read:true,reply:null,media:[],atNames:[]}));fs.writeFileSync(path.join(root,'messages',key.replace(':','_')+'.json'),JSON.stringify({chatKey:key,nextLocalId:1001,messages},null,1));}
 for(let i=0;i<120;i++){const rounds=Array.from({length:8},(_,r)=>({role:r%2?'assistant':'user',content:'模拟上下文与工具结果 '+String(i)+' '+String(r)+'，'.repeat(400)}));fs.writeFileSync(path.join(root,'sessions','s'+i+'.json'),JSON.stringify({id:'s'+i,chatKey:'group:100',status:'completed',rounds,usage:{promptTokens:1000,completionTokens:200,cachedTokens:500}},null,2));}
 for(let i=0;i<80;i++)fs.writeFileSync(path.join(root,'memory','m'+i+'.json'),JSON.stringify({impressions:Array.from({length:10},(_,j)=>({content:'模拟记忆条目 '+i+' '+j,ts:1700000000000}))},null,2));
}
if(process.argv.includes('--child')){
 const mode=process.argv[3],base=fs.mkdtempSync(path.join(os.tmpdir(),'qqa-benchmark-')),src=path.join(base,'src');fs.mkdirSync(src);fs.writeFileSync(path.join(base,'package.json'),'{"type":"module"}');
 const host='E:/QQ Agent/resources/app/src';for(const e of fs.readdirSync(host))if(/\.(js|mjs|json)$/.test(e))fs.copyFileSync(path.join(host,e),path.join(src,e));
 // Save a reproducible baseline copy before deployment changes the installed store.
 const baseline=path.join(project,'_scratch/storage-baseline-store.js');let storeSource=fs.readFileSync(fs.existsSync(baseline)?baseline:path.join(host,'store.js'),'utf8');
 if(mode==='sqlite'){storeSource=patchStorageSources('store.js',storeSource);for(const name of ['account-db-client.mjs','account-db-core.mjs','account-db-worker.mjs','account-storage-fs.mjs','account-db-legacy.mjs','account-storage-records.mjs'])fs.copyFileSync(path.join(project,'app/server',name),path.join(src,name));fs.symlinkSync(path.join(project,'app/server/storage-runtime'),path.join(src,'storage-runtime'),'junction');}
 fs.writeFileSync(path.join(src,'store.js'),storeSource);
 const roots=Array.from({length:3},(_,i)=>path.join(base,'data','account-'+i));for(const root of roots)fixture(root);const originalBytes=roots.reduce((n,r)=>n+bytes(r),0);process.env.QQ_AGENT_DATA_DIR=path.join(base,'data');
 const {ChatStore}=await import(pathToFileURL(path.join(src,'store.js')));let bridge;if(mode==='sqlite')bridge=await import(pathToFileURL(path.join(src,'account-db-client.mjs')));
 const start=performance.now(),stores=roots.map(root=>new ChatStore(0,{dataDir:root}));const initializationMs=performance.now()-start;
 const cold=performance.now();for(const store of stores)for(const key of store.listChats())store.unreadCount(key);const coldReadMs=performance.now()-cold;
 const page=performance.now();for(const root of roots)new ChatStore(0,{dataDir:root}).recent('group:100',{limit:80});const firstPageMs=performance.now()-page;
 const before=process.memoryUsage().rss,cpu=process.cpuUsage(),t=performance.now(),calls=[];let peakRss=before;
 for(let i=0;i<600;i++){const store=stores[i%3],key=(i%8%2?'private:':'group:')+(100+i%8),a=performance.now();const m=store.appendIncoming(key,{text:'新增模拟消息 '+i,senderId:'7',senderName:'模拟用户',ts:1700001000000+i});store.markEntryRead(key,m.id);calls.push(performance.now()-a);if(i%20===0)peakRss=Math.max(peakRss,process.memoryUsage().rss);}
 const enqueueMs=performance.now()-t;const f=performance.now();bridge?.flushDatabases();const flushMs=performance.now()-f,totalMs=performance.now()-t,used=process.cpuUsage(cpu);peakRss=Math.max(peakRss,process.memoryUsage().rss);
 // Reopening/verification forces worker acknowledgements and checks the durable tail.
 for(const store of stores)if(store.recent('group:100',{limit:1})[0].read!==true)throw Error('Tail mismatch');
 const liveBeforeCheckpoint=roots.reduce((n,r)=>n+fs.readdirSync(r).filter(f=>/^account-storage.sqlite/.test(f)).reduce((m,f)=>m+fs.statSync(path.join(r,f)).size,0),0);
 await bridge?.closeDatabases();
 const liveBytes=mode==='sqlite'?roots.reduce((n,r)=>n+fs.statSync(path.join(r,'account-storage.sqlite')).size,0):roots.reduce((n,r)=>n+bytes(r),0);
 const backupBytes=mode==='sqlite'?roots.reduce((n,r)=>n+fs.readdirSync(r).filter(f=>f.startsWith('storage-legacy-')).reduce((m,f)=>m+bytes(path.join(r,f)),0),0):0;
 calls.sort((a,b)=>a-b);
 console.log(JSON.stringify({mode,accounts:3,chats:24,seedMessages:24000,newMessages:600,originalBytes,initializationMs,coldReadMs,firstPageMs,enqueueMs,flushMs,totalMs,cpuMs:(used.user+used.system)/1000,rssLoadedMiB:before/1048576,peakRssMiB:peakRss/1048576,callP50Ms:calls[300],callP95Ms:calls[570],liveBeforeCheckpoint,liveBytes,backupBytes,node:process.version}));
}else{
 fs.mkdirSync(path.join(project,'_scratch'),{recursive:true});const baseline=path.join(project,'_scratch/storage-baseline-store.js');if(!fs.existsSync(baseline)){
  const host='E:/QQ Agent/resources/app/src';let source=fs.readFileSync(path.join(host,'store.js'),'utf8');
  if(source.includes('// ARCFØX account SQLite storage v1')){const backups=fs.readdirSync(host).filter(n=>n.startsWith('store.js.bak-sqlite-')).sort();const original=backups.map(n=>fs.readFileSync(path.join(host,n),'utf8')).find(s=>!s.includes('// ARCFØX account SQLite storage v1'));if(!original)throw Error('An unmodified JSON store baseline is required');source=original;}
  fs.writeFileSync(baseline,source);
 }
 const runs=[];for(let i=0;i<3;i++)for(const mode of ['json','sqlite']){const p=spawnSync(process.execPath,[self,'--child',mode],{cwd:project,encoding:'utf8',windowsHide:true,timeout:120000});if(p.status!==0)throw Error(p.stderr||p.stdout);const result=JSON.parse(p.stdout.trim().split(/\r?\n/).at(-1));runs.push(result);console.log(mode+' run '+(i+1)+': '+result.totalMs.toFixed(1)+' ms; RSS '+result.peakRssMiB.toFixed(1)+' MiB');}
 const median=a=>a.sort((x,y)=>x-y)[1];const summary={};for(const mode of ['json','sqlite']){const group=runs.filter(r=>r.mode===mode);summary[mode]=Object.fromEntries(Object.keys(group[0]).map(k=>[k,typeof group[0][k]==='number'?median(group.map(r=>r[k])):group[0][k]]));}
 fs.mkdirSync('docs/benchmarks',{recursive:true});fs.writeFileSync('docs/benchmarks/account-storage.json',JSON.stringify({date:'2026-10-09',fixture:'Synthetic only; 3 accounts, 24 chats, 24000 initial messages, 360 eight-round archives, 240 memory documents; 600 append + read-flag pairs',runtime:'System Node; not whole Electron application',runs,summary},null,2));console.log(JSON.stringify(summary,null,2));
}
