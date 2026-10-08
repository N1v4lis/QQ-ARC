import assert from 'node:assert/strict';
import {withPage} from './cdp.mjs';
await withPage({url:'http://127.0.0.1:3210/',width:1360,height:900,initScripts:[`const originalFetch=fetch;window.writes=[];window.fixture=null;const merge=(a,b)=>{if(b&&typeof b==='object'&&!Array.isArray(b)){if('__replace__' in b)return b.__replace__;const result={...a};for(const [k,v] of Object.entries(b))result[k]=merge(a?.[k],v);return result;}return b;};window.fetch=async(i,o)=>{if(String(i)==='/api/config'){if(o?.method==='POST'){const patch=JSON.parse(o.body);writes.push(patch);fixture=merge(fixture,patch);return new Response(JSON.stringify({ok:true,config:fixture}));}if(fixture)return new Response(JSON.stringify(fixture));const r=await originalFetch(i,o);fixture=await r.clone().json();return r;}if(o?.method&&o.method!=='GET')return new Response(JSON.stringify({ok:true}));return originalFetch(i,o);};`]},async p=>{
 await p.waitFor('!!state.config&&!document.getElementById("loading-overlay")',{timeout:60000});
 for(const skin of ['default','minecraft']){
  await p.eval(`qqaSkin.apply('${skin}');state.personaTarget='group:881511459';state.personaPanel='model';switchTab('persona');renderSettings();`);await new Promise(r=>setTimeout(r,700));await p.eval(`fixture=structuredClone(state.config);fixture.store={...fixture.store,unifiedTier:false,peakSchedule:{...fixture.store.peakSchedule,enabled:false},groupSliderPos:{'881511459':58,'other':77},groupPeakPos:{'other':{peak:10,valley:90}}};state.config=structuredClone(fixture);renderSettings();`);
  await p.waitFor('!!document.querySelector("#persona-active-editor #ac-slider")');
  assert.ok(await p.eval(`document.querySelector('[data-persona-panel="model"]').textContent.includes('身份与模型设置')`));
  for(const selector of ['#cfg-participation','#cfg-persona-chat-model']){
   const style=await p.eval(`(()=>{const e=document.querySelector('${selector}');e.focus();const s=getComputedStyle(e);return {offset:s.outlineOffset,shadow:s.boxShadow};})()`);assert.equal(style.offset,'-2px');assert.ok(style.shadow.includes('inset'),style.shadow);
  }
  await p.eval(`activeVSlider.applyValues(65,65);document.querySelector('#cfg-persona-chat-model').focus()`);
  assert.equal(await p.eval(`document.querySelector('#persona-active-editor').__storePatch(fixture).groupSliderPos.__replace__['881511459']`),65);
  assert.equal(await p.eval(`document.querySelector('#persona-active-editor').__storePatch(fixture).groupSliderPos.__replace__.other`),77);
  assert.equal(await p.eval(`document.querySelector('#settings-form').__savePersonaDraft('model')`),true);
  assert.equal(await p.eval(`writes.at(-1).store.groupSliderPos.__replace__['881511459']`),65);
  await p.screenshot('shots/final/persona-tier-focus-'+skin+'.png');
  await p.eval(`fixture.store.peakSchedule.enabled=true;state.config=structuredClone(fixture);renderSettings();activeVSlider.applyValues(85,20);`);
  assert.equal(await p.eval(`document.querySelector('#settings-form').__savePersonaDraft('model')`),true);
  assert.deepEqual(await p.eval(`writes.at(-1).store.groupPeakPos.__replace__['881511459']`),{peak:20,valley:85});
  await p.eval(`(()=>{const e=document.querySelector('#persona-tier-own');e.checked=false;e.dispatchEvent(new Event('change'));})()`);
  assert.equal(await p.eval(`document.querySelector('#settings-form').__savePersonaDraft('model')`),true);
  assert.equal(await p.eval(`'881511459' in writes.at(-1).store.groupSliderPos.__replace__`),false);
  assert.equal(await p.eval(`writes.at(-1).store.groupPeakPos.__replace__.other.valley`),90);
  await p.eval(`openSettingsSection('chat')`);await p.waitFor('!!document.querySelector("#ac-editor #ac-slider")');
  assert.equal(await p.eval(`!!document.querySelector('#ac-group-buttons')`),false);
  assert.equal(await p.eval(`document.querySelector('#ac-target').textContent.includes('全局')`),true);
  await p.eval(`openSettingsSection('api')`);await p.waitFor('!!document.querySelector("#mc-model-pick")');
  for(const section of ['api','memory','allow','chat','desktop','personal','theme','onebot','advanced','tools']){
  await p.eval(`openSettingsSection('${section}')`);
  const styles=await p.eval(`[...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]),textarea,select')].filter(e=>e.getClientRects().length&&!e.disabled&&!e.closest('[inert]')).map(e=>{e.focus();if(document.activeElement!==e)return null;const s=getComputedStyle(e);return {id:e.id,offset:s.outlineOffset,shadow:s.boxShadow};}).filter(Boolean)`);
  for(const s of styles){assert.equal(s.offset,'-2px',s.id);assert.ok(s.shadow==='none'||s.shadow.includes('inset'),JSON.stringify(s));}
  }
 }
 console.log('两皮肤：人设及API可见输入控件焦点内描边、群档位保存/清除与其他群隔离、聊天页默认档位通过；所有配置写入模拟。');
});
