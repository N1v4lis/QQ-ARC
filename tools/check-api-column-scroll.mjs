import assert from 'node:assert/strict';import {withPage} from './cdp.mjs';
await withPage({url:'http://127.0.0.1:3210/',width:1360,height:860},async p=>{
 await p.waitFor('!!state.config&&!document.getElementById("loading-overlay")',{timeout:60000});
 for(const skin of ['default','minecraft']){
  await p.eval(`qqaSkin.apply('${skin}');openSettingsSection('api')`);await p.waitFor('!!document.querySelector("#mg-add-prov")');await new Promise(r=>setTimeout(r,300));
  const geometry=await p.eval(`(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();return {upper:r('.api-inline-config').width,lower:r('.api-fallback').width,x:r('.api-inline-config').left,lx:r('.api-fallback').left,button:r('#mg-add-prov').top,url:r('#mg-baseurl').top};})()`);
  assert.ok(Math.abs(geometry.upper-geometry.lower)<1,'equal column width');assert.ok(Math.abs(geometry.x-geometry.lx)<1,'aligned divider');
  console.log(skin+' top alignment offset: '+(geometry.button-geometry.url));
  assert.ok(Math.abs(geometry.button-geometry.url)<6,'provider button aligns with Base URL');
  assert.ok(await p.eval(`['#api-model-directory','#api-model-config > .model-modal-body'].every(s=>{const e=document.querySelector(s);return e.scrollHeight<=e.clientHeight+1})`),'current content fully visible');
  assert.ok(await p.eval(`Math.abs(document.querySelector('#mg-add-prov').getBoundingClientRect().width-document.querySelector('#mg-del-prov').getBoundingClientRect().width)<1`),'provider buttons same width');
  assert.ok(await p.eval(`['mc-vision','mc-video'].every(id=>document.getElementById(id).closest('.switch').querySelector('.track').getBoundingClientRect().left>document.getElementById(id).closest('.switch').querySelector(':scope > span:last-child').getBoundingClientRect().left)`),'right aligned switches');
  await p.screenshot('shots/final/api-columns-'+skin+'.png');
  for(const id of ['#api-model-directory','#api-model-config > .model-modal-body']){
   await p.eval(`(()=>{const box=document.querySelector('${id}');box.insertAdjacentHTML('beforeend','<div class="scroll-fixture" style="height:1400px">未来内容</div>');})()`);
   const before=await p.eval(`(()=>{const e=document.querySelector('${id}');return {height:document.querySelector('.api-model-workspace').getBoundingClientRect().height,x:e.getBoundingClientRect().left+8,y:e.getBoundingClientRect().top+100,parents:[...document.querySelectorAll('.settings-pane,#settings-form,#view-settings')].map(x=>x.scrollTop)};})()`);
   await p.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:before.x,y:before.y,deltaY:260,deltaX:0});await new Promise(r=>setTimeout(r,200));
   assert.ok(await p.eval(`document.querySelector('${id}').scrollTop>0`),'internal scroll');
   assert.deepEqual(await p.eval(`[...document.querySelectorAll('.settings-pane,#settings-form,#view-settings')].map(x=>x.scrollTop)`),before.parents,'page does not move');
   assert.ok(await p.eval(`document.querySelector('.api-model-workspace').getBoundingClientRect().height<=620`),'future content bounded');
   await p.eval(`document.querySelector('${id}').scrollTop=99999`);
   await p.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:before.x,y:before.y,deltaY:260,deltaX:0});await new Promise(r=>setTimeout(r,150));
   assert.deepEqual(await p.eval(`[...document.querySelectorAll('.settings-pane,#settings-form,#view-settings')].map(x=>x.scrollTop)`),before.parents,'no boundary scroll chaining');
   await p.eval(`document.querySelector('${id} .scroll-fixture').remove();document.querySelector('${id}').scrollTop=0`);
  }
 }
 console.log('默认/MC：上下等宽同分隔线、提供商首行对齐、左右滚轮独立滚动与边界不带动整页通过。');
});
