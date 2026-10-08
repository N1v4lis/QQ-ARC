import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readSharedPersonas,changeSharedPersona} from './host/arcfox-shared-personas.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcfox-personas-')),file=path.join(dir,'library.json');
const seeds=[{customPersonas:[{name:'甲',text:'a'},{name:'同名',text:'one'}]},{customPersonas:[{name:'甲',text:'a'},{name:'乙',text:'b'},{name:'同名',text:'two'}],persona:{name:'当前',roleText:'current'}}];
try{
 const list=(await readSharedPersonas(file,seeds)).entries;
 assert.equal(list.length,5);assert.equal(list.filter(p=>p.name==='甲').length,1);
 assert.deepEqual((await readSharedPersonas(file,[])).entries,list);
 const p=list[1];await changeSharedPersona(file,[],{action:'update',id:p.id,expectedName:p.name,expectedText:p.text,name:p.name,text:'updated'});
 await Promise.all(['新增1','新增2'].map(name=>changeSharedPersona(file,[],{action:'create',name,text:'new'})));
 const renamed=(await readSharedPersonas(file,[])).entries[0];
 await changeSharedPersona(file,[],{action:'rename',id:renamed.id,expectedName:renamed.name,expectedText:renamed.text,name:'重命名'});
 await assert.rejects(changeSharedPersona(file,[],{action:'delete',id:renamed.id,expectedName:renamed.name,expectedText:renamed.text}),/已变化/);
 await changeSharedPersona(file,[],{action:'delete',id:renamed.id,expectedName:'重命名',expectedText:renamed.text});
 assert.equal((await readSharedPersonas(file,[])).entries.length,6);
 console.log('✔ 跨账号合并去重、不同内容不丢失、稳定ID、串行写入、更新重命名删除及过期冲突保护。');
}finally{await fs.rm(dir,{recursive:true,force:true});}
const url='http://127.0.0.1:3210/';
const accounts=await(await fetch(url+'api/accounts')).json();let reference;
for(const account of accounts.accounts||[]){
 const response=await(await fetch(url+'api/persona-templates?account='+encodeURIComponent(account.uin))).json();
 assert.equal(response.shared,true);assert(response.templates.every(p=>!p.name.includes('（来自主账号）')));
 if(reference)assert.deepEqual(response.templates,reference);else reference=response.templates;
}
console.log('✔ 真实各账号读取相同模板库，无来源账号后缀；真实配置未写入。');
