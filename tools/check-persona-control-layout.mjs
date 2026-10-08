import assert from 'node:assert/strict';
import {withPage} from './cdp.mjs';
await withPage({url:'http://127.0.0.1:3210/',width:1360,height:900},async page=>{
 await page.waitFor('!!state.config && !!window.qqaSkin',{timeout:15000});
 await page.eval(`(()=>{const original=fetch;window.fetch=async(input,init)=>{const u=typeof input==='string'?input:input.url;if(u.includes('/api/config')&&init?.method==='POST')return new Response(JSON.stringify({ok:true,config:state.config}));if(u.includes('/api/persona-usage'))return new Response(JSON.stringify({usage:[],usageByTemplate:{}}));return original(input,init);};document.querySelector('.tab[data-tab=persona]').click();})()`);
 await page.waitFor('!!document.querySelector("#persona-save-all")');
 for(const skin of ['default','minecraft'])for(const width of [1360,800,480]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
   await page.eval(`window.qqaSkin.set('${skin}');document.documentElement.dataset.motion='off';`);
   const metrics=await page.eval(`(()=>{const toolbar=document.querySelector('.persona-manual-tools').getBoundingClientRect(), surface=document.querySelector('.persona-edit-surface').getBoundingClientRect();return [...document.querySelectorAll('.persona-save-actions button')].every(b=>{const r=b.getBoundingClientRect();return r.right<=surface.right+1 && r.left>=surface.left-1 && r.bottom<=toolbar.bottom+1 && r.top>=toolbar.top-1;});})()`);
   assert.equal(metrics,true,skin+' '+width+' 保存按钮在工具栏内');
 }
 await page.eval(`document.querySelector('[data-persona-left=templates]').click();document.querySelector('.persona-usage-open').focus();`);
 assert.equal(await page.eval(`getComputedStyle(document.querySelector('.persona-usage-open')).outlineStyle`),'none');
 assert.equal(await page.eval(`getComputedStyle(document.querySelector('.persona-usage-dot')).borderRadius`),'50%');
 await page.eval(`document.querySelector('.persona-usage-open').click()`);
 await page.waitFor('!!document.querySelector(".model-modal-close svg")');
 const offset=await page.eval(`(()=>{const b=document.querySelector('.model-modal-close').getBoundingClientRect(),s=document.querySelector('.model-modal-close svg').getBoundingClientRect();return [Math.abs(b.x+b.width/2-s.x-s.width/2),Math.abs(b.y+b.height/2-s.y-s.height/2)];})()`);
 assert(offset.every(n=>n<1),'关闭符号居中');
 console.log('✔ 默认/MC主题1360、800、480宽度按钮无溢出，圆形焦点提示与关闭符号居中；配置写入模拟。');
});
