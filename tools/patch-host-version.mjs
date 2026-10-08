import fs from 'node:fs';
const version=fs.readFileSync(new URL('../VERSION',import.meta.url),'utf8').trim();
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid version');
const file='E:/QQ Agent/resources/app/package.json';
const source=fs.readFileSync(file,'utf8'),pkg=JSON.parse(source);
if(pkg.version!==version){fs.writeFileSync(file+'.bak-version-'+Date.now(),source);pkg.version=version;fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');}
console.log('QQA host version: '+version);
