import fs from 'node:fs';
const file='E:/QQ Agent/resources/app/src/routes.js';
let source=fs.readFileSync(file,'utf8');
if(!source.includes('// ARCFOX persona usage and builtin protection v1')){
 let next=source.replaceAll('\r\n','\n');
 const anchor="    {\n      method: 'GET', pattern: '/api/persona-templates',";
 const helper=fs.readFileSync(new URL('./host/arcfox-persona-usage.mjs',import.meta.url),'utf8').replace('export function','function');
 const route=`    // ARCFOX persona usage and builtin protection v1
    {
      method: 'POST', pattern: '/api/persona-usage',
      handler: async ({req,res,json}) => {
        const template=await bodyOf(req);
        ${helper}
        const accounts=listQqAccounts().map(a=>({uin:a.uin,config:getConfig(String(a.uin))}));
        return json(res,200,{usage:personaUsage(template,accounts)});
      }
    },
`;
 if(next.split(anchor).length!==2)throw Error('Template anchor changed');next=next.replace(anchor,route+anchor);
 const configAnchor='        const patch = await readBody(req);\n        const next = updateConfig(patch);';
 const protection=`        const patch = await readBody(req);
        const protect = (entry, previous) => {
          if(!entry || typeof entry !== 'object')return;
          const ref = Object.hasOwn(entry,'templateRef') ? entry.templateRef : previous?.templateRef;
          const builtin = ref?.builtin ? PERSONAS[ref.id] : null;
          if(builtin)Object.assign(entry,{name:builtin.name,roleText:builtin.text,customRules:'',systemPromptOverride:''});
        };
        protect(patch.persona,getConfig().persona);
        const entries=patch.personaByChat?.__replace__ || patch.personaByChat || {};
        for(const [key,entry]of Object.entries(entries))protect(entry,getConfig().personaByChat?.[key]);
        const next = updateConfig(patch);`;
 if(next.split(configAnchor).length!==2)throw Error('Config anchor changed');next=next.replace(configAnchor,protection);
 fs.writeFileSync(file+'.bak-persona-policy-'+Date.now(),source);fs.writeFileSync(file,source.includes('\r\n')?next.replaceAll('\n','\r\n'):next);
}
source=fs.readFileSync(file,'utf8');
let normalized=source.replaceAll('\r\n','\n');
// POST /api/config also needs the builtins; the GET handler's local import is out of scope.
if(!/^import \{ PERSONAS \} from '\.\/personas\.js';$/m.test(normalized)){
 const anchor="import fs from 'node:fs';";
 if(!normalized.includes(anchor))throw Error('Routes import anchor changed');
 normalized=normalized.replace(anchor,anchor+"\nimport { PERSONAS } from './personas.js';");
}
const helperStart=normalized.indexOf('function personaUsage('), helperEnd=normalized.indexOf('        const accounts=listQqAccounts()',helperStart);
if(helperStart<0 || helperEnd<0)throw Error('Usage helper anchor changed');
normalized=normalized.slice(0,helperStart)+fs.readFileSync(new URL('./host/arcfox-persona-usage.mjs',import.meta.url),'utf8').replace('export function','function')+'\n'+normalized.slice(helperEnd);
normalized=normalized.replace('return json(res,200,{usage:personaUsage(template,accounts)});',"return json(res,200,Array.isArray(template.templates)?{usageByTemplate:Object.fromEntries(template.templates.slice(0,500).map(t=>[t.id,personaUsage(t,accounts)]))}:{usage:personaUsage(template,accounts)});");
const updated=source.includes('\r\n')?normalized.replaceAll('\n','\r\n'):normalized;
if(updated!==source){fs.writeFileSync(file+'.bak-persona-usage-'+Date.now(),source);fs.writeFileSync(file,updated);}
const personasFile='E:/QQ Agent/resources/app/src/personas.js';
const personasSource=fs.readFileSync(personasFile,'utf8');
const personasUpdated=personasSource.replace("name: '小鲸鱼（默认）'","name: '小鲸鱼'");
if(personasUpdated!==personasSource){fs.writeFileSync(personasFile+'.bak-persona-name-'+Date.now(),personasSource);fs.writeFileSync(personasFile,personasUpdated);}
console.log('Persona usage and builtin save protection installed.');
