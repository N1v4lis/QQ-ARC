import fs from 'node:fs';
import {patchPersonaInheritance,patchModelInheritance} from './host/arcfox-persona-inheritance.mjs';
const plans=[['E:/QQ Agent/resources/app/src/config.js',patchPersonaInheritance],['E:/QQ Agent/resources/app/src/llm.js',patchModelInheritance]].map(([file,patch])=>{const source=fs.readFileSync(file,'utf8');return {file,source,next:patch(source)};});
for(const {file,source,next} of plans){if(source===next)continue;fs.writeFileSync(file+'.bak-persona-inheritance-'+Date.now(),source);fs.writeFileSync(file,next);}
console.log('Automatic persona/model inheritance installed; legacy configuration retained for rollback.');
