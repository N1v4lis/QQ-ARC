// Optimize readiness detection and use Node's native compile cache; no native binary changes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const host='E:/QQ Agent/resources/app';
export function patchSnowStartup(source,kind){
  const marker=kind==='core'?'// ARCFOX Snow startup cache v1':'// ARCFOX Snow compile cache flush v1';
  if(source.includes(marker))return source;
  const newline=source.includes('\r\n')?'\r\n':'\n';let result=source.replaceAll('\r\n','\n');
  const changes=kind==='core'?[
    ['          const child = spawn(nodeExe, [indexMjs], {',`          // ARCFOX Snow startup cache v1
          const child = spawn(nodeExe, [indexMjs], {`],
    ["            cwd: dir,\n            stdio: ['ignore', 'pipe', 'pipe'],",`            cwd: dir,
            env: { ...process.env, NODE_COMPILE_CACHE: path.join(dir, 'data', '.arcfox-compile-cache') },
            stdio: ['ignore', 'pipe', 'pipe'],`],
    ["            for (let i = 0; i < 20 && !(await __isPortOpenRaw('127.0.0.1', webuiPort)); i++) {\n              checkStartup();\n              await new Promise((resolve) => setTimeout(resolve, 1000));\n            }",`            const readyDeadline = Date.now() + 20_000;
            while (Date.now() < readyDeadline) {
              checkStartup();
              if (await __isPortOpenRaw('127.0.0.1', webuiPort)) break;
              await new Promise((resolve) => setTimeout(resolve, 200));
            }`]
  ]:[
    ['import { createRequire as __snowlumaCreateRequire } from "node:module";',`// ARCFOX Snow compile cache flush v1
import { createRequire as __snowlumaCreateRequire, flushCompileCache as __arcfoxFlushCompileCache } from "node:module";`],
    ['\tlet shutdownStarted = false;',`\t// Save compiled modules after startup; Windows process termination may skip exit hooks.
\ttry { __arcfoxFlushCompileCache(); } catch { /* Cache failure cannot block startup. */ }
\tlet shutdownStarted = false;`]
  ];
  for(const [before,after]of changes){if(result.split(before).length!==2)throw Error('Snow startup anchor changed: '+kind);result=result.replace(before,after);}
  return newline==='\r\n'?result.replaceAll('\n','\r\n'):result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const changes=[['src/app.js','core'],['snowluma/index.mjs','snow']].map(([relative,kind])=>{
    const target=path.join(host,relative),original=fs.readFileSync(target);
    return {target,original,result:patchSnowStartup(original.toString(),kind)};
  });
  const written=[];
  try{for(const c of changes){if(c.result===c.original.toString())continue;fs.writeFileSync(c.target+'.bak-snow-startup-'+Date.now(),c.original);written.push(c);fs.writeFileSync(c.target,c.result);}}
  catch(error){for(const c of written)fs.writeFileSync(c.target,c.original);throw error;}
  console.log('Snow startup cache and readiness patch installed.');
}
