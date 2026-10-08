import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const queues=new Map();
function serial(file,fn){const next=(queues.get(file)||Promise.resolve()).catch(()=>{}).then(fn);queues.set(file,next);return next;}
async function read(file,seeds){
 try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const seen=new Set(),entries=[];
 for(const config of seeds){
  const p=config.persona;
  const source=[...(config.customPersonas||[])];
  if(p?.roleText && !p.templateRef?.builtin)source.push({name:p.name||p.botName||'未命名人设',text:p.roleText,customRules:p.customRules||''});
  for(const item of source){
   const name=String(item.name||'未命名人设').replace(/（来自主账号）$/,''),text=String(item.text||''),customRules=String(item.customRules||'');
   const key=JSON.stringify([name,text,customRules]);if(seen.has(key))continue;seen.add(key);
   entries.push({id:'shared_'+randomUUID(),name,text,customRules});
  }
 }
 const library={version:1,entries};await write(file,library);return library;
}
async function write(file,library){const temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify(library,null,2),'utf8');await fs.rename(temp,file);}
export function readSharedPersonas(file,seeds){return serial(file,()=>read(file,seeds));}
export function changeSharedPersona(file,seeds,body){return serial(file,async()=>{
 const library=await read(file,seeds),list=library.entries;
 const index=body.id?list.findIndex(p=>p.id===body.id):Number(body.index);
 const fail=(message,status=409)=>{const error=new Error(message);error.status=status;throw error;};
 if(body.action!=='create' && (!Number.isInteger(index)||!list[index]||list[index].name!==body.expectedName||list[index].text!==body.expectedText))fail('人设列表已变化，请刷新后重试');
 const name=String(body.name||'').trim().slice(0,100);
 if(body.action==='delete')list.splice(index,1);
 else{
  if(!name)fail('人设名称不能为空',400);
  if((body.action==='create'||name!==list[index]?.name)&&list.some((p,i)=>p.name===name&&i!==index))fail('人设名称已存在');
  if(body.action==='create')list.push({id:'shared_'+randomUUID(),name,text:String(body.text||''),customRules:String(body.customRules||'')});
  else if(body.action==='rename')list[index]={...list[index],name};
  else if(body.action==='update')list[index]={...list[index],name,text:String(body.text||''),customRules:String(body.customRules||'')};
  else fail('未知操作',400);
 }
 await fs.copyFile(file,file+'.previous');await write(file,library);return {ok:true};
});}
