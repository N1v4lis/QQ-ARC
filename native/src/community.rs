//! Community API stays behind authenticated local IPC. Tokens never enter config.
use crate::{core::Core, network, workspace};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
const BASE: &str = "https://www.kondius.cn/api/community";
type ResultJson = Result<Json<Value>, (axum::http::StatusCode, Json<Value>)>;
fn error(e: impl Into<String>) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::BAD_REQUEST,
        Json(json!({"error":e.into()})),
    )
}
pub fn routes() -> Router<Core> {
    Router::new()
        .route("/community/list", get(list))
        .route("/community/login", post(login))
        .route("/community/logout", post(logout))
        .route("/community/verify", post(verify))
}
#[derive(Deserialize)]
struct ListQuery {
    account: String,
    kind: String,
}
async fn list(State(core): State<Core>, Query(q): Query<ListQuery>) -> ResultJson {
    let path = match q.kind.as_str() {
        "skill" => "skills",
        "plugin" => "plugins",
        "persona" => "personas",
        _ => return Err(error("市场类型无效")),
    };
    let cfg = workspace::load(&core.databases, &q.account)
        .await
        .map_err(error)?;
    let http = network::client(&cfg).map_err(error)?;
    let response = http
        .get(format!("{BASE}/{path}"))
        .send()
        .await
        .map_err(|_| error("社区连接失败"))?;
    Ok(Json(network::json(response).await.map_err(error)?))
}
#[derive(Deserialize)]
struct Login {
    account: String,
    login_id: String,
    password: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    register: bool,
}
async fn login(State(core): State<Core>, Json(q): Json<Login>) -> ResultJson {
    if q.login_id.is_empty() || q.password.is_empty() {
        return Err(error("请填写登录 ID 和密码"));
    }
    let cfg = workspace::load(&core.databases, &q.account)
        .await
        .map_err(error)?;
    let response = network::client(&cfg)
        .map_err(error)?
        .post(format!(
            "{BASE}/auth/{}",
            if q.register { "register" } else { "login" }
        ))
        .json(&json!({"loginId":q.login_id,"password":q.password,"displayName":q.display_name}))
        .send()
        .await
        .map_err(|_| error("社区登录请求失败"))?;
    let mut result = network::json(response).await.map_err(error)?;
    if result["ok"] != true {
        return Err(error("登录未成功，请检查凭据或服务状态"));
    }
    let token = result["token"]
        .as_str()
        .ok_or_else(|| error("服务未返回登录令牌"))?;
    workspace::set_key(&core.databases, &q.account, "community", token)
        .await
        .map_err(error)?;
    result.as_object_mut().unwrap().remove("token");
    Ok(Json(result))
}
#[derive(Deserialize)]
struct Account {
    account: String,
}
async fn logout(State(core): State<Core>, Json(q): Json<Account>) -> ResultJson {
    let token = workspace::key(&core.databases, &q.account, "community")
        .await
        .map_err(error)?;
    if !token.is_empty() {
        let _ = core
            .http
            .post(format!("{BASE}/auth/logout"))
            .header("X-Account-Token", token)
            .send()
            .await;
    }
    workspace::set_key(&core.databases, &q.account, "community", "")
        .await
        .map_err(error)?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct Codes {
    account: String,
    codes: Vec<String>,
}
async fn verify(State(core): State<Core>, Json(q): Json<Codes>) -> ResultJson {
    if q.codes.is_empty() || q.codes.len() > 30 {
        return Err(error("安装口令数量无效"));
    }
    let cfg = workspace::load(&core.databases, &q.account)
        .await
        .map_err(error)?;
    let response = network::client(&cfg)
        .map_err(error)?
        .post(format!("{BASE}/install/verify"))
        .json(&json!({"codes":q.codes}))
        .send()
        .await
        .map_err(|_| error("口令校验失败"))?;
    Ok(Json(network::json(response).await.map_err(error)?))
}
