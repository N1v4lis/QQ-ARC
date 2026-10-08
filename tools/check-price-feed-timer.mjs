import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createOfficialFeed} from '../app/server/official-price-feed.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qqa-feed-timer-'));
const si=globalThis.setInterval,ci=globalThis.clearInterval;let starts=0,stops=0;
globalThis.setInterval=()=>{starts++;return {unref(){}};};globalThis.clearInterval=()=>{stops++;};
const feed=createOfficialFeed({cacheFile:path.join(dir,'cache.json'),applyPrices(){},fetchImpl:async()=>new Response('',{status:503})});
try{feed.init();feed.init();assert.equal(starts,1);assert.equal(stops,0);feed.stop();assert.equal(stops,1);await feed.refresh();}
finally{globalThis.setInterval=si;globalThis.clearInterval=ci;if(fs.existsSync(path.join(dir,'cache.json')))fs.unlinkSync(path.join(dir,'cache.json'));fs.rmdirSync(dir);}
console.log('多次初始化官方价格服务保留唯一更新定时器；停用正确清理。');
