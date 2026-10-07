import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const host='E:/QQ Agent/resources/app/src';
export function patchDashboardApp(source){
  if(source.includes('// ARCFOX dashboard stats v1')){
    if(source.includes('arcfoxActiveUin'))return source;
    return source.replace("import { StatsCache } from './arcfox-stats-cache.mjs';", "import { StatsCache } from './arcfox-stats-cache.mjs';\nimport { activeUin as arcfoxActiveUin } from './accounts.js';".replaceAll('\n',source.includes('\r\n')?'\r\n':'\n')).replace('[DATA_DIR, String(range)', '[DATA_DIR, arcfoxActiveUin(), String(range)');
  }
  let out=source.replaceAll('\r\n','\n');
  const edits=[
    ["import fs from 'node:fs';","// ARCFOX dashboard stats v1\nimport { StatsCache } from './arcfox-stats-cache.mjs';\nimport { activeUin as arcfoxActiveUin } from './accounts.js';\nimport fs from 'node:fs';"],
    ["async function buildUsageStats({ range = '7' } = {}) {",`const dashboardStatsCache = new StatsCache();
async function buildUsageStats({ range = '7', fresh = false } = {}) {
  const cacheKey = JSON.stringify([DATA_DIR, arcfoxActiveUin(), String(range), dayKeyOf(Date.now()), sessionsDirSignature(), getConfig().api]);
  return dashboardStatsCache.read(cacheKey, () => buildUsageStatsUncached({ range }), { fresh });
}
async function buildUsageStatsUncached({ range = '7' } = {}) {`]
  ];
  for(const [a,b]of edits){if(out.split(a).length!==2)throw Error('Dashboard app anchor changed');out=out.replace(a,b);}
  return source.includes('\r\n')?out.replaceAll('\n','\r\n'):out;
}
export function patchDashboardRoutes(source){
  if(source.includes('// ARCFOX dashboard usage v1'))return source;
  const anchor="    // ── 成本看板 ─────────────────────────────────────────────────────";
  if(source.split(anchor).length!==2)throw Error('Dashboard route anchor changed');
  const route=`    // ARCFOX dashboard usage v1: one snapshot calculation supplies both totals and rankings.
    {
      method: 'GET', pattern: '/api/dashboard/usage',
      handler: async ({ res, json, url }) => {
        try {
          const range = String(url.searchParams.get('range') || '7');
          const stats = await buildUsageStats({ range, fresh: url.searchParams.get('fresh') === '1' });
          const breakdown = { range: stats.range, dim: '', key: '', by: '', totals: stats.totals,
            showPeak: !!stats.totals?.hasPeakModel && (stats.totals.peakCost > 0 || stats.totals.offPeakCost > 0),
            rows: (stats.chats || []).map(g => ({ key: g.key, cost: g.cost, promptTokens: g.promptTokens,
              completionTokens: g.completionTokens, cachedTokens: g.cachedTokens, totalTokens: g.totalTokens,
              cacheHitRate: g.cacheHitRate, runs: g.runs, exactCalls: g.exactCalls })) };
          return json(res, 200, { ok: true, stats, breakdown });
        } catch (error) { return json(res, 500, { ok: false, error: String(error?.message ?? error) }); }
      }
    },

`;
  return source.replace(anchor,(source.includes('\r\n')?route.replaceAll('\n','\r\n'):route)+anchor);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const plans=[['app.js',patchDashboardApp],['routes.js',patchDashboardRoutes]].map(([name,patch])=>{
    const target=path.join(host,name),original=fs.readFileSync(target);return {target,original,data:patch(original.toString())};
  });
  const helper=path.join(host,'arcfox-stats-cache.mjs');
  plans.push({target:helper,original:fs.existsSync(helper)?fs.readFileSync(helper):null,data:fs.readFileSync(new URL('./host/arcfox-stats-cache.mjs',import.meta.url))});
  for(const p of plans)if(p.original&&p.data!==p.original.toString()&&p.target!==helper)fs.writeFileSync(p.target+'.bak-dashboard-'+Date.now(),p.original);
  try{for(const p of plans)fs.writeFileSync(p.target,p.data);}
  catch(error){for(const p of plans){if(p.original)fs.writeFileSync(p.target,p.original);else fs.rmSync(p.target,{force:true});}throw error;}
  console.log('Dashboard shared statistics endpoint and bounded cache installed.');
}
