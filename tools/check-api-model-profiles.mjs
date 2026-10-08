import assert from 'node:assert/strict';import {withPage} from './cdp.mjs';
await withPage({url:'http://127.0.0.1:3210/',width:1360,height:860,initScripts:[`const f=fetch;window.saved=[];window.fixtureConfig=null;window.fetch=async(i,o)=>{if(String(i)==='/api/config'){if(o?.method==='POST'){const patch=JSON.parse(o.body);saved.push(patch);fixtureConfig={...fixtureConfig,api:{...fixtureConfig.api,...patch.api}};return new Response(JSON.stringify({ok:true,config:fixtureConfig}),{headers:{'content-type':'application/json'}});}if(fixtureConfig)return new Response(JSON.stringify(fixtureConfig),{headers:{'content-type':'application/json'}});const r=await f(i,o);fixtureConfig=await r.clone().json();return r;}if(o?.method&&o.method!=='GET')return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json'}});return f(i,o)};`]},async p=>{
 await p.waitFor('!!state.config&&!document.getElementById("loading-overlay")',{timeout:60000});
 for(const skin of ['default','minecraft']){
  await p.eval(`qqaSkin.apply('${skin}');openSettingsSection('api')`);await p.waitFor('document.querySelectorAll("#mc-model-pick option").length>2');
  assert.equal(await p.eval(`!!document.querySelector('#mc-cancel')`),false);
  assert.equal(await p.eval(`document.querySelector('.api-inline-config h4').textContent`),'模型配置');
  const choices=await p.eval(`[...document.querySelectorAll('#mc-model-pick option')].filter(x=>x.value).map(x=>x.value)`);assert.ok(choices.length>1);
  const a=choices[0],b=choices.find(v=>v!==a),keyA=JSON.stringify(a.split('|||')),keyB=JSON.stringify(b.split('|||'));
  const choose=async value=>p.eval(`(()=>{const e=document.querySelector('#mc-model-pick');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change'));})()`);
  await choose(a);
  await p.eval(`document.querySelector('#mc-vision').checked=false;document.querySelector('#mc-video').checked=true;document.querySelector('#mc-video-mode').value='native';document.querySelector('#mc-vision-model-pick').dataset.model=${JSON.stringify(a.split('|||')[1])};document.querySelector('#mc-vision-model-pick').value='fixture media model'`);
  await choose(b);assert.equal(await p.eval(`document.querySelector('#mc-vision-model-pick').value`),'');
  await p.eval(`document.querySelector('#mc-vision').checked=true;document.querySelector('#mc-video').checked=false;document.querySelector('#mc-video-mode').value='frames'`);
  await choose(a);assert.equal(await p.eval(`document.querySelector('#mc-vision').checked`),false);assert.equal(await p.eval(`document.querySelector('#mc-video').checked`),true);assert.equal(await p.eval(`document.querySelector('#mc-video-mode').value`),'native');
  await p.eval(`document.querySelector('#mc-save').click()`);await p.waitFor(`state.config.api?.modelMediaProfiles?.[${JSON.stringify(keyB)}]?.videoMode==='frames'`);
  assert.equal(await p.eval(`state.config.api.modelMediaProfiles[${JSON.stringify(keyA)}].vision`),false);
  await p.eval(`loadSettings()`);await choose(b);assert.equal(await p.eval(`document.querySelector('#mc-video-mode').value`),'frames');await choose(a);assert.equal(await p.eval(`document.querySelector('#mc-video-mode').value`),'native');
  const providers=await p.eval(`[...document.querySelectorAll('#mg-left .mm-prov')].map(x=>x.dataset.pid)`);const other=providers.find(pid=>pid!==a.split('|||')[0]);
  await p.eval(`document.querySelector('#mg-left [data-pid='+CSS.escape(${JSON.stringify(other)})+']').click();document.querySelector('.settings-pane').scrollTop=120;document.querySelector('#mg-apikey').value='fixture-provider-key';document.querySelector('#mg-apikey-save').click()`);
  await p.waitFor(`document.querySelector('#mg-apikey').value!=='fixture-provider-key'`);
  assert.equal(await p.eval(`document.querySelector('#mg-left .mm-prov.active').dataset.pid`),other);
  assert.equal(await p.eval(`document.querySelector('.settings-pane').scrollTop`),120);
  const widths=await p.eval(`(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();return {media:r('#mc-video-model-pick').right,mode:r('#mc-video-mode').right,left:r('#mc-video-mode').left,fallback:r('.fb-model-pick').left};})()`);
  assert.ok(Math.abs(widths.media-widths.mode)<2,'video mode aligns with media field');assert.ok(Math.abs(widths.left-widths.fallback)<2,'fallback left edge');
  assert.equal(await p.eval(`document.querySelector('.fb-model-pick').tagName`),'SELECT');
  await p.eval(`document.querySelector('.settings-pane').scrollTop=0`);await new Promise(r=>setTimeout(r,200));await p.screenshot('shots/final/api-model-profiles-'+skin+'.png');
 }
 console.log('两皮肤：按提供商/模型独立媒体配置、切换及保存重载恢复、提供商保存不跳转、备选下拉与对齐通过（所有写入模拟）。');
});
