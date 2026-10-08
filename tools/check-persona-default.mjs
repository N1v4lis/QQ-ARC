import assert from 'node:assert/strict';
import fs from 'node:fs';
import {withPage} from './cdp.mjs';
const hostSource=fs.readFileSync('E:/QQ Agent/resources/app/src/routes.js','utf8');
assert.match(hostSource,/^import \{ PERSONAS \} from '\.\/personas\.js';$/m,'POST handler must have a module-scoped builtin import');
const {PERSONAS}=await import('file:///E:/QQ%20Agent/resources/app/src/personas.js');
assert.equal(PERSONAS.xiaojingyu.name,'小鲸鱼');
// Run the installed POST handler with in-memory persistence, including its real builtin lookup.
const routeStart=hostSource.indexOf("method: 'POST', pattern: '/api/config'");
const handlerStart=hostSource.indexOf('handler: async',routeStart)+'handler: '.length;
const handlerEnd=hostSource.indexOf('\n    },',handlerStart);
let memory={persona:{name:'custom',roleText:'custom',templateRef:{builtin:false}}};
const handler=new Function('PERSONAS','readBody','getConfig','updateConfig','store','sessions','orchestrator','initPriceFeed','FIXED_PRICE_FEED_URL','emit','sanitizeConfig',
 'return '+hostSource.slice(handlerStart,handlerEnd).trim())(PERSONAS,async req=>structuredClone(req.patch),()=>memory,patch=>(memory={...memory,...patch}),{setMaxPerChat(){}},{},{stopProactiveLoop(){}},()=>{},'',()=>{},v=>v);
const response=await handler({req:{patch:{persona:{templateRef:{id:'xiaojingyu',builtin:true},roleText:'invalid edit'}}},res:{},json:(_res,status,body)=>({status,body})});
assert.equal(response.status,200);assert.equal(memory.persona.roleText,PERSONAS.xiaojingyu.text);assert.equal(memory.persona.name,'小鲸鱼');
const url='http://127.0.0.1:3210/';const before=await(await fetch(url+'api/config')).json();
await withPage({url,width:1360,height:900},async page=>{
 await page.waitFor('!!state.config && !!document.querySelector(".tab.active")',{timeout:15000});
 await page.eval(`(()=>{const original=fetch;window.__defaultPosts=[];window.fetch=async(input,init)=>{const u=typeof input==='string'?input:input.url;const json=v=>new Response(JSON.stringify(v));if(u.includes('/api/config')){if(init?.method==='POST'){const patch=JSON.parse(init.body);__defaultPosts.push(patch);return json({ok:true,config:{...state.config,...patch}});}return json(state.config);}if(u.includes('/api/persona-usage'))return json({usageByTemplate:{},usage:[]});return original(input,init);};state.personaTarget='global';document.querySelector('.tab[data-tab=persona]').click();})()`);
 await page.waitFor('!!document.querySelector(".persona-template")');
 await page.eval(`state.personaTemplates={test:{name:'测试默认',text:'test text',customRules:'test rules',owner:'test-account',editable:true,index:0},xiaojingyu:{name:'小鲸鱼',text:'builtin text',builtin:true}};state.personaTarget='private:preserved';state.config.personaByChat ||= {};state.config.personaByChat['private:preserved']={roleText:'own text'};window.__oldIdentity={botName:state.config.persona.botName,participation:state.config.persona.participation};window.__oldAllow=JSON.stringify(state.config.allow);renderSettings();`);
 const setDefault=async id=>{
   await page.eval(`document.querySelector('[data-persona-left=templates]').click();document.querySelector('[data-persona-id="${id}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:800,clientY:350}));document.querySelector('[data-template-action=default]').click();`);
   await page.waitFor(`state.config.persona.templateRef?.id===${JSON.stringify(id)} && !document.querySelector('.persona-context-menu') && !!document.querySelector('.persona-default')`);
 };
 await setDefault('test');
 assert.equal(await page.eval('state.config.persona.roleText'),'test text');assert.equal(await page.eval('state.config.persona.customRules'),'test rules');assert.equal(await page.eval('state.config.personaByChat["private:preserved"].roleText'),'own text');
 assert.equal(await page.eval('state.config.persona.botName===__oldIdentity.botName && state.config.persona.participation===__oldIdentity.participation'),true);
 assert.equal(await page.eval('JSON.stringify(state.config.allow)===__oldAllow'),true);
 assert.equal(await page.eval('document.querySelector(".persona-default [data-persona-id]").dataset.personaId'),'test');
 await setDefault('xiaojingyu');
 assert.equal(await page.eval('state.config.persona.roleText'),'builtin text');assert.equal(await page.eval('state.config.persona.systemPromptOverride'),'');
 assert.equal(await page.eval('document.querySelectorAll(".persona-default").length'),1);assert.equal(await page.eval('document.querySelector(".persona-default-badge").textContent'),'★ 默认');
 assert.equal(await page.eval('state.config.personaByChat["private:preserved"].roleText'),'own text');
 const count=await page.eval('__defaultPosts.length');
 await setDefault('xiaojingyu');
 await page.waitFor(`__defaultPosts.length===${count+1}`);
 assert.equal(await page.eval('state.config.persona.name'),'小鲸鱼');
 console.log('✔ 自定义/内置均可设默认，唯一特殊标记、正文规则即时生效、身份/独立人设/白名单保留；真实写入模拟。');
});
assert.deepEqual(await(await fetch(url+'api/config')).json(),before);
