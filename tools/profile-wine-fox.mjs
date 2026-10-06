// Read-only package verification and isolated Edge measurement. The probe is
// appended to the HTTP response in memory; supplied assets remain byte-identical.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { withPage, sleep } from './cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pack = path.join(root, 'Wine_Fox');
const output = path.join(root, 'docs', 'wine-fox-assessment');
fs.mkdirSync(output, { recursive: true });
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const files = walk(pack);
const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'MANIFEST.json'), 'utf8'));
const missing = [], mismatched = [];
for (const entry of manifest.files) {
  const file = path.resolve(pack, entry.path);
  if (!file.startsWith(pack + path.sep)) throw new Error('Manifest path escapes package');
  if (!fs.existsSync(file)) missing.push(entry.path);
  else if (fs.statSync(file).size !== entry.bytes || hash(file) !== entry.sha256) mismatched.push(entry.path);
}
const sourceArg = process.argv.find(a => a.startsWith('--source='));
let copyVerification = null;
if (sourceArg) {
  const source = path.resolve(sourceArg.slice('--source='.length));
  const originals = walk(source);
  const failures = originals.filter(f => {
    const dest = path.join(pack, path.relative(source, f));
    return !fs.existsSync(dest) || hash(f) !== hash(dest);
  }).map(f => path.relative(source, f));
  copyVerification = { source, files: originals.length, exactFileCount: originals.length === files.length, failures };
  if (failures.length || !copyVerification.exactFileCount) throw new Error('Package copy differs from source');
}
function glbStats(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('Invalid GLB');
  const doc = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8').trim());
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const used = new Set((doc.animations || []).flatMap(a => a.samplers.flatMap(s => [s.input, s.output])));
  return {
    file: path.relative(root, file), bytes: buf.length,
    meshDefinitions: doc.meshes.length, primitives: doc.meshes.reduce((n,m) => n+m.primitives.length,0),
    triangles: doc.meshes.reduce((n,m) => n+m.primitives.reduce((sum,p) => sum+(p.indices == null ? doc.accessors[p.attributes.POSITION].count : doc.accessors[p.indices].count)/3,0),0),
    maxSkeletonJoints: Math.max(...doc.skins.map(s => s.joints.length)), animations: doc.animations.length,
    channelsPerClip: [...new Set(doc.animations.map(a => a.channels.length))],
    animationAccessorElements: [...used].reduce((n,i) => n+doc.accessors[i].count*components[doc.accessors[i].type],0),
    animationAccessorBytes: [...used].reduce((n,i) => n+doc.accessors[i].count*components[doc.accessors[i].type]*4,0),
    animationNames: doc.animations.map(a => a.name)
  };
}
const report = {
  date: '2026-10-07', package: { files: files.length, bytes: files.reduce((n,f)=>n+fs.statSync(f).size,0),
    manifestEntries: manifest.files.length, missing, mismatched, copyVerification },
  models: ['winefox-large-lever.glb','snowfox-large-lever.glb'].map(f=>glbStats(path.join(pack,'Models','GLB',f))),
  browser: 'isolated headless Edge, not QQ Agent Electron; CPU timings exclude asynchronous GPU execution', scenarios: []
};
if (missing.length || mismatched.length) throw new Error('Supplied manifest verification failed');
console.log(JSON.stringify({ package: report.package, models: report.models.map(({animationNames,...s})=>s) }));

const staticRoot = path.join(pack, 'WebPet', 'dist');
const probe = `
window.__wineFoxProbe = {renderer,scene,camera,character,getMixer:()=>mixer,play,hitPet,step:(dt)=>{mixer.update(dt);applyExpression(performance.now());renderer.render(scene,camera);}};
const originalRender=renderer.render.bind(renderer);
window.__wineFoxFrames=[];
renderer.render=(...args)=>{const t=performance.now();originalRender(...args);window.__wineFoxFrames.push({at:t,ms:performance.now()-t});if(window.__wineFoxFrames.length>2000)window.__wineFoxFrames.shift();};
`;
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.glb':'model/gltf-binary','.svg':'image/svg+xml'};
const server = http.createServer((req,res)=>{
  const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file = path.resolve(staticRoot, '.'+(pathname==='/'?'/index.html':pathname));
  if (!file.startsWith(staticRoot+path.sep)) {res.writeHead(403);res.end();return;}
  try {
    let content=fs.readFileSync(file);
    if (pathname==='/app.js') content=Buffer.from(content.toString('utf8')+probe);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  await withPage({url:`http://127.0.0.1:${server.address().port}/`,width:1400,height:900},async(page,logs)=>{
    await page.send('Performance.enable');
    await page.waitFor('window.petState?.().loaded && window.__wineFoxProbe', {timeout:60000,label:'酒狐模型加载'});
    report.runtime = await page.eval(`(()=>{const p=window.__wineFoxProbe,gl=p.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {state:petState(),loadReadyMs:performance.now(),webglRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),webglVersion:gl.getParameter(gl.VERSION),threeRevision:'see bundled vendor',drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight]};})()`);
    async function measure(label, setup) {
      await page.eval(setup);
      await sleep(1000);
      await page.eval('window.__wineFoxFrames=[]');
      const before=await page.send('Performance.getMetrics');
      await sleep(5000);
      const after=await page.send('Performance.getMetrics');
      const stats=await page.eval(`(()=>{const rows=window.__wineFoxFrames,sorted=rows.map(x=>x.ms).sort((a,b)=>a-b),p=window.__wineFoxProbe,info=p.renderer.info,gl=p.renderer.getContext();return {frames:rows.length,fps:rows.length/5,renderSubmissionMeanMs:sorted.reduce((a,b)=>a+b,0)/sorted.length,renderSubmissionP95Ms:sorted[Math.floor(sorted.length*.95)],drawCalls:info.render.calls,triangles:info.render.triangles,geometries:info.memory.geometries,textures:info.memory.textures,programs:info.programs.length,buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight]};})()`);
      const a=Object.fromEntries(after.metrics.map(m=>[m.name,m.value])),b=Object.fromEntries(before.metrics.map(m=>[m.name,m.value]));
      report.scenarios.push({label,...stats,jsHeapUsedMiB:a.JSHeapUsedSize/1048576,rendererTaskMsPerSecond:(a.TaskDuration-b.TaskDuration)*200,scriptMsPerSecond:(a.ScriptDuration-b.ScriptDuration)*200});
      console.log(JSON.stringify(report.scenarios.at(-1)));
    }
    await measure('original fullscreen 1400x900 DPR1 idle','window.__wineFoxProbe.play("idle")');
    await measure('fullscreen 1400x900 DPR2 idle','window.__wineFoxProbe.renderer.setPixelRatio(2)');
    await measure('small drawing buffer 360x480 DPR1 idle','window.__wineFoxProbe.renderer.setPixelRatio(1);window.__wineFoxProbe.renderer.setSize(360,480,false)');
    await measure('small drawing buffer 360x480 DPR1 animation paused','document.getElementById("pause").click()');
    await measure('experimental small drawing buffer DPR1 capped at 30fps',`document.getElementById('pause').click();window.__wineFoxProbe.renderer.setAnimationLoop(null);window.__wineFoxLast=performance.now();window.__wineFoxProbe.renderer.setAnimationLoop(now=>{const dt=(now-window.__wineFoxLast)/1000;if(dt<1/30)return;window.__wineFoxLast=now;window.__wineFoxProbe.step(Math.min(dt,.05));})`);
    report.loadedResources = await page.eval('performance.getEntriesByType("resource").map(r=>({name:new URL(r.name).pathname,transferSize:r.transferSize,decodedBodySize:r.decodedBodySize,durationMs:r.duration}))');
    report.hitTest = await page.eval(`(()=>{const p=window.__wineFoxProbe,head=p.scene.getObjectByName('Head'),v=head.getWorldPosition(head.position.clone()).project(p.camera),e={clientX:(v.x+1)*700,clientY:(1-v.y)*450},values=[];let hits=0;for(let i=0;i<30;i++){const t=performance.now();if(p.hitPet(e))hits++;values.push(performance.now()-t);}values.sort((a,b)=>a-b);return {samples:30,hits,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:values[Math.floor(values.length*.95)]};})()`);
    report.console = logs.filter(l=>/exception|error/i.test(l));
    report.screenshot = 'docs/wine-fox-assessment/pet-preview.png';
    await page.screenshot(path.join(output,'pet-preview.png'));
  });
} finally { await new Promise(resolve=>server.close(resolve)); }
fs.writeFileSync(path.join(output,'assessment.json'),JSON.stringify(report,null,2));
console.log('Saved docs/wine-fox-assessment/assessment.json');
