import assert from 'node:assert/strict';
import {withPage} from './cdp.mjs';
const url='http://127.0.0.1:3210/';
await withPage({url,width:1360,height:900},async page=>{
 await page.waitFor('!!state.config && !!window.qqaMotion',{timeout:20000});
 for(const skin of ['default','minecraft'])for(const theme of ['light','dark']){
  await page.eval(`qqaSkin.apply('${skin}');applyTheme('${theme}',null,{animate:false});qqaMotion.setPref('on');document.documentElement.dataset.nav='expanded';`);
  await page.eval('new Promise(r=>setTimeout(r,300))');
  const before=await page.eval(`[...document.querySelectorAll('.q-side-foot .nav-btn')].filter(b=>b.offsetHeight).map(b=>b.getBoundingClientRect().height)`);
  await page.eval(`document.querySelector('#q-side-toggle').click()`);
  await page.eval('new Promise(r=>setTimeout(r,90))');
  const width=await page.eval(`document.querySelector('.q-sidebar').getBoundingClientRect().width`);
  assert(width>60&&width<168,skin+' '+theme+' 侧栏有中间帧');
  await page.eval('new Promise(r=>setTimeout(r,250))');
  const after=await page.eval(`[...document.querySelectorAll('.q-side-foot .nav-btn')].filter(b=>b.offsetHeight).map(b=>b.getBoundingClientRect().height)`);
  assert.deepEqual(after,before,'市场入口收起前后保持行高');
  assert.equal(await page.eval(`Math.round(document.querySelector('.q-sidebar').getBoundingClientRect().width)`),60);
  const centers=await page.eval(`(()=>{const icon=document.querySelector('.tab-ico').getBoundingClientRect();const b=document.querySelector('#skill-market-btn'),r=b.getBoundingClientRect();const mark=b.querySelector('.mc-nav-item');const center=mark?(()=>{const x=mark.getBoundingClientRect();return x.x+x.width/2;})():r.x+12+12;return Math.abs(icon.x+icon.width/2-center);})()`);
  assert(centers<2,'导航和市场入口图标同列');
 }
 await page.eval(`qqaSkin.apply('default');qqaMotion.setPref('off');state.settingsSection='personal';switchTab('settings');`);
 await page.waitFor('document.querySelector("#card-colors")');
 assert.equal(await page.eval('document.documentElement.dataset.motion'),'on');
 assert.equal(await page.eval('!!document.querySelector("#cfg-motion-on")'),false);
 await page.eval(`state.settingsSection='advanced';renderSettings()`);
 assert.equal(await page.eval('!!document.querySelector("#cfg-persona-shared")'),false);
 // Rapid switches must leave only the newest page active, without an overlapping old view.
 await page.eval(`switchTab('skills');switchTab('plugins');switchTab('usage');`);
 await page.waitFor('!!document.querySelector("#usage-page .usage-wrap")');
 assert.equal(await page.eval('document.querySelectorAll(".view.active").length'),1);
 assert.equal(await page.eval('document.querySelectorAll(".view.leaving").length'),0);
 await page.screenshot('shots/final/navigation-044.png');
 console.log('✔ 默认/MC亮暗四种组合的中间帧、行高及图标对齐；默认动效不可关闭、旧共用开关删除、快速切页及用量首次加载。');
});
for(const path of ['profile-manager.html','skill-market/index.html','plugin-market/index.html','persona-plaza/index.html']){
 await withPage({url:url+path,width:1000,height:800},async page=>{
  await page.waitFor('!!document.documentElement.dataset.skin');
  await page.eval(`localStorage.setItem('qqa-skin','minecraft');localStorage.setItem('qqa-theme-pref','dark');dispatchEvent(new Event('storage'));`);
  assert.equal(await page.eval('document.documentElement.dataset.theme'),'dark');
  assert.equal(await page.eval('document.documentElement.dataset.skin'),'minecraft');
  assert.equal(await page.eval('getComputedStyle(document.body).backgroundColor'),'rgb(26, 26, 28)');
  if(path==='profile-manager.html'){
    await page.eval(`document.querySelector('[data-profile-action="add"]').click()`);
    assert.equal(await page.eval('document.querySelector("#profileModal").classList.contains("show")'),true);
    await page.eval(`document.querySelector('[data-profile-action="cancel"]').click()`);
    assert.equal(await page.eval('document.querySelector("#profileModal").classList.contains("show")'),false);
  }else{
    assert.equal(await page.eval(`typeof document.querySelector('#search').oninput`),'function','市场搜索脚本未被CSP拦截');
  }
 });
}
console.log('✔ 本地账号管理及三种市场独立页跟随MC暗色主题。');
