import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $=id=>document.getElementById(id);
const leverNames={lever_left_to_right:'拉杆 · 左到右',lever_right_to_left:'拉杆 · 右到左'};
const names={gui:'展示',idle:'待机',new_idle_empty:'基础待机',new_idle_1:'待机 · 一',new_idle_2:'待机 · 二',new_idle_3:'待机 · 三',new_idle_4:'待机 · 四',walk:'走路',run:'奔跑',death:'倒下',jump:'跳跃',fly:'飞行',elytra_fly:'鞘翅飞行',attacked:'受到攻击',sneak:'潜行',sneaking:'潜行待机',swim:'游泳',swim_stand:'水中待机',sit:'坐下',sleep:'睡觉',boat:'划船',climb:'攀爬',climbing:'攀爬待机',use_mainhand:'使用主手',use_offhand:'使用副手',swing_hand:'挥手',pre_parallel0:'辅助 · 0',pre_parallel5:'辅助 · 5',pre_parallel6:'辅助 · 6',pre_parallel7:'辅助 · 7',parallel0:'并行 · 0',parallel6:'并行 · 6',parallel7:'并行 · 7','head:default':'头部默认',ladder_up:'爬梯向上',ladder_stillness:'爬梯停留',ladder_down:'爬梯向下',extra0:'附加动作 · 0',extra1:'附加动作 · 1',extra2:'附加动作 · 2',extra3:'附加动作 · 3',extra4:'附加动作 · 4',extra5:'附加动作 · 5',extra6:'附加动作 · 6',extra7:'附加动作 · 7',beg:'乞求',picnic:'野餐','use_mainhand:gohei':'使用御币',game_win:'胜利',game_lost:'失落',keyboard:'弹奏'};
let renderer,controls,model,mixer,currentAction,currentName='',clips=[],paused=false,variant='winefox',loadVersion=0,drag=null,toastTimer;
const cache=new Map(),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
let tour=false,faceNodes=[],faceBones=[],leverMeshes=[];
let faceTracks=[];
function updatePose(dt){
  mixer.update(dt);
  // Evaluate the baked face channels explicitly. Mixer property caching must
  // not leave a manual override in place when returning to a paused auto pose.
  for(const binding of faceTracks){
    const value=binding.sample.evaluate(currentAction.time);
    if(binding.property==='scale')binding.node.scale.fromArray(value);
    else for(let i=0;i<value.length;i++)binding.node.morphTargetInfluences[i]=value[i];
  }
  applyExpression();model.updateMatrixWorld(true);
}
const dragPlane=new THREE.Plane(),hit=new THREE.Vector3();
const scene=new THREE.Scene(),character=new THREE.Group(); scene.add(character);
const camera=new THREE.PerspectiveCamera(35,1,.05,100);
const canvas=$('canvas'),viewport=$('viewport');
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2200);}
function showError(error){console.error(error);$('loading').hidden=false;$('loading').querySelector('strong').textContent='暂时没能加载角色';$('load-detail').textContent='请确认本地服务已启动，然后再试一次。';$('retry').hidden=false;}
function boundsOfVisible(root){
  root.updateMatrixWorld(true);
  root.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
  const bounds=new THREE.Box3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),edge=new THREE.Vector3(),cross=new THREE.Vector3();
  root.traverse(o=>{
    if(!o.isMesh||!o.visible)return;
    const index=o.geometry.index,positions=o.geometry.attributes.position;
    const count=index?index.count:positions.count;
    for(let i=0;i<count;i+=3){
      const vertex=(n,target)=>o.getVertexPosition(index?index.getX(n):n,target).applyMatrix4(o.matrixWorld);
      vertex(i,a);vertex(i+1,b);vertex(i+2,c);
      edge.subVectors(b,a);cross.subVectors(c,a).cross(edge);
      if(cross.lengthSq()<1e-12)continue;
      bounds.expandByPoint(a);bounds.expandByPoint(b);bounds.expandByPoint(c);
    }
  });
  return bounds;
}
function resize(){const width=viewport.clientWidth,height=viewport.clientHeight;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
function resetView(){
  character.position.set(0,0,0);
  const narrow=viewport.clientWidth/viewport.clientHeight<.9;
  camera.position.set(2.0,1.7,-(narrow?7.4:5.5));
  controls.target.set(0,1.05,0);controls.update();
}
function updatePlaybackUI(){
  $('animation-select').value=currentName;
  $('now-playing').textContent=(paused?'已暂停 · ':'正在播放 · ')+(names[currentName]||currentName);
  $('pause').textContent=paused?'继续':'暂停';
  $('tour').textContent=tour?'停止逐个演示':'逐个演示全部动作';
  $('animation-list').querySelectorAll('button').forEach(button=>{
    const active=button.dataset.name===currentName;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  });
  canvas.setAttribute('aria-label',`${variant==='winefox'?'酒狐':'雪狐'}三维模型，当前动作：${names[currentName]||currentName}。拖动移动，点击随机动作。`);
}
function configureLoop(action){
  const repeat=$('loop').checked&&!tour&&!action.getClip().name.startsWith('lever_');
  action.setLoop(repeat?THREE.LoopRepeat:THREE.LoopOnce,repeat?Infinity:1);
  action.clampWhenFinished=true;
}
function play(name,announce=false){
  if(!mixer)return;
  const clip=clips.find(c=>c.name===name);if(!clip)return;
  // Every imported clip contains its complete default pose. Immediate switches
  // avoid blending unrelated scale-zero expression controls through the body.
  mixer.stopAllAction();currentAction=mixer.clipAction(clip);currentAction.reset();configureLoop(currentAction);
  faceTracks=[];
  for(const track of clip.tracks){
    const parsed=THREE.PropertyBinding.parseTrackName(track.name);
    const node=THREE.PropertyBinding.findNode(model,parsed.nodeName);
    if(node&&((faceBones.includes(node)&&parsed.propertyName==='scale')||(faceNodes.includes(node)&&parsed.propertyName==='morphTargetInfluences')))
      faceTracks.push({node,property:parsed.propertyName,sample:track.createInterpolant()});
  }
  currentAction.play();paused=false;mixer.timeScale=Number($('playback-speed').value);currentName=name;
  leverMeshes.forEach(o=>o.visible=name.startsWith('lever_'));
  updatePose(0);updatePlaybackUI();
  if(announce)toast(`${variant==='winefox'?'酒狐':'雪狐'}：${names[name]||name}`);
}
function randomAnimation(){
  if(!clips.length)return;
  const candidates=clips.filter(c=>c.name!==currentName);
  play(candidates[Math.floor(Math.random()*candidates.length)].name,true);
}
function togglePause(){if(!mixer)return;paused=!paused;mixer.timeScale=paused?0:Number($('playback-speed').value);updatePlaybackUI();}
function applyExpression(){
  if(!model)return;
  const mode=Number($('expression-select').value);
  faceNodes.forEach(o=>{
    o.visible=mode<0||Number(o.userData.expressionMode)===mode;
    const mouth=Number($('mouth-select').value);
    if(mouth>=0&&o.morphTargetInfluences)o.morphTargetInfluences[0]=mouth;
  });
  if(mode>=0)faceBones.forEach(o=>o.scale.setScalar(Number(o.name.slice(-1))===mode?1:.00001));
}
function buildAnimationMenu(){
  $('animation-select').replaceChildren();$('animation-list').replaceChildren();
  for(const clip of clips){
    const label=leverNames[clip.name]||names[clip.name]||clip.name;
    const option=document.createElement('option');option.value=clip.name;option.textContent=`${label} · ${clip.name}`;$('animation-select').append(option);
    const button=document.createElement('button');button.className='clip';button.dataset.name=clip.name;button.setAttribute('aria-pressed','false');
    const title=document.createElement('strong');title.textContent=label;
    const detail=document.createElement('small');detail.textContent=`${clip.name} · ${clip.duration.toFixed(2)}秒`;
    button.append(title,detail);button.title=`${label} (${clip.name})`;
    button.addEventListener('click',()=>play(clip.name));$('animation-list').append(button);
  }
  $('clip-count').textContent=`${clips.length} 个`;
}
async function loadVariant(next){
  const version=++loadVersion;
  $('loading').hidden=false;$('retry').hidden=true;
  $('loading').querySelector('strong').textContent=`${next==='winefox'?'酒狐':'雪狐'}正在过来…`;
  $('load-detail').textContent='准备模型与动作';
  ['animation-select','random','pause'].forEach(id=>$(id).disabled=true);
  document.querySelectorAll('.variant').forEach(button=>button.disabled=true);
  try{
    if(!cache.has(next)){
      const promise=new GLTFLoader().loadAsync(`./models/${next}-large-lever.glb`,event=>{
        if(version!==loadVersion)return;
        $('load-detail').textContent=event.total?`载入 ${Math.round(event.loaded/event.total*100)}%`:'正在载入模型…';
      });
      cache.set(next,promise);promise.catch(()=>cache.delete(next));
    }
    const gltf=await cache.get(next);if(version!==loadVersion)return;
    if(mixer){mixer.stopAllAction();mixer.uncacheRoot(model);}
    character.clear();character.position.set(0,0,0);model=gltf.scene;model.position.set(0,0,0);model.scale.setScalar(1);
    character.add(model);variant=next;clips=gltf.animations;
    faceNodes=[];faceBones=[];leverMeshes=[];faceTracks=[];
    model.traverse(o=>{
      if(o.userData.expressionMode!==undefined)faceNodes.push(o);
      if(/^FaceMode_[0-6]$/.test(o.name))faceBones.push(o);
      if(o.isMesh&&/^(Lever_|Base_Bolt|Travel_Stop|Grip_Endcap)/.test(o.name))leverMeshes.push(o);
    });
    $('expression-control').hidden=false;
    model.traverse(o=>{
      if(!o.isMesh)return;o.castShadow=false;o.receiveShadow=false;
      const materials=Array.isArray(o.material)?o.material:[o.material];
      materials.forEach(material=>{if(material.map){material.map.magFilter=THREE.NearestFilter;material.map.minFilter=THREE.NearestFilter;material.map.generateMipmaps=false;}material.roughness=.85;material.metalness=0;});
    });
    mixer=new THREE.AnimationMixer(model);
    mixer.addEventListener('finished',()=>{
      if(tour){play(clips[(clips.findIndex(c=>c.name===currentName)+1)%clips.length].name);}
      else if($('loop').checked&&currentName.startsWith('lever_'))play(currentName==='lever_left_to_right'?'lever_right_to_left':'lever_left_to_right');
    });
    buildAnimationMenu();
    play(clips.some(c=>c.name===currentName)?currentName:clips.some(c=>c.name==='idle')?'idle':clips[0].name);
    const bounds=boundsOfVisible(model);
    if(bounds.isEmpty())throw new Error('模型没有可见几何体');
    const height=bounds.max.y-bounds.min.y;const scale=2.15/height;
    model.scale.setScalar(scale);
    model.position.set(-(bounds.min.x+bounds.max.x)/2*scale,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)/2*scale);
    resetView();
    $('character-name').textContent=`和${variant==='winefox'?'酒狐':'雪狐'}玩一会儿`;
    document.querySelectorAll('.variant').forEach(button=>{const active=button.dataset.variant===variant;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    $('loading').hidden=true;['animation-select','random','pause'].forEach(id=>$(id).disabled=false);
    window.dispatchEvent(new CustomEvent('fox-ready',{detail:{variant,animations:clips.length}}));
  }catch(error){if(version===loadVersion)showError(error);}
  finally{if(version===loadVersion)document.querySelectorAll('.variant').forEach(button=>button.disabled=false);}
}
function pointRay(event){const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);}
function characterHit(event){
  if(!model||!$('loading').hidden)return false;
  pointRay(event);model.updateMatrixWorld(true);
  model.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.boundingSphere=null;}});
  return raycaster.intersectObject(model,true).length>0;
}
function pointerDown(event){
  if(event.button!==0||!characterHit(event))return;
  event.preventDefault();event.stopImmediatePropagation();
  controls.enabled=false;canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';
  const normal=camera.getWorldDirection(new THREE.Vector3());
  dragPlane.setFromNormalAndCoplanarPoint(normal,character.position.clone().add(new THREE.Vector3(0,1,0)));
  raycaster.ray.intersectPlane(dragPlane,hit);
  drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,start:hit.clone(),position:character.position.clone(),moved:false};
}
function pointerMove(event){
  if(drag){
    if(event.pointerId!==drag.id)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>6)drag.moved=true;
    if(!drag.moved)return;
    pointRay(event);
    if(raycaster.ray.intersectPlane(dragPlane,hit)){
      character.position.copy(drag.position).add(hit.clone().sub(drag.start));
      character.position.y=Math.max(0,character.position.y);
    }
  }else{canvas.style.cursor=characterHit(event)?'grab':'default';}
}
function finishPointer(event,cancelled=false){
  if(!drag||event.pointerId!==drag.id)return;
  event.stopImmediatePropagation();
  const shouldClick=!cancelled&&!drag.moved;
  drag=null;controls.enabled=true;canvas.style.cursor='grab';
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  if(shouldClick)randomAnimation();
}
function init(){
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  scene.add(new THREE.HemisphereLight(0xfffaf1,0xa79aad,2.2));
  const key=new THREE.DirectionalLight(0xffe5c3,2.7);key.position.set(-3,5,-4);scene.add(key);
  const fill=new THREE.DirectionalLight(0xe5efff,1.1);fill.position.set(3,2,2);scene.add(fill);
  const floor=new THREE.Mesh(new THREE.CircleGeometry(2.5,96),new THREE.MeshStandardMaterial({color:0xe5d2da,roughness:1,transparent:true,opacity:.6}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-.025;scene.add(floor);
  const ring=new THREE.Mesh(new THREE.RingGeometry(2.48,2.50,96),new THREE.MeshBasicMaterial({color:0xc6a7b6,transparent:true,opacity:.6,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=-.02;scene.add(ring);
  // Register model picking before OrbitControls so a model drag never rotates the camera.
  canvas.addEventListener('pointerdown',pointerDown,{capture:true});
  canvas.addEventListener('pointermove',pointerMove,{capture:true});
  canvas.addEventListener('pointerup',e=>finishPointer(e),{capture:true});
  canvas.addEventListener('pointercancel',e=>finishPointer(e,true),{capture:true});
  canvas.addEventListener('lostpointercapture',e=>finishPointer(e,true),{capture:true});
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.enablePan=false;controls.minDistance=2.8;controls.maxDistance=12;controls.maxPolarAngle=Math.PI*.77;
  controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
  resetView();new ResizeObserver(resize).observe(viewport);resize();
  let previous=performance.now();
  renderer.setAnimationLoop(now=>{const dt=Math.min((now-previous)/1000,.06);previous=now;if(mixer){updatePose(dt);$('timeline').value=currentAction?.time||0;const duration=currentAction?.getClip().duration||0;$('timeline').max=duration;$('time-label').textContent=`${(currentAction?.time||0).toFixed(2)} / ${duration.toFixed(2)} 秒`;}controls.update();renderer.render(scene,camera);});
  document.addEventListener('visibilitychange',()=>{previous=performance.now();});
  $('random').addEventListener('click',randomAnimation);$('pause').addEventListener('click',togglePause);
  $('expression-select').addEventListener('change',()=>{if(mixer)updatePose(0);toast((variant==='winefox'?'酒狐':'雪狐')+'：'+$('expression-select').selectedOptions[0].textContent);});
  $('mouth-select').addEventListener('change',()=>{if(mixer)updatePose(0);});
  $('tour').addEventListener('click',()=>{tour=!tour;if(currentAction)play(currentName);updatePlaybackUI();});
  $('timeline').addEventListener('input',event=>{
    if(!currentAction)return;
    paused=true;mixer.timeScale=0;currentAction.paused=false;currentAction.enabled=true;
    currentAction.time=Number(event.target.value);updatePose(0);updatePlaybackUI();
  });
  $('animation-select').addEventListener('change',event=>play(event.target.value));
  $('playback-speed').addEventListener('input',event=>{const speed=Number(event.target.value);$('speed-label').textContent=speed.toFixed(2)+'×';if(mixer)mixer.timeScale=paused?0:speed;});
  $('loop').addEventListener('change',()=>{if(currentAction){currentAction.reset();configureLoop(currentAction);currentAction.play();currentAction.paused=false;updatePose(0);}});
  $('reset').addEventListener('click',()=>{resetView();toast('回到中央');});
  $('retry').addEventListener('click',()=>loadVariant(variant));
  document.querySelectorAll('.variant').forEach(button=>button.addEventListener('click',()=>loadVariant(button.dataset.variant)));
  canvas.addEventListener('keydown',event=>{if(event.code==='Space'){event.preventDefault();togglePause();}if(event.code==='Enter'){event.preventDefault();randomAnimation();}});
  loadVariant('winefox');
  // Read-only diagnostics for verifying browser interaction and animation state.
  window.foxState=()=>({variant,animation:currentName,animations:clips.map(c=>c.name),durations:clips.map(c=>({name:c.name,seconds:c.duration})),tour,paused,position:character.position.toArray(),time:currentAction?.time,loaded:$('loading').hidden,rendererCalls:renderer.info.render.calls,expression:Number($('expression-select').value),expressionMeshes:faceNodes.map(o=>({name:o.name,mode:o.userData.expressionMode,visible:o.visible,mouth:o.morphTargetInfluences?.[0]})),faceScales:faceBones.map(o=>({name:o.name,scale:o.scale.x})),leverVisible:leverMeshes.some(o=>o.visible)});
  const context=document.modelContext;
  if(context?.registerTool){
    for(const tool of [
      {name:'read_fox_animation_state',description:'读取角色、可用动画、当前动作和播放状态。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>window.foxState()},
      {name:'play_fox_animation',description:'在当前角色上播放指定动画，名称必须来自可用动画列表。',inputSchema:{type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{if(!input||typeof input.name!=='string'||!clips.some(c=>c.name===input.name))throw new Error('请选择已载入的有效动作');play(input.name);return window.foxState();}}
    ]){try{Promise.resolve(context.registerTool(tool)).catch(error=>console.warn('WebMCP',error));}catch(error){console.warn('WebMCP',error);}}
  }
}
try{init();}catch(error){showError(error);}
