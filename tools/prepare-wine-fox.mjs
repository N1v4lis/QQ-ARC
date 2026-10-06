// Derive the minimal runtime from the intact reference package; never reconvert
// or trim the supplied model/animations. Bare Three.js imports become relative.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const src=path.join(root,'Wine_Fox'),dest=path.join(root,'app/ui/assets/wine-fox');
const vendor=path.join(src,'WebPet/dist/vendor/three');
const files=[['Models/GLB/winefox-large-lever.glb','winefox.glb'],['Models/GLB/SOURCE.txt','SOURCE.txt']];
for(const [s,d] of files){fs.mkdirSync(path.dirname(path.join(dest,d)),{recursive:true});fs.copyFileSync(path.join(src,s),path.join(dest,d));}
for(const rel of ['three.module.js','three.core.js','LICENSE','addons/loaders/GLTFLoader.js','addons/utils/BufferGeometryUtils.js','addons/utils/SkeletonUtils.js']){
  const source=path.join(vendor,rel),target=path.join(dest,'three',rel);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(rel.startsWith('addons/'))fs.writeFileSync(target,fs.readFileSync(source,'utf8').replace(/from 'three'/g,"from '../../three.module.js'"));
  else fs.copyFileSync(source,target);
}
const bytes=fs.readFileSync(path.join(dest,'winefox.glb'));
console.log(`WineFox runtime ready; GLB SHA256 ${crypto.createHash('sha256').update(bytes).digest('hex')}`);
