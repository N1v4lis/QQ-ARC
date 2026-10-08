import {withPage} from './cdp.mjs';
await withPage({url:process.argv[2]||'http://127.0.0.1:3210/',width:1360,height:900},async page=>{
 await page.waitFor('!!state.config && !document.querySelector("#loading-overlay:not(.hidden)")',{timeout:20000});
 const events=[];page.on(e=>{if(e.method==='Tracing.dataCollected')events.push(...e.params.value);});
 if(process.argv.includes('--trace'))await page.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReportEvents'});
 await page.eval(`window.__navProbe={requests:0,renders:0,renderMs:[],scrolls:0,long:[]};const f=fetch;window.fetch=(...a)=>{__navProbe.requests++;return f(...a)};const r=renderSettings;renderSettings=(...a)=>{__navProbe.renders++;const t=performance.now();const v=r(...a);__navProbe.renderMs.push({page:state.tab,ms:Math.round(performance.now()-t)});return v};const s=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(...a){__navProbe.scrolls++;return s.apply(this,a)};new PerformanceObserver(l=>__navProbe.long.push(...l.getEntries().map(e=>({ms:Math.round(e.duration),page:state.tab})))).observe({type:'longtask',buffered:false});`);
 for(const name of ['persona','skills','plugins','settings','persona','dashboard']){
  textResult(await page.eval(`(()=>{const t=performance.now();switchTab('${name}');return {page:'${name}',syncMs:Math.round(performance.now()-t)};})()`));
  await page.eval('new Promise(resolve=>setTimeout(resolve,350))');
 }
 console.log(await page.eval('JSON.stringify(__navProbe)'));
 if(process.argv.includes('--trace')){
  await page.send('Tracing.end');await new Promise(r=>setTimeout(r,500));
  console.log(JSON.stringify(events.filter(e=>e.dur>20000).map(e=>({name:e.name,ms:Math.round(e.dur/1000),data:e.args?.data?.functionName||e.args?.data?.url||'',roots:e.args?.endData?.layoutRoots}))));
 }
});
function textResult(v){console.log(JSON.stringify(v));}
