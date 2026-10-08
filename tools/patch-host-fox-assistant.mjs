// 清理早期模型接口；酒狐设置助手现完全使用本地解析。
import fs from 'node:fs';
const file='E:/QQ Agent/resources/app/src/routes.js';
let source=fs.readFileSync(file,'utf8');
const marker="import { askFox } from './arcfox-fox-assistant.mjs';";
const start=source.indexOf('    // ARCFØX wine fox natural-language assistant');
if(start>=0){
 const end=source.indexOf('    // ── 连通性测试 ─',start);
 if(end<0)throw Error('宿主路由结构已变化，未修改');
 fs.writeFileSync(file+'.bak-fox-local-'+Date.now(),source);
 source=source.slice(0,start)+source.slice(end);
}
source=source.replace(marker+'\r\n','').replace(marker+'\n','');
fs.writeFileSync(file,source);
console.log('酒狐旧模型路由已停用，本地助手无需模型API。');
