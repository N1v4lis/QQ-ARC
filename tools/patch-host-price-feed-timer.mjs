import fs from 'node:fs';
const file='E:/QQ Agent/resources/app/src/price-feed.js';let s=fs.readFileSync(file,'utf8');
const clear='  if (timer) { clearInterval(timer); timer = null; }';
const anchor='  if (status.url === url && status.enabled) return;   // 同 URL 已初始化过';
const begin=s.indexOf('export function initPriceFeed');const start=s.slice(0,begin),part=s.slice(begin);
if(!part.includes(anchor)||!part.includes(clear))throw Error('价格表结构改变，未修改');
if(part.indexOf(clear)<part.indexOf(anchor)){
 fs.writeFileSync(file+'.bak-timer-'+Date.now(),s);
 s=start+part.replace(clear+'\r\n','').replace(clear+'\n','').replace(anchor,anchor+'\n'+clear);
 fs.writeFileSync(file,s);
}
console.log('同地址初始化保留既有价格表定时器；未更改任何来源或更新周期。');
