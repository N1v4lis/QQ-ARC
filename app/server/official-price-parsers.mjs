// Parse public documentation as data. Never evaluate scripts from vendor pages.
export function text(s='') {
  return String(s).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'')
    .replace(/<[^>]*>/g,' ').replace(/&#x([\da-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16)))
    .replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g,x=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '}[x]))
    .replace(/\s+/g,' ').trim();
}
function money(s,currency) {
  s=text(String(s).replace(/~~[\s\S]*?~~/g,'')).replace(/\\/g,'');
  if(/^(?:免费|free(?: of charge)?|不计费)$/i.test(s))return 0;
  const m=s.match(currency==='CNY'?/(?:CNY\s*|[¥￥]\s*)([\d.]+)|^([\d.]+)(?:\s*(?:元|$))/i:/\$\s*([\d.]+)/);
  return m?Number(m[1]||m[2]):null;
}
function tables(html) {
  html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
  const out=[];
  for(const m of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    const rows=[];const spans=[];
    for(const row of m[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells=[];let col=0;
      const fill=()=>{while(spans[col]?.left>0){cells[col]=spans[col].value;spans[col].left--;col++;}};
      fill();
      for(const c of row[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
        fill();const rs=Number(c[2].match(/rowspan=["']?(\d+)/i)?.[1]||1),cs=Number(c[2].match(/colspan=["']?(\d+)/i)?.[1]||1);
        for(let j=0;j<cs;j++){cells[col]=text(c[3]);if(rs>1)spans[col]={value:cells[col],left:rs-1};col++;}
      }
      fill();rows.push(cells);
    }
    const before=html.slice(0,m.index);const headings=[...before.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)];
    const h=headings.at(-1);const h2=headings.filter(x=>Number(x[1])===2).at(-1);
    out.push({rows,heading:text(h?.[3]),modelHeading:text(h2?.[3]),modelId:h2?.[2]?.match(/id=["']([^"']+)/)?.[1],before});
  }return out;
}
function markdownTables(md) {
  const result=[];let rows=[],heading='';
  const flush=()=>{if(rows.length>1)result.push({rows,heading});rows=[];};
  for(const line of md.split('\n')) {
    if(/^\s*#+ /.test(line)){flush();heading=line.replace(/^\s*#+\s*/, '').trim();}
    const l=line.trim();if(l.startsWith('|')&&l.endsWith('|')) {
      const r=l.slice(1,-1).split(/(?<!\\)\|/).map(x=>text(x.replace(/\*\*/g,'')));
      if(!r.every(x=>/^[:\s-]+$/.test(x)))rows.push(r);
    }else flush();
  }flush();return result;
}
function modelId(s,vendor) {
  s=text(s).replace(/\*\*/g,'').replace(/\\/g,'');
  if(vendor==='anthropic')return s.match(/Claude\s+(?:(?:Fable|Mythos|Opus|Sonnet|Haiku)(?:\s+\d+(?:\.\d+)?)?|\d+(?:\.\d+)?\s+(?:Opus|Sonnet|Haiku))/i)?.[0].toLowerCase().replace(/[. ]/g,'-')||null;
  const regex={openai:/\b(?:gpt-[\w.-]+|chat(?:gpt)?-[\w.-]+|o[134](?:-[\w.-]+)?|text-embedding-[\w.-]+|whisper-[\w.-]+|tts-[\w.-]+|dall-e-[\w.-]+|sora[\w.-]*|omni-moderation[\w.-]*)/i,
    glm:/\b(?:glm|chatglm|cogview|cogvideo|embedding|codegeex)[\w.-]*/i,
    qwen:/\b(?:qwen|qwq|wan)[\w.-]*/i,mimo:/\bmimo[\w.-]*/i,kimi:/\b(?:kimi|moonshot)[\w.-]*/i,minimax:/\b(?:minimax|speech|hailuo|abab)[\w.-]*/i,xai:/\bgrok[\w.-]*/i};
  return s.match(regex[vendor]||/\bdeepseek[\w.-]*/i)?.[0].toLowerCase()||null;
}
export function parseOfficialPage(vendor,body) {
  const records=new Map();
  const add=(id,variant)=>{if(!id)return;let r=records.get(id);if(!r){r={id,vendor,currency:vendor==='glm'||vendor==='kimi'||vendor==='qwen'||vendor==='mimo'?'CNY':'USD',variants:[]};records.set(id,r);}r.variants.push(variant);};
  const ts=body.includes('<table')?tables(body):markdownTables(body);
  if(vendor==='openai') {
    // Astro props contain ALL rows, including collapsed legacy models. Decode tagged
    // serialization; rendered tables intentionally contain only the latest models.
    const unwrap=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='number'?(v[0]===1?v[1].map(unwrap):v[1]):v;
    for(const m of body.matchAll(/<astro-island\b[^>]*props="([^"]+)"/g)) {
      let props;try{props=JSON.parse(text(m[1]));}catch{continue;}
      if(!props.rows||!props.tier)continue;
      const tier=unwrap(props.tier);for(const row of unwrap(props.rows)) {
        const id=modelId(row[0],vendor);if(!id)continue;
        const long=row.length===5;add(id,{in:row[1],cached:row[2],out:row[long?4:3],unit:'1M tokens',condition:long?'短上下文；长上下文另价':'',tier,autoApply:tier==='standard'&&!long,raw:row.map(String)});
      }
    }
  }
  if(vendor==='deepseek') {
    const rows=ts[0]?.rows||[];let kind='',period='';const models=rows[0]?.map(s=>modelId(s,vendor)).filter(Boolean)||[];
    for(const row of rows){const line=row.join(' ');if(/CACHE HIT/.test(line))kind='cached';else if(/CACHE MISS/.test(line))kind='in';else if(/OUTPUT TOKENS/.test(line))kind='out';
      if(/OFF-PEAK/.test(line))period='off';else if(/\bPEAK\b/.test(line))period='peak';
      const prices=row.map(s=>money(s,'USD')).filter(x=>x!==null);if(kind&&prices.length===models.length){models.forEach((id,i)=>add(id,{[kind]:prices[i],period,unit:'1M tokens',condition:'工作日 UTC 峰谷时段及中国节假日影响价格',raw:row,autoApply:false}));}
    }
    for(const r of records.values()){const joined=[];for(const period of ['off','peak']){const p={period,unit:'1M tokens',autoApply:false,condition:'工作日 UTC 峰谷时段及中国节假日影响价格'};for(const v of r.variants.filter(v=>v.period===period))Object.assign(p,v);p.raw=[r.id,period==='off'?'非高峰':'高峰',`输入 $${p.in}`,`输出 $${p.out}`,`缓存命中 $${p.cached}`,'美元 / 百万 Token','高峰：工作日 UTC 01:00–04:00、06:00–10:00；中国节假日除外'];joined.push(p);}r.variants=joined;}
    for(const alias of ['deepseek-v4-flash','deepseek-v4-flash-vision-exp'])if(records.has('deepseek-flash'))records.set(alias,{...records.get('deepseek-flash'),id:alias,aliasOf:'deepseek-flash'});
  }else if(vendor==='kimi') {
    for(const m of body.matchAll(/<DocTable\s+columns=\{([\s\S]*?)\}\s+rows=\{([\s\S]*?)\}/g)) {
      const headers=[...m[1].matchAll(/title:\s*"([^"]+)"/g)].map(x=>x[1]);
      let rows;try{rows=JSON.parse(m[2].replace(/,\s*]/g,']'));}catch{continue;}
      for(const row of rows){const idx=s=>headers.findIndex(x=>x.includes(s));add(modelId(row[0],vendor),{in:money(row[idx('未命中')],'CNY'),out:money(row[idx('输出')],'CNY'),cached:money(row[idx('输入价格（缓存命中）')],'CNY'),unit:'1M tokens',autoApply:!headers.some(x=>x.includes('缓存写入')),condition:headers.some(x=>x.includes('缓存写入'))?'缓存写入 TTL 另计费':'',raw:row});}
    }
  }else if(vendor==='gemini') {
    for(const t of ts){let id=t.modelId; if(!id||!id.startsWith('gemini'))continue;
      const inp=t.rows.find(r=>/^Input price/.test(r[0])),out=t.rows.find(r=>/^Output price/.test(r[0])),cache=t.rows.find(r=>/^Context caching price/.test(r[0]));
      const raw=t.rows.flat();const conditional=(s)=>/\$[\d.]+[\s\S]*\$[\d.]+|per image|per second|audio|through|starting/i.test(s||'');
      add(id,{in:money(inp?.at(-1),'USD'),out:money(out?.at(-1),'USD'),cached:money(cache?.at(-1),'USD'),unit:'1M tokens',tier:t.heading,autoApply:t.heading==='Standard'&&!!inp&&!!out&&!conditional(inp.at(-1))&&!conditional(out.at(-1)),condition:raw.filter(x=>/\$/.test(x)).join(' · '),raw});
    }
  }else {
    for(const t of ts) {
      let headers=[];
      for(const row of t.rows) {
        if(row.some(x=>/^(?:Model(?: ID| name)?|Name|模型(?:名称)?|模型\/API)$/i.test(x))){headers=row;continue;}
        if(!headers.length)continue;
        const mi=headers.findIndex(x=>/^(?:Model(?: ID| name)?|Name|模型(?:名称)?|模型\/API)$/i.test(x));
        const id=modelId(row[mi],vendor);if(!id)continue;
        const ii=headers.findIndex(x=>/^(?:Base input|Input|输入)/i.test(x)&&!/^Input tokens/i.test(x)&&!(/(?:[Cc]ached|缓存命中|命中缓存)/.test(x)&&!/(?:未命中|不命中)/.test(x)));
        const oi=headers.findIndex(x=>/^(?:Output|输出)/.test(x));
        const ci=headers.findIndex(x=>/Cached input|caching Read|hits and refreshes|缓存命中|命中缓存/i.test(x)&&!/(?:未命中|不命中)/.test(x));
        const currency=vendor==='glm'||vendor==='qwen'||vendor==='mimo'?'CNY':'USD';
        const valid=ii>=0&&oi>=0;const conditional=/输入长度|输入 \[|输入.*≥|(?:<|>|≤|≥)\s*\d|tokens\)|token≤|cache.*write|缓存写入/i.test(row.join(' '))||vendor==='qwen'||vendor==='openai';
        const eligibleSection=!/Batch|Fast mode|training|微调|私有实例|云端|配额/i.test(t.heading)&&!(vendor==='mimo'&&/海外|Batch|批量/.test(t.heading+' '+row[0]));
        add(id,{in:valid?money(row[ii],currency):null,out:valid?money(row[oi],currency):null,cached:ci>=0?money(row[ci],currency):null,unit:valid?'1M tokens':'其他单位',condition:row.filter((_,i)=>i!==mi).join(' · '),tier:t.heading,autoApply:valid&&!conditional&&eligibleSection&&!(vendor==='anthropic'&&/[5-9]/.test(id)),raw:row});
      }
    }
  }
  const result=[...records.values()];for(const r of result){const v=r.variants.find(x=>x.autoApply)||r.variants.find(x=>x.in!==null&&x.out!==null)||r.variants[0];Object.assign(r,{in:v?.in??null,out:v?.out??null,cached:v?.cached??null,autoApply:!!v?.autoApply,condition:v?.condition||'',unit:v?.unit||'其他单位'});}
  if(!result.length)throw Error('公开页面没有可识别的模型价格；保留缓存');return result;
}
