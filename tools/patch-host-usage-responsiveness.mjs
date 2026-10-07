import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const host='E:/QQ Agent/resources/app';
export function usageParserSource(source){
  const begin=source.indexOf('function parseUsageSessionFile(dir, f) {');
  const end=source.indexOf('\n/**',begin);
  if(begin<0||end<0)throw Error('Usage parser anchor changed');
  return "// Derived from QQ Agent; Copyright (c) 2026 Kondius.\n// MIT license: see QQ-AGENT-LICENSE.txt. Preserve exact accounting rules.\nimport fs from 'node:fs';\nimport path from 'node:path';\nexport "+source.slice(begin,end).trim()+'\n';
}
export function patchUsageResponsiveness(source){
  if(source.includes('// ARCFOX usage responsiveness v1'))return source;
  const newline=source.includes('\r\n')?'\r\n':'\n';let out=source.replaceAll('\r\n','\n');
  const start=out.indexOf('async function refreshUsageArchive(dir, files, sig) {');
  const end=out.indexOf('\nasync function collectUsageRows',start);
  if(start<0||end<0)throw Error('Usage archive anchor changed');
  out=out.slice(0,start)+`const usageReader = new UsageReader();
async function refreshUsageArchive(dir, files, sig) {
  if (usageArchive.sessions && usageArchive.sig === sig && usageArchive.dir === dir) return usageArchive.sessions;
  const next = await usageReader.read(dir, files);
  usageArchive.sessions = next;
  usageArchive.sig = sig;
  usageArchive.dir = dir;
  usageArchive.at = Date.now();
  return next;
}
`+out.slice(end);
  const startWindow=out.indexOf('async function collectArchiveForWindow(dir, files, fromTs) {');
  const endWindow=out.indexOf('\n/**',startWindow);
  if(startWindow<0||endWindow<0)throw Error('Usage window anchor changed');
  out=out.slice(0,startWindow)+`async function collectArchiveForWindow(dir, files, fromTs) {
  return usageReader.read(dir, files, fromTs);
}
`+out.slice(endWindow);
  const edits=[
    ["import fs from 'node:fs';","// ARCFOX usage responsiveness v1\nimport { UsageReader } from './arcfox-usage-reader.mjs';\nimport fs from 'node:fs';"],
    ['function priceOf(model, vendor) {\n  const cfg = getConfig();','function priceOf(model, vendor, cfg = getConfig()) {'],
    ['function costOfRows(rows) {\n  const cfg = getConfig();','function costOfRows(rows) {\n  const cfg = getConfig();\n  const prices = new Map();'],
    ['    const p = priceOf(r.model, r.vendor);',`    const identity = JSON.stringify([r.model, r.vendor]);
    let p = prices.get(identity);
    if (!p) { p = priceOf(r.model, r.vendor, cfg); prices.set(identity, p); }`],
    ['  async function stop() {','  async function stop() {\n    await usageReader.close();']
  ];
  for(const [before,after]of edits){if(out.split(before).length!==2)throw Error('Usage response anchor changed: '+before.slice(0,55));out=out.replace(before,after);}
  return newline==='\r\n'?out.replaceAll('\n','\r\n'):out;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const target=path.join(host,'src/app.js'),original=fs.readFileSync(target),source=original.toString();
  const updated=patchUsageResponsiveness(source);
  const helperDir=path.join(path.dirname(fileURLToPath(import.meta.url)),'host');
  const parser=path.join(helperDir,'arcfox-usage-parser.mjs');
  const extracted=usageParserSource(source.replaceAll('\r\n','\n'));
  if(fs.existsSync(parser)&&fs.readFileSync(parser,'utf8')!==extracted)throw Error('Usage parser changed; review before deploying');
  if(!fs.existsSync(parser))fs.writeFileSync(parser,extracted);
  const names=['reader','worker','parser'].map(name=>`arcfox-usage-${name}.mjs`).concat('QQ-AGENT-LICENSE.txt');
  const writes=names.map(name=>({target:path.join(host,'src',name),data:fs.readFileSync(path.join(helperDir,name))}));
  if(updated!==source){fs.writeFileSync(target+'.bak-usage-responsive-'+Date.now(),original);writes.push({target,data:updated});}
  const originals=new Map(writes.map(item=>[item.target,fs.existsSync(item.target)?fs.readFileSync(item.target):null]));
  try{for(const item of writes)fs.writeFileSync(item.target,item.data);}
  catch(error){for(const [file,data]of originals){if(data===null)fs.rmSync(file,{force:true});else fs.writeFileSync(file,data);}throw error;}
  console.log('Worker archive parsing and scoped price memoization installed.');
}
