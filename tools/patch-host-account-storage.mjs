import {patchNativeRecords} from './native-records-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function patchV1(name,source){
 if(name==='arcfox-usage-reader.mjs')return source;
 if(source.includes('// ARCFØX account SQLite storage v1')){
  if(name==='app.js'){
   const nl=source.includes('\r\n')?'\r\n':'\n';const flush='    flushDatabases();'+nl+'    await closeDatabases();'+nl;
   if(source.includes(flush)&&source.indexOf(flush)<source.indexOf('    server.close();'))return source.replace(flush,'').replace('    server.close();','    server.close();'+nl+flush.trimEnd());
  }
  return source;
 }
 const nl=source.includes('\r\n')?'\r\n':'\n';let s=source.replaceAll('\r\n','\n');
 const edit=(before,after)=>{if(s.split(before).length!==2)throw Error('Storage anchor changed in '+name+': '+before.slice(0,65));s=s.replace(before,after);};
 edit("import fs from 'node:fs';","// ARCFØX account SQLite storage v1\nimport fs from './account-storage-fs.mjs';");
 if(name==='store.js'){
  s="import {databaseFor,saveChatState} from './account-db-client.mjs';\n"+s;
  edit("    this.maxPerChat = Math.max(0, Number(maxPerChat) || 0);","    databaseFor(path.dirname(this.messagesDir));\n    this.maxPerChat = Math.max(0, Number(maxPerChat) || 0);");
  const a=s.indexOf('function saveChat(dir, state) {'),b=s.indexOf('\nexport class ChatStore',a);if(a<0||b<0)throw Error('Chat persistence anchor changed');
  s=s.slice(0,a)+"function saveChat(dir, state, delta) { saveChatState(path.dirname(dir),state,delta); }\n"+s.slice(b);
  const appendAnchor='    this.#trim(st);\n    saveChat(this.messagesDir, st);';
  if(s.split(appendAnchor).length!==3)throw Error('Append anchors changed');
  s=s.replaceAll(appendAnchor,'    const removed=this.#trim(st);\n    saveChat(this.messagesDir, st,{upserts:[entry],removed});');
  s=s.replace('      st.messages.splice(0, st.messages.length - this.maxPerChat);','      return st.messages.splice(0, st.messages.length - this.maxPerChat).map(m=>m.id);');
  for(const name of ['markEntryRead','markRecalled','updateByMid']){
   const start=s.indexOf('  '+name+'('),end=s.indexOf('\n  }',start);
   const segment=s.slice(start,end).replace('saveChat(this.messagesDir, st);','saveChat(this.messagesDir, st,{upserts:[m]});');s=s.slice(0,start)+segment+s.slice(end);
  }
  const bulk={drainUnread:'{upserts:st.messages}',drainUnreadFrom:'{upserts:st.messages}',markAllRead:'{upserts:changed}',markUnreadInWindow:'{upserts:st.messages.filter(m=>!m.self&&!m.read&&m.ts>=winStart&&m.ts<=winEnd)}',removeByLocalIds:'{upserts:[],removed:[...ids]}',clearChat:'{upserts:[],removed:deletedIds}'};
  for(const [name,delta] of Object.entries(bulk)){
   const start=s.indexOf('  '+name+'('),end=s.indexOf('\n  }',start);let segment=s.slice(start,end);
   if(name==='markAllRead')segment=segment.replace('    let n = 0;','    const changed=st.messages.filter(m=>!m.read&&!m.self);\n    let n = 0;');
   if(name==='clearChat')segment=segment.replace('      st.messages = [];','      const deletedIds=st.messages.map(m=>m.id);\n      st.messages = [];');
   segment=segment.replace('saveChat(this.messagesDir, st);','saveChat(this.messagesDir, st,'+delta+');');s=s.slice(0,start)+segment+s.slice(end);
  }
  // Every production mutation supplies its exact delta; no full-history snapshot is needed.
 }
 if(name==='memory.js'){
  s="import {databaseFor} from './account-db-client.mjs';\n"+s;
  edit("    this.memoryDir = dataDir ? path.join(dataDir, 'memory') : MEMORY_DIR;","    this.memoryDir = dataDir ? path.join(dataDir, 'memory') : MEMORY_DIR;\n    databaseFor(path.dirname(this.memoryDir));");
 }
 if(name==='sessions.js'){
  s="import {databaseFor} from './account-db-client.mjs';\n"+s;
  edit("    this.sessionsDir = path.join(this.dataDir, 'sessions');","    databaseFor(this.dataDir);\n    this.sessionsDir = path.join(this.dataDir, 'sessions');");
  // Always use the owning instance, even outside AsyncLocalStorage event context.
  s=s.replaceAll('sessionFile(id)', 'sessionFile(id, this.sessionsDir)').replaceAll('sessionFile(s.id)', 'sessionFile(s.id, this.sessionsDir)');
 }
 if(name==='app.js'){
  s="import {closeDatabases,flushDatabases} from './account-db-client.mjs';\n"+s;
  edit('    await orchestrator.abortAll();','    onebot.close();\n    for(const rt of accountRuntimes.values()){rt.onebot.close();rt.orchestrator?.stopReminderLoop();}\n    await orchestrator.abortAll();');
  edit('    sessions.flushIndexCache();','    sessions.flushIndexCache();\n    for(const rt of accountRuntimes.values()){await rt.orchestrator?.abortAll();rt.sessions?.flushIndexCache();}');
  edit('    server.close();','    server.close();\n    flushDatabases();\n    await closeDatabases();');
 }
 if(name==='routes.js'){
  s="import {closeDatabases,flushDatabases} from './account-db-client.mjs';\n"+s;
  edit('            fs.cpSync(resolved, backupDir, { recursive: true, force: true });','            flushDatabases();\n            fs.cpSync(resolved, backupDir, { recursive: true, force: true });');
  edit('          for (const name of fs.readdirSync(resolved)) {','          await closeDatabases();\n          for (const name of fs.readdirSync(resolved)) {');
 }
 return nl==='\r\n'?s.replaceAll('\n','\r\n'):s;
}
export function patchStorageSources(name,source){return patchNativeRecords(name,patchV1(name,source));}
export const patchedNames=['store.js','memory.js','sessions.js','app.js','routes.js','arcfox-usage-worker.mjs','arcfox-usage-parser.mjs','telemetry.js','arcfox-usage-reader.mjs'];
export function prepareHost(root){
 const src=path.join(root,'src');const writes=patchedNames.map(name=>{const file=path.join(src,name);return {file,source:fs.readFileSync(file,'utf8'),name};});
 for(const w of writes)w.next=patchStorageSources(w.name,w.source);
 const stamp=Date.now();for(const w of writes)if(w.next!==w.source)fs.writeFileSync(w.file+'.bak-sqlite-'+stamp,w.source);
 const source=path.join(project,'app/server');
 for(const name of ['account-db-core.mjs','account-db-client.mjs','account-db-worker.mjs','account-storage-fs.mjs','account-db-legacy.mjs','account-storage-records.mjs'])fs.copyFileSync(path.join(source,name),path.join(src,name));
 const runtime=path.join(src,'storage-runtime');fs.mkdirSync(path.join(runtime,'native'),{recursive:true});
 for(const name of ['package.json','package-lock.json'])fs.copyFileSync(path.join(source,'storage-runtime',name),path.join(runtime,name));
 fs.cpSync(path.join(source,'storage-runtime/node_modules'),path.join(runtime,'node_modules'),{recursive:true});
 const nativeSource=path.join(source,'storage-runtime/native/electron-130.node'),nativeTarget=path.join(runtime,'native/electron-130.node');
 if(!fs.existsSync(nativeTarget)||!fs.readFileSync(nativeSource).equals(fs.readFileSync(nativeTarget)))fs.copyFileSync(nativeSource,nativeTarget);
 for(const w of writes)fs.writeFileSync(w.file,w.next);
 console.log('Account SQLite worker storage installed; legacy migration is transactional on first open.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv.includes('--apply'))throw Error('Use --apply to install after tests');prepareHost('E:/QQ Agent/resources/app');
}
