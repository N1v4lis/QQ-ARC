import {Worker} from 'node:worker_threads';
export class UsageReader {
  constructor(url=new URL('./arcfox-usage-worker.mjs',import.meta.url)){
    this.url=url;this.worker=null;this.pending=new Map();this.inFlight=new Map();this.sequence=0;this.closed=false;
  }
  open(){
    if(this.worker)return this.worker;
    const worker=new Worker(this.url);this.worker=worker;
    const fail=error=>{
      if(this.worker!==worker)return;
      this.worker=null;for(const {reject}of this.pending.values())reject(error);this.pending.clear();
    };
    worker.on('message',({id,entries,error})=>{
      const task=this.pending.get(id);if(!task)return;
      this.pending.delete(id);error?task.reject(Error(error)):task.resolve(new Map(entries));
      if(!this.pending.size)worker.unref();
    });
    worker.on('error',fail);worker.on('exit',()=>fail(Error('Usage worker exited')));worker.unref();return worker;
  }
  read(dir,files,fromTs=0){
    if(this.closed)return Promise.reject(Error('Usage reader closed'));
    const key=JSON.stringify([dir,files,fromTs]);
    if(this.inFlight.has(key))return this.inFlight.get(key);
    const work=new Promise((resolve,reject)=>{
      const worker=this.open(),id=++this.sequence;this.pending.set(id,{resolve,reject});worker.ref();
      try{worker.postMessage({id,dir,files,fromTs});}catch(error){this.pending.delete(id);reject(error);if(!this.pending.size)worker.unref();}
    });
    this.inFlight.set(key,work);
    work.then(()=>this.inFlight.delete(key),()=>this.inFlight.delete(key));return work;
  }
  async close(){
    this.closed=true;const worker=this.worker;this.worker=null;
    for(const {reject}of this.pending.values())reject(Error('Usage reader stopped'));
    this.pending.clear();this.inFlight.clear();if(worker)await worker.terminate();
  }
}
