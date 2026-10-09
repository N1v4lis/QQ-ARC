//! Portable, data-only theme packages. Credentials, startup and account settings are excluded.
use crate::core::Core;
use axum::{Json, Router, extract::State, routing::post};
use serde::Deserialize;
use serde_json::{Value, json};
type ResultJson = Result<Json<Value>, (axum::http::StatusCode, Json<Value>)>;
fn error(e: impl Into<String>) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::BAD_REQUEST,
        Json(json!({"error":e.into()})),
    )
}
const KEYS: &[&str] = &[
    "theme",
    "skin",
    "accent",
    "fontFamily",
    "fontSize",
    "mcFont",
    "background",
    "opacity",
    "wallpaper",
    "sound",
    "masterVolume",
    "clickVolume",
    "toggleVolume",
    "sliderVolume",
    "clickSound",
    "toggleSound",
    "sliderSound",
    "customBackground",
];
pub fn validate(value: &Value) -> Result<Value, String> {
    let object = value.as_object().ok_or("主题设置须为对象")?;
    if object.keys().any(|k| !KEYS.contains(&k.as_str())) {
        return Err("主题包含非视觉字段，禁止导入账号或系统设置".into());
    }
    for (key, v) in object {
        match key.as_str() {
            "theme"
                if v.as_str()
                    .is_some_and(|s| ["light", "dark", "auto"].contains(&s)) => {}
            "skin"
                if v.as_str()
                    .is_some_and(|s| ["default", "minecraft"].contains(&s)) => {}
            "accent"
                if v.as_str()
                    .is_some_and(|s| s.len() == 6 && s.bytes().all(|b| b.is_ascii_hexdigit())) => {}
            "fontFamily" if v.as_str().is_some_and(|s| s.len() <= 120) => {}
            "fontSize" if v.as_f64().is_some_and(|n| (11.0..=18.0).contains(&n)) => {}
            "mcFont" | "background" | "sound" if v.is_boolean() => {}
            "opacity" | "masterVolume" | "clickVolume" | "toggleVolume" | "sliderVolume"
                if v.as_f64().is_some_and(|n| (0.0..=1.0).contains(&n)) => {}
            "wallpaper" if v.as_u64().is_some_and(|n| (1..=3).contains(&n)) => {}
            "clickSound"
                if v.as_str()
                    .is_some_and(|s| ["hit", "menu", "pop", "none"].contains(&s)) => {}
            "toggleSound"
                if v.as_str()
                    .is_some_and(|s| ["piston", "beacon", "none"].contains(&s)) => {}
            "sliderSound"
                if v.as_str()
                    .is_some_and(|s| ["bow", "pop", "none"].contains(&s)) => {}
            "customBackground" if v.is_null() => {}
            "customBackground" => {
                let list = v.as_array().ok_or("背景须为 PNG 字节数组")?;
                if list.len() > 1024 * 1024 || list.len() < 24 {
                    return Err("背景 PNG 限制为 1 MiB".into());
                }
                let bytes: Vec<u8> = list
                    .iter()
                    .map(|n| {
                        n.as_u64()
                            .filter(|n| *n < 256)
                            .map(|n| n as u8)
                            .ok_or("背景字节无效")
                    })
                    .collect::<Result<_, _>>()?;
                if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                    return Err("背景只支持 PNG".into());
                }
                let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
                let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
                if w == 0 || h == 0 || w > 8192 || h > 8192 || w as u64 * h as u64 > 16_000_000 {
                    return Err("背景尺寸超限".into());
                }
            }
            _ => return Err(format!("主题字段无效：{key}")),
        }
    }
    Ok(value.clone())
}
#[derive(Deserialize)]
struct Export {
    path: String,
    #[serde(default)]
    overwrite: bool,
    #[serde(default)]
    background_path: String,
}
#[derive(Deserialize)]
struct Import {
    path: String,
    confirmed: bool,
}
pub fn routes() -> Router<Core> {
    Router::new()
        .route("/themes/export", post(export))
        .route("/themes/import", post(import))
}
async fn export(State(core): State<Core>, Json(q): Json<Export>) -> ResultJson {
    let saved = core
        .databases
        .call("local-settings".into(), |s| {
            s.preference("ui").map_err(|_| "偏好读取失败".into())
        })
        .await
        .map_err(error)?;
    let prefs = saved
        .and_then(|v| serde_json::from_str::<Value>(&v).ok())
        .unwrap_or(json!({"skin":"default","theme":"light"}));
    let mut settings = json!({});
    for key in KEYS {
        if let Some(value) = prefs.get(*key) {
            settings[*key] = value.clone();
        }
    }
    if !q.background_path.is_empty() {
        let meta = std::fs::metadata(&q.background_path).map_err(|_| error("背景文件不存在"))?;
        if !meta.is_file() || meta.len() > 1024 * 1024 {
            return Err(error("背景 PNG 限制为 1 MiB"));
        }
        settings["customBackground"] =
            json!(std::fs::read(&q.background_path).map_err(|_| error("背景读取失败"))?);
    }
    validate(&settings).map_err(error)?;
    let path = std::path::Path::new(&q.path);
    if path.extension().and_then(|s| s.to_str()) != Some("qqtheme") {
        return Err(error("请选择 .qqtheme 文件路径"));
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(!q.overwrite)
        .create(q.overwrite)
        .truncate(q.overwrite)
        .open(path)
        .map_err(|_| error("无法创建主题包；覆盖现有文件需要明确确认"))?;
    file.write_all(
        serde_json::to_string_pretty(
            &json!({"format":"qqaf-theme","version":1,"settings":settings}),
        )
        .unwrap()
        .as_bytes(),
    )
    .map_err(|_| error("主题包写入失败"))?;
    Ok(Json(json!({"ok":true})))
}
async fn import(State(core): State<Core>, Json(q): Json<Import>) -> ResultJson {
    if !q.confirmed {
        return Err(error("请确认导入主题包"));
    }
    let path = std::path::Path::new(&q.path);
    let size = std::fs::metadata(path).map_err(|_| error("主题包不存在"))?;
    if !size.is_file() || size.len() > 8 * 1024 * 1024 {
        return Err(error("主题包超过 8 MiB"));
    }
    let pack: Value =
        serde_json::from_slice(&std::fs::read(path).map_err(|_| error("主题包读取失败"))?)
            .map_err(|_| error("主题包格式无效"))?;
    if pack["format"] != "qqaf-theme" || pack["version"] != 1 {
        return Err(error("不支持的主题包格式"));
    }
    let settings = validate(&pack["settings"]).map_err(error)?;
    let prefs = core
        .databases
        .call("local-settings".into(), move |s| {
            let mut prefs = s
                .preference("ui")
                .map_err(|_| "偏好读取失败")?
                .and_then(|v| serde_json::from_str::<Value>(&v).ok())
                .unwrap_or(json!({}));
            if !prefs.is_object() {
                prefs = json!({});
            }
            for (key, value) in settings.as_object().unwrap() {
                prefs[key] = value.clone();
            }
            prefs["winefox_enabled"] = json!(false);
            s.set_preference("ui", &prefs.to_string())
                .map_err(|_| "保存主题失败")?;
            Ok(prefs)
        })
        .await
        .map_err(error)?;
    Ok(Json(prefs))
}
