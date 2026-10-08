import assert from 'node:assert/strict';import {withPage} from './cdp.mjs';
await withPage({url:'http://127.0.0.1:3210/',initScripts:[`window.mergeWrites=[];const f=fetch;window.fetch=(i,o)=>{if(typeof i==='string'&&i.includes('/api/config')&&o?.method==='POST'){const b=JSON.parse(o.body);window.mergeWrites.push(b);return Promise.resolve(new Response(JSON.stringify({ok:true,config:state.config}),{headers:{'content-type':'application/json'}}));}return f(i,o)};`]},async p=>{
 await p.waitFor('!!state.config && !document.getElementById("loading-overlay")',{timeout:60000});
 for(const skin of ['default','minecraft']){await p.eval(`qqaSkin.apply('${skin}');openSettingsSection('api')`);await p.waitFor('!!document.querySelector("#cfg-searchprovider")');
 assert.equal(await p.eval(`document.querySelector('#settings-api').textContent`),'API与搜索');
 assert.equal(await p.eval(`!!document.querySelector('.settings-menu-item[data-section="search"]')`),false);
 assert.equal(await p.eval(`document.querySelectorAll('#settings-form .setcard').length`),0);
 await p.eval(`document.querySelector('#cfg-websearch').checked=false;saveConfig({quiet:true})`);
 assert.equal(await p.eval(`window.mergeWrites.at(-1).webSearch.enabled`),false);
 assert.equal(await p.eval(`!!window.mergeWrites.at(-1).api`),true);
 await p.eval(`openSettingsSection('search')`);assert.equal(await p.eval('state.settingsSection'),'api');
 }
 console.log('API与搜索单入口、两皮肤常显搜索区、模型/搜索同页保存以及旧入口兼容通过（模拟写入）。');
});
