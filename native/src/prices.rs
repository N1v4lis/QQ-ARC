//! Public price pages are parsed as data, never evaluated as JavaScript.
use crate::{core::Core, network};
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use regex::Regex;
use serde_json::{Value, json};
use std::collections::BTreeMap;
pub const VENDORS: [(&str, &str, &str, &str); 10] = [
    (
        "deepseek",
        "DeepSeek",
        "api.deepseek.com",
        "https://api-docs.deepseek.com/quick_start/pricing/",
    ),
    (
        "glm",
        "GLM",
        "open.bigmodel.cn",
        "https://docs.bigmodel.cn/cn/guide/start/pricing.md",
    ),
    (
        "gemini",
        "Gemini",
        "generativelanguage.googleapis.com",
        "https://ai.google.dev/gemini-api/docs/pricing",
    ),
    (
        "mimo",
        "MiMo",
        "api.xiaomimimo.com",
        "https://mimo.mi.com/docs/price/pay-as-you-go",
    ),
    (
        "qwen",
        "Qwen",
        "dashscope.aliyuncs.com",
        "https://help.aliyun.com/en/model-studio/model-pricing",
    ),
    (
        "kimi",
        "Kimi",
        "api.moonshot.cn",
        "https://platform.kimi.com/docs/pricing/chat.md",
    ),
    (
        "minimax",
        "MiniMax",
        "api.minimax.io",
        "https://platform.minimax.io/docs/guides/pricing-paygo.md",
    ),
    (
        "anthropic",
        "Anthropic",
        "api.anthropic.com",
        "https://platform.claude.com/docs/en/about-claude/pricing.md",
    ),
    (
        "openai",
        "OpenAI",
        "api.openai.com",
        "https://developers.openai.com/api/docs/pricing",
    ),
    (
        "xai",
        "Grok · xAI",
        "api.x.ai",
        "https://docs.x.ai/developers/pricing.md",
    ),
];
fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("price pattern")
}
pub fn official(base: &str, vendor: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(base) else {
        return false;
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.query().is_none()
        && url.fragment().is_none()
        && VENDORS
            .iter()
            .any(|(id, _, host, _)| *id == vendor && url.host_str() == Some(*host))
        && [
            "/",
            "",
            "/v1",
            "/v1/",
            "/v1beta",
            "/v1beta/openai",
            "/api/paas/v4",
            "/compatible-mode/v1",
            "/anthropic",
            "/api",
        ]
        .contains(&url.path())
}
fn entities(text: &str) -> String {
    let numeric = re(r"&#(?:x([0-9a-fA-F]+)|(\d+));")
        .replace_all(text, |c: &regex::Captures| {
            let n = if let Some(hex) = c.get(1) {
                u32::from_str_radix(hex.as_str(), 16).ok()
            } else {
                c.get(2).and_then(|n| n.as_str().parse().ok())
            };
            n.and_then(char::from_u32)
                .map(|c| c.to_string())
                .unwrap_or_default()
        })
        .into_owned();
    let mut result = numeric;
    for (from, to) in [
        ("&quot;", "\""),
        ("&#39;", "'"),
        ("&apos;", "'"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&nbsp;", " "),
        ("&amp;", "&"),
    ] {
        result = result.replace(from, to);
    }
    result
}
fn model(text: &str, vendor: &str) -> Option<String> {
    let pattern = match vendor {
        "anthropic" => {
            r"(?i)Claude\s+(?:(?:Opus|Sonnet|Haiku|Mythos|Fable)(?:\s+\d+(?:\.\d+)?)?|\d+(?:\.\d+)?\s+(?:Opus|Sonnet|Haiku))"
        }
        "openai" => {
            r"(?i)\b(?:gpt-[\w.-]+|chat(?:gpt)?-[\w.-]+|o[134](?:-[\w.-]+)?|text-embedding-[\w.-]+|whisper-[\w.-]+|tts-[\w.-]+|dall-e-[\w.-]+|sora[\w.-]*|omni-moderation[\w.-]*)"
        }
        "glm" => r"(?i)\b(?:glm|chatglm|cogview|cogvideo|embedding|codegeex)[\w.-]*",
        "qwen" => r"(?i)\b(?:qwen|qwq|wan)[\w.-]*",
        "kimi" => r"(?i)\b(?:kimi|moonshot)[\w.-]*",
        "minimax" => r"(?i)\b(?:minimax|speech|hailuo|abab)[\w.-]*",
        "gemini" => r"(?i)\b(?:gemini|gemma|imagen|veo|lyria)[\w.-]*",
        "xai" => r"(?i)\bgrok[\w.-]*",
        "mimo" => r"(?i)\bmimo[\w.-]*",
        _ => r"(?i)\bdeepseek[\w.-]*",
    };
    re(pattern).find(text).map(|m| {
        m.as_str()
            .to_lowercase()
            .replace([' ', '.'], if vendor == "anthropic" { "-" } else { "." })
    })
}
fn money(text: &str, cny: bool) -> Option<f64> {
    let text = re(r"~~.*?~~").replace_all(text, "").replace('\\', "");
    let text = network::plain(&text);
    if ["免费", "free", "不计费"].contains(&text.to_lowercase().as_str()) {
        return Some(0.);
    }
    let pattern = if cny {
        r"(?:CNY\s*|[¥￥]\s*)([\d.]+)|^([\d.]+)(?:\s*(?:元|$))"
    } else {
        r"\$\s*([\d.]+)"
    };
    let captures = re(pattern).captures(&text)?;
    captures
        .get(1)
        .or_else(|| captures.get(2))?
        .as_str()
        .parse()
        .ok()
}
fn tables(body: &str) -> Vec<(String, Vec<Vec<String>>)> {
    let mut output = vec![];
    for table in re(r"(?is)<table\b[^>]*>.*?</table>").find_iter(body) {
        let before = &body[..table.start()];
        let heading = re(r"(?is)<h[1-6]\b[^>]*>(.*?)</h[1-6]>")
            .captures_iter(before)
            .last()
            .map(|c| network::plain(&entities(&c[1])))
            .unwrap_or_default();
        let mut rows = vec![];
        let mut spans: BTreeMap<usize, (usize, String)> = BTreeMap::new();
        for row in re(r"(?is)<tr\b[^>]*>(.*?)</tr>").captures_iter(table.as_str()) {
            let mut values = vec![];
            let mut column = 0;
            let fill = |column: &mut usize,
                        values: &mut Vec<String>,
                        spans: &mut BTreeMap<usize, (usize, String)>| {
                while let Some((left, value)) = spans.get_mut(column) {
                    if *left == 0 {
                        break;
                    }
                    values.push(value.clone());
                    *left -= 1;
                    *column += 1;
                }
            };
            fill(&mut column, &mut values, &mut spans);
            for cell in re(r"(?is)<(?:td|th)\b([^>]*)>(.*?)</(?:td|th)>").captures_iter(&row[1]) {
                fill(&mut column, &mut values, &mut spans);
                let value = network::plain(&entities(&cell[2]));
                let count = |key: &str| {
                    re(&format!(r#"{key}\s*=\s*["']?(\d+)"#))
                        .captures(&cell[1])
                        .and_then(|c| c[1].parse::<usize>().ok())
                        .unwrap_or(1)
                        .min(100)
                };
                for _ in 0..count("colspan") {
                    values.push(value.clone());
                    if count("rowspan") > 1 {
                        spans.insert(column, (count("rowspan") - 1, value.clone()));
                    }
                    column += 1;
                }
            }
            fill(&mut column, &mut values, &mut spans);
            rows.push(values);
        }
        let heading = if let Some(c) = re(r#"(?is)<h2\b[^>]*id=["'](gemini[^"']+)["'][^>]*>"#)
            .captures_iter(before)
            .last()
        {
            format!("{}\0{}", &c[1], heading)
        } else {
            heading
        };
        output.push((heading, rows));
    }
    if output.is_empty() {
        let mut heading = String::new();
        let mut rows = vec![];
        for line in body.lines() {
            let line = line.trim();
            if line.starts_with('#') {
                if rows.len() > 1 {
                    output.push((heading.clone(), std::mem::take(&mut rows)));
                }
                heading = line.trim_start_matches('#').trim().into();
            } else if line.starts_with('|') && line.ends_with('|') {
                let values: Vec<String> = line[1..line.len() - 1]
                    .split('|')
                    .map(|s| network::plain(s).replace("**", ""))
                    .collect();
                if !values
                    .iter()
                    .all(|s| s.chars().all(|c| c == '-' || c == ':' || c == ' '))
                {
                    rows.push(values);
                }
            } else if rows.len() > 1 {
                output.push((heading.clone(), std::mem::take(&mut rows)));
            }
        }
        if rows.len() > 1 {
            output.push((heading, rows));
        }
    }
    output
}
fn unwrap(value: &Value) -> Value {
    if let Some(pair) = value
        .as_array()
        .filter(|v| v.len() == 2 && v[0].is_number())
    {
        if pair[0] == 1 {
            return pair[1]
                .as_array()
                .map(|a| json!(a.iter().map(unwrap).collect::<Vec<_>>()))
                .unwrap_or(pair[1].clone());
        }
        return pair[1].clone();
    }
    value.clone()
}
pub fn parse(vendor: &str, body: &str) -> Result<Vec<Value>, String> {
    let currency = if ["glm", "qwen", "mimo", "kimi"].contains(&vendor) {
        "CNY"
    } else {
        "USD"
    };
    let mut records: BTreeMap<String, Value> = BTreeMap::new();
    let mut add = |id: String,
                   input: Option<f64>,
                   output: Option<f64>,
                   cached: Option<f64>,
                   apply: bool,
                   condition: String| {
        let variant = json!({"in":input,"out":output,"cached":cached,"autoApply":apply,"condition":condition});
        let record=records.entry(id.clone()).or_insert_with(||json!({"id":id,"vendor":vendor,"currency":currency,"in":input,"out":output,"cached":cached,"autoApply":apply,"variants":[],"condition":condition}));
        if apply {
            record["in"] = json!(input);
            record["out"] = json!(output);
            record["cached"] = json!(cached);
            record["autoApply"] = json!(true);
        }
        record["variants"].as_array_mut().unwrap().push(variant);
    };
    if vendor == "openai" {
        for props in re(r#"(?is)<astro-island\b[^>]*props="([^"]+)""#).captures_iter(body) {
            let Ok(props) = serde_json::from_str::<Value>(&entities(&props[1])) else {
                continue;
            };
            let rows = unwrap(&props["rows"]);
            let tier = unwrap(&props["tier"]);
            if let Some(rows) = rows.as_array() {
                for row in rows {
                    let Some(id) = row[0].as_str().and_then(|s| model(s, vendor)) else {
                        continue;
                    };
                    let long = row.as_array().is_some_and(|r| r.len() == 5);
                    add(
                        id,
                        row[1].as_f64(),
                        row[if long { 4 } else { 3 }].as_f64(),
                        row[2].as_f64(),
                        tier == "standard" && !long,
                        if long {
                            "长上下文另价".into()
                        } else {
                            tier.as_str().unwrap_or("").into()
                        },
                    );
                }
            }
        }
    }
    if vendor == "gemini" {
        for (heading, rows) in tables(body) {
            let Some((id, tier)) = heading.split_once('\0') else {
                continue;
            };
            let cell = |prefix: &str| {
                rows.iter()
                    .find(|r| r.first().is_some_and(|s| s.starts_with(prefix)))
                    .and_then(|r| r.last())
                    .map(String::as_str)
            };
            let input = cell("Input price");
            let output = cell("Output price");
            let cache = cell("Context caching price");
            let condition = rows
                .iter()
                .flatten()
                .filter(|s| s.contains('$'))
                .cloned()
                .collect::<Vec<_>>()
                .join(" · ");
            let conditional =
                re(r"(?i)\$[\d.]+.*\$[\d.]+|per image|per second|audio|through|starting");
            let apply = tier == "Standard"
                && input.is_some()
                && output.is_some()
                && !input.is_some_and(|s| conditional.is_match(s))
                && !output.is_some_and(|s| conditional.is_match(s));
            add(
                id.into(),
                input.and_then(|s| money(s, false)),
                output.and_then(|s| money(s, false)),
                cache.and_then(|s| money(s, false)),
                apply,
                condition,
            );
        }
    }
    if vendor == "kimi" {
        for table in re(r#"(?s)<DocTable\s+columns=\{(.*?)\}\s+rows=\{(.*?)\}"#).captures_iter(body)
        {
            let headers: Vec<String> = re(r#"title:\s*"([^"]+)""#)
                .captures_iter(&table[1])
                .map(|c| c[1].into())
                .collect();
            let cleaned = re(r",\s*]").replace_all(&table[2], "]");
            let Ok(rows) = serde_json::from_str::<Vec<Vec<String>>>(&cleaned) else {
                continue;
            };
            for row in rows {
                let Some(id) = row.first().and_then(|s| model(s, vendor)) else {
                    continue;
                };
                let price = |text: &str| {
                    headers
                        .iter()
                        .position(|s| s.contains(text))
                        .and_then(|n| row.get(n))
                        .and_then(|s| money(s, true))
                };
                add(
                    id,
                    price("未命中"),
                    price("输出"),
                    price("输入价格（缓存命中）"),
                    !headers.iter().any(|s| s.contains("缓存写入")),
                    row.join(" · "),
                );
            }
        }
    }
    for (heading, rows) in tables(body) {
        let mut headers = vec![];
        let mut columns = vec![];
        let mut deep_kind = "";
        for row in rows {
            if vendor == "deepseek" {
                if columns.is_empty() {
                    columns = row
                        .iter()
                        .filter_map(|s| model(s, vendor))
                        .collect::<Vec<_>>();
                }
                let line = row.join(" ");
                if line.contains("CACHE HIT") {
                    deep_kind = "cached";
                } else if line.contains("CACHE MISS") {
                    deep_kind = "in";
                } else if line.contains("OUTPUT TOKENS") {
                    deep_kind = "out";
                }
                let prices = row
                    .iter()
                    .filter_map(|s| money(s, false))
                    .collect::<Vec<_>>();
                if !deep_kind.is_empty() && prices.len() == columns.len() {
                    for (id, price) in columns.iter().zip(prices) {
                        add(
                            id.clone(),
                            if deep_kind == "in" { Some(price) } else { None },
                            if deep_kind == "out" {
                                Some(price)
                            } else {
                                None
                            },
                            if deep_kind == "cached" {
                                Some(price)
                            } else {
                                None
                            },
                            false,
                            format!("峰谷时段及节假日条件：{line}"),
                        );
                    }
                }
                continue;
            }
            if row.iter().any(|s| {
                re(r"(?i)^(?:Model(?: ID| name)?|Name|模型(?:名称)?|模型/API)$").is_match(s)
            }) {
                headers = row;
                continue;
            }
            let Some(index) = headers.iter().position(|s| {
                re(r"(?i)^(?:Model(?: ID| name)?|Name|模型(?:名称)?|模型/API)$").is_match(s)
            }) else {
                continue;
            };
            let Some(id) = row.get(index).and_then(|s| model(s, vendor)) else {
                continue;
            };
            let input = headers.iter().position(|s| {
                re(r"(?i)^(?:Base input|Input|输入)").is_match(s)
                    && !re(r"(?i)(?:Cached|缓存命中|命中缓存|Input tokens)").is_match(s)
            });
            let output = headers
                .iter()
                .position(|s| re(r"(?i)^(?:Output|输出)").is_match(s));
            let cache = headers.iter().position(|s| {
                re(r"(?i)Cached input|caching Read|缓存命中|命中缓存").is_match(s)
                    && !s.contains("未命中")
            });
            let price = |index: Option<usize>| {
                index
                    .and_then(|n| row.get(n))
                    .and_then(|s| money(s, currency == "CNY"))
            };
            let condition = format!("{heading} · {}", row.join(" · "));
            let conditional=re(r"(?i)batch|fast mode|training|微调|私有实例|海外|缓存写入|cache.*write|[<>=≤≥]|输入长度|per image|per second|audio").is_match(&condition)||["qwen","openai","gemini"].contains(&vendor);
            let apply = input.is_some()
                && output.is_some()
                && !conditional
                && price(input).is_some()
                && price(output).is_some();
            add(
                id,
                price(input),
                price(output),
                price(cache),
                apply,
                condition,
            );
        }
    }
    if records.is_empty() {
        return Err("公开页面格式未识别，保留此前缓存".into());
    }
    Ok(records.into_values().collect())
}
pub async fn cached(core: &Core) -> Result<Value, String> {
    let value = core
        .databases
        .call("local-settings".into(), |s| {
            s.preference("official-prices")
                .map_err(|_| "读取价格缓存失败".into())
        })
        .await?;
    Ok(value
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or(json!({"catalogue":[],"sources":{},"fetchedAt":0})))
}
async fn page(http: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = http.get(url).send().await.map_err(|_| "官网连接失败")?;
    Ok(String::from_utf8_lossy(&network::bytes(response, 6 * 1024 * 1024).await?).into_owned())
}
async fn mimo_page(http: &reqwest::Client, url: &str) -> Result<String, String> {
    let html = page(http, url).await?;
    if html.contains("<table") {
        return Ok(html);
    }
    let main = re(r#"(?:src|href)="(/static/main\.[\w.]+\.js)""#)
        .captures(&html)
        .map(|c| c[1].to_string())
        .ok_or("MiMo 文档入口改变")?;
    let code = page(http, &format!("https://mimo.mi.com{main}")).await?;
    let route = re(r#"path:"zh-CN/price/pay-as-you-go",importFn:[\s\S]{0,350}?key:"#)
        .find(&code)
        .map(|m| m.as_str())
        .ok_or("MiMo 价格入口未找到")?;
    let ids = re(r"\.e\((\d+)\)")
        .captures_iter(route)
        .map(|c| c[1].to_string())
        .collect::<Vec<_>>();
    for id in ids.iter().rev() {
        let pattern = format!(r#"\b{id}:"([a-f0-9]+)""#);
        let Some(hash) = re(&pattern).captures(&html).map(|c| c[1].to_string()) else {
            continue;
        };
        let chunk = page(
            http,
            &format!("https://mimo.mi.com/static/{id}.{hash}.chunk.js"),
        )
        .await?;
        if let Some(raw) = re(r"\bhtml:'((?:\\.|[^'])*)'").captures(&chunk) {
            let encoded = format!("\"{}\"", raw[1].replace("\\'", "'").replace('"', "\\\""));
            if let Ok(decoded) = serde_json::from_str::<String>(&encoded) {
                return Ok(decoded);
            }
        }
    }
    Err("MiMo 价格内容未识别".into())
}
pub async fn refresh(core: &Core) -> Result<Value, String> {
    let _refresh = core.price_refresh.lock().await;
    let mut data = cached(core).await?;
    if crate::core::now() - data["fetchedAt"].as_i64().unwrap_or(0) < 60 {
        return Ok(data);
    }
    let mut records = data["catalogue"].as_array().cloned().unwrap_or_default();
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| "价格连接初始化失败")?;
    let slots = std::sync::Arc::new(tokio::sync::Semaphore::new(4));
    let results = futures_util::future::join_all(VENDORS.into_iter().map(|(id, name, _, url)| {
        let http = http.clone();
        let slots = slots.clone();
        async move {
            let _slot = slots.acquire().await;
            let result = tokio::time::timeout(std::time::Duration::from_secs(25), async {
                let body = if id == "mimo" {
                    mimo_page(&http, url).await?
                } else {
                    page(&http, url).await?
                };
                parse(id, &body)
            })
            .await
            .unwrap_or_else(|_| Err("官网读取超时，保留缓存".into()));
            (id, name, url, result)
        }
    }))
    .await;
    for (id, name, url, result) in results {
        match result {
            Ok(mut fresh) => {
                records.retain(|r| r["vendor"] != id);
                for record in &mut fresh {
                    record["sourceUrl"] = json!(url);
                }
                let count = fresh.len();
                records.extend(fresh);
                data["sources"][id] = json!({"name":name,"url":url,"ok":true,"count":count,"successAt":crate::core::now()});
            }
            Err(error) => {
                let old = data["sources"][id].clone();
                data["sources"][id] = json!({"name":name,"url":url,"ok":false,"error":error,"count":old["count"],"successAt":old["successAt"],"checkedAt":crate::core::now()});
            }
        }
    }
    if let Ok(response) = http
        .get("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")
        .send()
        .await
    {
        if let Ok(bytes) = network::bytes(response, 1024 * 1024).await {
            let xml = String::from_utf8_lossy(&bytes);
            let rate = |id: &str| {
                re(&format!(r#"currency=['"]{id}['"]\s+rate=['"]([\d.]+)"#))
                    .captures(&xml)
                    .and_then(|c| c[1].parse::<f64>().ok())
            };
            if let (Some(usd), Some(cny)) = (rate("USD"), rate("CNY")) {
                if usd > 0. && cny > 0. {
                    data["cnyPerUsd"] = json!(cny / usd);
                }
            }
        }
    }
    data["catalogue"] = json!(records);
    data["fetchedAt"] = json!(crate::core::now());
    let saved = data.to_string();
    core.databases
        .call("local-settings".into(), move |s| {
            s.set_preference("official-prices", &saved)
                .map_err(|_| "保存价格缓存失败".into())
        })
        .await?;
    Ok(data)
}
pub async fn effective(core: &Core, cfg: &Value, base: &str, id: &str) -> (f64, f64) {
    let api = &cfg["api"];
    let custom_key = format!("{}：{id}", base.trim_end_matches('/'));
    let custom = api["modelPrices"]
        .get(&custom_key)
        .or_else(|| api["modelPrices"].get(id));
    if let Some(value) = custom {
        return (
            value["in"].as_f64().unwrap_or(0.),
            value["out"].as_f64().unwrap_or(0.),
        );
    }
    if api["useOfficialPrice"] == true {
        if let Ok(data) = cached(core).await {
            if let Some(price) = data["catalogue"].as_array().and_then(|r| {
                r.iter().find(|r| {
                    r["id"] == id
                        && r["autoApply"] == true
                        && r["vendor"].as_str().is_some_and(|v| official(base, v))
                })
            }) {
                let factor = if price["currency"] == "CNY" {
                    Some(1.)
                } else {
                    data["cnyPerUsd"].as_f64()
                };
                if let (Some(factor), Some(input), Some(output)) =
                    (factor, price["in"].as_f64(), price["out"].as_f64())
                {
                    return (input * factor, output * factor);
                }
            }
        }
    }
    (
        api["priceInputPerM"].as_f64().unwrap_or(0.),
        api["priceOutputPerM"].as_f64().unwrap_or(0.),
    )
}
type ResultJson = Result<Json<Value>, (axum::http::StatusCode, Json<Value>)>;
fn err(e: String) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::BAD_REQUEST,
        Json(json!({"error":e})),
    )
}
pub fn routes() -> Router<Core> {
    Router::new()
        .route("/prices", get(read))
        .route("/prices/refresh", post(fetch))
}
async fn read(State(core): State<Core>) -> ResultJson {
    Ok(Json(cached(&core).await.map_err(err)?))
}
async fn fetch(State(core): State<Core>) -> ResultJson {
    Ok(Json(refresh(&core).await.map_err(err)?))
}
