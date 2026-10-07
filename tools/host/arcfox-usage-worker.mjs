import fs from 'node:fs';
import path from 'node:path';
import {parentPort} from 'node:worker_threads';
import {parseUsageSessionFile} from './arcfox-usage-parser.mjs';
let cachedDir='',cache=new Map();
parentPort.on('message',({id,dir,files,fromTs=0})=>{
  try{
    if(dir!==cachedDir){cachedDir=dir;cache=new Map();}
    const alive=new Set(files),entries=[];
    for(const key of cache.keys())if(!alive.has(key))cache.delete(key);
    for(const file of files){
      if(path.basename(file)!==file||!file.endsWith('.json'))throw Error('Invalid session filename');
      let stat;try{stat=fs.statSync(path.join(dir,file));}catch{cache.delete(file);continue;}
      if(fromTs&&stat.mtimeMs<fromTs)continue;
      const old=cache.get(file);
      const parsed=old&&old.mtime===stat.mtimeMs&&old.size===stat.size?old.parsed:parseUsageSessionFile(dir,file);
      cache.set(file,{mtime:stat.mtimeMs,size:stat.size,parsed});entries.push([file,parsed]);
    }
    parentPort.postMessage({id,entries});
  }catch{parentPort.postMessage({id,error:'Usage archive parsing failed'});}
});
