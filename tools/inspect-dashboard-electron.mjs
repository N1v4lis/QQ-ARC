import fs from 'node:fs';
import assert from 'node:assert/strict';
import {withElectronPage} from './cdp.mjs';
fs.mkdirSync('shots/dashboard-loading',{recursive:true});
await withElectronPage({cdpUrl:'http://127.0.0.1:9224'},async(page,logs)=>{
  await page.waitFor('qqaStartup.state().disposed && dashData?.stats && dashData?.st && dashData?.accounts && dashData?.chats',{timeout:30000});
  const report=await page.eval(`({animation:qqaStartup.state().duration,mode:qqaStartup.state().mode,requests:performance.getEntriesByType('resource').filter(r=>/\\/api\\/(dashboard\\/usage|usage\\/(stats|breakdown)|accounts|chats|status)/.test(r.name)).map(r=>({path:new URL(r.name).pathname,start:Math.round(r.startTime),ms:Math.round(r.duration)}))})`);
  assert.equal(report.animation,2000);assert.equal(report.mode,'cold');
  assert(report.requests.some(r=>r.path==='/api/dashboard/usage'));
  assert(!report.requests.some(r=>r.path==='/api/usage/breakdown'));
  assert.equal(logs.filter(s=>s.startsWith('[exception]')).length,0);
  fs.writeFileSync('shots/dashboard-loading/electron.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
