// User supplied Minecraft wallpapers replace the retired generated scenes.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(root,'../../Minecraft_Wallpapers'),target=path.join(root,'app/ui/assets/mc/bg');
const files=fs.readdirSync(source).filter(n=>n.endsWith('.png')).sort();
if(files.length!==3)throw Error('Expected exactly three user-provided PNG wallpapers');
fs.mkdirSync(target,{recursive:true});
for(const name of ['plains-dawn','night-stars','cave-torch','forest-lake','mesa-canyon'])for(const suffix of ['.png','.thumb.png']){const file=path.join(target,name+suffix);if(fs.existsSync(file))fs.unlinkSync(file);}
files.forEach((name,i)=>fs.copyFileSync(path.join(source,name),path.join(target,'wallpaper-'+(i+1)+'.png')));
console.log('Copied three original wallpapers without resizing; selection shows images only.');
