// Build-time extraction of our existing pixel art; no browser/Node at runtime.
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('app/ui/shell/03-mc-icons.js','utf8');
const begin=source.indexOf('  const R =');
const end=source.indexOf('\n  };',source.indexOf('  const ART ='))+5;
const art=vm.runInNewContext(source.slice(begin,end)+'\nART',{}, {timeout:1000});
fs.mkdirSync('flutter/assets/mc/icons',{recursive:true});
for(const [key,rects] of Object.entries(art)){
  const body=rects.map(({c,r})=>`<rect fill="${c}" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}"/>`).join('');
  fs.writeFileSync(`flutter/assets/mc/icons/${key}.svg`,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${body}</svg>`);
}
console.log(`Generated ${Object.keys(art).length} original pixel icons`);
