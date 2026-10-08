import fs from 'node:fs';import path from 'node:path';
import {databaseFor,rootForFile} from './account-db-client.mjs';
import {readValue,writeValue,objectTemps} from './account-storage-records.mjs';
const rpc=(f,op,args={})=>databaseFor(f.root).request(op,{file:f.file,...args});
const paths=f=>rpc(f,'list');
const bridge={
 readFileSync(file,options){if(rootForFile(file))throw Error('Native SQL records require readValue, not a JSON file adapter');return fs.readFileSync(file,options);},
 writeFileSync(file,data,options){if(rootForFile(file))throw Error('Native SQL records require writeValue, not JSON packaging');return fs.writeFileSync(file,data,options);},
 renameSync(from,to){if(objectTemps.has(from)){writeValue(to,objectTemps.get(from));objectTemps.delete(from);return;}const f=rootForFile(from);if(f){writeValue(to,readValue(from));bridge.unlinkSync(from);return;}return fs.renameSync(from,to);},
 existsSync(file){if(objectTemps.has(file))return true;const f=rootForFile(file);return f?!!rpc(f,'stat')||fs.existsSync(file):fs.existsSync(file);},
 readdirSync(file,options){const f=rootForFile(file);if(!f)return fs.readdirSync(file,options);const found=new Map();for(const r of paths(f)){const rel=r.path.slice(f.file.length+1);if(rel)found.set(rel.split('/')[0],rel.includes('/'));}let raw=[];try{raw=fs.readdirSync(file,{withFileTypes:true});}catch{}for(const e of raw)if(!found.has(e.name))found.set(e.name,e.isDirectory());return [...found].map(([name,dir])=>options?.withFileTypes?{name,isDirectory:()=>dir,isFile:()=>!dir,isSymbolicLink:()=>false}:name);},
 statSync(file){const f=rootForFile(file);if(!f)return fs.statSync(file);const row=rpc(f,'stat');if(!row)return fs.statSync(file);return {mtimeMs:row.mtime,mtime:new Date(row.mtime),size:row.bytes,isDirectory:()=>row.dir,isFile:()=>!row.dir};},
 unlinkSync(file){const f=rootForFile(file);if(!f)return fs.unlinkSync(file);if(!rpc(f,'stat')){const e=Error('Record not found');e.code='ENOENT';throw e;}databaseFor(f.root).enqueue('delete',{file:f.file});},
 rmSync(file,options={}){const f=rootForFile(file);if(!f)return fs.rmSync(file,options);databaseFor(f.root).enqueue('delete',{file:f.file,recursive:!!options.recursive});if(fs.existsSync(file))fs.rmSync(file,options);},
 copyFileSync(from,to,mode){if(rootForFile(from)||rootForFile(to)){writeValue(to,readValue(from));return;}return fs.copyFileSync(from,to,mode);}
};
export default new Proxy(fs,{get(target,key){return bridge[key]||target[key];}});
