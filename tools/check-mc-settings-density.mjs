import assert from 'node:assert/strict';
import {withPage} from './cdp.mjs';
await withPage({url:'http://127.0.0.1:3210/',width:1360,height:900},async p=>{
 await p.waitFor('!!state.config && !!window.qqaMcTheme');
 await p.eval(`(()=>{const original=fetch;window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;if(url.includes('/api/config')&&init?.method==='POST')return new Response(JSON.stringify({ok:true,config:state.config}),{headers:{'content-type':'application/json'}});return original(input,init)}})()`);
 await p.eval(`window.qqaSkin.set('minecraft');openSettingsSection('theme')`);
 await p.waitFor('!!document.getElementById("mc-motion-on")');
 assert.equal(await p.eval(`window.qqaMotion.getPref()`),'on');
 await p.eval(`var m=document.getElementById('mc-motion-on');m.checked=false;m.dispatchEvent(new Event('change',{bubbles:true}))`);
 assert.equal(await p.eval(`document.documentElement.dataset.motion`),'off');
 await p.eval(`var m=document.getElementById('mc-motion-on');m.checked=true;m.dispatchEvent(new Event('change',{bubbles:true}))`);
 assert.equal(await p.eval(`document.documentElement.dataset.motion`),'on');
 assert.equal(await p.eval(`document.querySelectorAll('.mc-channel-volume input').length`),3);
 await p.eval(`var s=document.querySelector('[data-mc=clickVolume]');s.value=25;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}))`);
 assert.equal(await p.eval(`qqaMcTheme.read().clickVolume`),.25);
 assert.equal(await p.eval(`qqaMcTheme.read().toggleVolume`),1);
 assert.equal(await p.eval(`qqaMcTheme.BACKGROUNDS.length`),3);
 await p.eval(`window.testGains=[];const original=AudioContext.prototype.createGain;AudioContext.prototype.createGain=function(){const g=original.call(this);window.testGains.push(g);return g};qqaMcTheme.write({sfxVolume:.5,clickVolume:.2,toggleVolume:.4,sliderVolume:.8});`);
 await p.eval(`qqaMcTheme.loadSfx()`);
 await p.eval(`qqaMcTheme.play('menu',null,'click');qqaMcTheme.play('menu','on','toggle');qqaMcTheme.play('menu',null,'slider')`);
 assert.deepEqual(await p.eval(`window.testGains.slice(-3).map(g=>Math.round(g.gain.value*100))`),[10,20,40]);

 for(const v of [0,50,100]){
  await p.eval(`qqaMcTheme.write({bgOn:true});var s=document.getElementById('mc-bg-opacity');s.value=${v};s.dispatchEvent(new Event('input',{bubbles:true}))`);
  assert.equal(Number(await p.eval(`getComputedStyle(document.getElementById('q-shell'),'::before').opacity`)),v/100);
 }
 await p.eval(`qqaMcTheme.write({bgOpacity:.75});`);
 assert.equal(await p.eval(`getComputedStyle(document.getElementById('settings-form')).backgroundColor`),'rgba(0, 0, 0, 0)');
 await p.screenshot('shots/final/mc-background-settings.png');
 await p.eval(`openSettingsSection('onebot')`);
 await p.waitFor('!!document.querySelector(".snow-status-grid")');
 assert.equal(await p.eval(`!!document.getElementById('cfg-snowlumalaunch')`),false);
 assert(await p.eval(`(()=>{const a=document.querySelector('.snow-start-column').getBoundingClientRect(),b=document.querySelector('.snow-runtime-column').getBoundingClientRect();return b.left>=a.right})()`));
 assert(await p.eval(`(()=>{const a=document.querySelector('.onebot-directory').getBoundingClientRect(),b=document.querySelector('.onebot-connect-fields').getBoundingClientRect();return b.left>=a.right})()`));
 await p.screenshot('shots/final/onebot-density.png');
 await p.send('Emulation.setDeviceMetricsOverride',{width:800,height:900,deviceScaleFactor:1,mobile:false});
 assert(await p.eval(`(()=>{const a=document.querySelector('.snow-start-column').getBoundingClientRect(),b=document.querySelector('.snow-runtime-column').getBoundingClientRect();return b.top>=a.bottom})()`));
 await p.eval(`window.qqaSkin.set('default');openSettingsSection('personal')`);
 assert.equal(await p.eval(`!!document.querySelector('#card-motion')`),false);
 console.log('✔ MC motion, independent volume, live background 0–100%, dense OneBot columns and narrow stacking; no real config writes.');
});
