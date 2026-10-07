import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {UsageReader} from './host/arcfox-usage-reader.mjs';
import {parseUsageSessionFile} from './host/arcfox-usage-parser.mjs';
import {patchUsageResponsiveness} from './patch-host-usage-responsiveness.mjs';
const host='E:/QQ Agent/resources/app/src';
const current=fs.readFileSync(path.join(host,'app.js'),'utf8');
assert.equal(patchUsageResponsiveness(current),current);
const backup=fs.readdirSync(host).filter(f=>f.startsWith('app.js.bak-usage-responsive-')).sort().at(-1);
assert(backup,'Install patch before testing old/new accounting equivalence');
const before=fs.readFileSync(path.join(host,backup),'utf8');
const prices=await import(pathToFileURL(path.join(host,'model-prices.js')));
function costFunction(source,cfg){
  const start=source.indexOf('function priceOf(model, vendor');
  const end=source.indexOf('/** 按某个字段分组',start);
  assert(start>=0&&end>start);let reads=0;
  const ctx={Map,JSON,Number,Math,getConfig:()=>{reads++;return cfg;},resolveModelPrice:prices.resolveModelPrice,modelLabel:prices.modelLabel,isPeakHour:prices.isPeakHour,priceAt:prices.priceAt};
  vm.runInNewContext(source.slice(start,end)+';globalThis.calculate=costOfRows;',ctx);
  return {calculate:ctx.calculate,reads:()=>reads};
}
const rows=Array.from({length:12000},(_,i)=>({model:i%2?'example-a':'example-b',vendor:i%3?'channel-one':'channel-two',at:Date.UTC(2026,9,5,i%24),promptTokens:100+i%30,completionTokens:20,cachedTokens:i%4?15:200,exact:i%2===0}));
for(const api of [
  {priceInputPerM:2,priceOutputPerM:6,priceCachedPerM:0.2},
  {modelPrices:{'example-a':{in:3,out:7,cached:0.5,peak:{in:5,out:9,cached:1}},'channel-one：example-b':{in:4,out:8,cached:0.8}}},
  {useOfficialPrice:true}
]){
  const old=costFunction(before,{api}),fresh=costFunction(current,{api});
  const expected=old.calculate(rows),actual=fresh.calculate(rows);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)));
  assert.equal(old.reads(),rows.length+1);assert.equal(fresh.reads(),1);
}
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.join(repo,'shots/usage-worker');fs.mkdirSync(base,{recursive:true});
const dir=fs.mkdtempSync(path.join(base,'fixture-')),reader=new UsageReader();
try{
  const sessions=[
    {id:'exact',startedAt:1000,vendor:'channel',model:'fallback',webSearchCount:2,messages:[{toolCall:{name:'search'},raw:{model:'example-a',created:2,usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:10}}}}]},
    {id:'legacy',startedAt:2000,usage:{promptTokens:80,completionTokens:12,cachedTokens:4}},
    {id:'missing-start',messages:[{raw:{created:3,usage:{prompt_tokens:15,completion_tokens:2}}}]}
  ];
  sessions.forEach((s,i)=>fs.writeFileSync(path.join(dir,`${i}.json`),JSON.stringify(s)));
  fs.writeFileSync(path.join(dir,'bad.json'),'{broken');
  const files=['0.json','1.json','2.json','bad.json'];
  const first=reader.read(dir,files),same=reader.read(dir,files);assert.equal(first,same,'Concurrent archive requests must share one job');
  const archive=await first;
  for(const file of files)assert.deepEqual(JSON.parse(JSON.stringify(archive.get(file))),JSON.parse(JSON.stringify(parseUsageSessionFile(dir,file))));
  const updated={...sessions[1],usage:{promptTokens:900,completionTokens:80}};
  fs.writeFileSync(path.join(dir,'1.json'),JSON.stringify(updated));fs.utimesSync(path.join(dir,'1.json'),new Date(),new Date(Date.now()+1000));
  assert.equal((await reader.read(dir,files)).get('1.json').rows[0].promptTokens,900);
  const window=await reader.read(dir,files,Date.now()+500);assert.deepEqual([...window.keys()],['1.json']);
  const pending=reader.read(dir,files);const rejected=assert.rejects(pending,/stopped/);await reader.close();await rejected;
  await assert.rejects(reader.read(dir,files),/closed/);
  console.log('Usage accounting unchanged: 3 pricing modes × 12,000 rows; configuration reads reduced 12,001→1. Worker exact/legacy/missing timestamp/corrupt JSON, deduplication, modified-file invalidation, window filtering and shutdown passed.');
}finally{
  await reader.close();const resolved=path.resolve(dir);assert(resolved.startsWith(path.resolve(base)+path.sep));fs.rmSync(resolved,{recursive:true,force:true});
}
