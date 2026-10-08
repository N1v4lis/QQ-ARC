import {serialize,deserialize} from 'node:v8';
import {parentPort,workerData} from 'node:worker_threads';
import {openDatabase,operate} from './account-db-core.mjs';
let db,fatal=null,cachedReply=null,scheduled=false;const queue=[];
try{db=openDatabase(workerData.root);}catch(e){fatal=e;}
function reply(shared,value,error){const control=new Int32Array(shared,0,4),buffer=new Uint8Array(shared,16);const data=serialize(error?{error:error.message,code:error.code}:{value:value??null});cachedReply=data;Atomics.store(control,1,data.length);if(data.length>buffer.length)Atomics.store(control,0,2);else{buffer.set(data);Atomics.store(control,0,1);}Atomics.notify(control,0);}
function drain(){scheduled=false;while(queue.length){const batch=queue.splice(0,64);try{if(fatal)throw fatal;db.transaction(()=>{for(const m of batch)operate(db,m.op,m.args);})();for(const m of batch)parentPort.postMessage({id:m.id,ok:true});}catch(e){fatal=e;for(const m of batch)parentPort.postMessage({id:m.id,error:e.message});}}}
parentPort.on('message',m=>{
 if(!m.shared){queue.push(m);if(!scheduled){scheduled=true;setImmediate(drain);}return;}
 try{
  drain();if(fatal)throw fatal;
  if(m.op==='reply'){const cached=deserialize(cachedReply);const e=cached.error?Object.assign(Error(cached.error),{code:cached.code}):null;reply(m.shared,cached.value,e);return;}
  reply(m.shared,operate(db,m.op,m.args));
 }catch(e){reply(m.shared,null,e);}
});
