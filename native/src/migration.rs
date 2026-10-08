//! User-initiated, one-time official JSON migration. Never auto-open archived DBs.
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
#[derive(Deserialize)]
struct Import {
    account: String,
    path: String,
    confirmed: bool,
}
pub fn routes() -> Router<Core> {
    Router::new().route("/migration/official-messages", post(import))
}
async fn import(State(core): State<Core>, Json(q): Json<Import>) -> ResultJson {
    if !q.confirmed {
        return Err(error("请确认迁入官方格式副本"));
    }
    let path = std::fs::canonicalize(&q.path).map_err(|_| error("迁入文件不存在"))?;
    let size = std::fs::metadata(&path)
        .map_err(|_| error("迁入文件读取失败"))?
        .len();
    if !path.is_file() || size > 64 * 1024 * 1024 {
        return Err(error("请选择不超过 64 MiB 的官方消息 JSON 文件"));
    }
    let source = path.to_string_lossy().into_owned();
    let count = core
        .databases
        .call(q.account, move |s| {
            let value: Value =
                serde_json::from_slice(&std::fs::read(path).map_err(|_| "迁入文件读取失败")?)
                    .map_err(|_| "迁入文件 JSON 格式无效")?;
            s.import_official_messages(&source, &value)
        })
        .await
        .map_err(error)?;
    Ok(Json(
        json!({"ok":true,"importedMessages":count,"sourceModified":false,"scope":"messages/media/replies","unknownFieldsImported":false}),
    ))
}
