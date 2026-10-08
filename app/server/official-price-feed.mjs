import fs from 'node:fs';
import path from 'node:path';
import {VENDORS} from '../ui/vendor/model-vendors.js';
import {parseOfficialPage} from './official-price-parsers.mjs';

const DAY=86400000,MAX_PAGE=6000000;
export function createOfficialFeed({cacheFile,applyPrices,fetchImpl=fetch}) {
  let timer=null,inflight=null;
  const data={version:1,enabled:true,source:'builtin',ok:false,fetchedAt:0,sources:{},catalogue:[],fx:null};
  try{const saved=JSON.parse(fs.readFileSync(cacheFile,'utf8'));if(saved.version===1){Object.assign(data,saved,{source:'cache'});}}catch{}
  const status=()=>({...data,sources:structuredClone(data.sources),catalogue:structuredClone(data.catalogue),count:data.catalogue.length});
  const publish=()=>{
    const prices={};
    for(const r of data.catalogue){
      if(!r.autoApply||!Number.isFinite(r.in)||!Number.isFinite(r.out))continue;
      const factor=r.currency==='CNY'?1:data.fx?.cnyPerUsd;
      if(!Number.isFinite(factor))continue;
      prices[r.id]={...r,in:r.in*factor,out:r.out*factor,cached:r.cached==null?null:r.cached*factor,src:'official-live',note:`${r.currency}/百万 token${r.currency==='USD'?`，ECB ${data.fx.date} 汇率折算`:''}`,sourceUrl:r.sourceUrl};
    }
    applyPrices(prices);
  };
  async function get(url) {
    const res=await fetchImpl(url,{signal:AbortSignal.timeout(18000),headers:{'accept':'text/html,text/plain,application/xml','user-agent':'QQ-Agent-ARCFox/0.4.4.5 (public-pricing)'}});
    if(!res.ok)throw Error(`HTTP ${res.status}`);
    // Stream a bounded response; a malformed public endpoint cannot allocate unbounded memory.
    let bytes=0;const chunks=[];for await(const chunk of res.body){bytes+=chunk.length;if(bytes>MAX_PAGE)throw Error('页面过大');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');
  }
  async function mimoPage() {
    const html=await get(VENDORS.find(v=>v.id==='mimo').url);
    if(html.includes('<table'))return html;
    const main=html.match(/(?:src|href)="(\/static\/main\.[\w.]+\.js)"/)?.[1];if(!main)throw Error('MiMo 文档入口改变');
    const code=await get('https://mimo.mi.com'+main);
    const route=code.match(/path:"zh-CN\/price\/pay-as-you-go",importFn:[\s\S]{0,350}?key:/)?.[0];
    const ids=[...String(route).matchAll(/\.e\((\d+)\)/g)].map(m=>m[1]);
    // Runtime's chunk hashes are treated only as URL data; no downloaded JS executes.
    for(const id of ids.reverse()){
      const hash=html.match(new RegExp('\\b'+id+':"([a-f0-9]+)"'))?.[1];if(!hash)continue;
      const chunk=await get(`https://mimo.mi.com/static/${id}.${hash}.chunk.js`);
      const raw=chunk.match(/\bhtml:'((?:\\.|[^'])*)'/)?.[1];if(!raw)continue;
      return raw.replace(/\\(u[\da-fA-F]{4}|.)/g,(_,x)=>x[0]==='u'?String.fromCharCode(parseInt(x.slice(1),16)):({n:'\n',r:'\r',t:'\t'}[x]??x));
    }throw Error('MiMo 价格内容未找到');
  }
  async function refresh(force=true) {
    if(inflight)return inflight;
    inflight=(async()=>{
      data.fetchedAt=Date.now();
      // ECB reference rate, not an invented fixed exchange rate. Keep the last good rate offline.
      try{const xml=await get('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');const rate=c=>Number(xml.match(new RegExp("currency=['\"]"+c+"['\"]\\s+rate=['\"]([\\d.]+)"))?.[1]);const usd=rate('USD'),cny=rate('CNY');if(usd>0&&cny>0)data.fx={cnyPerUsd:cny/usd,date:xml.match(/time=['"]([^'"]+)/)?.[1],sourceUrl:'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'};}catch{}
      await Promise.allSettled(VENDORS.map(async v=>{
        const old=data.sources[v.id];if(!force&&old&&(old.ok?Date.now()-old.successAt<DAY:Date.now()-old.checkedAt<3*3600000))return;
        try{
          const body=v.id==='mimo'?await mimoPage():await get(v.url);
          const records=parseOfficialPage(v.id,body).map(r=>({...r,sourceUrl:v.url,fetchedAt:Date.now()}));
          data.catalogue=[...data.catalogue.filter(r=>r.vendor!==v.id),...records];
          data.sources[v.id]={name:v.name,url:v.url,ok:true,count:records.length,successAt:Date.now(),checkedAt:Date.now(),error:''};
        }catch(e){data.sources[v.id]={...old,name:v.name,url:v.url,ok:false,count:old?.count||0,checkedAt:Date.now(),error:String(e.message).slice(0,180)};}
      }));
      data.ok=Object.values(data.sources).some(s=>s.ok);data.source=data.ok?'remote':'cache';
      publish();try{fs.mkdirSync(path.dirname(cacheFile),{recursive:true});const tmp=cacheFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data));fs.renameSync(tmp,cacheFile);}catch{}
      return status();
    })().finally(()=>{inflight=null;});return inflight;
  }
  publish();
  function init(){if(timer)return;refresh(false).catch(()=>{});timer=setInterval(()=>{refresh(false).catch(()=>{});},3600000);timer.unref?.();}
  return {status,refresh,init,stop(){if(timer)clearInterval(timer);timer=null;}};
}
