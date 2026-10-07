import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Quaternion} from '../app/ui/assets/wine-fox/three/three.core.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function splitGui(bytes){
  if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2)throw Error('Expected GLB2');
  const size=bytes.readUInt32LE(12),doc=JSON.parse(bytes.toString('utf8',20,20+size));
  const bin=bytes.subarray(28+size,28+size+bytes.readUInt32LE(20+size));
  const index=doc.animations.findIndex(a=>a.name==='gui');if(index<0||doc.animations.some(a=>a.name==='gui2'))throw Error('Expected unsplit gui');
  const original=doc.animations[index],chunks=[bin];let length=bin.length;
  function append(values,type,count,min,max){
    const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}
    const buffer=Buffer.alloc(values.length*4);values.forEach((v,i)=>buffer.writeFloatLE(v,i*4));
    const view=doc.bufferViews.push({buffer:0,byteOffset:length,byteLength:buffer.length})-1;chunks.push(buffer);length+=buffer.length;
    return doc.accessors.push({bufferView:view,componentType:5126,count,type,...(min?{min,max}:{})})-1;
  }
  function read(accessor){
    const a=doc.accessors[accessor],v=doc.bufferViews[a.bufferView],n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
    if(a.componentType!==5126||a.sparse||v.byteStride||!n)throw Error('Unsupported animation accessor');
    return Array.from({length:a.count*n},(_,i)=>bin.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+i*4));
  }
  function clip(name,start,end){
    const result={...original,name,samplers:[],channels:original.channels.map(c=>({...c,target:{...c.target}})),extras:{...original.extras,arcfoxGui:{fps:30,sourceFrames:[start*30,end*30]}}};
    original.samplers.forEach((s,i)=>{
      const times=read(s.input),values=read(s.output),width=values.length/times.length,kind=s.interpolation||'LINEAR';
      if(!Number.isInteger(width)||!['STEP','LINEAR'].includes(kind))throw Error('Unsupported interpolation');
      const keys=[start,...times.filter(t=>t>start+1e-5&&t<end-1e-5),end];
      const rotation=original.channels.some(c=>c.sampler===i&&c.target.path==='rotation');
      const out=[];
      for(const time of keys){
        let hi=times.findIndex(t=>t>=time);if(hi<0)hi=times.length-1;
        let lo=Math.max(0,hi-1);if(Math.abs(times[hi]-time)<1e-5)lo=hi;
        const span=times[hi]-times[lo],ratio=span?(time-times[lo])/span:0;
        const a=values.slice(lo*width,(lo+1)*width),b=values.slice(hi*width,(hi+1)*width);
        if(kind==='STEP'||lo===hi)out.push(...a);
        else if(rotation){const q=[];Quaternion.slerpFlat(q,0,a,0,b,0,ratio);out.push(...q);}
        else out.push(...a.map((v,k)=>v+(b[k]-v)*ratio));
      }
      const a=doc.accessors[s.output],components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
      result.samplers.push({...s,input:append(keys.map(t=>t-start),'SCALAR',keys.length,[0],[end-start]),output:append(out,a.type,out.length/components)});
    });return result;
  }
  const duration=Math.max(...original.samplers.map(s=>read(s.input).at(-1)));if(Math.abs(duration-18)>1e-4)throw Error('GUI duration changed');
  const first=clip('gui',0,4),second=clip('gui2',4,duration);doc.animations.splice(index,1,first,second);
  doc.buffers[0].byteLength=length;
  let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
  let body=Buffer.concat(chunks);body=Buffer.concat([body,Buffer.alloc((4-body.length%4)%4)]);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+body.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(body.length,0);binHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,json,binHeader,body]);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dest=path.join(root,'Wine_Fox/Models/Derived');fs.mkdirSync(dest,{recursive:true});
  for(const name of ['winefox','snowfox']){
    const file=`${name}-large-lever.glb`,bytes=splitGui(fs.readFileSync(path.join(root,'Wine_Fox/Models/GLB',file)));
    fs.writeFileSync(path.join(dest,file),bytes);console.log(`${name}: gui 4s, gui2 14s; 47 clips, geometry and original library retained`);
  }
  fs.copyFileSync(path.join(root,'Wine_Fox/Models/GLB/SOURCE.txt'),path.join(dest,'SOURCE.txt'));
}
