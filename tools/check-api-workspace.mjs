import assert from 'node:assert/strict';import {withPage} from './cdp.mjs';
await withPage({url:'http://127.0.0.1:3210/',width:1360,height:900,onConsole:s=>{if(s.startsWith('[error]')||s.startsWith('[exception]'))console.log(s.slice(0,250))},initScripts:[`const f=fetch;window.saved=[];window.fetch=(i,o)=>{if(typeof i==='string'&&i.includes('/api/config')&&o?.method==='POST'){window.saved.push(JSON.parse(o.body));return Promise.resolve(new Response(JSON.stringify({ok:true,config:state.config}),{headers:{'content-type':'application/json'}}));}return f(i,o)};`]},async p=>{
 await p.waitFor('!!state.config && !document.getElementById("loading-overlay")',{timeout:60000});
 for(const skin of ['default','minecraft']){
  console.log('检查皮肤：'+skin);
  await p.eval(`qqaSkin.apply('${skin}');openSettingsSection('api')`);await p.waitFor('!!document.querySelector(".api-workspace")');await new Promise(r=>setTimeout(r,350));
  assert.equal(await p.eval(`document.querySelectorAll('#settings-form .setcard,#settings-form .fold-head').length`),0);
  assert.equal(await p.eval(`!!document.querySelector('#card-api-bychat-moved')`),false);
  for(const id of ['cfg-provider','cfg-model','cfg-baseurl-value','fallback-model-rows','cfg-useofficialprice','cfg-price-in','cfg-price-out','cfg-price-cached','price-feed-refresh-btn','batch-price-btn'])assert.equal(await p.eval(`!!document.getElementById('${id}')`),true,id);
  await p.eval(`document.querySelectorAll('.model-modal-overlay').forEach(e=>e.remove())`);
  const n=await p.eval(`document.querySelectorAll('.fb-model-pick').length`);await p.eval(`document.querySelector('#add-fallback-row-btn').click()`);assert.equal(await p.eval(`document.querySelectorAll('.fb-model-pick').length`),n+1);
  await p.screenshot('shots/final/api-workspace-'+skin+'.png');
 }
 await p.eval(`openSettingsSection('chat')`);await p.waitFor('!!document.querySelector("#card-active-config")');await new Promise(r=>setTimeout(r,300));
 assert.equal(await p.eval(`getComputedStyle(document.querySelector('#card-active-config .sc-val')).display`),'none');
 await p.eval(`document.querySelector('#card-active-config .setcard-head').click()`);
 assert.equal(await p.eval(`getComputedStyle(document.querySelector('#card-active-config .ac-head-controls')).display`),'none');
 console.log('模型API两皮肤常显工作区、原字段/配置入口/备选新增保留，迁移说明删除，活跃摘要隐藏与收回控制区隐藏通过。');
});
