// Shared by the browser and host. Branding never proves a connection is official.
export const VENDORS = [
  {id:'deepseek',name:'DeepSeek',url:'https://api-docs.deepseek.com/quick_start/pricing/',hosts:['api.deepseek.com']},
  {id:'glm',name:'GLM',url:'https://docs.bigmodel.cn/cn/guide/start/pricing.md',hosts:['open.bigmodel.cn']},
  {id:'gemini',name:'Gemini',url:'https://ai.google.dev/gemini-api/docs/pricing',hosts:['generativelanguage.googleapis.com']},
  {id:'mimo',name:'MiMo',url:'https://mimo.mi.com/docs/price/pay-as-you-go',hosts:['api.xiaomimimo.com']},
  {id:'qwen',name:'Qwen',url:'https://help.aliyun.com/en/model-studio/model-pricing',hosts:['dashscope.aliyuncs.com']},
  {id:'kimi',name:'Kimi',url:'https://platform.kimi.com/docs/pricing/chat.md',hosts:['api.moonshot.cn']},
  {id:'minimax',name:'MiniMax',url:'https://platform.minimax.io/docs/guides/pricing-paygo.md',hosts:['api.minimax.io']},
  {id:'anthropic',name:'Anthropic',url:'https://platform.claude.com/docs/en/about-claude/pricing.md',hosts:['api.anthropic.com']},
  {id:'openai',name:'OpenAI',url:'https://developers.openai.com/api/docs/pricing',hosts:['api.openai.com']},
  {id:'xai',name:'Grok · xAI',url:'https://docs.x.ai/developers/pricing.md',hosts:['api.x.ai']}
];
export function modelVendor(model) {
  const id=String(model||'').trim().toLowerCase().split('/').pop().replace(/\s+/g,'-');
  if(/^deepseek(?:-|$)/.test(id))return 'deepseek';
  if(/^(?:glm|chatglm|cogview|cogvideo|codegeex)(?:-|\d|$)/.test(id))return 'glm';
  if(/^(?:gemini|gemma|imagen|veo|lyria)(?:-|$)/.test(id))return 'gemini';
  if(/^mimo(?:-|$)/.test(id))return 'mimo';
  if(/^(?:qwen|qwq|wan)(?:-|\d|$)/.test(id))return 'qwen';
  if(/^(?:kimi|moonshot)(?:-|$)/.test(id))return 'kimi';
  if(/^(?:minimax|abab|hailuo|speech)(?:-|\d|$)/.test(id))return 'minimax';
  if(/^claude(?:-|$)/.test(id))return 'anthropic';
  if(/^(?:gpt|chatgpt|chat-latest|codex|o[134](?:-|$)|text-embedding|whisper|tts|dall-e|sora|omni-moderation)/.test(id))return 'openai';
  if(/^grok(?:-|$)/.test(id))return 'xai';
  return null;
}
export function classifyEndpoint(baseURL, model='') {
  let u;try{u=new URL(String(baseURL||'').trim());}catch{return {official:false,reason:'连接地址无效'};}
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))return {official:false,reason:'非官方 HTTPS 连接'};
  const vendor=VENDORS.find(v=>v.hosts.includes(u.hostname.toLowerCase()));
  const other={'api.z.ai':'glm','dashscope-intl.aliyuncs.com':'qwen','dashscope-us.aliyuncs.com':'qwen','api.moonshot.ai':'kimi','api.minimaxi.com':'minimax','api.minimax.chat':'minimax','us.api.x.ai':'xai'}[u.hostname.toLowerCase()];
  const id=vendor?.id||other;
  if(!id)return {official:false,reason:'中转站或未识别地址，使用站点自定义价格'};
  const family=modelVendor(model);
  if(family&&family!==id)return {official:false,vendor:id,reason:'模型品牌与官方地址不一致'};
  const allowed=/^\/(?:|v1\/?|v1beta\/?|v1beta\/openai\/?|api\/paas\/v4\/?|compatible-mode\/v1\/?|anthropic\/?|api\/?|api\/anthropic\/?)$/;
  if(!allowed.test(u.pathname))return {official:false,vendor:id,reason:'官方域名上的路径未识别，暂不套用官方价格'};
  return {official:true,vendor:id,market:other?'other':'default',priceEligible:!!vendor,reason:other?'官方地区端点，当前价格来源不适用':'官方直连'};
}
export function applicablePrice(entry, endpoint) {
  return !!(endpoint?.official&&endpoint.priceEligible&&entry?.vendor===endpoint.vendor&&entry?.autoApply&&Number.isFinite(entry.in)&&Number.isFinite(entry.out));
}
export function modelPriceKey(model, api={}, providers=[]) {
  const base=String(api.baseUrl||'').trim();
  if(base){try{const u=new URL(base);return `${u.origin}${u.pathname.replace(/\/+$/,'')}：${model}`;}catch{}}
  return legacyModelPriceKey(model,api,providers);
}
export function legacyModelPriceKey(model,api={},providers=[]) {
  const base=String(api.baseUrl||'').trim();
  const p=providers.find(p=>p.id===api.provider)||providers.find(p=>String(p.baseURL||'').replace(/\/+$/,'')===base.replace(/\/+$/,''));
  let vendor=p?.displayName;try{vendor ||= new URL(base).host;}catch{}
  return `${vendor||'未知渠道'}：${model}`;
}
export function modelLogoHtml(model) {
  const id=modelVendor(model);if(!id)return '';
  const name=VENDORS.find(v=>v.id===id).name;
  return `<img class="model-brand-logo" src="/assets/model-logos/${id}.${['deepseek','xai'].includes(id)?'svg':'png'}" width="20" height="20" alt="${name}" loading="lazy">`;
}
