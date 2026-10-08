import {serialize,deserialize} from 'node:v8';
import path from 'node:path';
import fs from 'node:fs';
import {Worker,isMainThread} from 'node:worker_threads';
import {openDatabase,operate,DB_NAME} from './account-db-core.mjs';
const clients=new Map();
export class AccountDatabase{
 constructor(root){this.root=path.resolve(root);this.sequence=0;this.pending=new Map();this.pendingBytes=0;this.error=null;this.closed=false;
  if(!isMainThread){this.inline=openDatabase(this.root,{readonly:true,migrate:false});return;}
  this.worker=new Worker(new URL('./account-db-worker.mjs',import.meta.url),{workerData:{root:this.root},resourceLimits:{maxYoungGenerationSizeMb:4}});this.worker.unref();
  this.worker.on('error',e=>{this.error=e;console.error('[storage] database worker failed:',e.message);});
  this.worker.on('exit',code=>{if(!this.closed){this.error=Error('Database worker exited: '+code);}});
  this.worker.on('message',m=>{const bytes=this.pending.get(m.id)||0;this.pending.delete(m.id);this.pendingBytes-=bytes;if(m.error){this.error=Error(m.error);console.error('[storage] persistence failed:',m.error);}if(!this.pending.size&&!this.closed)this.worker.unref();});
  try{this.request('flush',{},120000);}catch(e){this.closed=true;this.worker.ref();this.worker.terminate();throw e;}
 }
 request(op,args={},timeout=30000){if(this.error)throw this.error;if(this.closed)throw Error('Database is closed');if(this.inline)return operate(this.inline,op,args);
  let shared=new SharedArrayBuffer(1024*1024+16);const wait=(op)=>{const c=new Int32Array(shared,0,4);this.worker.postMessage({op,args,shared});if(Atomics.wait(c,0,0,timeout)==='timed-out'){this.error=Error('Database operation timed out');throw this.error;}return c;};
  let c=wait(op);if(Atomics.load(c,0)===2){const size=Atomics.load(c,1);if(size>128*1024*1024)throw Error('Database response exceeds compatibility limit');shared=new SharedArrayBuffer(size+16);c=wait('reply');}
  const result=deserialize(Buffer.from(shared,16,Atomics.load(c,1)));if(result.error){const e=Error(result.error);e.code=result.code;throw e;}return result.value;
 }
 enqueue(op,args={}){if(this.error)throw this.error;if(this.closed)throw Error('Database is closed');if(this.inline)throw Error('Read-only archive worker');
  const bytes=serialize(args).byteLength;if(this.pendingBytes+bytes>8*1024*1024)this.flush();
  const id=++this.sequence;this.pending.set(id,bytes);this.pendingBytes+=bytes;this.worker.ref();this.worker.postMessage({id,op,args});
 }
 flush(){const value=this.request('flush');this.pending.clear();this.pendingBytes=0;this.worker?.unref();return value;}
 async close(){if(this.closed)return;this.flush();if(!this.inline)this.request('checkpoint');this.closed=true;if(this.inline)this.inline.close();else {this.worker.ref();await this.worker.terminate();}clients.delete(this.root);}
}
export function databaseFor(root){root=path.resolve(String(root));let db=clients.get(root);if(!db){db=new AccountDatabase(root);clients.set(root,db);}return db;}
export async function closeDatabases(){await Promise.all([...clients.values()].map(db=>db.close()));}
export function flushDatabases(){for(const db of clients.values())db.flush();}
export function databasesStatus(){return [...clients.values()].map(db=>({root:db.root,pending:db.pending.size,pendingBytes:db.pendingBytes,error:db.error?.message||null}));}
const managed=rel=>/^(messages|sessions|memory|usage-days)(\/|$)/.test(rel)||/^(session-index-cache|usage-today|telemetry-totals|usage-daily)\.json(?:\..*)?$/.test(rel);
export function rootForFile(file){if(typeof file!=='string')return null;let resolved=path.resolve(file);for(const root of clients.keys()){if(resolved.startsWith(root+path.sep)){const rel=path.relative(root,resolved).replaceAll('\\','/');if(managed(rel))return {root,file:rel};}}
 if(managed(path.basename(resolved))){const root=path.dirname(resolved);if(fs.existsSync(path.join(root,DB_NAME)))return {root,file:path.basename(resolved)};}
 const parts=resolved.split(path.sep);for(let i=parts.length-1;i>=0;i--){if(['messages','sessions','memory','usage-days'].includes(parts[i])){const root=parts.slice(0,i).join(path.sep);if(fs.existsSync(path.join(root,DB_NAME)))return {root,file:parts.slice(i).join('/')};}}
 return null;
}
export function saveChatState(root,state,delta){const {messages,...meta}=state;const file='messages/'+String(state.chatKey).replace(/[^a-z0-9_]/gi,'_')+'.json';const db=databaseFor(root);if(delta)db.enqueue('chatDelta',{file,meta,upserts:delta.upserts,removed:delta.removed||[]});else db.enqueue('put',{file,value:state});}
