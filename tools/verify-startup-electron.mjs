// Attach to the real app after restart-agent --apply --cdp-port 9224.
import fs from 'node:fs';
import {withElectronPage} from './cdp.mjs';
const report={date:new Date().toISOString(),checks:[]};let failed=0;
function ok(name,pass,detail=''){report.checks.push({name,pass:!!pass,detail});console.log(`${pass?'✔':'✗'} ${name} ${detail}`);if(!pass)failed++;}
try{await withElectronPage({},async(page,logs)=>{
  await page.send('Page.enable');
  const probe=await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__arcfoxProbe={samples:[],finished:false};const timer=setInterval(()=>{if(!window.qqaStartup)return;const s=qqaStartup.state();if(s.disposed){window.__arcfoxProbe.finished=true;clearInterval(timer);return;}if(s.count)window.__arcfoxProbe.samples.push({time:s.time,frames:s.frames,count:s.count,reduced:s.reduced,duration:s.duration,active:s.active});},35);`});
  await page.send('Page.reload');
  await page.waitFor('window.__arcfoxProbe?.finished',{timeout:30000,label:'真实启动动画完成'});
  await page.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:probe.identifier});
  ok('真实Electron外壳',await page.eval('!!qqAgentShell?.controls&&document.documentElement.dataset.shell==="electron"'));
  const samples=await page.eval('__arcfoxProbe.samples');report.samples=samples;const first=samples[0];
  ok(first?.reduced?'真实窗口尊重减弱动态效果':'真实窗口进入粒子聚合阶段',first?.reduced?first.duration===500:samples.some(s=>s.time>=800&&s.time<2150));
  const final=samples.filter(s=>s.time>=2150);ok('最终画面停止绘制',first?.reduced||final.length>1&&final.every(s=>s.frames===final[0].frames));
  if(first&&!first.reduced){const body=samples.filter(s=>s.time>100&&s.time<2100),a=body[0],b=body.at(-1);report.fps=a&&b?(b.frames-a.frames)/((b.time-a.time)/1000):0;ok('真实Canvas动画30~64FPS',report.fps>=30&&report.fps<=64,report.fps.toFixed(1)+' FPS');}
  ok('就绪后无残留启动遮罩',await page.eval('qqaStartup.state().ready&&qqaStartup.state().complete&&!document.getElementById("loading-overlay")'));
  ok('自绘标题栏控制仍在',await page.eval('!!document.querySelector("#q-winctl [data-qwin=close]")'));
  await page.screenshot('shots/startup/electron-ready.png');
  ok('真实启动无脚本与CSP错误',!logs.some(l=>/\[exception\]|\[error\]|Refused to|\[log:error\]/.test(l)),logs.filter(l=>/exception|error|Refused/.test(l)).join(' | '));
});}catch(error){ok('真机验收执行完成',false,error.stack||error.message);}
fs.mkdirSync('shots/startup',{recursive:true});fs.writeFileSync('shots/startup/electron-checks.json',JSON.stringify(report,null,2));process.exit(failed?2:0);
