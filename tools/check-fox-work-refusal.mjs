import assert from 'node:assert/strict';
import {withPage} from './cdp.mjs';
await withPage({url:'http://127.0.0.1:3210/',width:1360,height:900},async p=>{
 await p.waitFor('!!state.config && !document.getElementById("loading-overlay")',{timeout:60000});await p.eval(`qqaSkin.set('minecraft');openSettingsSection('theme')`);await p.waitFor('qqaWineFox.state().loaded',{timeout:20000});
 await p.eval(`(()=>{const original=fetch;window.foxRequests=0;window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;if(url==='/api/fox-assistant'){window.foxRequests++;throw Error('拒绝状态不应发出请求');}if(url.includes('/api/config')&&init?.method==='POST')return new Response(JSON.stringify({ok:true,config:state.config}));return original(input,init)}})()`);
 await p.eval(`qqaFoxSettingsHelper.open();void(window.pinnedTask=qqaFoxSettingsHelper.run('#mc-sfx-on',document.getElementById('mc-sfx-on').checked?'off':'on'))`);
 await p.waitFor('qqaFoxSettingsHelper.state().phase==="gesture"');await new Promise(r=>setTimeout(r,210));
 const pinned=await p.eval(`(()=>{const e=document.getElementById('mc-sfx-on'),o=document.querySelector('.fox-helper-control'),r=e.getBoundingClientRect(),b=o.getBoundingClientRect(),hand=qqaWineFox.helper().helperHand();return {difference:Math.max(Math.abs(r.left-b.left),Math.abs(r.top-b.top),Math.abs(r.width-b.width),Math.abs(r.height-b.height)),front:Number(getComputedStyle(o).zIndex)>Number(getComputedStyle(document.getElementById('wine-fox-pet')).zIndex),masked:getComputedStyle(e).opacity,lever:qqaWineFox.state().leverVisible,handDistance:Math.hypot(hand[0]-r.left-r.width/2,hand[1]-r.top-14)};})()`);
 assert.ok(pinned.difference<=1);assert.equal(pinned.front,true);assert.equal(pinned.masked,'0');assert.equal(pinned.lever,false);assert.ok(pinned.handDistance<35,JSON.stringify(pinned));
 await p.screenshot('shots/final/fox-real-lever.png');assert.equal(await p.eval(`window.pinnedTask`),true);assert.equal(await p.eval(`document.querySelectorAll('.fox-helper-masked').length`),0);
 for(const mood of ['angry','dazed']){
  await p.eval(`qqaFoxSettingsHelper.cancel();qqaWineFox.set({animation:'idle',voice:false});qqaWineFox.set({animation:'natural'});(async()=>{const {FoxBehavior}=await import('/shell/fox-behavior.mjs');const advance=FoxBehavior.prototype.advance,next=FoxBehavior.prototype.nextAt;FoxBehavior.prototype.nextAt=()=>performance.now()+10;FoxBehavior.prototype.advance=function(now){FoxBehavior.prototype.advance=advance;FoxBehavior.prototype.nextAt=next;this.mood='${mood}';this.reason='idle';this.until=${mood==='angry'?'now+10000':'0'};return this.mood;};qqaWineFox.set({size:${mood==='angry'?281:282}});})()`);
  await p.waitFor(`qqaWineFox.state().mood==='${mood}'`);assert.equal(await p.eval(`qqaFoxSettingsHelper.open()`),true);
  assert.equal(await p.eval(`qqaFoxSettingsHelper.ask('打开背景图')`),false);assert.equal(await p.eval(`window.foxRequests`),0);assert.equal(await p.eval(`qqaWineFox.state().mood`),mood);assert.equal(await p.eval(`qqaWineFox.state().helperBusy`),false);
  assert.ok(await p.eval(`document.querySelector('.fox-helper-status').textContent.includes('${mood==='angry'?'生气':'发呆'}')`));
 }
 await p.eval(`qqaFoxSettingsHelper.cancel()`);console.log('酒狐：原位拉杆前景、原控件状态提交/恢复、手部接触、生气/呆住状态保留且零模型请求通过。');
});
