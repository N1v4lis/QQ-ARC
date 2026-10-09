//! Account workspace contracts shared by every Flutter page and the agent runtime.
use crate::{
    core::{Core, DatabasePool},
    model::ModelConfig,
    vault,
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
type ResultJson = Result<Json<Value>, (axum::http::StatusCode, Json<Value>)>;
fn error(message: impl Into<String>) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::BAD_REQUEST,
        Json(json!({"error":message.into()})),
    )
}
#[cfg(feature = "clean-release")]
const DEFAULT_CONFIG: &str = include_str!("../resources/fresh-config.json");
#[cfg(not(feature = "clean-release"))]
const DEFAULT_CONFIG: &str = include_str!("../resources/default-config.json");
#[cfg(feature = "clean-release")]
const BUILTIN_PERSONAS: &str = include_str!("../resources/fresh-personas.json");
#[cfg(not(feature = "clean-release"))]
const BUILTIN_PERSONAS: &str = include_str!("../resources/personas.json");

pub fn defaults() -> Value {
    let mut value: Value = serde_json::from_str(DEFAULT_CONFIG).expect("embedded defaults");
    value["harnesses"] = json!([]);
    value["runtime"] = json!({"enabled":false});
    value["personaHistory"] = json!({"days":1,"limit":5});
    value["proxy"] = json!({"enabled":false,"url":"http://127.0.0.1:7890"});
    value
}
pub fn merge(base: &mut Value, patch: Value) {
    match (base, patch) {
        (Value::Object(base), Value::Object(patch)) => {
            for (key, value) in patch {
                merge(base.entry(key).or_insert(Value::Null), value);
            }
        }
        (base, patch) => *base = patch,
    }
}
pub fn validate(cfg: &Value) -> Result<(), String> {
    fn shape(default: &Value, value: &Value) -> bool {
        match (default, value) {
            (Value::Object(d), Value::Object(v)) => {
                d.iter().all(|(k, d)| v.get(k).is_none_or(|v| shape(d, v)))
            }
            (Value::Array(_), Value::Array(_))
            | (Value::String(_), Value::String(_))
            | (Value::Bool(_), Value::Bool(_))
            | (Value::Number(_), Value::Number(_)) => true,
            (Value::Null, _) => true,
            _ => false,
        }
    }
    if !shape(&defaults(), cfg) {
        return Err("配置字段类型不符合当前契约".into());
    }
    let mut seen = std::collections::HashSet::new();
    for provider in cfg["providers"].as_array().into_iter().flatten() {
        let id = provider["id"].as_str().ok_or("提供商需要 id")?;
        if id.is_empty() || id.len() > 200 || !seen.insert(id) {
            return Err("提供商 id 重复或无效".into());
        }
        if provider["models"].as_array().is_none() {
            return Err("提供商 models 需要为列表".into());
        }
    }
    for field in ["priceInputPerM", "priceOutputPerM", "priceCachedPerM"] {
        let value = cfg["api"][field].as_f64().ok_or("单价格式无效")?;
        if !value.is_finite() || value < 0. {
            return Err("单价必须为非负数".into());
        }
    }
    if cfg["store"]["historyCount"]
        .as_u64()
        .is_none_or(|v| v > 500)
        || cfg["store"]["contextTier"]
            .as_u64()
            .is_none_or(|v| !(1..=4).contains(&v))
    {
        return Err("上下文条数为 0–500，响应档位为 1–4".into());
    }
    Ok(())
}
pub async fn load(db: &DatabasePool, account: &str) -> Result<Value, String> {
    db.call(account.into(), |store| store.workspace()).await
}
pub async fn store(db: &DatabasePool, account: &str, value: &Value) -> Result<(), String> {
    let encoded = value.to_string();
    db.call(account.into(), move |s| {
        s.set_preference("workspace", &encoded)
            .map_err(|_| "保存账号配置失败".into())
    })
    .await
}
pub async fn update(
    db: &DatabasePool,
    account: &str,
    action: impl FnOnce(&mut Value) -> Result<(), String> + Send + 'static,
) -> Result<Value, String> {
    db.call(account.into(), move |s| {
        let mut cfg = defaults();
        if let Some(saved) = s.preference("workspace").map_err(|_| "读取配置失败")? {
            merge(
                &mut cfg,
                serde_json::from_str(&saved).map_err(|_| "配置损坏")?,
            );
        }
        action(&mut cfg)?;
        validate(&cfg)?;
        s.set_preference("workspace", &cfg.to_string())
            .map_err(|_| "保存配置失败")?;
        Ok(cfg)
    })
    .await
}
pub async fn key(db: &DatabasePool, account: &str, slot: &str) -> Result<String, String> {
    let slot = format!("credential:{slot}");
    match db
        .call(account.into(), move |s| {
            s.preference(&slot).map_err(|_| "读取凭据失败".into())
        })
        .await?
    {
        Some(value) => vault::reveal(&value),
        None => Ok(String::new()),
    }
}
pub async fn set_key(
    db: &DatabasePool,
    account: &str,
    slot: &str,
    value: &str,
) -> Result<(), String> {
    let slot = format!("credential:{slot}");
    let value = vault::protect(value)?;
    db.call(account.into(), move |s| {
        s.set_preference(&slot, &value)
            .map_err(|_| "保存凭据失败".into())
    })
    .await
}
pub async fn resolve(
    core: &Core,
    account: &str,
    chat: &str,
) -> Result<(ModelConfig, String), String> {
    resolve_selected(core, account, chat, None).await
}
pub async fn resolve_selected(
    core: &Core,
    account: &str,
    chat: &str,
    selection: Option<Value>,
) -> Result<(ModelConfig, String), String> {
    let cfg = load(&core.databases, account).await?;
    let api = &cfg["api"];
    let override_model = &api["apiByChat"]["byChat"][chat];
    let selected = if let Some(ref selection) = selection {
        selection
    } else if override_model["model"]
        .as_str()
        .is_some_and(|v| !v.is_empty())
    {
        override_model
    } else {
        api
    };
    let provider_id = selected["provider"].as_str().unwrap_or("");
    let provider = cfg["providers"]
        .as_array()
        .and_then(|p| p.iter().find(|p| p["id"] == provider_id));
    let base = provider
        .and_then(|p| p["baseUrl"].as_str())
        .unwrap_or_else(|| api["baseUrl"].as_str().unwrap_or(""));
    let mut persona = cfg["persona"].clone();
    if let Some(overrides) = cfg["personaByChat"].get(chat) {
        merge(&mut persona, overrides.clone());
    }
    let builtin: Value = serde_json::from_str(BUILTIN_PERSONAS).expect("builtin personas");
    if persona
        .pointer("/templateRef/builtin")
        .and_then(Value::as_bool)
        == Some(true)
    {
        if let Some(text) = persona
            .pointer("/templateRef/id")
            .and_then(Value::as_str)
            .and_then(|id| builtin[id]["text"].as_str())
        {
            persona["roleText"] = json!(text);
            persona["customRules"] = json!("");
            persona["systemPromptOverride"] = json!("");
        }
    }
    let system = if let Some(prompt) = persona["systemPromptOverride"]
        .as_str()
        .filter(|p| !p.is_empty())
    {
        prompt.to_string()
    } else {
        format!(
            "{}\n{}\n称呼：{}；参与度：{}",
            persona["roleText"].as_str().unwrap_or(""),
            persona["customRules"].as_str().unwrap_or(""),
            persona["botName"].as_str().unwrap_or(""),
            persona["participation"].as_str().unwrap_or("medium")
        )
    };
    let prices =
        crate::prices::effective(core, &cfg, base, selected["model"].as_str().unwrap_or("")).await;
    let config = ModelConfig {
        base_url: base.into(),
        model: selected["model"].as_str().unwrap_or("").into(),
        system_prompt: system,
        input_per_million: prices.0,
        output_per_million: prices.1,
    };
    let credential = key(
        &core.databases,
        account,
        if provider_id.is_empty() {
            "api"
        } else {
            provider_id
        },
    )
    .await?;
    Ok((config, credential))
}
pub fn routes() -> Router<Core> {
    Router::new()
        .route("/config", get(read).post(write))
        .route("/credentials", post(credentials))
        .route("/providers/fetch-models", post(fetch_models))
        .route("/providers/test", post(test_model))
        .route("/roster", get(roster))
        .route("/persona", get(persona).post(save_persona))
        .route("/persona/templates", get(templates).post(save_templates))
        .route("/archive", get(archive))
        .route("/archive/delete", post(delete_archive))
        .route("/usage", get(usage))
        .route("/memory/documents", get(documents).post(save_document))
        .route("/memory/documents/delete", post(delete_document))
        .route("/persona/template", post(edit_template))
        .route("/runs", get(runs))
        .route("/runs/events", get(run_events))
        .route("/runs/cancel", post(cancel_run))
        .route("/tools", get(tool_list))
        .route("/ui/sound", post(sound))
        .route("/onebot/action", post(action))
}
#[derive(Deserialize)]
struct Account {
    account: String,
}
async fn read(State(core): State<Core>, Query(a): Query<Account>) -> ResultJson {
    Ok(Json(
        load(&core.databases, &a.account).await.map_err(error)?,
    ))
}
#[derive(Deserialize)]
struct Save {
    account: String,
    patch: Value,
}
fn reject_secrets(value: &Value) -> bool {
    match value {
        Value::Object(o) => o.iter().any(|(k, v)| {
            matches!(
                k.as_str(),
                "apiKey"
                    | "accessToken"
                    | "httpAccessToken"
                    | "dshProviderKeys"
                    | "token"
                    | "password"
            ) && !v.as_str().is_some_and(str::is_empty)
                && v != &json!({})
                || reject_secrets(v)
        }),
        Value::Array(a) => a.iter().any(reject_secrets),
        _ => false,
    }
}
async fn write(State(core): State<Core>, Json(s): Json<Save>) -> ResultJson {
    if !s.patch.is_object() || s.patch.to_string().len() > 1024 * 1024 || reject_secrets(&s.patch) {
        return Err(error("配置无效；密钥须通过凭据接口保存"));
    }
    update(&core.databases, &s.account, move |config| {
        merge(config, s.patch);
        config.as_object_mut().unwrap().remove("personaUnified");
        config.as_object_mut().unwrap().remove("personaShared");
        Ok(())
    })
    .await
    .map_err(error)?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct Credential {
    account: String,
    slot: String,
    value: Option<String>,
}
async fn credentials(State(core): State<Core>, Json(s): Json<Credential>) -> ResultJson {
    if s.slot.is_empty() || s.slot.len() > 200 {
        return Err(error("凭据位置无效"));
    }
    if let Some(value) = s.value {
        if value.len() > 16384 {
            return Err(error("凭据长度超过限制"));
        }
        set_key(&core.databases, &s.account, &s.slot, &value)
            .await
            .map_err(error)?;
        Ok(Json(json!({"ok":true})))
    } else {
        let value = key(&core.databases, &s.account, &s.slot)
            .await
            .map_err(error)?;
        Ok(Json(json!({"value":value,"saved":!value.is_empty()})))
    }
}
#[derive(Deserialize)]
struct Provider {
    account: String,
    provider: String,
}
async fn fetch_models(State(core): State<Core>, Json(p): Json<Provider>) -> ResultJson {
    let cfg = load(&core.databases, &p.account).await.map_err(error)?;
    let provider = cfg["providers"]
        .as_array()
        .and_then(|v| v.iter().find(|v| v["id"] == p.provider))
        .ok_or_else(|| error("提供商不存在"))?;
    let mut url = reqwest::Url::parse(provider["baseUrl"].as_str().unwrap_or(""))
        .map_err(|_| error("提供商地址无效"))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
    {
        return Err(error("提供商地址无效"));
    }
    let secret = key(&core.databases, &p.account, &p.provider)
        .await
        .map_err(error)?;
    let base = provider["baseUrl"].clone();
    let host = url.host_str().unwrap_or("").to_string();
    let gemini = host == "generativelanguage.googleapis.com" && !url.path().contains("openai");
    let claude = host == "api.anthropic.com";
    if (gemini || claude) && url.scheme() != "https" {
        return Err(error("官方接口须使用 HTTPS"));
    }
    if gemini {
        url.set_path("/v1beta/models");
    } else if claude {
        url.set_path("/v1/models");
    } else {
        url.set_path(&format!("{}/models", url.path().trim_end_matches('/')));
    }
    let http = crate::network::client(&cfg).map_err(error)?;
    let mut models = vec![];
    let mut page = String::new();
    for _ in 0..10 {
        let mut endpoint = url.clone();
        if gemini {
            endpoint.query_pairs_mut().append_pair("pageSize", "500");
        }
        if claude {
            endpoint.query_pairs_mut().append_pair("limit", "500");
        }
        if !page.is_empty() {
            endpoint
                .query_pairs_mut()
                .append_pair(if gemini { "pageToken" } else { "after_id" }, &page);
        }
        let mut request = http.get(endpoint);
        if gemini {
            request = request.header("x-goog-api-key", &secret);
        } else if claude {
            request = request
                .header("x-api-key", &secret)
                .header("anthropic-version", "2023-06-01");
        } else {
            request = request.bearer_auth(&secret);
        }
        let data = crate::network::json(request.send().await.map_err(|_| error("拉取模型失败"))?)
            .await
            .map_err(error)?;
        let values = data[if gemini { "models" } else { "data" }]
            .as_array()
            .ok_or_else(|| error("返回内容没有模型列表"))?;
        for value in values {
            if gemini
                && !value["supportedGenerationMethods"]
                    .as_array()
                    .is_some_and(|methods| methods.iter().any(|v| v == "generateContent"))
            {
                continue;
            }
            let Some(id) = value[if gemini { "name" } else { "id" }].as_str() else {
                continue;
            };
            let id = if gemini {
                id.strip_prefix("models/").unwrap_or(id)
            } else {
                id
            };
            let mut model = provider["models"]
                .as_array()
                .and_then(|old| old.iter().find(|v| v["id"] == id))
                .cloned()
                .unwrap_or(json!({}));
            model["id"] = json!(id);
            model["name"] = json!(
                value[if gemini {
                    "displayName"
                } else {
                    "display_name"
                }]
                .as_str()
                .unwrap_or(id)
            );
            models.push(model);
        }
        let next = if gemini {
            data["nextPageToken"].as_str().unwrap_or("")
        } else if claude && data["has_more"] == true {
            data["last_id"].as_str().unwrap_or("")
        } else {
            ""
        };
        if next.is_empty() || next == page || models.len() >= 5000 {
            break;
        }
        page = next.into();
    }
    models.truncate(5000);
    let new_models = models.clone();
    update(&core.databases, &p.account, move |current| {
        let provider = current["providers"]
            .as_array_mut()
            .and_then(|list| list.iter_mut().find(|v| v["id"] == p.provider))
            .ok_or("提供商已删除")?;
        if provider["baseUrl"] != base {
            return Err("拉取期间连接地址已改变，请重试".into());
        }
        provider["models"] = json!(new_models);
        Ok(())
    })
    .await
    .map_err(error)?;
    Ok(Json(json!(models)))
}
#[derive(Deserialize)]
struct ModelTest {
    account: String,
    provider: String,
    model: String,
    #[serde(default)]
    image: String,
}
async fn test_model(State(core): State<Core>, Json(q): Json<ModelTest>) -> ResultJson {
    let cfg = load(&core.databases, &q.account).await.map_err(error)?;
    let (model, key) = resolve_selected(
        &core,
        &q.account,
        "",
        Some(json!({"provider":q.provider,"model":q.model})),
    )
    .await
    .map_err(error)?;
    if model.model.is_empty() {
        return Err(error("请选择测试模型"));
    }
    let content = if q.image.is_empty() {
        json!("Reply with OK.")
    } else {
        let url = reqwest::Url::parse(&q.image).map_err(|_| error("图片地址无效"))?;
        if !["http", "https"].contains(&url.scheme())
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(error("图片 URL 无效"));
        }
        json!([{"type":"text","text":"Describe the image briefly."},{"type":"image_url","image_url":{"url":url.as_str()}}])
    };
    let started = std::time::Instant::now();
    let result = crate::model_protocols::request(
        &crate::network::client(&cfg).map_err(error)?,
        &model.base_url,
        &key,
        &json!({"model":model.model,"messages":[{"role":"user","content":content}],"stream":false,"local_network_config":cfg}),
    )
    .await
    .map_err(error)?;
    let input = result["usage"]["prompt_tokens"].as_u64().unwrap_or(0);
    let output = result["usage"]["completion_tokens"].as_u64().unwrap_or(0);
    let cost = (input as f64 * model.input_per_million + output as f64 * model.output_per_million)
        / 1_000_000.;
    let id = model.model.clone();
    core.databases
        .call(q.account, move |s| {
            s.record_usage(&id, input, output, cost, crate::core::now())
                .map_err(|_| "记录测试用量失败".into())
        })
        .await
        .map_err(error)?;
    Ok(Json(
        json!({"ok":true,"milliseconds":started.elapsed().as_millis(),"text":result["choices"][0]["message"]["content"],"input":input,"output":output,"cost":cost}),
    ))
}
async fn roster(State(core): State<Core>, Query(a): Query<Account>) -> ResultJson {
    let (groups, friends) = tokio::join!(
        core.connections
            .action(&a.account, json!({"action":"get_group_list","params":{}})),
        core.connections
            .action(&a.account, json!({"action":"get_friend_list","params":{}}))
    );
    Ok(Json(
        json!({"groups":groups.map_err(error)?,"friends":friends.map_err(error)?}),
    ))
}
#[derive(Deserialize)]
struct Target {
    account: String,
    #[serde(default)]
    target: String,
}
async fn persona(State(core): State<Core>, Query(a): Query<Target>) -> ResultJson {
    let cfg = load(&core.databases, &a.account).await.map_err(error)?;
    let raw = if a.target.is_empty() {
        cfg["persona"].clone()
    } else {
        cfg["personaByChat"][&a.target].clone()
    };
    let slot = format!("persona-history:{}", a.target);
    let history = core
        .databases
        .call(a.account, move |s| {
            s.preference(&slot).map_err(|_| "读取保存记录失败".into())
        })
        .await
        .map_err(error)?;
    Ok(Json(
        json!({"value":raw,"defaults":cfg["persona"],"history":history.and_then(|h|serde_json::from_str::<Value>(&h).ok()).unwrap_or(json!([]))}),
    ))
}
#[derive(Deserialize)]
struct PersonaSave {
    account: String,
    target: String,
    section: String,
    value: Value,
}
async fn save_persona(State(core): State<Core>, Json(s): Json<PersonaSave>) -> ResultJson {
    let allowed = match s.section.as_str() {
        "body" => vec!["roleText"],
        "rules" => vec!["customRules", "systemPromptOverride"],
        "identity" => vec!["botName", "selfNickname", "participation", "templateRef"],
        "all" => vec![
            "roleText",
            "customRules",
            "systemPromptOverride",
            "botName",
            "selfNickname",
            "participation",
            "templateRef",
        ],
        _ => return Err(error("人设栏位无效")),
    };
    core.databases
        .call(s.account, move |db| {
            let mut cfg = db.workspace()?;
            let history_days = cfg["personaHistory"]["days"]
                .as_i64()
                .unwrap_or(1)
                .clamp(1, 7);
            let history_limit = cfg["personaHistory"]["limit"]
                .as_u64()
                .unwrap_or(5)
                .clamp(1, 20) as usize;
            let target = if s.target.is_empty() {
                &mut cfg["persona"]
            } else {
                &mut cfg["personaByChat"][&s.target]
            };
            if target.is_null() {
                *target = json!({});
            }
            if allowed.contains(&"templateRef") {
                if let Some(reference) = s.value.get("templateRef") {
                    target["templateRef"] = reference.clone();
                }
            }
            let builtin = target
                .pointer("/templateRef/builtin")
                .and_then(Value::as_bool)
                == Some(true);
            for name in allowed {
                if let Some(value) = s.value.get(name) {
                    if builtin
                        && matches!(name, "roleText" | "customRules" | "systemPromptOverride")
                    {
                        return Err("内置人设正文与规则只读".into());
                    }
                    target[name] = value.clone();
                }
            }
            let version =
                json!({"timestamp":crate::core::now(),"section":s.section,"value":target.clone()});
            let slot = format!("persona-history:{}", s.target);
            let mut history: Vec<Value> = db
                .preference(&slot)
                .map_err(|_| "读取历史失败")?
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or_default();
            history.insert(0, version);
            history.retain(|v| {
                v["timestamp"].as_i64().unwrap_or(0) >= crate::core::now() - 86400 * history_days
            });
            history.truncate(history_limit);
            db.save_preferences(&[
                ("workspace".into(), cfg.to_string()),
                (slot, serde_json::to_string(&history).unwrap()),
            ])
            .map_err(|_| "保存人设失败".into())
        })
        .await
        .map_err(error)?;
    Ok(Json(json!({"ok":true})))
}
async fn templates(State(core): State<Core>) -> ResultJson {
    let builtin: Value = serde_json::from_str(BUILTIN_PERSONAS).expect("builtin personas");
    let custom = core
        .databases
        .call("local-settings".into(), |s| {
            s.preference("persona-library")
                .map_err(|_| "读取模板失败".into())
        })
        .await
        .map_err(error)?;
    Ok(Json(
        json!({"builtin":builtin,"custom":custom.and_then(|v|serde_json::from_str::<Value>(&v).ok()).unwrap_or(json!([]))}),
    ))
}
async fn save_templates(State(core): State<Core>, Json(value): Json<Value>) -> ResultJson {
    if !value.is_array() || value.to_string().len() > 1024 * 1024 {
        return Err(error("模板库无效"));
    }
    core.databases
        .call("local-settings".into(), move |s| {
            s.set_preference("persona-library", &value.to_string())
                .map_err(|_| "保存模板失败".into())
        })
        .await
        .map_err(error)?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct ArchiveQuery {
    account: String,
    #[serde(default)]
    chat: String,
    #[serde(default)]
    search: String,
    before: Option<i64>,
}
async fn archive(State(core): State<Core>, Query(q): Query<ArchiveQuery>) -> ResultJson {
    Ok(Json(
        core.databases
            .call(q.account, move |s| {
                let rows = s
                    .archive(&q.chat, &q.search, q.before)
                    .map_err(|_| "读取存档失败")?;
                s.enrich_messages(rows)
                    .map_err(|_| "读取多媒体关联失败".into())
            })
            .await
            .map_err(error)?,
    ))
}
#[derive(Deserialize)]
struct DeleteArchive {
    account: String,
    chat: String,
    confirmed: bool,
}
async fn delete_archive(State(core): State<Core>, Json(q): Json<DeleteArchive>) -> ResultJson {
    if !q.confirmed || q.chat.is_empty() {
        return Err(error("请确认要清理的会话"));
    }
    core.databases
        .call(q.account, move |s| {
            s.delete_chat(&q.chat).map_err(|_| "清理会话失败".into())
        })
        .await
        .map_err(error)?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct UsageQuery {
    account: String,
    #[serde(default)]
    since: i64,
}
async fn usage(State(core): State<Core>, Query(q): Query<UsageQuery>) -> ResultJson {
    Ok(Json(
        core.databases
            .call(q.account, move |s| {
                s.usage_breakdown(q.since)
                    .map_err(|_| "读取用量失败".into())
            })
            .await
            .map_err(error)?,
    ))
}
async fn runs(State(core): State<Core>, Query(q): Query<Account>) -> ResultJson {
    Ok(Json(
        core.databases
            .call(q.account, |s| {
                s.runs().map_err(|_| "读取运行记录失败".into())
            })
            .await
            .map_err(error)?,
    ))
}
#[derive(Deserialize)]
struct RunQuery {
    account: String,
    run_id: String,
}
async fn run_events(State(core): State<Core>, Query(q): Query<RunQuery>) -> ResultJson {
    Ok(Json(
        core.databases
            .call(q.account, move |s| {
                s.run_events(&q.run_id)
                    .map_err(|_| "读取运行事件失败".into())
            })
            .await
            .map_err(error)?,
    ))
}
async fn cancel_run(State(core): State<Core>, Json(q): Json<RunQuery>) -> ResultJson {
    Ok(Json(
        json!({"cancelled":crate::agent::cancel(&core,&q.account,&q.run_id).await.map_err(error)?}),
    ))
}
#[derive(Deserialize)]
struct Documents {
    account: String,
    chat: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    search: String,
}
async fn documents(State(core): State<Core>, Query(q): Query<Documents>) -> ResultJson {
    if q.search.len() > 2000 {
        return Err(error("搜索内容过长"));
    }
    Ok(Json(
        core.databases
            .call(q.account, move |s| {
                s.documents(&q.chat, &q.kind, &q.search)
                    .map_err(|_| "读取文档失败".into())
            })
            .await
            .map_err(error)?,
    ))
}
#[derive(Deserialize)]
struct Document {
    account: String,
    chat: String,
    id: Option<i64>,
    kind: String,
    title: String,
    content: String,
}
async fn save_document(State(core): State<Core>, Json(q): Json<Document>) -> ResultJson {
    if !["document", "member", "summary"].contains(&q.kind.as_str())
        || q.chat.is_empty()
        || q.title.trim().is_empty()
        || q.title.len() > 400
        || q.content.chars().count() > 32000
    {
        return Err(error("文档类型、标题或长度无效"));
    }
    let id = core
        .databases
        .call(q.account, move |s| {
            s.save_document(q.id, &q.chat, &q.kind, &q.title, &q.content)
                .map_err(|_| "文档不存在或保存失败".into())
        })
        .await
        .map_err(error)?;
    Ok(Json(json!({"ok":true,"id":id})))
}
#[derive(Deserialize)]
struct DeleteDocument {
    account: String,
    chat: String,
    id: i64,
    confirmed: bool,
}
async fn delete_document(State(core): State<Core>, Json(q): Json<DeleteDocument>) -> ResultJson {
    if !q.confirmed {
        return Err(error("请确认删除文档"));
    }
    let deleted = core
        .databases
        .call(q.account, move |s| {
            s.delete_document(q.id, &q.chat)
                .map_err(|_| "删除文档失败".into())
        })
        .await
        .map_err(error)?;
    Ok(Json(json!({"deleted":deleted})))
}
#[derive(Deserialize)]
struct TemplateEdit {
    id: String,
    #[serde(default)]
    value: Value,
    #[serde(default)]
    delete: bool,
    #[serde(default)]
    confirmed: bool,
}
async fn edit_template(State(core): State<Core>, Json(q): Json<TemplateEdit>) -> ResultJson {
    if q.id.is_empty()
        || q.id.len() > 100
        || q.value.to_string().len() > 128 * 1024
        || (q.delete && !q.confirmed)
    {
        return Err(error("模板参数无效"));
    }
    let value = core
        .databases
        .call("local-settings".into(), move |db| {
            let mut library: Vec<Value> = db
                .preference("persona-library")
                .map_err(|_| "模板库读取失败")?
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or_default();
            if q.delete {
                library.retain(|v| v["id"] != q.id);
            } else {
                let mut value = q.value;
                if !value.is_object() || value["name"].as_str().is_none_or(str::is_empty) {
                    return Err("请填写模板名称".into());
                }
                value["id"] = json!(q.id);
                if let Some(found) = library.iter_mut().find(|v| v["id"] == q.id) {
                    *found = value;
                } else {
                    library.push(value);
                }
            }
            db.set_preference("persona-library", &json!(library).to_string())
                .map_err(|_| "保存模板失败")?;
            Ok(json!({"custom":library}))
        })
        .await
        .map_err(error)?;
    Ok(Json(value))
}
async fn tool_list(State(core): State<Core>, Query(q): Query<Account>) -> ResultJson {
    let cfg = load(&core.databases, &q.account).await.map_err(error)?;
    Ok(Json(json!(crate::agent::tools(&cfg))))
}
#[derive(Deserialize)]
struct Sound {
    name: String,
    volume: f64,
}
async fn sound(Json(q): Json<Sound>) -> ResultJson {
    tokio::task::spawn_blocking(move || crate::audio::play(&q.name, q.volume))
        .await
        .map_err(|_| error("音效任务失败"))?
        .map_err(error)?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct Action {
    account: String,
    action: String,
    #[serde(default)]
    params: Value,
}
async fn action(State(core): State<Core>, Json(q): Json<Action>) -> ResultJson {
    // Explicit UI operations; model tools have a separate availability gate.
    if !matches!(
        q.action.as_str(),
        "get_login_info"
            | "get_version_info"
            | "get_group_list"
            | "get_friend_list"
            | "get_group_member_list"
            | "get_msg"
            | "get_group_msg_history"
    ) {
        return Err(error("该操作不在界面查询清单中"));
    }
    Ok(Json(
        core.connections
            .action(&q.account, json!({"action":q.action,"params":q.params}))
            .await
            .map_err(error)?,
    ))
}
