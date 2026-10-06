// Requires restart-agent --apply --cdp-port 9224. Attaches to the actual window.
import fs from 'node:fs';
import {withElectronPage,sleep} from './cdp.mjs';
const report={date:'2026-10-07',checks:[],samples:[]};
let failed=false;
function ok(name,condition,detail=''){report.checks.push({name,pass:!!condition,detail});console.log(`${condition?'✔':'✗'} ${name} ${detail}`);if(!condition)failed=true;}
try{await withElectronPage({url:'http://127.0.0.1:3210/'},async(page,logs)=>{
  await page.waitFor('window.qqaWineFox && !document.getElementById("loading-overlay")',{timeout:60000,label:'Electron就绪'});
  ok('真实Electron桥存在',await page.eval('!!window.qqAgentShell?.controls && document.documentElement.dataset.shell==="electron"'));
  await page.eval('qqaWineFox.set({enabled:false})');
  await page.send('Performance.enable');
  async function sample(name){await sleep(200);const a=await page.send('Performance.getMetrics');const n=await page.eval('qqaWineFox.state().frames||0');await sleep(3000);
    const b=await page.send('Performance.getMetrics');const s=await page.eval('qqaWineFox.state()');const aa=Object.fromEntries(a.metrics.map(m=>[m.name,m.value])),bb=Object.fromEntries(b.metrics.map(m=>[m.name,m.value]));
    const row={name,fps:((s.frames||0)-n)/3,taskMsPerSecond:(bb.TaskDuration-aa.TaskDuration)*1000/3,jsHeapMiB:bb.JSHeapUsedSize/1048576};report.samples.push(row);console.log(JSON.stringify(row));return row;}
  await sample('disabled');
  await page.eval('qqaWineFox.set({enabled:true,animation:"idle",expression:-1,paused:false})');await page.waitFor('qqaWineFox.state().loaded',{timeout:60000,label:'真机加载'});
  const running=await sample('running');ok('真机限帧运行',running.fps>10&&running.fps<=32);
  report.renderer=await page.eval('(()=>{const gl=document.querySelector("#wine-fox-pet canvas").getContext("webgl2"),e=gl.getExtension("WEBGL_debug_renderer_info");return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);})()');
  await page.eval('qqaWineFox.set({paused:true})');const paused=await sample('paused');ok('真机暂停停止绘制',paused.fps===0);
  await page.eval('qqaWineFox.set({paused:false});qqAgentShell.controls.minimize()');
  await sleep(600);ok('最小化触发挂起',await page.eval('document.hidden && qqaWineFox.state().suspended'));
  const hidden=await sample('minimized');ok('最小化停止绘制',hidden.fps===0);
  await page.eval('qqAgentShell.refocus()');await page.waitFor('!document.hidden&&!qqaWineFox.state().suspended',{timeout:10000,label:'窗口恢复'});
  const restored=await sample('restored');ok('恢复后继续绘制',restored.fps>10&&restored.fps<=32);
  await page.click('#tabs .tab[data-tab="settings"]');await page.waitFor('!!document.querySelector("#settings-sidebar [data-section=theme]")',{timeout:30000});await page.click('#settings-sidebar [data-section=theme]');
  await page.waitFor('!!document.getElementById("card-wine-fox")',{timeout:30000});await sleep(500);
  await page.screenshot('shots/final/wine-fox-electron.png');
  ok('最终展示酒狐与主题设置',await page.eval('qqaWineFox.state().loaded&&!!document.querySelector("[data-wine-fox-pref=enabled]:checked")'));
  report.state=await page.eval('qqaWineFox.state()');
  const errors=logs.filter(l=>/\[exception\]|\[error\]|Refused to|Content Security Policy/.test(l));ok('真机无新运行错误',errors.length===0,errors.join(' | '));
});}catch(e){ok('真机验收完成',false,e.stack||e.message);}
fs.mkdirSync('shots/final',{recursive:true});fs.writeFileSync('shots/final/wine-fox-electron.json',JSON.stringify(report,null,2));process.exit(failed?2:0);
