// Public brand assets only; never read credentials or provider configuration.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('../app/ui/assets/model-logos/',import.meta.url));fs.mkdirSync(dir,{recursive:true});
const assets={
 deepseek:'https://api-docs.deepseek.com/img/favicon.svg',glm:'https://bigmodel.cn/static/images/favicon.png',
 gemini:'https://www.gstatic.com/lamda/images/gemini_sparkle_4g_512_lt_f94943af3be039176192d.png',mimo:'https://platform.xiaomimimo.com/favicon.png',
 qwen:'https://img.alicdn.com/imgextra/i4/O1CN01OXv3EM1FN8t9W4P79_!!6000000000474-2-tps-80-80.png',
 kimi:'https://platform.kimi.com/docs/_mintlify/favicons/moonshotcn/T8-4VFDdIJ9zZmvG/_generated/favicon/android-chrome-192x192.png',
 minimax:'https://platform.minimax.io/docs/_mintlify/favicons/minimax-cac98058/-WSO_KEoennf5XoM/_generated/favicon/android-chrome-192x192.png',
 anthropic:'https://cdn.prod.website-files.com/67ce28cfec624e2b733f8a52/681d52619fec35886a7f1a70_favicon.png',openai:'https://developers.openai.com/favicon.png',
 xai:'https://docs.x.ai/_next/static/media/favicon-light.1u6watcuoe8mg.svg'
};
const results=await Promise.allSettled(Object.entries(assets).map(async([id,url])=>{
 const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`${id}: HTTP ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());const svg=id==='deepseek'||id==='xai';
 if(bytes.length>1000000||!(svg?/<svg[\s>]/.test(bytes.toString()):bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))))throw Error(`${id}: 非有效 Logo`);
 if(svg&&/<script|foreignObject|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(bytes.toString()))throw Error(`${id}: SVG含外部内容`);
 fs.writeFileSync(dir+id+(svg?'.svg':'.png'),bytes);return id;
}));
for(const r of results)console.log(r.status==='fulfilled'?`${r.value}: saved`:r.reason.message);
if(results.some(r=>r.status==='rejected'))process.exitCode=1;
fs.writeFileSync(dir+'SOURCES.json',JSON.stringify({retrievedAt:new Date().toISOString(),notice:'Official brand trademarks, used solely to identify model vendors; no affiliation implied.',assets},null,2));
