import assert from 'node:assert/strict';import {withPage} from './cdp.mjs';
await withPage({url:'http://127.0.0.1:3210/',width:1360,height:860,onConsole:s=>{if(s.startsWith('[exception]'))console.log(s)},initScripts:[`const f=fetch;window.writes=[];window.fetch=(i,o)=>{if(o?.method&&o.method!=='GET'){writes.push({url:String(i),body:JSON.parse(o.body||'{}')});return Promise.resolve(new Response(JSON.stringify({ok:true,config:state.config}),{headers:{'content-type':'application/json'}}));}return f(i,o)};`]},async p=>{
 await p.waitFor('!!state.config&&!document.getElementById("loading-overlay")',{timeout:60000});
 for(const skin of ['default','minecraft']){
  await p.eval(`qqaSkin.apply('${skin}');openSettingsSection('api')`);
  await p.waitFor('!!document.querySelector("#mc-save")&&!!document.querySelector("#mg-add-model")&&state.modelPrices?.remote?.catalogue?.length>0');
  assert.equal(await p.eval(`!!document.querySelector('#open-model-config-btn,#open-model-manage-btn')`),false);
  assert.equal(await p.eval(`document.querySelectorAll('.model-modal-overlay').length`),0);
  assert.ok(await p.eval(`document.querySelector('#api-model-directory').getBoundingClientRect().left<document.querySelector('#api-model-config').getBoundingClientRect().left`));
  assert.equal(await p.eval(`document.querySelector('#mc-baseurl').type`),'hidden');
  assert.equal(await p.eval(`document.querySelector('#mc-apikey').type`),'hidden');
  assert.ok(await p.eval(`document.querySelector('#api-model-config label').textContent.includes('选择模型')`));
  await p.eval(`document.querySelector('#mc-vision').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await p.eval(`!!document.querySelector('.settings-undo-btn')`),false);

  for(const id of ['mc-model-pick','mc-baseurl','mc-apikey','mc-test-btn','mc-vision','mc-video','mc-video-mode','mc-vision-model-pick','mc-video-model-pick','mc-scan-btn','mc-save','mg-add-prov','mg-del-prov','mg-add-model','mg-fetch-models','mg-del-model','mg-apikey-clear'])assert.ok(await p.eval(`!!document.querySelector('#${id}')`),id);
  await p.eval(`document.querySelector('#mg-apikey').value='fixture-key';document.querySelector('#mg-apikey-save').click()`);
  await p.waitFor(`writes.some(w=>w.url.includes('/api/providers/set-key')&&w.body.apiKey==='fixture-key'&&!!w.body.providerId)`);
  assert.ok(await p.eval(`document.querySelector('#model-vision-hint').textContent.includes('视频：')`),'current capabilities');
  assert.ok(await p.eval(`document.querySelector('#mg-right .model-input-capabilities').textContent.includes('视频：')`),'model capabilities');
  assert.equal(await p.eval(`document.querySelector('#mc-vision').closest('.switch').textContent.trim()`),'图片输入');
  assert.equal(await p.eval(`document.querySelector('#mc-video').closest('.switch').textContent.trim()`),'视频输入');
  assert.ok(await p.eval(`Math.abs(document.querySelector('#mc-vision').closest('.switch').getBoundingClientRect().top-document.querySelector('#mc-video').closest('.switch').getBoundingClientRect().top)<1`),'switches on same row');
  await new Promise(r=>setTimeout(r,300));await p.screenshot('shots/final/api-inline-'+skin+'.png');
  await p.eval(`document.querySelector('#official-price-catalogue-btn').click();document.querySelector('[data-vendor="openai"]').click();document.querySelector('[data-vendor="deepseek"]').click()`);
  assert.equal(await p.eval(`document.querySelectorAll('#official-sources button[aria-pressed="true"]').length`),2);
  assert.equal(await p.eval(`document.querySelectorAll('#official-source-links a').length`),2);
  assert.equal(await p.eval(`document.querySelectorAll('[data-filter-vendor]:checked').length`),2);
  assert.ok(await p.eval(`Array.from(document.querySelectorAll('.official-model-record summary .model-name-with-logo')).every(x=>state.modelPrices.remote.catalogue.some(r=>['deepseek','openai'].includes(r.vendor)&&r.id===x.textContent))`));
  await p.eval(`document.querySelector('#official-vendor').open=true;document.querySelector('[data-filter-vendor][value="glm"]').click()`);
  assert.equal(await p.eval(`document.querySelectorAll('#official-sources button[aria-pressed="true"]').length`),3);
  assert.ok(await p.eval(`document.querySelector('[data-filter-vendor]').getBoundingClientRect().width<=16`),'compact checkbox');
  assert.ok(await p.eval(`document.querySelector('.official-vendor-options').getBoundingClientRect().height<=360`),'bounded dropdown');
  await new Promise(r=>setTimeout(r,200));await p.screenshot('shots/final/api-multiselect-'+skin+'.png');
  await p.eval(`document.querySelector('#official-vendor-all').click()`);
  assert.equal(await p.eval(`document.querySelectorAll('#official-sources button[aria-pressed="true"]').length`),0);
  await p.eval(`document.querySelector('#official-close').click()`);
  assert.equal(await p.eval(`document.querySelector('#mc-model-pick').tagName`),'SELECT');
  const picked=await p.eval(`document.querySelector('#mc-model-pick option[value]:not([value=""])').value.split('|||')[1]`);
  await p.eval(`(()=>{const select=document.querySelector('#mc-model-pick');select.value=select.querySelector('option[value]:not([value=""])').value;select.dispatchEvent(new Event('change'));document.querySelector('#mc-save').click();})()`);
  await p.waitFor(`writes.some(w=>w.body.api?.model===${JSON.stringify(picked)})`);
  assert.ok(await p.eval(`!!document.querySelector('#api-model-config')`));
 }
 console.log('默认/MC：多厂商联合筛选、复选框同步、全部恢复、官网联动；页内完整配置/管理、模型选择与保存通过（写入全部模拟）。');
});
