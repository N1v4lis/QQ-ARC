//! Import manifests and portable prompt skills without executing archived JS.
use crate::core::Core;
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
type ResultJson = Result<Json<Value>, (axum::http::StatusCode, Json<Value>)>;
fn error(e: impl Into<String>) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::BAD_REQUEST,
        Json(json!({"error":e.into()})),
    )
}
#[derive(Deserialize)]
struct Account {
    account: String,
}
pub fn routes() -> Router<Core> {
    Router::new()
        .route("/extensions", get(list))
        .route("/extensions/import", post(import))
        .route("/extensions/remove", post(remove))
}
pub async fn entries(core: &Core, account: &str) -> Result<Vec<Value>, String> {
    core.databases
        .call(account.into(), |s| {
            Ok(s.preference("extensions-list")
                .map_err(|_| "扩展清单读取失败")?
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default())
        })
        .await
}
pub async fn prompt(core: &Core, account: &str, cfg: &Value) -> Result<String, String> {
    let mut result = String::new();
    for item in entries(core, account).await? {
        let id = item["id"].as_str().unwrap_or("");
        let enabled = cfg["skills"][id]["enabled"].as_bool().unwrap_or(false);
        if enabled && item["runtime"] == "prompt" {
            if let Some(text) = item["prompt"].as_str() {
                let remaining = 8000usize.saturating_sub(result.chars().count());
                result.push_str(&text.chars().take(remaining).collect::<String>());
                result.push('\n');
            }
        }
    }
    Ok(result)
}
async fn list(State(core): State<Core>, Query(a): Query<Account>) -> ResultJson {
    Ok(Json(json!(
        entries(&core, &a.account).await.map_err(error)?
    )))
}
#[derive(Deserialize)]
struct Import {
    account: String,
    path: String,
}
async fn import(State(core): State<Core>, Json(q): Json<Import>) -> ResultJson {
    let root = std::fs::canonicalize(&q.path).map_err(|_| error("扩展目录不存在"))?;
    if !root.is_dir() {
        return Err(error("请选择扩展目录"));
    }
    let mut manifest = json!({});
    for name in ["plugin.json", "skill.json"] {
        let path = root.join(name);
        if path.is_file() {
            if std::fs::metadata(&path)
                .map_err(|_| error("清单读取失败"))?
                .len()
                > 128 * 1024
            {
                return Err(error("清单超过大小限制"));
            }
            manifest =
                serde_json::from_slice(&std::fs::read(path).map_err(|_| error("清单读取失败"))?)
                    .map_err(|_| error("清单格式无效"))?;
            break;
        }
    }
    let id = manifest["id"]
        .as_str()
        .or_else(|| root.file_name().and_then(|n| n.to_str()))
        .ok_or_else(|| error("扩展 id 无效"))?
        .to_string();
    if id.is_empty()
        || id.len() > 100
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
    {
        return Err(error("扩展 id 无效"));
    }
    let md = root.join("SKILL.md");
    let mut text = String::new();
    if md.is_file() {
        if std::fs::metadata(&md)
            .map_err(|_| error("技能文档读取失败"))?
            .len()
            > 128 * 1024
        {
            return Err(error("技能文档超过大小限制"));
        }
        text = std::fs::read_to_string(md).map_err(|_| error("技能文档不是 UTF-8"))?;
    }
    if let Some(instruction) = manifest
        .pointer("/prompt/instruction")
        .and_then(Value::as_str)
    {
        text.push_str(instruction);
    }
    for section in manifest
        .pointer("/prompt/sections")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(content) = section["content"].as_str() {
            text.push('\n');
            text.push_str(content);
        }
    }
    let js = ["index.js", "index.mjs", "main.js", "main.mjs"]
        .iter()
        .any(|p| root.join(p).is_file())
        || manifest["entry"]
            .as_str()
            .is_some_and(|p| p.ends_with(".js") || p.ends_with(".mjs"));
    if manifest.as_object().is_none_or(|m| m.is_empty()) && text.is_empty() {
        return Err(error("目录没有可识别的清单或 SKILL.md"));
    }
    let item = json!({"id":id,"name":manifest["name"].as_str().unwrap_or(&id),"description":manifest["description"].as_str().unwrap_or(""),"version":manifest["version"],"kind":if root.join("plugin.json").exists(){"plugin"}else{"skill"},"runtime":if js{"legacy-js"}else if text.is_empty(){"unsupported"}else{"prompt"},"prompt":text,"source":root.to_string_lossy(),"manifest":manifest});
    let saved = item.clone();
    core.databases
        .call(q.account, move |s| {
            let mut items: Vec<Value> = s
                .preference("extensions-list")
                .map_err(|_| "扩展清单读取失败")?
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            items.retain(|v| v["id"] != saved["id"]);
            if items.len() >= 200 {
                return Err("扩展数量超过限制".into());
            }
            items.push(saved);
            s.set_preference("extensions-list", &serde_json::to_string(&items).unwrap())
                .map_err(|_| "扩展保存失败".into())
        })
        .await
        .map_err(error)?;
    Ok(Json(item))
}
#[derive(Deserialize)]
struct Remove {
    account: String,
    id: String,
}
async fn remove(State(core): State<Core>, Json(q): Json<Remove>) -> ResultJson {
    core.databases
        .call(q.account, move |s| {
            let mut items: Vec<Value> = s
                .preference("extensions-list")
                .map_err(|_| "扩展清单读取失败")?
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            items.retain(|v| v["id"] != q.id);
            s.set_preference("extensions-list", &serde_json::to_string(&items).unwrap())
                .map_err(|_| "扩展保存失败".into())
        })
        .await
        .map_err(error)?;
    Ok(Json(json!({"ok":true})))
}
