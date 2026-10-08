// Fixed startup behavior requested by the user; retains asynchronous readiness checks.
import fs from 'node:fs';
const file='E:/QQ Agent/resources/app/src/app.js';
const source=fs.readFileSync(file,'utf8');
const old="      if (!getConfig().snowluma?.autoLaunch) { startupState.snowluma = 'disabled'; return; }";
const replacement='      // ARCFØX: always start SnowLuma when its WebUI is not already running.';
if(source.includes(old)){
 fs.writeFileSync(file+'.bak-snow-autolaunch-'+Date.now(),source);
 fs.writeFileSync(file,source.replace(old,replacement));
}else if(!source.includes(replacement))throw Error('Startup implementation changed; refusing an unverified patch');
console.log('SnowLuma startup enabled; existing port check and asynchronous launch retained.');
