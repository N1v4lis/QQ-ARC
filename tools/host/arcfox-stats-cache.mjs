// Small, process-local cache. Never persists configuration or account/session data.
export class StatsCache {
  constructor({ttl=3000,max=8,clock=Date.now}={}){this.ttl=ttl;this.max=max;this.clock=clock;this.entries=new Map();this.pending=new Map();}
  async read(key,compute,{fresh=false}={}){
    const cached=this.entries.get(key);
    if(!fresh&&cached&&this.clock()-cached.at<this.ttl)return structuredClone(cached.value);
    let job=this.pending.get(key);
    if(!job){
      job=Promise.resolve().then(compute);this.pending.set(key,job);
      job.then(value=>{
        this.entries.delete(key);this.entries.set(key,{at:this.clock(),value:structuredClone(value)});
        while(this.entries.size>this.max)this.entries.delete(this.entries.keys().next().value);
      },()=>{}).finally(()=>{if(this.pending.get(key)===job)this.pending.delete(key);});
    }
    return structuredClone(await job);
  }
}
