import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const $=id=>document.getElementById(id),canvas=$('pet');
const scene=new THREE.Scene(),character=new THREE.Group();scene.add(character);
const camera=new THREE.OrthographicCamera(-8,8,5,-5,.05,100);camera.position.set(0,0,-10);camera.lookAt(0,0,0);
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});renderer.setClearColor(0,0);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
scene.add(new THREE.HemisphereLight(0xfffaf1,0xa79aad,2.2));for(const [color,intensity,position] of [[0xffe5c3,2.7,[-3,5,-4]],[0xe5efff,1.1,[3,2,2]]]){const light=new THREE.DirectionalLight(color,intensity);light.position.set(...position);scene.add(light);}
let model,mixer,action,clips=[],currentName='',head,loaded=false,paused=false,drag=null,clickTimes=[],angerUntil=0,greetingUntil=0,userExpression=-1,bubbleUntil=0,restoreAt=0,baseScale=1,petHeight=3.2;
let faceNodes=[],faceBones=[],faceTracks=[],leverMeshes=[];
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,0,1),0),intersection=new THREE.Vector3();
const names={idle:'待机',new_idle_1:'待机 · 一',new_idle_2:'待机 · 二',new_idle_3:'待机 · 三',new_idle_4:'待机 · 四',gui:'展示',walk:'走路',run:'奔跑',fly:'飞行',sit:'坐下',sleep:'睡觉',jump:'跳跃',swing_hand:'挥手',beg:'乞求',picnic:'野餐'};
function resize(){const ratio=innerWidth/innerHeight;camera.left=-5*ratio;camera.right=5*ratio;camera.top=5;camera.bottom=-5;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);clampPosition();}
function clampPosition(){const halfWidth=petHeight*.34;const margin=Math.min(.4,5*(camera.right-camera.left)/10);character.position.x=THREE.MathUtils.clamp(character.position.x,camera.left+halfWidth+margin,camera.right-halfWidth-margin);character.position.y=THREE.MathUtils.clamp(character.position.y,-4.65,Math.max(-4.65,4.65-petHeight));}
function home(){character.position.set((camera.right-camera.left)*.20,-4.0,0);clampPosition();}
function expression(now=performance.now()){return now<angerUntil?2:now<greetingUntil?1:userExpression;}
function applyExpression(now){
  if(!model)return;
  for(const binding of faceTracks){
    const value=binding.sample.evaluate(action.time);
    if(binding.property==='scale')binding.node.scale.fromArray(value);
    else for(let i=0;i<value.length;i++)binding.node.morphTargetInfluences[i]=value[i];
  }
  const mode=expression(now);
  faceNodes.forEach(o=>o.visible=mode<0||Number(o.userData.expressionMode)===mode);
  if(mode>=0)faceBones.forEach(o=>o.scale.setScalar(Number(o.name.slice(-1))===mode?1:.00001));
  model.updateMatrixWorld(true);
}
function speak(text,ms=1800,angry=false){$('bubble').textContent=text;$('bubble').classList.toggle('angry',angry);$('bubble').hidden=false;bubbleUntil=performance.now()+ms;}
function play(name,temporary=false){
  if(!mixer)return;const clip=clips.find(c=>c.name===name);if(!clip)return;
  mixer.stopAllAction();action=mixer.clipAction(clip);action.reset();
  const lever=name.startsWith('lever_');action.setLoop(lever?THREE.LoopOnce:THREE.LoopRepeat,lever?1:Infinity);action.clampWhenFinished=true;action.play();
  currentName=name;mixer.timeScale=paused?0:1;faceTracks=[];
  for(const track of clip.tracks){
    const parsed=THREE.PropertyBinding.parseTrackName(track.name),node=THREE.PropertyBinding.findNode(model,parsed.nodeName);
    if(node&&((faceBones.includes(node)&&parsed.propertyName==='scale')||(faceNodes.includes(node)&&parsed.propertyName==='morphTargetInfluences')))
      faceTracks.push({node,property:parsed.propertyName,sample:track.createInterpolant()});
  }
  leverMeshes.forEach(o=>o.visible=lever);mixer.update(0);applyExpression();
  $('animation').value=name;restoreAt=temporary?performance.now()+Math.min(5000,clip.duration*1000):0;
}
function greet(){if(!loaded)return;const now=performance.now();clickTimes=clickTimes.filter(t=>now-t<=2000);clickTimes.push(now);
  if(now<angerUntil||clickTimes.length>=3){angerUntil=now+6000;greetingUntil=0;clickTimes=[];speak('💢 别一直戳我啦！',2500,true);applyExpression(now);return;}
  greetingUntil=now+1800;speak(clickTimes.length===2?'再戳就要生气了哦。':'嗯？你叫我呀。');applyExpression(now);
}
function pointRay(event){const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);}
function hitPet(event){if(!loaded)return false;pointRay(event);model.updateMatrixWorld(true);model.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.boundingSphere=null;}});return raycaster.intersectObject(model,true).some(hit=>hit.object.visible);}
canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!hitPet(event))return;event.preventDefault();canvas.setPointerCapture(event.pointerId);raycaster.ray.intersectPlane(plane,intersection);drag={id:event.pointerId,x:event.clientX,y:event.clientY,origin:intersection.clone(),position:character.position.clone(),moved:false};canvas.style.cursor='grabbing';$('hint').classList.add('faded');});
canvas.addEventListener('pointermove',event=>{if(!drag){canvas.style.cursor=hitPet(event)?'grab':'default';return;}if(event.pointerId!==drag.id)return;drag.moved||=Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>6;if(!drag.moved)return;pointRay(event);if(raycaster.ray.intersectPlane(plane,intersection)){character.position.copy(drag.position).add(intersection.clone().sub(drag.origin));clampPosition();}});
function finishDrag(event,cancelled=false){if(!drag||drag.id!==event.pointerId)return;const click=!cancelled&&!drag.moved;drag=null;canvas.style.cursor='grab';if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(click)greet();}
canvas.addEventListener('pointerup',event=>finishDrag(event));canvas.addEventListener('pointercancel',event=>finishDrag(event,true));canvas.addEventListener('lostpointercapture',event=>finishDrag(event,true));canvas.addEventListener('keydown',event=>{if(event.code==='Enter'){event.preventDefault();greet();}});
function bounds(root){root.updateMatrixWorld(true);root.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});const box=new THREE.Box3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();root.traverse(o=>{if(!o.isMesh||!o.visible||o.userData.expressionMode!==undefined)return;const index=o.geometry.index;for(let i=0;i<index.count;i+=3){o.getVertexPosition(index.getX(i),a).applyMatrix4(o.matrixWorld);o.getVertexPosition(index.getX(i+1),b).applyMatrix4(o.matrixWorld);o.getVertexPosition(index.getX(i+2),c).applyMatrix4(o.matrixWorld);if(ab.subVectors(b,a).cross(ac.subVectors(c,a)).lengthSq()<1e-12)continue;box.expandByPoint(a);box.expandByPoint(b);box.expandByPoint(c);}});return box;}
async function load(){try{
  $('loading').hidden=false;$('retry').hidden=true;
  const gltf=await new GLTFLoader().loadAsync('./models/winefox.glb');
  model=gltf.scene;clips=gltf.animations;character.add(model);head=model.getObjectByName('Head');
  faceNodes=[];faceBones=[];leverMeshes=[];
  model.traverse(o=>{
    if(o.userData.expressionMode!==undefined)faceNodes.push(o);
    if(/^FaceMode_[0-6]$/.test(o.name))faceBones.push(o);
    if(!o.isMesh)return;
    if(/^(Lever_|Base_Bolt|Travel_Stop|Grip_Endcap)/.test(o.name))leverMeshes.push(o);
    for(const material of Array.isArray(o.material)?o.material:[o.material]){
      if(material.map){material.map.magFilter=THREE.NearestFilter;material.map.minFilter=THREE.NearestFilter;material.map.generateMipmaps=false;}
      material.roughness=.85;material.metalness=0;
    }
  });
  mixer=new THREE.AnimationMixer(model);
  mixer.addEventListener('finished',()=>{if(currentName.startsWith('lever_'))play(currentName==='lever_left_to_right'?'lever_right_to_left':'lever_left_to_right');});
  $('animation').replaceChildren(...clips.map(c=>{const option=document.createElement('option');option.value=c.name;option.textContent=(names[c.name]||c.name)+' · '+c.name;return option;}));
  play(clips.some(c=>c.name==='idle')?'idle':clips[0].name);applyExpression();const box=bounds(model);
  if(box.isEmpty())throw new Error('角色几何体为空');
  baseScale=3.2/(box.max.y-box.min.y);model.scale.setScalar(baseScale);
  model.position.set(-(box.max.x+box.min.x)/2*baseScale,-box.min.y*baseScale,0);
  home();loaded=true;$('loading').hidden=true;$('animation').disabled=false;
}catch(error){console.error(error);$('load-text').textContent='酒狐迷路了，重试一下吧。';$('retry').hidden=false;}}
function panel(open){$('settings').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));$('settings-toggle').setAttribute('aria-label',open?'收起酒狐设置':'打开酒狐设置');if(open)$('expression').focus();else $('settings-toggle').focus();}
$('settings-toggle').addEventListener('click',()=>panel($('settings').hidden));$('close').addEventListener('click',()=>panel(false));document.addEventListener('keydown',event=>{if(event.code==='Escape')panel(false);});
$('expression').addEventListener('change',()=>{userExpression=Number($('expression').value);angerUntil=0;greetingUntil=0;clickTimes=[];applyExpression();});$('animation').addEventListener('change',()=>play($('animation').value));$('home').addEventListener('click',home);$('pause').addEventListener('click',()=>{paused=!paused;if(mixer)mixer.timeScale=paused?0:1;$('pause').textContent=paused?'继续动作':'暂停动作';});$('size').addEventListener('input',()=>{const size=Number($('size').value);character.scale.setScalar(size/100);petHeight=3.2*size/100;$('size-label').value=size+'%';clampPosition();});$('retry').addEventListener('click',load);
let previous=performance.now();renderer.setAnimationLoop(now=>{const dt=Math.min((now-previous)/1000,.05);previous=now;if(mixer)mixer.update(dt);if(angerUntil&&now>=angerUntil){angerUntil=0;speak('好啦，不生气了。');}if(restoreAt&&now>=restoreAt)play('idle');applyExpression(now);if(now>bubbleUntil)$('bubble').hidden=true;if(head&&!$('bubble').hidden){const anchor=head.getWorldPosition(new THREE.Vector3());anchor.y+=petHeight*.28;anchor.project(camera);$('bubble').style.left=THREE.MathUtils.clamp((anchor.x+1)*innerWidth/2,110,innerWidth-110)+'px';$('bubble').style.top=THREE.MathUtils.clamp((1-anchor.y)*innerHeight/2,60,innerHeight-40)+'px';}renderer.render(scene,camera);});window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>previous=performance.now());setTimeout(()=>$('hint').classList.add('faded'),10000);resize();load();
window.petState=()=>({loaded,animation:currentName,animations:clips.map(c=>c.name),expression:expression(),effectiveExpression:expression()<0?Number(faceBones.find(o=>o.scale.x>.5)?.name.slice(-1)):expression(),angry:performance.now()<angerUntil,position:character.position.toArray(),clicks:clickTimes.length,paused,panelOpen:!$('settings').hidden,meshes:Array.from({length:7},(_,mode)=>faceNodes.find(o=>Number(o.userData.expressionMode)===mode)?.visible||false),faceScales:faceBones.map(o=>({name:o.name,scale:o.scale.x})),leverVisible:leverMeshes.some(o=>o.visible)});
