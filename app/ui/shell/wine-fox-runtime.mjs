import * as THREE from '../assets/wine-fox/three/three.module.js';
import {FoxBehavior,MOOD_ACTIONS,LOOP_ACTIONS,MOOD_HOLD_MS,visibleActions,chooseTravel,destination,TURN_RATE,thoughtCount,thoughtGrid,nextThoughtWave} from './fox-behavior.mjs';
import {createThoughtCanvas} from './fox-thought-canvas.mjs';
import {releaseVelocity,stepThrow,FoxInjury} from './fox-throw.mjs';
import {GLTFLoader} from '../assets/wine-fox/three/addons/loaders/GLTFLoader.js';

export async function createWineFox(initial,{signal,onPosition,onAnimation,onDisable,onError}){
  const host=document.createElement('div');host.id='wine-fox-pet';host.setAttribute('aria-label','酒狐互动宠物');
  const canvas=document.createElement('canvas');canvas.tabIndex=0;canvas.setAttribute('aria-label','酒狐：轻点互动和语音；拖动移动，方向键也可移动');
  const bubble=document.createElement('div');bubble.className='wine-fox-bubble';bubble.hidden=true;bubble.setAttribute('role','status');bubble.setAttribute('aria-live','polite');
  host.append(canvas,bubble);document.body.append(host);
  let renderer,model,mixer,action,clips=[],faceMeshes=[],faceBones=[],faceTracks=[],leverMeshes=[],prefs={...initial};
  let disposed=false,suspended=document.hidden,contextLost=false,raf=0,frameTimer=0,lastAt=performance.now(),frames=0;
  let drag=null,suppressClick=null,hitTests=0,hitMs=0,currentName='';
  let interaction='',happyNames=[],lastHappy='',voices=[],voicePlaying=false,voiceTicket=0,voiceName='',voiceError='';
  const brain=new FoxBehavior();
  let dazedVoices=[],angryVoices=[],behaviorTimer=0,nextAutoAt=Infinity,actionEndAt=Infinity,homePoint=null,returning=null,loopPolicy={};
  let inertia=null,injury=null;
  let travel=null,motionKind='base',pressTimer=0,menuOpen=false,faceYaw=0,facePitch=0,faceUntil=0;
  const menu=document.createElement('div');menu.className='wine-fox-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','酒狐互动动作');document.body.append(menu);
  const natural=()=>prefs.animation==='natural';
  const thoughts=createThoughtCanvas(),thoughtCloud=thoughts.element;
  let dazedSince=null,thoughtResumeAt=0,thoughtNextAt=Infinity,cloudGrid=null;
  function clearThoughts(){thoughts.clear();dazedSince=null;thoughtNextAt=Infinity;cloudGrid=null;}
  function acknowledge(){
    const now=performance.now();clearThoughts();brain.touch(now);thoughtResumeAt=brain.mood==='dazed'?brain.idleAt:0;
    if(brain.mood==='dazed'){bubble.hidden=true;bubble.classList.remove('wine-fox-thought');bubble.replaceChildren();}
    armBehavior();
  }
  function syncThoughtCloud(now=performance.now()){
    if(brain.mood!=='dazed'||injury){if(thoughts.state().count||dazedSince!==null)clearThoughts();thoughtResumeAt=0;return;}
    if(now<thoughtResumeAt){thoughtNextAt=thoughtResumeAt;return;}
    if(dazedSince===null)dazedSince=now;
    cloudGrid=thoughtGrid(innerWidth,innerHeight);
    const count=Math.max(thoughts.state().count,thoughtCount(now-dazedSince,cloudGrid.capacity));
    thoughts.sync(count);thoughtNextAt=count>=cloudGrid.capacity?Infinity:dazedSince+nextThoughtWave(now-dazedSince);
  }
  function startInjury(){
    inertia=travel=returning=null;closeMenu(false);injury=new FoxInjury(performance.now());brain.mood='normal';brain.reason='';brain.clicks=[];brain.recovery=[];interaction='injury';motionKind='injury';actionEndAt=nextAutoAt=Infinity;clearThoughts();faceOwner();persistPosition();play('death',true);armBehavior();
  }
  function recoverInjury(dazed=false){
    injury=null;interaction='';prefs={...prefs,animation:'natural'};onAnimation?.('natural');brain.clicks=[];brain.recovery=[];brain.until=0;brain.mood=dazed?'dazed':'normal';brain.reason=dazed?'idle':'';brain.touch(performance.now());thoughtResumeAt=0;clearThoughts();if(dazed)startMoodMotion();else returnIdle();
  }
  function finishDrag(d){
    const rect=host.getBoundingClientRect();
    if(d.moody){const target=place(...(homePoint||[d.left,d.top]));place(rect.left,rect.top);returning={from:[rect.left,rect.top],to:target,at:performance.now(),duration:Math.max(300,Math.hypot(rect.left-target[0],rect.top-target[1])/180*1000)};interaction='return';faceDestination(target[0]-rect.left,target[1]-rect.top);play('run');armBehavior();schedule(true);}
    else{persistPosition();brain.touch(performance.now());restoreBase();}
  }
  function faceDestination(dx,dy,flight=false){faceYaw=Math.abs(dx)>.5?Math.sign(dx)*Math.PI/2:0;facePitch=flight?THREE.MathUtils.clamp(Math.atan2(-dy,Math.abs(dx))*.4,-.35,.35):0;faceUntil=Infinity;}
  function faceOwner(){faceYaw=0;facePitch=0;faceUntil=0;}
  function persistPosition(){const r=host.getBoundingClientRect();prefs={...prefs,x:r.left,y:r.top};homePoint=[r.left,r.top];onPosition(r.left,r.top);}
  function stopTravel(){if(travel){travel=null;persistPosition();}faceOwner();}
  function closeMenu(restore=true){if(!menuOpen)return;menuOpen=false;menu.hidden=true;if(restore){acknowledge();restoreBase();}canvas.focus({preventScroll:true});}
  function openMenu(fromKeyboard=false){
    if(injury||disposed||suspended||(!fromKeyboard&&(!drag||drag.moved)))return;acknowledge();if(drag)drag.menu=true;menuOpen=true;stopTravel();returning=null;interaction='';motionKind='base';nextAutoAt=actionEndAt=Infinity;play('idle');faceOwner();
    const names=clips.map(c=>c.name).filter(n=>/^extra\d+$/i.test(n)).sort((a,b)=>Number(a.slice(5))-Number(b.slice(5)));
    menu.replaceChildren(...names.map((name,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitem');b.dataset.extra=name;b.textContent='Extra '+name.slice(5);const angle=-Math.PI/2+i/names.length*Math.PI*2;b.style.left=(140+Math.cos(angle)*100-30)+'px';b.style.top=(140+Math.sin(angle)*100-30)+'px';return b;}));
    const back=document.createElement('button');back.type='button';back.className='wine-fox-menu-back';back.dataset.menuClose='';back.textContent='返回';back.setAttribute('aria-label','关闭互动菜单');menu.append(back);
    const r=host.getBoundingClientRect();menu.style.left=THREE.MathUtils.clamp(r.left+r.width/2-140,4,Math.max(4,innerWidth-284))+'px';menu.style.top=THREE.MathUtils.clamp(r.top+r.height*.35-140,52,Math.max(52,innerHeight-284))+'px';menu.hidden=false;menu.querySelector('button')?.focus({preventScroll:true});armBehavior();schedule(true);
  }
  const voice=new Audio();voice.preload='none';voice.volume=.7;
  function stopVoice(){voiceTicket++;voice.pause();voicePlaying=false;voice.removeAttribute('src');voice.load();}
  function speak(angry=false){
    const pool=angry==='dazed'?dazedVoices:angry?angryVoices:voices;stopVoice();if(prefs.voice===false||!pool.length)return;
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
  function dispose(){if(disposed)return;disposed=true;stopVoice();cancelFrame();clearTimeout(behaviorTimer);clearTimeout(pressTimer);thoughts.dispose();menu.remove();for(const remove of listeners)remove();
    if(drag&&canvas.hasPointerCapture(drag.id))canvas.releasePointerCapture(drag.id);drag=null;
    mixer?.stopAllAction();if(model)mixer?.uncacheRoot(model);freeModel(model);renderer?.dispose();renderer?.forceContextLoss();host.remove();}
  function activeMode(now=performance.now()){return injury?6:interaction==='happy'?1:brain.mood==='angry'?2:brain.mood==='dazed'?6:prefs.expression;}
  function pose(now){if(!model||!action)return;
    for(const b of faceTracks){const v=b.sample.evaluate(action.time);if(b.property==='scale')b.node.scale.fromArray(v);else for(let i=0;i<v.length;i++)b.node.morphTargetInfluences[i]=v[i];}
    const mode=activeMode(now);for(const o of faceMeshes)o.visible=mode<0||Number(o.userData.expressionMode)===mode;
    if(mode>=0)for(const o of faceBones)o.scale.setScalar(Number(o.name.slice(-1))===mode?1:.00001);
    model.updateMatrixWorld(true);
  }
  function schedule(immediate=false){if(disposed||suspended||contextLost||!model)return;if(raf||frameTimer){if(!immediate)return;cancelFrame();}
    if(immediate)raf=requestAnimationFrame(tick);else frameTimer=setTimeout(()=>{frameTimer=0;raf=requestAnimationFrame(tick);},Math.max(0,1000/30-(performance.now()-lastAt)));}
  function tick(now){raf=0;if(disposed||suspended||contextLost)return;const dt=Math.max(0,Math.min((now-lastAt)/1000,.1));lastAt=now;
    if(!menuOpen&&(!prefs.paused||interaction))mixer.update(dt);
    if(inertia){const r=host.getBoundingClientRect(),result=stepThrow([r.left,r.top],inertia.velocity,dt,[[0,Math.max(0,innerWidth-r.width)],[Math.min(52,Math.max(0,innerHeight-r.height)),Math.max(52,innerHeight-r.height)]]);place(...result.position);inertia.velocity=result.velocity;if(result.impact)startInjury();else if(Math.hypot(...result.velocity)<60){const d=inertia.drag;inertia=null;finishDrag(d);}}
    if(returning||travel){const journey=returning||travel;const progress=Math.min(1,(now-journey.at)/journey.duration);place(THREE.MathUtils.lerp(journey.from[0],journey.to[0],progress),THREE.MathUtils.lerp(journey.from[1],journey.to[1],progress));if(progress>=1){const wasReturn=!!returning;returning=null;travel=null;persistPosition();if(wasReturn&&natural()&&brain.mood!=='normal')startMoodMotion();else restoreBase();}}
    if(!drag&&!inertia&&!returning&&!travel&&now>=faceUntil)faceOwner();
    const delta=Math.atan2(Math.sin(faceYaw-model.rotation.y),Math.cos(faceYaw-model.rotation.y)),blend=1-Math.exp(-dt*TURN_RATE);
    model.rotation.y+=delta*blend;model.rotation.x+=(facePitch-model.rotation.x)*blend;
    const turning=Math.abs(delta)>.002||Math.abs(facePitch-model.rotation.x)>.002;
    pose(now);renderer.render(scene,camera);frames++;
    if((!prefs.paused&&!action.paused&&!menuOpen)||(interaction&&!(injury&&action.paused))||inertia||travel||returning||turning)schedule();}
  function play(name,once=false,forceRepeat=false){const clip=clips.find(c=>c.name===name&&name!=='jump')||clips.find(c=>c.name==='idle')||clips[0];
    mixer.stopAllAction();action=mixer.clipAction(clip);action.reset();const lever=clip.name.startsWith('lever_');
    const repeat=!once&&clip.name!=='death'&&(forceRepeat||loopPolicy[clip.name]==='repeat'||LOOP_ACTIONS.has(clip.name));
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
  function resize(){const current=travel||returning?host.getBoundingClientRect():null;const height=Math.min(prefs.size,Math.max(120,innerHeight-60)),width=Math.min(height*.72,innerWidth);
    host.style.width=width+'px';host.style.height=height+'px';camera.left=-1.95*width/height;camera.right=1.95*width/height;camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);if(current)place(current.left,current.top);else place();schedule(true);}
  function updateBubble(){
    syncThoughtCloud();const thought=brain.mood==='dazed'&&performance.now()>=thoughtResumeAt&&(MOOD_ACTIONS.dazed.includes(currentName)||drag||returning);
    if(thought){if(!bubble.classList.contains('wine-fox-thought')){bubble.classList.add('wine-fox-thought');const track=document.createElement('div');track.className='wine-fox-thought-track';track.setAttribute('aria-hidden','true');for(let i=0;i<2;i++){const text=document.createElement('span');text.textContent='ご主人様…　ご主人様…　';if(i)text.setAttribute('aria-hidden','true');track.append(text);}bubble.replaceChildren(track);bubble.setAttribute('aria-label','ご主人様…');}bubble.hidden=false;}
    else{bubble.classList.remove('wine-fox-thought');bubble.removeAttribute('aria-label');const text=brain.mood==='angry'?'💢':interaction==='happy'?'♪':'';if(bubble.textContent!==text)bubble.textContent=text;bubble.hidden=!text;}
  }
  function armBehavior(){
    clearTimeout(behaviorTimer);if(disposed||suspended||contextLost)return;
    const brainAt=injury?injury.until:natural()||brain.mood!=='normal'?brain.nextAt():Infinity;
    const motionAt=!injury&&!inertia&&!menuOpen&&!drag&&!returning&&(!prefs.paused||interaction)?actionEndAt:Infinity;
    const autoAt=natural()&&!prefs.paused&&!menuOpen&&!drag&&!returning&&!travel?nextAutoAt:Infinity;
    const at=Math.min(brainAt,motionAt,autoAt,!menuOpen?thoughtNextAt:Infinity);
    if(Number.isFinite(at))behaviorTimer=setTimeout(advanceBehavior,Math.max(10,at-performance.now()));
  }
  function returnIdle(){
    interaction='';motionKind='base';actionEndAt=Infinity;nextAutoAt=natural()&&brain.mood==='normal'?performance.now()+brain.delay():Infinity;play('idle');faceOwner();armBehavior();
  }
  function restoreBase(){
    if(natural()){if(brain.mood!=='normal')startMoodMotion();else returnIdle();}
    else if(prefs.animation==='extra2')returnIdle();
    else startMotion(prefs.animation,'manual');
  }
  function finishMotion(){
    if(injury||inertia||drag||returning||travel||menuOpen||motionKind==='mood')return;
    actionEndAt=Infinity;
    if(motionKind==='manual'&&currentName!=='extra2'){nextAutoAt=Infinity;armBehavior();return;}
    restoreBase();
  }
  function startMotion(name,kind='auto'){
    if(name==='jump'){returnIdle();return;}
    travel=null;faceOwner();motionKind=kind;interaction=['happy','menu'].includes(kind)?kind:'';nextAutoAt=Infinity;
    if(name==='idle'||name==='natural'){returnIdle();return;}
    const clip=clips.find(c=>c.name===name);if(!clip){returnIdle();return;}
    play(name,['happy','menu'].includes(kind),kind==='mood');
    // A wall-clock deadline also restores short gestures if mixer completion is missed.
    actionEndAt=kind==='mood'?performance.now()+MOOD_HOLD_MS:kind==='manual'?name==='extra2'?performance.now()+clip.duration*1000+250:Infinity:performance.now()+(LOOP_ACTIONS.has(name)&&kind==='auto'?Math.max(500,clip.duration*2000):clip.duration*1000+250);
    armBehavior();
  }
  function startMoodMotion(){const pool=MOOD_ACTIONS[brain.mood],choices=pool.filter(n=>n!==currentName);startMotion((choices.length?choices:pool)[Math.floor(Math.random()*(choices.length||pool.length))],'mood');if(brain.mood==='dazed')speak('dazed');}
  function startTravel(){
    const animation=chooseTravel(),r=host.getBoundingClientRect(),from=[r.left,r.top],to=destination(from,r.width,r.height,innerWidth,innerHeight,animation),distance=Math.hypot(to[0]-from[0],to[1]-from[1]);
    if(distance<10){returnIdle();return;}
    startMotion(animation,'auto');motionKind='travel';actionEndAt=nextAutoAt=Infinity;
    travel={from,to,at:performance.now(),duration:Math.max(600,distance/(animation==='walk'?70:animation==='run'?160:110)*1000)};faceDestination(to[0]-from[0],to[1]-from[1],['fly','elytra_fly'].includes(animation));armBehavior();schedule(true);
  }
  function moodPool(){return clips.map(c=>c.name).filter(name=>!['idle','gui','gui2','jump','death','attacked','game_lost','walk','run','fly','elytra_fly'].includes(name));}
  function advanceBehavior(){
    behaviorTimer=0;const now=performance.now();if(disposed||suspended)return;
    if(injury){if(injury.expired(now))recoverInjury(true);else armBehavior();return;}
    if((drag||menuOpen)&&brain.mood==='normal')brain.touch(now);
    const transition=natural()||brain.mood!=='normal'?brain.advance(now):'';
    if(transition){stopTravel();if(transition!=='normal'){const r=host.getBoundingClientRect();homePoint=[r.left,r.top];if(!drag&&!returning&&!menuOpen)startMoodMotion();}else if(!drag&&!returning&&!menuOpen)restoreBase();}
    if(!prefs.paused&&!inertia&&!drag&&!returning&&!menuOpen&&!travel){
      if(now>=actionEndAt){if(motionKind==='mood'&&natural())startMoodMotion();else finishMotion();}
      else if(natural()&&now>=nextAutoAt){if(Math.random()<.5)startTravel();else{const pool=moodPool();startMotion(pool[Math.floor(Math.random()*pool.length)]);}}
    }else if(interaction&&!drag&&!returning&&!menuOpen&&now>=actionEndAt)finishMotion();
    updateBubble();schedule(true);armBehavior();
  }
  function greet(){
    if(injury){if(injury.click(performance.now()))recoverInjury();else armBehavior();return;}
    if(inertia){inertia=null;persistPosition();}
    const result=brain.click(performance.now());acknowledge();
    if(result==='attention'){if(brain.mood==='angry')speak(true);updateBubble();schedule(true);armBehavior();return;}
    returning=null;stopTravel();nextAutoAt=Infinity;
    if(result==='angry'){
      const r=host.getBoundingClientRect();homePoint=[r.left,r.top];const pool=MOOD_ACTIONS.angry;
      startMotion(pool[Math.floor(Math.random()*pool.length)],'mood');speak(true);return;
    }
    const choices=happyNames.filter(name=>name!==lastHappy),pool=choices.length?choices:happyNames;
    if(!pool.length)return;lastHappy=pool[Math.floor(Math.random()*pool.length)];startMotion(lastHappy,'happy');speak();
  }
  function configure(next){const old=prefs;prefs={...next};
    if(old.voice!==prefs.voice&&prefs.voice===false)stopVoice();
    if(model&&(old.animation!==prefs.animation||old.expression!==prefs.expression)){
      injury=null;inertia=null;returning=null;stopTravel();closeMenu(false);brain.mood='normal';brain.reason='';brain.clicks=[];brain.recovery=[];brain.touch(performance.now());
      if(natural())returnIdle();else startMotion(prefs.animation,'manual');
    }
    thoughts.setPaused(prefs.paused||suspended);
    if(old.paused!==prefs.paused&&!injury){if(prefs.paused)stopTravel();if(!interaction&&!returning){if(natural())returnIdle();else{actionEndAt=prefs.animation==='extra2'?performance.now()+Math.max(0,action.getClip().duration-action.time)*1000+250:Infinity;nextAutoAt=Infinity;}}}
    if(renderer)resize();if(old.x!==prefs.x||old.y!==prefs.y)homePoint=place();lastAt=performance.now();armBehavior();schedule(true);
  }
  function setSuspended(value){suspended=!!value;host.hidden=suspended;cancelFrame();clearTimeout(behaviorTimer);lastAt=performance.now();
    thoughts.setPaused(suspended||prefs.paused);
    if(suspended){inertia=null;clearThoughts();clearTimeout(pressTimer);closeMenu(false);stopTravel();stopVoice();const pending=drag;drag=null;if(pending&&canvas.hasPointerCapture(pending.id))canvas.releasePointerCapture(pending.id);if(returning){const pos=place(...returning.to);prefs={...prefs,x:pos[0],y:pos[1]};onPosition(...pos);}returning=null;if(!injury)interaction='';}
    else{advanceBehavior();schedule(true);}
  }
  function rayHit(e){const rect=canvas.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)return false;
    const t=performance.now();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
    pose(performance.now());const targets=[];model.traverse(o=>{if(o.isMesh&&visibleMesh(o)){if(o.isSkinnedMesh){o.skeleton.update();o.boundingSphere=null;}targets.push(o);}});
    const result=raycaster.intersectObjects(targets,false).some(hit=>{const o=hit.object;return !o.isSkinnedMesh||o.skeleton.bones.some(b=>!/^FaceMode_/.test(b.name)||b.scale.x>.5);});
    hitTests++;hitMs+=performance.now()-t;return result;}
  function blocked(e){return [...document.querySelectorAll('dialog[open],[role="dialog"],.modal,#loading-overlay,.qrcode-egg-overlay')].some(el=>el.getBoundingClientRect().width>0&&getComputedStyle(el).visibility!=='hidden');}
  function down(e){if(menuOpen){if(menu.contains(e.target))return;closeMenu();}if(disposed||suspended||contextLost||e.button!==0||!e.isPrimary||blocked(e)||!rayHit(e))return;
    inertia=null;stopTravel();const rect=host.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top,moved:false,moody:brain.mood!=='normal',samples:[{x:e.clientX,y:e.clientY,at:performance.now()}]};returning=null;if(!drag.moody)brain.touch(performance.now());else homePoint||=[rect.left,rect.top];
    suppressClick=null;clearTimeout(pressTimer);if(!injury)pressTimer=setTimeout(openMenu,550);canvas.setPointerCapture(e.pointerId);e.preventDefault();e.stopImmediatePropagation();}
  function move(e){if(!drag||drag.id!==e.pointerId||drag.menu||injury)return;e.preventDefault();e.stopImmediatePropagation();
    if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>6){clearTimeout(pressTimer);drag.moved=true;nextAutoAt=Infinity;actionEndAt=Infinity;if(!drag.moody){interaction='drag';play('fly');}armBehavior();}
    if(drag.moved){const now=performance.now();drag.samples.push({x:e.clientX,y:e.clientY,at:now});drag.samples=drag.samples.filter(s=>now-s.at<=150);if(!drag.moody)faceDestination(e.clientX-(drag.lastX??drag.x),e.clientY-(drag.lastY??drag.y),true);drag.lastX=e.clientX;drag.lastY=e.clientY;place(drag.left+e.clientX-drag.x,drag.top+e.clientY-drag.y);}}
  function finish(e,cancelled=false){if(!drag||e.pointerId!==drag.id)return;const d=drag;drag=null;clearTimeout(pressTimer);
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(d.menu){suppressClick={until:performance.now()+500,x:e.clientX,y:e.clientY};e.preventDefault();e.stopImmediatePropagation();return;}
    if(d.moved){
      const velocity=cancelled?[0,0]:releaseVelocity(d.samples,performance.now());
      if(Math.hypot(...velocity)>=120){inertia={velocity,drag:d};interaction='inertia';actionEndAt=nextAutoAt=Infinity;faceDestination(...velocity,!d.moody);armBehavior();schedule(true);}
      else finishDrag(d);
    }
    if(cancelled&&!d.moved&&!injury)restoreBase();
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
    const manifest=await voiceManifest;signal.throwIfAborted();dazedVoices=(manifest.dazed||[]).filter(name=>/^death[^/\\]*\.ogg$/i.test(name));voices=(manifest.happy||[]).filter(name=>/^eatSugar\d+\.ogg$/.test(name));angryVoices=(manifest.angry||[]).filter(name=>['JaNai.ogg','Sato.ogg','Mo-Ya-Da.ogg'].includes(name));loopPolicy=Object.fromEntries(gltf.parser.json.animations.map(a=>[a.name,a.extras?.arcfoxPlayback]));
    model.traverse(o=>{if(o.userData.expressionMode!==undefined)faceMeshes.push(o);if(/^FaceMode_[0-6]$/.test(o.name))faceBones.push(o);
      if(!o.isMesh)return;if(/^(Lever_|Base_Bolt|Travel_Stop|Grip_Endcap)/.test(o.name))leverMeshes.push(o);
      for(const m of Array.isArray(o.material)?o.material:[o.material]){if(m.map){m.map.magFilter=THREE.NearestFilter;m.map.minFilter=THREE.NearestFilter;m.map.generateMipmaps=false;}m.roughness=.85;m.metalness=0;}});
    happyNames=clips.filter(clip=>!/^(gui2?|jump)$/i.test(clip.name)&&clip.tracks.some(track=>{
      const parsed=THREE.PropertyBinding.parseTrackName(track.name),node=THREE.PropertyBinding.findNode(model,parsed.nodeName);
      return node?.name==='FaceMode_1'&&parsed.propertyName==='scale'&&Array.from(track.values).every(value=>value>.5);
    })).map(clip=>clip.name);
    mixer=new THREE.AnimationMixer(model);mixer.addEventListener('finished',finishMotion);
    listen(menu,'click',e=>{const button=e.target.closest('button');if(!button)return;acknowledge();e.preventDefault();e.stopPropagation();if(button.hasAttribute('data-menu-close')){closeMenu();return;}const name=button.dataset.extra;if(!name)return;closeMenu(false);brain.mood='normal';brain.reason='';brain.until=0;brain.clicks=[];brain.recovery=[];brain.touch(performance.now());startMotion(name,'menu');});
    listen(menu,'keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeMenu();}else if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(e.key)){e.preventDefault();const buttons=[...menu.querySelectorAll('button')],i=buttons.indexOf(document.activeElement),step=['ArrowRight','ArrowDown'].includes(e.key)?1:-1;buttons[(i+step+buttons.length)%buttons.length].focus();}});
    listen(voice,'ended',()=>{voicePlaying=false;});
    play('idle');
    // Ignore zero-scale hidden triangles when fitting, exactly as the reference.
    model.updateMatrixWorld(true);model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
    const box=new THREE.Box3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
    model.traverse(o=>{if(!o.isMesh||!visibleMesh(o)||o.userData.expressionMode!==undefined)return;const index=o.geometry.index;
      for(let i=0;i<index.count;i+=3){o.getVertexPosition(index.getX(i),a).applyMatrix4(o.matrixWorld);o.getVertexPosition(index.getX(i+1),b).applyMatrix4(o.matrixWorld);o.getVertexPosition(index.getX(i+2),c).applyMatrix4(o.matrixWorld);
        if(ab.subVectors(b,a).cross(ac.subVectors(c,a)).lengthSq()<1e-12)continue;box.expandByPoint(a);box.expandByPoint(b);box.expandByPoint(c);}});
    if(box.isEmpty())throw new Error('Model has no visible body');const scale=3.2/(box.max.y-box.min.y);model.scale.setScalar(scale);model.position.set(-(box.max.x+box.min.x)/2*scale,-box.min.y*scale,0);
    listen(window,'resize',()=>{resize();updateBubble();armBehavior();});
    listen(document,'pointerdown',down,{capture:true,passive:false});listen(document,'pointermove',move,{capture:true,passive:false});
    listen(document,'pointerup',e=>finish(e),{capture:true,passive:false});listen(document,'pointercancel',e=>finish(e,true),true);
    // The transparent canvas is not the original touch target. Prevent native
    // scrolling only for a gesture already accepted by our precise hit test.
    listen(document,'touchstart',e=>{if(drag)e.preventDefault();},{capture:true,passive:false});
    listen(document,'touchmove',e=>{if(drag)e.preventDefault();},{capture:true,passive:false});
    listen(canvas,'lostpointercapture',e=>finish(e,true));
    listen(document,'click',e=>{if(suppressClick&&performance.now()<suppressClick.until&&Math.hypot(e.clientX-suppressClick.x,e.clientY-suppressClick.y)<4){suppressClick=null;e.preventDefault();e.stopImmediatePropagation();}},true);
    listen(canvas,'keydown',e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();openMenu(true);}else if(['Enter',' '].includes(e.key)){e.preventDefault();greet();}else if(e.key.startsWith('Arrow')){acknowledge();e.preventDefault();const rect=host.getBoundingClientRect();const pos=place(rect.left+(e.key==='ArrowRight'?10:e.key==='ArrowLeft'?-10:0),rect.top+(e.key==='ArrowDown'?10:e.key==='ArrowUp'?-10:0));onPosition(...pos);prefs={...prefs,x:pos[0],y:pos[1]};}});
    listen(canvas,'webglcontextlost',e=>{e.preventDefault();contextLost=true;stopVoice();cancelFrame();bubble.hidden=false;bubble.textContent='请重新开启酒狐';onError('显示暂时中断，请重新开启酒狐。');});
    resize();homePoint=place();if(natural())returnIdle();else startMotion(prefs.animation,'manual');setSuspended(document.hidden);
    return {configure,setSuspended,dispose,state:()=>({animations:clips.map(c=>c.name),visibleAnimations:visibleActions(clips.map(c=>c.name)),extraAnimations:clips.map(c=>c.name).filter(name=>/^extra\d+$/i.test(name)),menuOpen,natural:natural(),travel:travel?{animation:currentName,from:[...travel.from],to:[...travel.to]}:null,facingAngle:model.rotation.y,facingTarget:faceYaw,motionKind,happyAnimations:[...happyNames],interaction,voicePlaying,voiceName,voiceError,animation:currentName,expression:activeMode(),effectiveExpression:activeMode()<0?Number(faceBones.find(b=>b.scale.x>.5)?.name.slice(-1)):activeMode(),angry:brain.mood==='angry',mood:brain.mood,moodReason:brain.reason,idleAt:brain.idleAt,moodUntil:brain.until,injured:!!injury,injuryClicks:injury?.clicks||0,injuryUntil:injury?.until||0,inertia:!!inertia,thoughtCanvas:thoughts.state(),thoughtCount:thoughts.state().count,thoughtCapacity:512,thoughtNextAt,thoughtResumeAt,turnRate:TURN_RATE,nextAutoAt,actionEndAt,returning:!!returning,loop:action.loop,actionTime:action.time,homePoint:homePoint?[...homePoint]:null,bubble:!bubble.hidden?bubble.textContent:'',frames,hitTests,meanHitMs:hitTests?hitMs/hitTests:0,paused:prefs.paused,suspended,contextLost,position:[host.getBoundingClientRect().left,host.getBoundingClientRect().top],size:[canvas.width,canvas.height],drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,faceScales:faceBones.map(b=>({name:b.name,scale:b.scale.x})),leverVisible:leverMeshes.some(m=>m.visible)})};
  }catch(e){dispose();throw e;}
}
