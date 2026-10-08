import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {patchStorageSources,patchedNames} from './patch-host-account-storage.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qqa-storage-runtime-')),src=path.join(dir,'src');fs.mkdirSync(src);fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({type:'module'}));
const host='E:/QQ Agent/resources/app/src';for(const e of fs.readdirSync(host))if(/\.(?:js|mjs|json)$/.test(e))fs.copyFileSync(path.join(host,e),path.join(src,e));
for(const name of patchedNames)fs.writeFileSync(path.join(src,name),patchStorageSources(name,fs.readFileSync(path.join(src,name),'utf8')));
for(const name of ['account-db-client.mjs','account-db-core.mjs','account-db-worker.mjs','account-storage-fs.mjs','account-db-legacy.mjs','account-storage-records.mjs'])fs.copyFileSync('app/server/'+name,path.join(src,name));{const file=path.join(src,'account-db-worker.mjs');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('catch(e){fatal=e;}','catch(e){fatal=e;}\nJSON.parse=JSON.stringify=()=>{throw Error(\"Unexpected JSON in storage worker\");};'));}
fs.symlinkSync(path.resolve('app/server/storage-runtime'),path.join(src,'storage-runtime'),'junction');
const data=path.join(dir,'data');process.env.QQ_AGENT_DATA_DIR=data;
const {ChatStore}=await import(pathToFileURL(path.join(src,'store.js')));const {MemoryStore}=await import(pathToFileURL(path.join(src,'memory.js')));const {SessionRegistry}=await import(pathToFileURL(path.join(src,'sessions.js')));const {closeDatabases}=await import(pathToFileURL(path.join(src,'account-db-client.mjs')));
const fixtures=['A','B'].map(account=>{const root=path.join(data,account);return {account,root,store:new ChatStore(0,{dataDir:root}),memory:new MemoryStore({dataDir:root}),sessions:new SessionRegistry(0,{dataDir:root})};});
const originalParse=JSON.parse,originalStringify=JSON.stringify;JSON.parse=JSON.stringify=()=>{throw Error('Unexpected JSON conversion in native storage');};
for(const {account,root,store,memory,sessions} of fixtures){
 const m=store.appendIncoming('group:42',{text:'account '+account,senderId:'7',senderName:'fixture'});assert.equal(store.unreadCount('group:42'),1);assert.equal(store.markEntryRead('group:42',m.id),true);assert.equal(store.recent('group:42')[0].text,'account '+account);
 memory.append('group:42','memberImpression','memory '+account,{userId:'7',target:'fixture'});assert.equal(memory.query('group:42').memberImpression[0].content,'memory '+account);
 const extra=store.appendIncoming('group:42',{mid:'recall',text:'recall me',senderId:'7'});store.updateByMid('group:42','recall',{text:'updated',appendMedia:[{url:'fixture://image'}]});assert.equal(new ChatStore(0,{dataDir:root}).findByMid('group:42','recall').media.length,1);store.markRecalled('group:42','recall');assert.equal(new ChatStore(0,{dataDir:root}).findByMid('group:42','recall').recalled,true);
 store.appendIncoming('group:42',{mid:'batch',text:'batch',ts:100,senderId:'7'});store.markAllRead('group:42');store.markUnreadInWindow('group:42',100,100);assert.ok(new ChatStore(0,{dataDir:root}).unreadCount('group:42')>0);store.drainUnreadFrom('group:42',100);assert.equal(new ChatStore(0,{dataDir:root}).unreadCount('group:42'),0);
 store.removeByLocalIds('group:42',[extra.id]);assert.equal(new ChatStore(0,{dataDir:root}).findByMid('group:42','recall'),null);store.clearChat('group:42');assert.equal(new ChatStore(0,{dataDir:root}).recent('group:42').length,0);
 store.setMaxPerChat(1);store.appendSelf('group:42',{text:'old'});store.appendSelf('group:42',{text:'new'});assert.equal(new ChatStore(0,{dataDir:root}).recent('group:42').length,1);
 const s=sessions.create({chatKey:'group:42',trigger:[],triggerSummary:'fixture'});assert.equal(sessions.get(s.id).chatKey,'group:42');sessions.finish(s.id,'completed');assert.equal(sessions.get(s.id).status,'completed');sessions.flushIndexCache();
}
const {UsageReader}=await import(pathToFileURL(path.join(src,'arcfox-usage-reader.mjs')));const {writeValue}=await import(pathToFileURL(path.join(src,'account-storage-records.mjs')));const {flushDatabases}=await import(pathToFileURL(path.join(src,'account-db-client.mjs')));
const fixture=path.join(data,'A/sessions/usage-fixture.json');writeValue(fixture,{id:'usage-fixture',startedAt:100,chatKey:'group:42',model:'fixture',messages:[{raw:{created:1,model:'fixture',usage:{prompt_tokens:120,completion_tokens:30,prompt_tokens_details:{cached_tokens:40}}}}]});flushDatabases();
const usage=new UsageReader();const parsed=await usage.read(path.dirname(fixture),['usage-fixture.json']);assert.equal(parsed.get('usage-fixture.json').rows[0].promptTokens,120);assert.equal(parsed.get('usage-fixture.json').rows[0].cachedTokens,40);await usage.close();
JSON.parse=originalParse;JSON.stringify=originalStringify;
// Compare exact accounting rules against the original physical-JSON parser.
const originalFile=fs.readdirSync(host).filter(n=>n.startsWith('arcfox-usage-parser.mjs.bak-sqlite-')).sort().find(n=>!fs.readFileSync(path.join(host,n),'utf8').includes('native SQL records v2'));
let originalSource=fs.readFileSync(path.join(host,originalFile||'arcfox-usage-parser.mjs'),'utf8').replace("from './account-storage-fs.mjs'", "from 'node:fs'");
const {parseUsageSessionFile:baselineParser}=await import('data:text/javascript;base64,'+Buffer.from(originalSource).toString('base64'));
const {parseUsageSessionFile:nativeParser}=await import(pathToFileURL(path.join(src,'arcfox-usage-parser.mjs')));
const baselineDir=path.join(dir,'legacy-usage-fixtures');fs.mkdirSync(baselineDir);
const cases=[
 {id:'fallback',startedAt:10,model:'fallback-model',vendor:'fixture',usage:{promptTokens:7,completionTokens:9,cachedTokens:3},messages:[{toolCall:{name:'web_search'}}],webSearchCount:2},
 {id:'missing-start',messages:[{raw:{created:123,usage:{prompt_tokens:'14',completion_tokens:2,prompt_tokens_details:{cached_tokens:5}}},toolCall:{name:'fetch_url'}},{toolCall:{name:'fetch_url'}}]},
 {id:'mixed',startedAt:99,model:'top-model',messages:[{raw:{model:'override',usage:{prompt_tokens:11}}},{raw:{usage:{completion_tokens:3}}},{content:'no usage'}],usage:{promptTokens:999}},
 {id:'empty',messages:[null,'plain',{raw:null}]}];
for(const value of cases){const filename=value.id+'.json';fs.writeFileSync(path.join(baselineDir,filename),JSON.stringify(value));writeValue(path.join(data,'A/sessions',filename),value);flushDatabases();const expected=baselineParser(baselineDir,filename),actual=nativeParser(path.join(data,'A/sessions'),filename);delete expected.mtime;delete actual.mtime;assert.deepEqual(actual,expected);}

await closeDatabases();
console.log('Real ChatStore/MemoryStore/SessionRegistry contracts passed in isolated accounts; no real account data or API requests.');
