import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const host='E:/QQ Agent/resources/app';
export function patchPluginLoading(source,kind){
  const marker=kind==='loader'?'// ARCFOX ordered parallel imports v1':'// ARCFOX single-pass reload v1';
  if(source.includes(marker))return source;
  const newline=source.includes('\r\n')?'\r\n':'\n';let out=source.replaceAll('\r\n','\n');
  const changes=kind==='loader'?[
    ["import fs from 'node:fs';",`// ARCFOX ordered parallel imports v1
import { loadOrderedBatches } from './arcfox-plugin-imports.mjs';
import fs from 'node:fs';`],
    ['async function loadSkillDir(dir, { log = console.log, kind = null } = {}) {','async function loadSkillDir(dir, { log = console.log, kind = null, prepared = null } = {}) {'],
    ['  const found = readManifest(dir);','  const found = prepared?.found ?? readManifest(dir);'],
    ['    mod = await import(`${entryUrl}?t=${Date.now()}`);','    if (prepared?.error) throw prepared.error;\n    mod = prepared?.mod ?? await import(`${entryUrl}?t=${Date.now()}`);'],
    ["async function loadSkillRoot(rootDir, { log = console.log, label = 'skill' } = {}) {","async function loadSkillRoot(rootDir, { log = console.log, label = 'skill', importConcurrency = 1 } = {}) {"],
    ['  const results = [];\n  const kind = kindOfDir(rootDir);\n  for (const dir of dirs) {\n    // 逐个串行加载：并行 import 时若两个 Skill 抢同一 id，顺序不确定\n    results.push(await loadSkillDir(dir, { log, kind }));\n  }',`  const kind = kindOfDir(rootDir);
  const results = await loadOrderedBatches(dirs,
    (dir, prepared) => loadSkillDir(dir, { log, kind, prepared }),
    { width: importConcurrency, readManifest, normalizeManifest, isManifestUsable });`],
    ['export async function loadPlugins({ log = console.log, roots = null } = {}) {',`let pluginLoadTail = Promise.resolve();
export function loadPlugins(options = {}) {
  const result = pluginLoadTail.then(() => loadPluginsOnce(options));
  pluginLoadTail = result.catch(() => {});
  return result;
}
async function loadPluginsOnce({ log = console.log, roots = null, importConcurrency = 1 } = {}) {`],
    ["loadSkillRoot(skillsRoot, { log, label: 'skill' })","loadSkillRoot(skillsRoot, { log, label: 'skill', importConcurrency })"],
    ["loadSkillRoot(pluginsRoot, { log, label: 'plugin' })","loadSkillRoot(pluginsRoot, { log, label: 'plugin', importConcurrency })"],
    ["      if (typeof onReload === 'function') onReload(result);","      if (!closed && typeof onReload === 'function') await onReload(result);"],
    ['  let reloadTimer = null;','  let closed = false;\n  let reloadTimer = null;'],
    ['  const runReload = async (filename) => {','  const runReload = async (filename) => {\n    if (closed) return;'],
    ['  const scheduleReload = (filename) => {','  const scheduleReload = (filename) => {\n    if (closed) return;'],
    ['  return { close: () => { for (const w of watchers)', '  return { close: () => { closed = true; clearTimeout(reloadTimer); pendingAgain = false; for (const w of watchers)']
  ]:[
    ["  async function reloadSkills({ reason = 'manual' } = {}) {\n    const result = await loadPlugins({ log });",`  // ARCFOX single-pass reload v1
  async function reloadSkills({ reason = 'manual', preloaded = null } = {}) {
    const requestedWidth = process.env.QQ_AGENT_PLUGIN_IMPORT_CONCURRENCY;
    const width = requestedWidth === undefined ? 4 : Number(requestedWidth);
    const result = preloaded ?? await loadPlugins({ log, importConcurrency: reason === 'boot' ? width : 1 });`],
    ["onReload: () => reloadSkills({ reason: 'watch' })","onReload: (preloaded) => reloadSkills({ reason: 'watch', preloaded })"]
  ];
  for(const [before,after]of changes){if(out.split(before).length!==2)throw Error('Plugin loading anchor changed: '+kind+' '+before.slice(0,75));out=out.replace(before,after);}
  return newline==='\r\n'?out.replaceAll('\n','\r\n'):out;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const changes=[['src/plugin-loader.js','loader'],['src/app.js','app']].map(([rel,kind])=>{
    const target=path.join(host,rel),original=fs.readFileSync(target);
    return {target,original,updated:patchPluginLoading(original.toString(),kind)};
  });
  const helper=path.join(host,'src/arcfox-plugin-imports.mjs');
  const previousHelper=fs.existsSync(helper)?fs.readFileSync(helper):null;
  const written=[];
  try{
    fs.copyFileSync(new URL('./host/arcfox-plugin-imports.mjs',import.meta.url),helper);
    for(const c of changes){if(c.updated===c.original.toString())continue;fs.writeFileSync(c.target+'.bak-plugin-loading-'+Date.now(),c.original);written.push(c);fs.writeFileSync(c.target,c.updated);}
  }catch(error){for(const c of written)fs.writeFileSync(c.target,c.original);if(previousHelper)fs.writeFileSync(helper,previousHelper);else if(fs.existsSync(helper))fs.unlinkSync(helper);throw error;}
  console.log('Ordered parallel import and single-pass hot reload installed.');
}
