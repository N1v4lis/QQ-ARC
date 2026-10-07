// Derive the minimal runtime from the intact reference package; never reconvert
// or trim source assets. GUI splits are reproducible derivatives; imports become relative.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const src=path.join(root,'Wine_Fox'),dest=path.join(root,'app/ui/assets/wine-fox');
const vendor=path.join(src,'WebPet/dist/vendor/three');
const files=[['Models/Derived/winefox-large-lever.glb','winefox.glb'],['Models/Derived/snowfox-large-lever.glb','snowfox.glb'],['Models/GLB/SOURCE.txt','SOURCE.txt']];
for(const [s,d] of files){fs.mkdirSync(path.dirname(path.join(dest,d)),{recursive:true});fs.copyFileSync(path.join(src,s),path.join(dest,d));}
for(const rel of ['three.module.js','three.core.js','LICENSE','addons/loaders/GLTFLoader.js','addons/utils/BufferGeometryUtils.js','addons/utils/SkeletonUtils.js']){
  const source=path.join(vendor,rel),target=path.join(dest,'three',rel);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(rel.startsWith('addons/'))fs.writeFileSync(target,fs.readFileSync(source,'utf8').replace(/from 'three'/g,"from '../../three.module.js'"));
  else fs.copyFileSync(source,target);
}
const bytes=fs.readFileSync(path.join(dest,'winefox.glb'));
console.log(`WineFox runtime ready; GLB SHA256 ${crypto.createHash('sha256').update(bytes).digest('hex')}`);

const voiceSource=path.join(root,'Wine_Fox_PECO'),voiceDest=path.join(dest,'voice');
fs.mkdirSync(voiceDest,{recursive:true});
const voices=fs.readdirSync(voiceSource).filter(n=>/^eatSugar\d+\.ogg$/.test(n)).sort();
for(const name of voices)fs.copyFileSync(path.join(voiceSource,name),path.join(voiceDest,name));
fs.writeFileSync(path.join(voiceDest,'manifest.json'),JSON.stringify({happy:voices},null,2));
