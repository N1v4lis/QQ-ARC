import fs from 'node:fs';
const file='E:/QQ Agent/resources/app/src/routes.js';
let source=fs.readFileSync(file,'utf8');
if(!source.includes('// ARCFOX persona library management v1')){
 const anchor="    {\n      method: 'POST', pattern: '/api/persona-templates',";
 const normalized=source.replaceAll('\r\n','\n');
 const route=`    // ARCFOX persona library management v1
    {
      method: 'POST', pattern: '/api/persona-library',
      handler: async ({req,res,json}) => {
        const body = await bodyOf(req);
        const current = String(activeAccountUin() || '');
        const owner = String(body.owner ?? personaLibraryOwnerFor(accountParamOf(req)) ?? current);
        const allowedOwners = new Set([current, String(personaLibraryOwnerFor(accountParamOf(req)) || current)]);
        if (getConfig()?.personaShared === true) allowedOwners.add(String(primaryUin() || current));
        if (!allowedOwners.has(owner)) return json(res,403,{error:'不能修改该账号的人设库'});
        const list = [...(getConfig(owner).customPersonas || [])];
        const name = String(body.name ?? '').trim().slice(0,100);
        const index = Number(body.index);
        if (body.action !== 'create') {
          if (!Number.isInteger(index) || !list[index] || list[index].name !== body.expectedName || list[index].text !== body.expectedText)
            return json(res,409,{error:'人设列表已变化，请刷新后重试'});
        }
        if (body.action === 'delete') list.splice(index,1);
        else {
          if (!name) return json(res,400,{error:'人设名称不能为空'});
          if (list.some((p,i)=>p.name===name && (body.action==='create' || i!==index))) return json(res,409,{error:'人设名称已存在'});
          if (body.action === 'create') list.push({name,text:String(body.text ?? ''),customRules:String(body.customRules ?? '')});
          else if (body.action === 'rename') list[index] = {...list[index],name};
          else if (body.action === 'update') list[index] = {...list[index],name,text:String(body.text ?? ''),customRules:String(body.customRules ?? '')};
          else return json(res,400,{error:'未知操作'});
        }
        updateConfig({customPersonas:list},owner);
        return json(res,200,{ok:true});
      }
    },
`;
 if(normalized.split(anchor).length!==2)throw Error('Persona route anchor changed');
 let next=normalized.replace(anchor,route+anchor);
 next=next.replace("const customs = [...(cur.customPersonas || []), ...sharedList.filter((p) => !seenNames.has(String(p.name || '')))].map((p, i) => ({", "const customs = [...(cur.customPersonas || []).map((p,index)=>({...p,owner:String(activeAccountUin() || ''),index})), ...sharedList.map((p,index)=>({...p,owner:String(libOwner),index})).filter((p)=>!seenNames.has(String(p.name || '')))].map((p, i) => ({");
 next=next.replace('id: `custom_${i}`, name: p.name, text: p.text, customRules:', 'id: `custom_${i}`, owner:p.owner, index:p.index, editable:true, name: p.name, text: p.text, customRules:');
 next=next.replace('id: `owner_custom_${i}`,','id: `owner_custom_${i}`, owner:String(ownerUin), index:i, editable:true,');
 fs.writeFileSync(file+'.bak-persona-'+Date.now(),source);
 fs.writeFileSync(file,source.includes('\r\n')?next.replaceAll('\n','\r\n'):next);
}
console.log('Persona library CRUD/empty templates/owner metadata installed.');
