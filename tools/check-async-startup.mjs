// Targeted lifecycle checks, independent of the retired UI regression suites.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {patchAsyncStartup} from './patch-host-async-startup.mjs';
const source=fs.readFileSync('E:/QQ Agent/resources/app/src/app.js','utf8');
assert.equal(patchAsyncStartup(source,'app'),source,'Patch must be idempotent');
const main=fs.readFileSync('E:/QQ Agent/resources/app/electron/main.js','utf8');
assert.equal(patchAsyncStartup(main,'main'),main);
assert.throws(()=>patchAsyncStartup('unrelated source','app'),/anchor changed/);
const startSource=source.slice(source.indexOf('  async function start({'),source.indexOf('  // ── Skill 重扫'));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
  const skills=deferred(),snow=deferred(),events=[],timers=[];
  let probes=0;
  const noop=()=>{};
  const ctx={AbortController,setImmediate,Promise,Error,Map,
    getConfig:()=>({server:{port:3210},snowluma:{autoLaunch:true},api:{},proactive:{enabled:false}}),
    listenOn:async port=>{if(port===3210)throw Object.assign(new Error('occupied'),{code:'EADDRINUSE'});return port;},
    startTelemetryLoop:noop,log:noop,sessions:{reconcileInBackground:()=>events.push('reconcile')},
    collectUsageRows:async()=>events.push('warmup'),reloadSkills:()=>skills.promise,
    orchestrator:{refreshToolDefs:noop,startReminderLoop:noop},pluginWatcher:null,
    snowlumaWebuiPort:()=>40653,snowlumaWsPort:()=>3001,
    __isPortOpenRaw:async()=>++probes>1,launchSnowluma:async()=>{await snow.promise;return {ok:true,launched:true};},
    // Cached probes are forbidden on the startup path.
    isPortOpen:()=>{throw Error('Cached probe used during startup');},
    syncSnowlumaTokens:()=>false,onebot:{connect:async()=>events.push('onebot')},
    accountRuntimes:new Map(),startSnowlumaFollow:noop,emit:noop,
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return {unref:noop};},setInterval:()=>({unref:noop})
  };
  vm.runInNewContext('const startupState={ready:false,plugins:"pending",snowluma:"pending"};let usageWarmupTimer=null,obPortPollTimer=null;'+startSource+';globalThis.start=start;globalThis.state=startupState;',ctx);
  return {ctx,skills,snow,events,timers};
}
const f=fixture();let bound;
const run=f.ctx.start({onListening:port=>{bound=port;f.events.push('window');}});
await new Promise(setImmediate);
assert.equal(bound,3211,'Window must use the actual fallback port');
assert.deepEqual(f.events,['window'],'Window must not await plugins or SnowLuma');
f.skills.resolve({loaded:[],failed:[]});await new Promise(setImmediate);
assert(!f.events.includes('onebot'),'OneBot must wait for SnowLuma too');
f.snow.resolve();assert.equal(await run,3211);
assert(f.ctx.state.ready);assert.equal(f.ctx.state.plugins,'ready');
assert.equal(f.ctx.state.snowluma,'ready');assert(f.events.includes('onebot'));
assert(!f.events.includes('warmup'));assert(!f.events.includes('reconcile'));
f.timers.find(t=>t.ms===30000).fn();
assert(f.events.includes('warmup'));assert(f.events.includes('reconcile'));
const canceled=fixture(),controller=new AbortController();
const pending=canceled.ctx.start({signal:controller.signal,onListening:()=>{}});
const rejected=assert.rejects(pending,error=>error.name==='AbortError');
await new Promise(setImmediate);controller.abort();
canceled.skills.resolve({loaded:[],failed:[]});canceled.snow.resolve();await rejected;
assert(!canceled.ctx.state.ready);assert(!canceled.events.includes('onebot'));
assert(!canceled.timers.some(t=>t.ms===30000),'Canceled startup must not schedule warmup');
console.log('Async startup: early window, fallback port, readiness gate, fresh probes, deferred warmup, cancellation and patch idempotency passed.');
