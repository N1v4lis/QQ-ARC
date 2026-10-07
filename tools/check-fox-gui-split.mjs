import fs from 'node:fs';
import assert from 'node:assert/strict';
function load(file){const bytes=fs.readFileSync(file),len=bytes.readUInt32LE(12);return {bytes,doc:JSON.parse(bytes.toString('utf8',20,20+len)),bin:bytes.subarray(28+len,28+len+bytes.readUInt32LE(20+len))};}
function values(model,index){const a=model.doc.accessors[index],v=model.doc.bufferViews[a.bufferView],n={SCALAR:1,VEC3:3,VEC4:4}[a.type];return Array.from({length:a.count*n},(_,i)=>model.bin.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+i*4));}
for(const name of ['winefox','snowfox']){
  const source=load(`Wine_Fox/Models/GLB/${name}-large-lever.glb`),derived=load(`Wine_Fox/Models/Derived/${name}-large-lever.glb`);
  assert.equal(derived.doc.animations.length,47);
  assert(derived.bin.subarray(0,source.bin.length).equals(source.bin),'Original binary data must remain intact');
  for(const key of ['meshes','nodes','materials','images','textures','skins'])assert.deepEqual(derived.doc[key],source.doc[key]);
  assert.deepEqual(derived.doc.animations.filter(a=>!/^gui2?$/.test(a.name)),source.doc.animations.filter(a=>a.name!=='gui'));
  const original=source.doc.animations.find(a=>a.name==='gui'),first=derived.doc.animations.find(a=>a.name==='gui'),second=derived.doc.animations.find(a=>a.name==='gui2');
  assert.deepEqual(first.channels,original.channels);assert.deepEqual(second.channels,original.channels);
  first.samplers.forEach((sampler,i)=>{
    const next=second.samplers[i],old=original.samplers[i],oldTimes=values(source,old.input),a=values(derived,sampler.input),b=values(derived,next.input);
    assert.equal(a[0],0);assert.equal(a.at(-1),4);assert.equal(b[0],0);assert.equal(b.at(-1),14);
    const left=values(derived,sampler.output),right=values(derived,next.output),width=left.length/a.length;
    assert.deepEqual(left.slice(-width),right.slice(0,width),'Frame 120 shared boundary must match');
    const originalValues=values(source,old.output);
    for(let k=0;k<oldTimes.length;k++){
      const time=oldTimes[k],times=time<4?a:b,local=time<4?time:time-4,output=time<4?left:right;
      const at=times.findIndex(t=>Math.abs(t-local)<2e-5);assert(at>=0,'Every source keyframe must survive');
      for(let c=0;c<width;c++)assert(Math.abs(output[at*width+c]-originalValues[k*width+c])<1e-5,'Source keyframe values must match');
    }
  });
  assert(fs.readFileSync(`app/ui/assets/wine-fox/${name}.glb`).equals(derived.bytes));
  console.log(`${name}: 47 clips, gui=4s / gui2=14s, all keyframes and frame-120 boundary preserved; geometry/materials/other clips unchanged.`);
}
