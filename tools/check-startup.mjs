import fs from 'node:fs';
import {withPage,sleep} from './cdp.mjs';
const base=process.argv[2]||'http://127.0.0.1:3400/';
const preview=new URL('startup-preview.html',base).href;
let failed=0;const checks=[],report={date:new Date().toISOString(),base,checks};
function ok(name,pass,detail=''){checks.push({name,pass:!!pass,detail});console.log(`${pass?'✔':'✗'} ${name} ${detail}`);if(!pass)failed++;}
const pixels=`(()=>{const c=document.querySelector('canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=2166136261;for(const x of d)hash=Math.imul(hash^x,16777619);return hash>>>0;})()`;
try{
  await withPage({url:preview,width:1440,height:900},async(page,logs)=>{
    await page.waitFor('!!window.arcfoxPreview',{timeout:20000});
    await page.eval('window.__sharedParticleSystem=arcfoxPreview.instance.system');
    let stable=true;for(const t of [0,150,412,650,800,1050,1250,1400,1700,1990,2050,2150,2600]){
      await page.eval(`arcfoxPreview.setTheme('light');arcfoxPreview.seek(${t})`);const light=await page.eval(`arcfoxPreview.state(${t})`);
      await page.eval(`arcfoxPreview.setTheme('dark')`);const dark=await page.eval(`arcfoxPreview.state(${t})`);
      stable&&=JSON.stringify(light.geometry)===JSON.stringify(dark.geometry)&&light.seed===dark.seed&&light.count===dark.count;
    }ok('亮暗13个采样时刻每粒子坐标、尺寸与延迟完全相同',stable);
    ok('切换亮暗从未重建粒子系统',await page.eval('__sharedParticleSystem===arcfoxPreview.instance.system'));
    const first=await page.eval('arcfoxPreview.instance.system');await page.eval(`arcfoxPreview.setTheme('light')`);
    ok('固定seed且桌面320粒子',first.particles.length===320&&first.particles.every(p=>p.seed===0xA7CF0A));
    ok('目标来自SVG alpha mask且非空',first.cells.length>0&&first.wordCells.length>0&&first.particles.every(p=>Number.isFinite(p.targetX)&&Number.isFinite(p.targetY)));
    await page.eval('arcfoxPreview.seek(2150)');const final=await page.eval(pixels);await page.eval('arcfoxPreview.seek(2600)');ok('第6阶段逐像素静止，没有追加阶段',final===await page.eval(pixels));
    const previewState=await page.eval('arcfoxPreview.state()');ok('桌面logo尺寸与文字比例',previewState.layout.logoWidth/1440>=.08&&previewState.layout.logoWidth/1440<=.12);
    await page.eval('arcfoxPreview.play()');await sleep(2800);const stopped=await page.eval('arcfoxPreview.state()');await sleep(250);ok('播放完成停止rAF绘制',stopped.complete&&!stopped.active&&stopped.frames===await page.eval('arcfoxPreview.state().frames'));
    const performanceSample=await page.eval(`(async()=>{arcfoxPreview.instance.stop();const times=[];for(let i=0;i<160;i++){const t=performance.now();arcfoxPreview.seek(200+i*12);times.push(performance.now()-t);}times.sort((a,b)=>a-b);return {meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[Math.floor(times.length*.95)]};})()`);
    report.render=performanceSample;ok('320粒子Canvas单帧绘制p95低于33ms',performanceSample.p95Ms<33,JSON.stringify(performanceSample));
    await page.eval(`arcfoxPreview.setTheme('light');arcfoxPreview.seek(2600)`);await page.screenshot('shots/startup/final-light.png');
    await page.eval(`arcfoxPreview.setTheme('dark');arcfoxPreview.seek(2600)`);await page.screenshot('shots/startup/final-dark.png');
    ok('预览无CSP与运行错误',!logs.some(l=>/\[exception\]|\[error\]|\[log:error\]|Refused to/.test(l)),logs.filter(l=>/error|exception|Refused/.test(l)).join(' | '));
  });
  await withPage({url:preview,width:390,height:844,deviceScaleFactor:2},async(page)=>{
    await page.waitFor('!!window.arcfoxPreview',{timeout:20000});const s=await page.eval('arcfoxPreview.state()');ok('移动端212粒子且logo宽24%',s.count===212&&Math.abs(s.layout.logoWidth/390-.24)<.001);
    await page.eval('arcfoxPreview.seek(2600)');await page.screenshot('shots/startup/mobile.png');
    ok('移动端无横向溢出且DPR封顶1.5',await page.eval('document.documentElement.scrollWidth===innerWidth&&document.querySelector("canvas").width<=390*1.5'));
  });
  await withPage({url:preview,motion:'reduce'},async(page)=>{
    await page.waitFor('!!window.arcfoxPreview',{timeout:20000});await sleep(700);const s=await page.eval('arcfoxPreview.state()');ok('减弱动态效果500ms完成并静止',s.reduced&&s.duration===500&&s.complete&&!s.active);
  });
  // Hold actual readiness, so the real startup must finish visually without dismissing.
  const hold=`window.qqAgentShell={controls:{minimize(){},maximize(){},close(){}},onWindowState(){},getWindowState:async()=>({maximized:false})};window.__releaseBoot=false;const realFetch=window.fetch.bind(window);window.fetch=async(input,options)=>{const u=typeof input==='string'?input:input.url;if(u?.includes('/api/status'))while(!window.__releaseBoot)await new Promise(r=>setTimeout(r,40));return realFetch(input,options);};`;
  await withPage({url:base,initScripts:[hold]},async(page,logs)=>{
    await page.waitFor('window.qqaStartup?.state().complete',{timeout:12000,label:'六阶段完成'});let s=await page.eval('qqaStartup.state()');
    ok('真实启动等待后端时停留最终画面',s.complete&&!s.ready&&!s.disposed&&!!(await page.eval('document.getElementById("loading-overlay")')));
    const frames=s.frames;await sleep(400);ok('等待服务不持续绘制',frames===await page.eval('qqaStartup.state().frames'));
    ok('外壳桥存在时启动遮罩不覆盖窗口按钮',await page.eval(`(()=>{const b=document.querySelector('#q-winctl button');if(!b)return false;const r=b.getBoundingClientRect();return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#q-winctl');})()`));
    ok('启动详情与ARIA状态保留',await page.eval('!!document.querySelector("#loading-status[role=status]")&&!!document.querySelector("details #loading-logs")'));
    await page.click('.arcfox-startup-details summary');ok('启动详情可展开',await page.eval('document.querySelector(".arcfox-startup-details").open'));
    await page.eval('window.__releaseBoot=true');await page.waitFor('qqaStartup.state().disposed&&!document.getElementById("loading-overlay")',{timeout:30000});
    ok('服务就绪后摘除遮罩并释放画布',await page.eval('qqaStartup.state().ready&&qqaStartup.state().disposed&&!!document.querySelector("#tabs .tab.active")'));
    ok('真实接入没有新的脚本或CSP错误',!logs.some(l=>/\[exception\]|Refused to/.test(l)));
  });
  await withPage({url:base,initScripts:[`localStorage.setItem('qqa-motion','off');`]},async(page)=>{
    await page.waitFor('!!window.qqaStartup',{timeout:15000});await page.waitFor('qqaStartup.state().disposed',{timeout:30000});ok('应用动效关闭也不会阻塞启动',await page.eval('qqaStartup.state().ready&&qqaStartup.state().disposed'));
  });
  await withPage({url:base,initScripts:[`const f=window.fetch.bind(window);window.fetch=(url,options)=>String(url).includes('arcfox-logo.svg')?Promise.resolve(new Response('',{status:404})):f(url,options);`]},async(page)=>{
    await page.waitFor('window.qqaStartup?.state().disposed',{timeout:30000});ok('SVG资源失败降级静态画面且不阻塞就绪',await page.eval('qqaStartup.state().complete&&qqaStartup.state().ready&&qqaStartup.state().disposed'));
  });
}catch(error){ok('启动验收执行完成',false,error.stack||error.message);}
fs.mkdirSync('shots/startup',{recursive:true});fs.writeFileSync('shots/startup/checks.json',JSON.stringify(report,null,2));console.log(`\n${checks.length-failed}/${checks.length} 启动检查通过`);process.exit(failed?2:0);
