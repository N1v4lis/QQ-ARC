// Expose the existing cached QQ.exe process scan; do not add another process query.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const defaultTarget='E:/QQ Agent/resources/app/src/app.js';
export function patchQqDetection(source){
  if(source.includes('detectedRunning: pid !== null || qqDetectedCount > 0')&&source.includes('qqDetectedCount = procs.length;'))return source;
  if(source.includes('qqDetectedCount'))throw Error('Incomplete QQ detection patch; inspect the host before editing');
  const replacements=[
    ['  let qqPidCache = { at: 0, pid: undefined };','  let qqDetectedCount = null;\n  let qqPidCache = { at: 0, pid: undefined };'],
    ['    const procs = await listQqProcesses();','    const procs = await listQqProcesses();\n    qqDetectedCount = procs.length;'],
    ['          pid,\n          dir: qqPortableDir(),','          pid,\n          detectedRunning: pid !== null || qqDetectedCount > 0,\n          detectedCount: Math.max(pid !== null ? 1 : 0, qqDetectedCount || 0),\n          dir: qqPortableDir(),']
  ];
  const newline=source.includes('\r\n')?'\r\n':'\n';let result=source.replaceAll('\r\n','\n');
  for(const [before,after] of replacements){if(result.split(before).length!==2)throw Error('QQ detection host anchor changed');result=result.replace(before,after);}
  return newline==='\r\n'?result.replaceAll('\n','\r\n'):result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const source=fs.readFileSync(defaultTarget,'utf8'),updated=patchQqDetection(source);
  if(updated===source)console.log('QQ process summary already installed.');
  else{fs.copyFileSync(defaultTarget,defaultTarget+'.bak-qq-detection-'+Date.now());fs.writeFileSync(defaultTarget,updated);console.log('Installed cached QQ process summary; restart the host to activate.');}
}
