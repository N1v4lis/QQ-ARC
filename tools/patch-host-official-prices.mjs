import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));const host='E:/QQ Agent/resources/app/src';
function write(file,next){const p=path.join(host,file);if(fs.existsSync(p)&&fs.readFileSync(p,'utf8')!==next)fs.copyFileSync(p,p+'.bak-official-'+Date.now());fs.writeFileSync(p,next);}
write('model-vendors.js',fs.readFileSync(path.join(root,'app/ui/vendor/model-vendors.js'),'utf8'));
write('official-price-parsers.mjs',fs.readFileSync(path.join(root,'app/server/official-price-parsers.mjs'),'utf8'));
write('official-price-feed.mjs',fs.readFileSync(path.join(root,'app/server/official-price-feed.mjs'),'utf8').replace("'../ui/vendor/model-vendors.js'","'./model-vendors.js'"));
write('price-feed.js',`// Official public sources; asynchronous, independent failures, cached offline.
import path from 'node:path';
import {DATA_DIR} from './config.js';
import {setRemotePrices} from './model-prices.js';
import {createOfficialFeed} from './official-price-feed.mjs';
const feed=createOfficialFeed({cacheFile:path.join(DATA_DIR,'official-vendor-prices.json'),applyPrices:setRemotePrices});
export const priceFeedStatus=feed.status;
export const refreshPriceFeed=()=>feed.refresh(true);
export const initPriceFeed=()=>feed.init();
`);
let prices=fs.readFileSync(path.join(host,'model-prices.js'),'utf8');
if(!prices.includes("from './model-vendors.js'"))prices="import {classifyEndpoint,applicablePrice,modelPriceKey} from './model-vendors.js';\n"+prices;
prices=prices.replace('import {classifyEndpoint,applicablePrice}', 'import {classifyEndpoint,applicablePrice,modelPriceKey}');
const custom='  const custom = (api.modelPrices || {})[id];';
if(prices.includes(custom))prices=prices.replace(custom,"  const custom = (api.modelPrices || {})[modelLabel(vendorOfConfig(cfg), id)] || (api.modelPrices || {})[id];");
prices=prices.replace('  const custom = (api.modelPrices || {})[modelLabel(vendorOfConfig(cfg), id)] || (api.modelPrices || {})[id];', '  const custom = (api.modelPrices || {})[modelPriceKey(id, api, cfg?.providers || [])] || (api.modelPrices || {})[modelLabel(vendorOfConfig(cfg), id)] || (api.modelPrices || {})[id];');
if(!prices.includes('const officialEndpoint =')){
 prices=prices.replace('  if (useOfficial) {\r\n    const p = id ?', '  if (useOfficial) {\n    const officialEndpoint = classifyEndpoint(api.baseUrl || (cfg?.providers || []).find(p=>p.id===api.provider)?.baseURL, id);\n    const p = id ?').replace('  if (useOfficial) {\n    const p = id ?', '  if (useOfficial) {\n    const officialEndpoint = classifyEndpoint(api.baseUrl || (cfg?.providers || []).find(p=>p.id===api.provider)?.baseURL, id);\n    const p = id ?');
 const at=prices.indexOf('export function resolveModelPrice');let part=prices.slice(at);
 part=part.replace('    if (p) {','    if (p && applicablePrice(p, officialEndpoint)) {');
 prices=prices.slice(0,at)+part;
}
if(!prices.includes("from 'node:crypto'"))prices="import {createHash} from 'node:crypto';\n"+prices;
if(!prices.includes('getRemotePriceRevision')){
 prices=prices.replace('let REMOTE_OVERRIDES = {};', "let REMOTE_PRICE_REVISION = '';\nexport const getRemotePriceRevision = () => REMOTE_PRICE_REVISION;\nlet REMOTE_OVERRIDES = {};");
 prices=prices.replace("  EFFECTIVE_PRICES = Object.keys(REMOTE_OVERRIDES).length", "  REMOTE_PRICE_REVISION = createHash('sha256').update(JSON.stringify(Object.entries(REMOTE_OVERRIDES).sort(([a],[b])=>a.localeCompare(b)).map(([id,p])=>[id,p.vendor,p.autoApply,p.in,p.out,p.cached,p.peak,p.offPeak]))).digest('hex');\n  EFFECTIVE_PRICES = Object.keys(REMOTE_OVERRIDES).length");
}
write('model-prices.js',prices);
let routes=fs.readFileSync(path.join(host,'routes.js'),'utf8');
routes=routes.replace("import { resolveOfficialPrice, listOfficialPrices } from './model-prices.js';", "import { resolveOfficialPrice, resolveModelPrice, listOfficialPrices } from './model-prices.js';");
const routeStart=routes.indexOf("method: 'GET', pattern: '/api/model-prices'");
const routeEnd=routes.indexOf('// ── SnowLuma',routeStart);
if(routeStart<0||routeEnd<0)throw Error('价格 API 路由结构改变，未改写');
let routePart=routes.slice(routeStart,routeEnd);
routePart=routePart.replaceAll('prices: listOfficialPrices(),', "prices: listOfficialPrices().filter(p=>p.src==='official-live'),");
routePart=routePart.replace('current: resolveOfficialPrice(String(url.searchParams.get(\'model\') || getConfig().api?.model || \'\')),', 'current: resolveModelPrice(String(url.searchParams.get(\'model\') || getConfig().api?.model || \'\'), getConfig()),');
routePart=routePart.replace('current: resolveOfficialPrice(getConfig().api?.model || \'\')', 'current: resolveModelPrice(getConfig().api?.model || \'\', getConfig())');
routePart=routePart.replace('remote: { ...priceFeedStatus(), url: FIXED_PRICE_FEED_URL }', 'remote: priceFeedStatus()');
routes=routes.slice(0,routeStart)+routePart+routes.slice(routeEnd);
routes=routes.replace('buildUsageStats({ range: raw })', "buildUsageStats({ range: raw, fresh: url.searchParams.get('fresh') === '1' })");
write('routes.js',routes);
let app=fs.readFileSync(path.join(host,'app.js'),'utf8');
const old='  return resolveModelPrice(model, cfg);';
if(!app.includes('const historicalProvider ='))app=app.replace(old,`  const historicalProvider = (cfg.providers || []).find(p=>p.id===vendor||p.displayName===vendor);
  // An unknown historical channel cannot inherit today's official endpoint.
  const recordedBase = historicalProvider?.baseURL || (/^[a-z0-9.-]+$/i.test(vendor||'') ? 'https://'+vendor : '');
  return resolveModelPrice(model, vendor ? {...cfg,api:{...cfg.api,provider:historicalProvider?.id||'',baseUrl:recordedBase}} : {...cfg,api:{...cfg.api,baseUrl:'',provider:''}});`);
if(!app.includes('function usagePricingRevision()')){
 app=app.replace('isPeakHour, priceAt, resolveModelPrice,', 'isPeakHour, priceAt, resolveModelPrice, getRemotePriceRevision,');
 app=app.replace('function loadUsageDayFile(dayKey) {', `function usagePricingRevision() {
  const cfg=getConfig(); const api=cfg.api||{};
  return JSON.stringify([getRemotePriceRevision(),api.useOfficialPrice,api.modelPrices,api.priceInputPerM,api.priceOutputPerM,api.priceCachedPerM,(cfg.providers||[]).map(p=>[p.id,p.displayName,p.baseURL])]);
}

function loadUsageDayFile(dayKey) {`);
 app=app.replace('parsed.day === dayKey && parsed.aggregates', 'parsed.day === dayKey && parsed.priceRevision === usagePricingRevision() && parsed.aggregates');
 app=app.replace('if (snap?.aggregates) {', 'if (snap?.aggregates && snap.priceRevision === usagePricingRevision()) {');
 app=app.replace('version: USAGE_DAY_VERSION, day: dayKey, savedAt: Date.now(), aggregates', 'version: USAGE_DAY_VERSION, day: dayKey, savedAt: Date.now(), priceRevision: usagePricingRevision(), aggregates');
 app=app.replace('sessionsDirSignature(), getConfig().api', 'sessionsDirSignature(), getConfig().api, usagePricingRevision()').replace('sessionsDirSignature(),getConfig().api', 'sessionsDirSignature(),getConfig().api,usagePricingRevision()');
 app=app.replace(/成本口径：快照存 costOfRows 聚合结果。[\s\S]*?想重算任何一天，删掉快照文件对应条目即可。/, '成本口径：价格配置与远程价格内容共同决定快照版本。价格变更后按需重算历史日，随后继续复用日快照；Dashboard 与用量共用同一计价结果。');
}
app=app.replace('api.useOfficialPricing,api.modelPrices,api.priceIn,api.priceOut,api.priceCached','api.useOfficialPrice,api.modelPrices,api.priceInputPerM,api.priceOutputPerM,api.priceCachedPerM');
write('app.js',app);
console.log('官方价格来源、共享域名识别、计费阻止中转误匹配及渠道自定义价格补丁已安装。');
