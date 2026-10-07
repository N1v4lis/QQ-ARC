import * as THREE from '../assets/wine-fox/three/three.module.js';
import {FoxBehavior,MOOD_ACTIONS,LOOP_ACTIONS} from './fox-behavior.mjs';
import {GLTFLoader} from '../assets/wine-fox/three/addons/loaders/GLTFLoader.js';

export async function createWineFox(initial,{signal,onPosition,onDisable,onError}){
  const host=document.createElement('div');host.id='wine-fox-pet';host.setAttribute('aria-label','酒狐互动宠物');
  const canvas=document.createElement('canvas');canvas.tabIndex=0;canvas.setAttribute('aria-label','酒狐：轻点互动和语音；拖动移动，方向键也可移动');
  const bubble=document.createElement('div');bubble.className='wine-fox-bubble';bubble.hidden=true;bubble.setAttribute('role','status');bubble.setAttribute('aria-live','polite');
  host.append(canvas,bubble);document.body.append(host);
  let renderer,model,mixer,action,clips=[],faceMeshes=[],faceBones=[],faceTracks=[],leverMeshes=[],prefs={...initial};
  let disposed=false,suspended=document.hidden,contextLost=false,raf=0,frameTimer=0,emotionTimer=0,lastAt=performance.now(),frames=0;
  let drag=null,clicks=[],angerUntil=0,greetingUntil=0,suppressClick=null,hitTests=0,hitMs=0,currentName='';
  let interaction='',happyNames=[],lastHappy='',voices=[],voicePlaying=false,voiceTicket=0,voiceName='',voiceError='';
  const brain=new FoxBehavior();
  let angryVoices=[],behaviorTimer=0,nextAutoAt=Infinity,actionEndAt=Infinity,homePoint=null,returning=null,loopPolicy={};
  const voice=new Audio();voice.preload='none';voice.volume=.7;
  function stopVoice(){voiceTicket++;voice.pause();voicePlaying=false;voice.removeAttribute('src');voice.load();}
  function speak(angry=false){
    const pool=angry?angryVoices:voices;stopVoice();if(prefs.voice===false||!pool.length)return;
    voiceName=pool[Math.floor(Math.random()*pool.length)];voiceError='';
    voice.src=new URL('../assets/wine-fox/voice/'+voiceName,import.meta.url).href;
    const ticket=voiceTicket;voice.play().then(()=>{if(ticket===voiceTicket&&!disposed)voicePlaying=true;}).catch(()=>{
      if(ticket!==voiceTicket||disposed)return;voicePlaying=false;voiceError='语音暂时无法播放';onError('语音暂时无法播放，动作仍可用。');
    });
  }
  const listeners=[],scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1.8,1.8,1.95,-1.95,.05,100);
  camera.position.set(0,1.65,-10);camera.lookAt(0,1.65,0);
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  function listen(target,type,fn,options){target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));}
  function visibleMesh(o){for(let node=o;node;node=node.parent)if(!node.visible)return false;return true;}
  function freeModel(root){if(!root)return;const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
    root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.skeleton)skeletons.add(o.skeleton);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
    for(const t of textures){t.dispose();t.source?.data?.close?.();}for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const s of skeletons)s.dispose();}
  function cancelFrame(){clearTimeout(frameTimer);cancelAnimationFrame(raf);frameTimer=0;raf=0;}
  function dispose(){if(disposed)return;disposed=true;stopVoice();cancelFrame();clearTimeout(behaviorTimer);clearTimeout(emotionTimer);for(const remove of listeners)remove();
    if(drag&&canvas.hasPointerCapture(drag.id))canvas.releasePointerCapture(drag.id);drag=null;
    mixer?.stopAllAction();if(model)mixer?.uncacheRoot(model);freeModel(model);renderer?.dispose();renderer?.forceContextLoss();host.remove();}
  function activeMode(now=performance.now()){return interaction==='happy'?1:brain.mood==='angry'?2:brain.mood==='dazed'?6:prefs.expression;}
  function pose(now){if(!model||!action)return;
    for(const b of faceTracks){const v=b.sample.evaluate(action.time);if(b.property==='scale')b.node.scale.fromArray(v);else for(let i=0;i<v.length;i++)b.node.morphTargetInfluences[i]=v[i];}
    const mode=activeMode(now);for(const o of faceMeshes)o.visible=mode<0||Number(o.userData.expressionMode)===mode;
    if(mode>=0)for(const o of faceBones)o.scale.setScalar(Number(o.name.slice(-1))===mode?1:.00001);
    model.updateMatrixWorld(true);
  }
  function schedule(immediate=false){if(disposed||suspended||contextLost||!model)return;if(raf||frameTimer){if(!immediate)return;cancelFrame();}
    if(immediate)raf=requestAnimationFrame(tick);else frameTimer=setTimeout(()=>{frameTimer=0;raf=requestAnimationFrame(tick);},Math.max(0,1000/30-(performance.now()-lastAt)));}
  function tick(now){raf=0;if(disposed||suspended||contextLost)return;const dt=Math.min((now-lastAt)/1000,.1);lastAt=now;
    if(!prefs.paused||interaction)mixer.update(dt);
    if(returning){const progress=Math.min(1,(now-returning.at)/returning.duration);place(THREE.MathUtils.lerp(returning.from[0],returning.to[0],progress),THREE.MathUtils.lerp(returning.from[1],returning.to[1],progress));if(progress>=1){const target=returning.to;returning=null;onPosition(...target);prefs={...prefs,x:target[0],y:target[1]};returnIdle();}}
    pose(now);renderer.render(scene,camera);frames++;
    if(!prefs.paused||interaction)schedule();}
  function play(name,once=false){const clip=clips.find(c=>c.name===name)||clips.find(c=>c.name==='idle')||clips[0];
    mixer.stopAllAction();action=mixer.clipAction(clip);action.reset();const lever=clip.name.startsWith('lever_');
    const repeat=!once&&clip.name!=='death'&&(loopPolicy[clip.name]==='repeat'||LOOP_ACTIONS.has(clip.name));
    action.setLoop(repeat?THREE.LoopRepeat:THREE.LoopOnce,repeat?Infinity:1);action.clampWhenFinished=true;action.play();currentName=clip.name;updateBubble();
    faceTracks=[];for(const track of clip.tracks){const parsed=THREE.PropertyBinding.parseTrackName(track.name),node=THREE.PropertyBinding.findNode(model,parsed.nodeName);
      if(node&&((faceBones.includes(node)&&parsed.propertyName==='scale')||(faceMeshes.includes(node)&&parsed.propertyName==='morphTargetInfluences')))
        faceTracks.push({node,property:parsed.propertyName,sample:track.createInterpolant()});}
    for(const mesh of leverMeshes)mesh.visible=lever;mixer.update(0);pose(performance.now());schedule(true);}
  function place(x=prefs.x,y=prefs.y){const width=parseFloat(host.style.width),height=parseFloat(host.style.height);
    const minY=Math.min(52,Math.max(0,innerHeight-height));
    const left=THREE.MathUtils.clamp(x??innerWidth-width-24,0,Math.max(0,innerWidth-width));
    const top=THREE.MathUtils.clamp(y??innerHeight-height-12,minY,Math.max(minY,innerHeight-height));
    host.style.left=left+'px';host.style.top=top+'px';return [left,top];}
  function resize(){const height=Math.min(prefs.size,Math.max(120,innerHeight-60)),width=Math.min(height*.72,innerWidth);
    host.style.width=width+'px';host.style.height=height+'px';camera.left=-1.95*width/height;camera.right=1.95*width/height;camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);place();schedule(true);}
  function updateBubble(){
    const thought=brain.mood==='dazed'&&currentName==='keyboard';
    bubble.classList.toggle('wine-fox-thought',thought);
    if(thought){bubble.innerHTML='<span>ご主人様…</span>';bubble.hidden=false;}
    else {bubble.textContent=brain.mood==='angry'?'💢':interaction==='happy'?'♪':'';bubble.hidden=!bubble.textContent;}
  }
  function armBehavior(){
    clearTimeout(behaviorTimer);if(disposed||suspended||contextLost)return;
    const at=Math.min(brain.nextAt(),prefs.paused?Infinity:Math.min(nextAutoAt,actionEndAt));
    if(Number.isFinite(at))behaviorTimer=setTimeout(advanceBehavior,Math.max(10,at-performance.now()));
  }
  function returnIdle(){
    interaction='';actionEndAt=Infinity;nextAutoAt=performance.now()+brain.delay();play('idle');armBehavior();
  }
  function startMotion(name,kind='auto'){
    interaction=kind==='happy'?'happy':'';nextAutoAt=Infinity;
    if(name==='idle'){returnIdle();return;}
    const clip=clips.find(c=>c.name===name);if(!clip){returnIdle();return;}
    play(name,kind==='happy');
    actionEndAt=LOOP_ACTIONS.has(name)&&kind!=='happy'?performance.now()+Math.max(500,clip.duration*2000):Infinity;
    armBehavior();
  }
  function moodPool(){return brain.mood==='normal'?clips.map(c=>c.name).filter(name=>!['idle','gui','gui2','death','attacked','game_lost'].includes(name)):MOOD_ACTIONS[brain.mood];}
  function advanceBehavior(){
    behaviorTimer=0;const now=performance.now();if(disposed||suspended)return;
    if(drag&&brain.mood==='normal')brain.touch(now);
    const transition=brain.advance(now);
    if(transition){if(transition!=='normal'){const r=host.getBoundingClientRect();homePoint=[r.left,r.top];const pool=moodPool();startMotion(pool[Math.floor(Math.random()*pool.length)]);}else returnIdle();}
    if(!prefs.paused&&!drag&&!returning){
      if(now>=actionEndAt)returnIdle();
      else if(now>=nextAutoAt){const pool=moodPool();startMotion(pool[Math.floor(Math.random()*pool.length)]);}
    }
    updateBubble();schedule(true);armBehavior();
  }
  function greet(){
    const result=brain.click(performance.now());
    if(result==='attention'){if(brain.mood==='angry')speak(true);updateBubble();schedule(true);armBehavior();return;}
    returning=null;nextAutoAt=Infinity;
    if(result==='angry'){
      const r=host.getBoundingClientRect();homePoint=[r.left,r.top];const pool=MOOD_ACTIONS.angry;
      startMotion(pool[Math.floor(Math.random()*pool.length)]);speak(true);return;
    }
    const choices=happyNames.filter(name=>name!==lastHappy),pool=choices.length?choices:happyNames;
    if(!pool.length)return;lastHappy=pool[Math.floor(Math.random()*pool.length)];startMotion(lastHappy,'happy');speak();
  }
  function configure(next){const old=prefs;prefs={...next};
    if(old.voice!==prefs.voice&&prefs.voice===false)stopVoice();
    if(model&&(old.animation!==prefs.animation||old.expression!==prefs.expression)){
      returning=null;brain.mood='normal';brain.reason='';brain.clicks=[];brain.recovery=[];brain.touch(performance.now());
      startMotion(prefs.animation,'manual');
    }
    if(old.paused!==prefs.paused&&old.animation===prefs.animation&&old.expression===prefs.expression){actionEndAt=Infinity;nextAutoAt=performance.now()+brain.delay();if(interaction!=='drag'&&interaction!=='return')returnIdle();}
    if(renderer)resize();if(old.x!==prefs.x||old.y!==prefs.y)homePoint=place();lastAt=performance.now();armBehavior();schedule(true);
  }
  function setSuspended(value){suspended=!!value;host.hidden=suspended;cancelFrame();clearTimeout(behaviorTimer);lastAt=performance.now();
    if(suspended){stopVoice();const pending=drag;drag=null;if(pending&&canvas.hasPointerCapture(pending.id))canvas.releasePointerCapture(pending.id);if(returning){const pos=place(...returning.to);prefs={...prefs,x:pos[0],y:pos[1]};onPosition(...pos);}returning=null;interaction='';}
    else{advanceBehavior();schedule(true);}
  }
  function rayHit(e){const rect=canvas.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return false;
    const t=performance.now();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
    pose(performance.now());const targets=[];model.traverse(o=>{if(o.isMesh&&visibleMesh(o)){if(o.isSkinnedMesh){o.skeleton.update();o.boundingSphere=null;}targets.push(o);}});
    const result=raycaster.intersectObjects(targets,false).some(hit=>{const o=hit.object;return !o.isSkinnedMesh||o.skeleton.bones.some(b=>!/^FaceMode_/.test(b.name)||b.scale.x>.5);});
    hitTests++;hitMs+=performance.now()-t;return result;}
  function blocked(e){return !!e.target.closest?.('.wine-fox-hide')||[...document.querySelectorAll('dialog[open],[role="dialog"],.modal,#loading-overlay,.qrcode-egg-overlay')].some(el=>el.getBoundingClientRect().width>0&&getComputedStyle(el).visibility!=='hidden');}
  function down(e){if(disposed||suspended||contextLost||e.button!==0||!e.isPrimary||blocked(e)||!rayHit(e))return;
    const rect=host.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top,moved:false,moody:brain.mood!=='normal'};returning=null;if(!drag.moody)brain.touch(performance.now());else homePoint||=[rect.left,rect.top];
    suppressClick=null;canvas.setPointerCapture(e.pointerId);e.preventDefault();e.stopImmediatePropagation();}
  function move(e){if(!drag||drag.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();
    if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>6){drag.moved=true;nextAutoAt=Infinity;actionEndAt=Infinity;if(!drag.moody){interaction='drag';play('fly');}armBehavior();}
    if(drag.moved)place(drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);}
  function finish(e,cancelled=false){if(!drag||e.pointerId!==drag.id)return;const d=drag;drag=null;
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(d.moved){
      const rect=host.getBoundingClientRect();
      if(d.moody){const target=place(...(homePoint||[d.left,d.top]));place(rect.left,rect.top);returning={from:[rect.left,rect.top],to:target,at:performance.now(),duration:Math.max(300,Math.hypot(rect.left-target[0],rect.top-target[1])/180*1000)};interaction='return';play('run');armBehavior();}
      else {prefs={...prefs,x:rect.left,y:rect.top};homePoint=[rect.left,rect.top];onPosition(rect.left,rect.top);brain.touch(performance.now());returnIdle();}
    }
    if(!cancelled){if(!d.moved)greet();
      suppressClick={until:performance.now()+500,x:e.clientX,y:e.clientY};}e.preventDefault();e.stopImmediatePropagation();}
  try{
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false,powerPreference:'low-power',failIfMajorPerformanceCaveat:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
    scene.add(new THREE.HemisphereLight(0xfffaf1,0xa79aad,2.2));for(const [c,i,p] of [[0xffe5c3,2.7,[-3,5,-4]],[0xe5efff,1.1,[3,2,2]]]){const light=new THREE.DirectionalLight(c,i);light.position.set(...p);scene.add(light);}
    const voiceManifest=fetch(new URL('../assets/wine-fox/voice/manifest.json',import.meta.url),{signal}).then(r=>r.ok?r.json():{}).catch(()=>({}));
    const response=await fetch(new URL('../assets/wine-fox/winefox.glb',import.meta.url),{signal});if(!response.ok)throw new Error(`GLB ${response.status}`);
    const bytes=await response.arrayBuffer();signal.throwIfAborted();
    // ImageBitmapLoader fetches a blob URL under connect-src. The host already
    // permits blob images under img-src; use TextureLoader for this embedded PNG
    // instead of loosening the application's HTTP and meta CSP policies.
    const loader=new GLTFLoader();loader.register(parser=>{parser.textureLoader=new THREE.TextureLoader(parser.options.manager).setCrossOrigin(parser.options.crossOrigin);return {name:'QQARCFOX_embedded_images'};});
    const gltf=await loader.parseAsync(bytes,'');model=gltf.scene;signal.throwIfAborted();clips=gltf.animations;scene.add(model);
    const manifest=await voiceManifest;signal.throwIfAborted();voices=(manifest.happy||[]).filter(name=>/^eatSugar\d+\.ogg$/.test(name));angryVoices=(manifest.angry||[]).filter(name=>['JaNai.ogg','Sato.ogg','Mo-Ya-Da.ogg'].includes(name));loopPolicy=Object.fromEntries(gltf.parser.json.animations.map(a=>[a.name,a.extras?.arcfoxPlayback]));
    model.traverse(o=>{if(o.userData.expressionMode!==undefined)faceMeshes.push(o);if(/^FaceMode_[0-6]$/.test(o.name))faceBones.push(o);
      if(!o.isMesh)return;if(/^(Lever_|Base_Bolt|Travel_Stop|Grip_Endcap)/.test(o.name))leverMeshes.push(o);
      for(const m of Array.isArray(o.material)?o.material:[o.material]){if(m.map){m.map.magFilter=THREE.NearestFilter;m.map.minFilter=THREE.NearestFilter;m.map.generateMipmaps=false;}m.roughness=.85;m.metalness=0;}});
    happyNames=clips.filter(clip=>!/^gui2?$/i.test(clip.name)&&clip.tracks.some(track=>{
      const parsed=THREE.PropertyBinding.parseTrackName(track.name),node=THREE.PropertyBinding.findNode(model,parsed.nodeName);
      return node?.name==='FaceMode_1'&&parsed.propertyName==='scale'&&Array.from(track.values).every(value=>value>.5);
    })).map(clip=>clip.name);
    mixer=new THREE.AnimationMixer(model);mixer.addEventListener('finished',()=>{if(!drag&&!returning)returnIdle();});
    listen(voice,'ended',()=>{voicePlaying=false;});
    play('idle');
    // Ignore zero-scale hidden triangles when fitting, exactly as the reference.
    model.updateMatrixWorld(true);model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
    const box=new THREE.Box3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
    model.traverse(o=>{if(!o.isMesh||!visibleMesh(o)||o.userData.expressionMode!==undefined)return;const index=o.geometry.index;
      for(let i=0;i<index.count;i+=3){o.getVertexPosition(index.getX(i),a).applyMatrix4(o.matrixWorld);o.getVertexPosition(index.getX(i+1),b).applyMatrix4(o.matrixWorld);o.getVertexPosition(index.getX(i+2),c).applyMatrix4(o.matrixWorld);
        if(ab.subVectors(b,a).cross(ac.subVectors(c,a)).lengthSq()<1e-12)continue;box.expandByPoint(a);box.expandByPoint(b);box.expandByPoint(c);}});
    if(box.isEmpty())throw new Error('Model has no visible body');const scale=3.2/(box.max.y-box.min.y);model.scale.setScalar(scale);model.position.set(-(box.max.x+box.min.x)/2*scale,-box.min.y*scale,0);
    listen(window,'resize',resize);
    listen(document,'pointerdown',down,{capture:true,passive:false});listen(document,'pointermove',move,{capture:true,passive:false});
    listen(document,'pointerup',e=>finish(e),{capture:true,passive:false});listen(document,'pointercancel',e=>finish(e,true),true);
    // The transparent canvas is not the original touch target. Prevent native
    // scrolling only for a gesture already accepted by our precise hit test.
    listen(document,'touchstart',e=>{if(drag)e.preventDefault();},{capture:true,passive:false});
    listen(document,'touchmove',e=>{if(drag)e.preventDefault();},{capture:true,passive:false});
    listen(canvas,'lostpointercapture',e=>finish(e,true));
    listen(document,'click',e=>{if(suppressClick&&performance.now()<suppressClick.until&&Math.hypot(e.clientX-suppressClick.x,e.clientY-suppressClick.y)<4){suppressClick=null;e.preventDefault();e.stopImmediatePropagation();}},true);
    listen(canvas,'keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();greet();}else if(e.key.startsWith('Arrow')){e.preventDefault();const rect=host.getBoundingClientRect();const pos=place(rect.left+(e.key==='ArrowRight'?10:e.key==='ArrowLeft'?-10:0),rect.top+(e.key==='ArrowDown'?10:e.key==='ArrowUp'?-10:0));onPosition(...pos);prefs={...prefs,x:pos[0],y:pos[1]};}});
    listen(canvas,'webglcontextlost',e=>{e.preventDefault();contextLost=true;stopVoice();cancelFrame();bubble.hidden=false;bubble.textContent='请重新开启酒狐';onError('显示暂时中断，请重新开启酒狐。');});
    resize();homePoint=place();startMotion(prefs.animation,'manual');setSuspended(document.hidden);
    return {configure,setSuspended,dispose,state:()=>({animations:clips.map(c=>c.name),visibleAnimations:clips.map(c=>c.name).filter(name=>!/^gui2?$/i.test(name)),happyAnimations:[...happyNames],interaction,voicePlaying,voiceName,voiceError,animation:currentName,expression:activeMode(),effectiveExpression:activeMode()<0?Number(faceBones.find(b=>b.scale.x>.5)?.name.slice(-1)):activeMode(),angry:brain.mood==='angry',mood:brain.mood,moodReason:brain.reason,idleAt:brain.idleAt,nextAutoAt,actionEndAt,returning:!!returning,loop:action.loop,actionTime:action.time,homePoint:homePoint?[...homePoint]:null,bubble:!bubble.hidden?bubble.textContent:'',frames,hitTests,meanHitMs:hitTests?hitMs/hitTests:0,paused:prefs.paused,suspended,contextLost,position:[host.getBoundingClientRect().left,host.getBoundingClientRect().top],size:[canvas.width,canvas.height],drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,faceScales:faceBones.map(b=>({name:b.name,scale:b.scale.x})),leverVisible:leverMeshes.some(m=>m.visible)})};
  }catch(e){dispose();throw e;}
}
