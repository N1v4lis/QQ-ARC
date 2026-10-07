import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {patchPluginLoading} from './patch-host-plugin-loading.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.join(repo,'shots/plugin-loading');fs.mkdirSync(base,{recursive:true});
const root=fs.mkdtempSync(path.join(base,'fixture-'));
const host='E:/QQ Agent/resources/app';
const originals={loader:fs.readFileSync(path.join(host,'src/plugin-loader.js'),'utf8'),app:fs.readFileSync(path.join(host,'src/app.js'),'utf8')};
const patched=Object.fromEntries(Object.entries(originals).map(([kind,source])=>[kind,patchPluginLoading(source,kind)]));
for(const [kind,source]of Object.entries(patched))assert.equal(patchPluginLoading(source,kind),source);
function remove(target){const resolved=path.resolve(target);assert(resolved===root||resolved.startsWith(root+path.sep));fs.rmSync(resolved,{recursive:true,force:true});}
try{
  fs.mkdirSync(path.join(root,'src/skills'),{recursive:true});
  fs.mkdirSync(path.join(root,'skills'));fs.mkdirSync(path.join(root,'plugins'));
  fs.writeFileSync(path.join(root,'package.json'),' {"type":"module"}');
  for(const name of ['manager','manifest','registry','capabilities','errors','config'])fs.copyFileSync(path.join(host,`src/skills/${name}.js`),path.join(root,`src/skills/${name}.js`));
  fs.copyFileSync(path.join(host,'src/tool-registry.js'),path.join(root,'src/tool-registry.js'));
  fs.writeFileSync(path.join(root,'src/config.js'),'export const getConfig=()=>({});export const updateConfig=()=>({});');
  fs.writeFileSync(path.join(root,'src/plugin-loader.js'),patched.loader);
  fs.copyFileSync(path.join(repo,'tools/host/arcfox-plugin-imports.mjs'),path.join(root,'src/arcfox-plugin-imports.mjs'));
  globalThis.__loadEvents=[];globalThis.__importActive=0;globalThis.__importMax=0;
  function create(name,{id=name,delay=5,requires=[],entry='index.js',code}={}){
    const dir=path.join(root,'skills',name);fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'skill.json'),JSON.stringify({id,name,apiVersion:1,requires,capabilities:['seed'],entry}));
    fs.writeFileSync(path.join(dir,'index.js'),code??`
globalThis.__importActive++;globalThis.__importMax=Math.max(globalThis.__importMax,globalThis.__importActive);
globalThis.__loadEvents.push('begin:${name}');await new Promise(r=>setTimeout(r,${delay}));
globalThis.__importActive--;globalThis.__loadEvents.push('import:${name}');
export const providers={seed:()=>true};
export function setup(api){globalThis.__loadEvents.push('setup:${name}');api.registerTool({id:'ping',name:'Ping',description:'Test tool',parameters:{type:'object',properties:{}},execute:()=> '${name}'});}
`);return dir;
  }
  create('a',{id:'shared',delay:60});create('b',{id:'shared',delay:5});create('c',{delay:10});create('d',{delay:20});
  create('e',{requires:['seed']});create('f',{code:"throw Error('broken import');"});
  create('g',{entry:'../../outside.js'});create('h');
  fs.writeFileSync(path.join(root,'outside.js'),"globalThis.__outsideRan=true;export const hooks={};");
  const {loadPlugins,watchPlugins}=await import(pathToFileURL(path.join(root,'src/plugin-loader.js')));
  const {getTool}=await import(pathToFileURL(path.join(root,'src/tool-registry.js')));
  const {skillManager}=await import(pathToFileURL(path.join(root,'src/skills/manager.js')));
  const roots={skills:path.join(root,'skills'),plugins:path.join(root,'plugins')};
  const result=await loadPlugins({roots,importConcurrency:4,log:()=>{}});
  if(result.loaded.length!==6)console.log(result.failed.map(f=>({id:f.id,error:f.error})));
  assert.equal(result.loaded.length,6);assert.equal(result.failed.length,2);
  assert(globalThis.__importMax>1&&globalThis.__importMax<=4);
  assert.deepEqual(globalThis.__loadEvents.filter(e=>e.startsWith('setup:')),['setup:a','setup:b','setup:c','setup:d','setup:e','setup:h']);
  assert(globalThis.__loadEvents.indexOf('import:b')<globalThis.__loadEvents.indexOf('import:a'));
  assert(globalThis.__loadEvents.indexOf('begin:e')>globalThis.__loadEvents.indexOf('setup:d'));
  assert.equal(getTool('shared__ping').execute(),'b');assert(!globalThis.__outsideRan);
  fs.writeFileSync(path.join(root,'skills/h/index.js'),"export function setup(){throw Error('failed setup');}");
  const retry=await loadPlugins({roots,importConcurrency:1,log:()=>{}});
  assert(retry.failed.some(f=>f.id==='h'));assert.equal(getTool('h__ping').execute(),'h');
  assert(skillManager.errors.get('h').includes('沿用旧版本'));
  remove(path.join(root,'skills/c'));
  const pruned=await loadPlugins({roots,importConcurrency:1,log:()=>{}});
  assert(pruned.pruned.includes('c'));assert(!getTool('c__ping'));
  globalThis.__importMax=0;
  await Promise.all([loadPlugins({roots,importConcurrency:4,log:()=>{}}),loadPlugins({roots,importConcurrency:4,log:()=>{}})]);
  assert(globalThis.__importMax<=4,'Concurrent reloads must serialize, not double the import pool');
  const badRoot=path.join(root,'not-a-directory');fs.writeFileSync(badRoot,'invalid root');
  const queued=await Promise.allSettled([loadPlugins({roots:{...roots,skills:badRoot},log:()=>{}}),loadPlugins({roots,log:()=>{}})]);
  assert.equal(queued[0].status,'rejected');assert.equal(queued[1].status,'fulfilled');
  let callbacks=0;
  const watcher=watchPlugins({roots,log:()=>{},onReload:()=>{callbacks++;}});
  fs.appendFileSync(path.join(root,'skills/d/index.js'),'\n// queued change');
  await new Promise(r=>setTimeout(r,80));watcher.close();
  await new Promise(r=>setTimeout(r,600));assert.equal(callbacks,0,'Closing watcher must cancel queued work');
  // Run the host's actual reload function against a completed watcher result: no second load.
  const reload=patched.app.slice(patched.app.indexOf('  async function reloadSkills({'),patched.app.indexOf('  async function stop() {'));
  let loads=0;const finished={loaded:[],failed:[]};
  const ctx={process,skillManager:{list:()=>[]},loadPlugins:async()=>{loads++;return finished;},orchestrator:{refreshToolDefs:()=>{}},getConfig:()=>({extensions:{hotReload:false}}),pluginWatcher:null,watchPlugins:()=>{},log:()=>{},emit:()=>{}};
  vm.runInNewContext(reload+';globalThis.reload=reloadSkills;',ctx);
  await ctx.reload({reason:'watch',preloaded:finished});assert.equal(loads,0);
  await ctx.reload({reason:'manual'});assert.equal(loads,1);
  console.log('Plugin lifecycle passed: bounded parallel import, ordered registration, duplicate IDs, dependency barrier, failure isolation, path rejection, stale-instance recovery, prune, reload queue recovery and watcher cleanup/single-pass.');
}finally{
  remove(root);delete globalThis.__loadEvents;delete globalThis.__importActive;delete globalThis.__importMax;delete globalThis.__outsideRan;
}
