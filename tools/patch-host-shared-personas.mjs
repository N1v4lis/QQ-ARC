import fs from 'node:fs';
const dir='E:/QQ Agent/resources/app/src',file=dir+'/routes.js';
fs.copyFileSync(new URL('./host/arcfox-shared-personas.mjs',import.meta.url),dir+'/arcfox-shared-personas.mjs');
const old=fs.readFileSync(file,'utf8');let source=old.replaceAll('\r\n','\n');
if(!source.includes("import {readSharedPersonas,changeSharedPersona}"))source=source.replace("import fs from 'node:fs';","import fs from 'node:fs';\nimport {readSharedPersonas,changeSharedPersona} from './arcfox-shared-personas.mjs';");
const seed="[...new Set([String(primaryUin() || activeAccountUin() || ''),...listQqAccounts().map(a=>String(a.uin))])].map(uin=>getConfig(uin))";
function replaceRoute(method,pattern,handler){
 const anchor=`      method: '${method}', pattern: '${pattern}',`;
 const start=source.indexOf(anchor),end=source.indexOf('\n    },',start);
 if(start<0||end<0)throw Error('Route anchor missing: '+pattern);
 source=source.slice(0,start)+anchor+'\n'+handler+source.slice(end);
}
replaceRoute('GET','/api/persona-templates',`      // ARCFOX shared persona library v2: one persistent library for every account.
      handler: async ({res,json}) => {
        const library=await readSharedPersonas(path.join(DATA_DIR,'shared-personas.json'),${seed});
        const builtins=Object.entries(PERSONAS).map(([id,p])=>({id,name:p.name,text:p.text,builtin:true}));
        const templates=library.entries.map((p,index)=>({...p,owner:'shared',index,editable:true,builtin:false}));
        return json(res,200,{templates:[...builtins,...templates],shared:true});
      }`);
replaceRoute('POST','/api/persona-library',`      handler: async ({req,res,json}) => {
        try{return json(res,200,await changeSharedPersona(path.join(DATA_DIR,'shared-personas.json'),${seed},await bodyOf(req)));}
        catch(error){return json(res,error.status||500,{error:error.message});}
      }`);
replaceRoute('POST','/api/persona-templates',`      handler: async ({req,res,json}) => {
        try{return json(res,200,await changeSharedPersona(path.join(DATA_DIR,'shared-personas.json'),${seed},{...await bodyOf(req),action:'create'}));}
        catch(error){return json(res,error.status||500,{error:error.message});}
      }`);
const deleteAnchor=source.indexOf("      method: 'DELETE', pattern: /^\\/api\\/persona-templates\\/");
const deleteEnd=source.indexOf('\n    },',deleteAnchor);
if(deleteAnchor<0||deleteEnd<0)throw Error('Delete route anchor changed');
source=source.slice(0,deleteAnchor)+`      method: 'DELETE', pattern: /^\\/api\\/persona-templates\\/([^/]+)$/,
      handler: async ({req,res,json,match}) => {
        const file=path.join(DATA_DIR,'shared-personas.json'),seeds=${seed};
        const library=await readSharedPersonas(file,seeds);
        const id=match[1],entry=library.entries.find(p=>p.id===id) || (/^custom_\\d+$/.test(id)?library.entries[Number(id.slice(7))]:null);
        if(!entry)return json(res,404,{error:'人设不存在'});
        try{return json(res,200,await changeSharedPersona(file,seeds,{action:'delete',id:entry.id,expectedName:entry.name,expectedText:entry.text}));}
        catch(error){return json(res,error.status||500,{error:error.message});}
      }`+source.slice(deleteEnd);
if(source!==old.replaceAll('\r\n','\n')){fs.writeFileSync(file+'.bak-shared-personas-'+Date.now(),old);fs.writeFileSync(file,old.includes('\r\n')?source.replaceAll('\n','\r\n'):source);}
console.log('Shared persona library installed; legacy account libraries retained for rollback.');
