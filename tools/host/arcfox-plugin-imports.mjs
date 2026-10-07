import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
let generation=0;
// Preparation may evaluate module top-level code. setup/register/registry writes stay ordered.
export async function prepareSkillImport(dir,found,{normalizeManifest,isManifestUsable}){
  if(found.error)return {found};
  const {manifest,problems}=normalizeManifest(found.raw,{fallbackId:path.basename(dir)});
  if(!isManifestUsable(manifest,problems))return {found};
  const entryPath=path.resolve(dir,String(found.raw.entry||'index.js'));
  const relative=path.relative(dir,entryPath);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))return {found};
  try{
    const realRelative=path.relative(fs.realpathSync(dir),fs.realpathSync(entryPath));
    if(realRelative.startsWith('..')||path.isAbsolute(realRelative))return {found};
  }catch{return {found};}
  try{
    const mod=await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}-${++generation}`);
    return {found,mod};
  }catch(error){return {found,error};}
}
export async function loadOrderedBatches(dirs,load,{width=4,readManifest,normalizeManifest,isManifestUsable}){
  const limit=Math.max(1,Math.min(4,Math.floor(Number(width)||1)));
  const results=[];
  if(limit===1){for(const dir of dirs)results.push(await load(dir));return results;}
  const serial=found=>found.raw?.importMode==='serial'||(Array.isArray(found.raw?.requires)&&found.raw.requires.length>0);
  let next=0,pending;
  while(next<dirs.length){
    const found=pending??readManifest(dirs[next]);pending=undefined;
    if(serial(found)){
      results.push(await load(dirs[next++],{found}));continue;
    }
    const batch=[{dir:dirs[next++],found}];
    while(next<dirs.length&&batch.length<limit){
      const found=readManifest(dirs[next]);
      if(serial(found)){pending=found;break;}
      batch.push({dir:dirs[next++],found});
    }
    const prepared=await Promise.all(batch.map(({dir,found})=>prepareSkillImport(dir,found,{normalizeManifest,isManifestUsable})));
    for(let i=0;i<batch.length;i++)results.push(await load(batch[i].dir,prepared[i]));
    await new Promise(resolve=>setImmediate(resolve));
  }
  return results;
}
