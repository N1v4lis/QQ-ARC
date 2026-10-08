import fs from 'node:fs';import path from 'node:path';
import {databaseFor,rootForFile} from './account-db-client.mjs';
export const objectTemps=new Map();
export function readValue(file){const f=rootForFile(file);if(f)return databaseFor(f.root).request('get',{file:f.file});return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
export function writeValue(file,value){const f=rootForFile(file);if(f){if(file.endsWith('.tmp'))objectTemps.set(file,value);else databaseFor(f.root).enqueue('put',{file:f.file,value});return;}fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value),'utf8');}
