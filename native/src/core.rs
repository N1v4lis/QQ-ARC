use crate::{
    connections::Connections,
    model::{self, ModelConfig},
    storage::AccountStore,
};
use axum::{
    Json, Router,
    extract::{Query, Request, State},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, mpsc},
};
use tokio::sync::oneshot;
type Job = Box<dyn FnOnce(&mut AccountStore) + Send>;
#[derive(Clone)]
pub struct DatabasePool {
    root: PathBuf,
    writers: Arc<Mutex<HashMap<String, mpsc::SyncSender<Job>>>>,
}
impl DatabasePool {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            writers: Default::default(),
        }
    }
    pub async fn call<T: Send + 'static>(
        &self,
        account: String,
        action: impl FnOnce(&mut AccountStore) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        if account.is_empty()
            || !account
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err("账号标识无效".into());
        }
        let sender = {
            let mut writers = self.writers.lock().map_err(|_| "存储锁异常")?;
            if !writers.contains_key(&account) {
                let root = self.root.clone();
                let id = account.clone();
                let (send, receive) = mpsc::sync_channel::<Job>(256);
                let (ready, initialized) = mpsc::sync_channel(1);
                std::thread::spawn(move || {
                    let mut store = match AccountStore::open(&root, &id) {
                        Ok(s) => s,
                        Err(_) => {
                            let _ = ready.send(false);
                            return;
                        }
                    };
                    let _ = ready.send(true);
                    for job in receive {
                        job(&mut store);
                    }
                });
                if initialized.recv() != Ok(true) {
                    return Err("账号数据库初始化失败".into());
                }
                writers.insert(account.clone(), send);
            }
            writers[&account].clone()
        };
        let (send, receive) = oneshot::channel();
        sender
            .try_send(Box::new(move |store| {
                let _ = send.send(action(store));
            }))
            .map_err(|_| "存储队列繁忙，请重试")?;
        receive.await.map_err(|_| "存储线程已关闭".to_string())?
    }
    pub fn accounts(&self) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(self.root.join("accounts")) else {
            return vec![];
        };
        entries
            .filter_map(Result::ok)
            .filter(|e| e.path().join("native-prototype.sqlite").is_file())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|id| id != "local-settings")
            .collect()
    }
}
#[derive(Clone)]
pub struct Core {
    pub data_root: PathBuf,
    pub snow: crate::snow::Manager,
    pub databases: DatabasePool,
    pub connections: Connections,
    pub http: reqwest::Client,
    pub token: String,
    pub model_keys: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    pub shutdown: tokio::sync::watch::Sender<bool>,
    pub runtime: crate::agent::Runtime,
    pub price_refresh: Arc<tokio::sync::Mutex<()>>,
}
impl Core {
    pub fn new(root: PathBuf, token: String) -> Self {
        Self {
            data_root: root.clone(),
            snow: Default::default(),
            databases: DatabasePool::new(root),
            connections: Default::default(),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("HTTP client"),
            token,
            model_keys: Default::default(),
            shutdown: tokio::sync::watch::channel(false).0,
            runtime: Default::default(),
            price_refresh: Default::default(),
        }
    }
}
struct Error(String);
impl From<String> for Error {
    fn from(v: String) -> Self {
        Self(v)
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error":self.0})),
        )
            .into_response()
    }
}
type ResultJson = Result<Json<Value>, Error>;
#[derive(Deserialize)]
struct Account {
    account: String,
}
#[derive(Deserialize)]
struct Page {
    account: String,
    chat: String,
    before: Option<i64>,
}
pub fn router(core: Core) -> Router {
    Router::new()
        .merge(crate::workspace::routes())
        .merge(crate::themes::routes())
        .merge(crate::harness::routes())
        .merge(crate::community::routes())
        .merge(crate::prices::routes())
        .merge(crate::snow::routes())
        .merge(crate::extensions::routes())
        .merge(crate::migration::routes())
        .route("/status", get(status))
        .route("/stats", get(stats))
        .route("/memory", get(read_memory).post(write_memory))
        .route("/memory/delete", post(delete_memory))
        .route("/accounts", get(accounts).post(add_account))
        .route("/chats", get(chats))
        .route("/messages", get(messages))
        .route("/onebot/connect", post(connect))
        .route("/onebot/disconnect", post(disconnect))
        .route("/onebot/send", post(send))
        .route("/model/config", get(get_model).post(save_model))
        .route("/model/chat", post(chat_model))
        .route("/preferences", get(preferences).post(save_preferences))
        .route("/shutdown", post(shutdown))
        .layer(middleware::from_fn_with_state(core.clone(), authenticate))
        .with_state(core)
}
async fn authenticate(State(core): State<Core>, request: Request, next: Next) -> Response {
    let authorized = request
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h == format!("Bearer {}", core.token));
    if !authorized || request.headers().contains_key("Origin") {
        return axum::http::StatusCode::UNAUTHORIZED.into_response();
    }
    next.run(request).await
}
async fn status(State(core): State<Core>) -> Json<Value> {
    Json(
        json!({"architecture":"Flutter + Rust","clean_release":cfg!(feature = "clean-release"),"connected_accounts":core.connections.status().await,"winefox":{"enabled":false,"available":false,"implementation":"undecided: Slint or native 3D"}}),
    )
}
async fn accounts(State(core): State<Core>) -> Json<Value> {
    Json(json!(core.databases.accounts()))
}
async fn add_account(State(core): State<Core>, Json(account): Json<Account>) -> ResultJson {
    core.databases.call(account.account, |_| Ok(())).await?;
    Ok(Json(json!({"ok":true})))
}
async fn chats(State(core): State<Core>, Query(account): Query<Account>) -> ResultJson {
    let items = core
        .databases
        .call(account.account, |s| {
            s.chats().map_err(|_| "读取会话失败".into())
        })
        .await?;
    Ok(Json(json!(items)))
}
async fn messages(State(core): State<Core>, Query(page): Query<Page>) -> ResultJson {
    let items = core
        .databases
        .call(page.account, move |s| {
            let rows = s
                .recent(&page.chat, page.before, 50)
                .map_err(|_| "读取消息失败")?;
            s.enrich_messages(json!(rows))
                .map_err(|_| "读取多媒体关联失败".into())
        })
        .await?;
    Ok(Json(json!(items)))
}
#[derive(Deserialize)]
struct Connect {
    account: String,
    address: String,
    #[serde(default)]
    access_token: String,
}
async fn connect(State(core): State<Core>, Json(s): Json<Connect>) -> ResultJson {
    core.databases.call(s.account.clone(), |_| Ok(())).await?;
    core.connections
        .connect(
            s.account.clone(),
            s.address.clone(),
            s.access_token.clone(),
            core.databases.clone(),
        )
        .await?;
    crate::workspace::set_key(&core.databases, &s.account, "onebot", &s.access_token).await?;
    crate::workspace::update(&core.databases, &s.account, move |cfg| {
        cfg["snowluma"]["wsUrl"] = json!(s.address);
        cfg["snowluma"]["autoConnect"] = json!(true);
        Ok(())
    })
    .await?;
    Ok(Json(json!({"ok":true})))
}
async fn disconnect(State(core): State<Core>, Json(account): Json<Account>) -> ResultJson {
    crate::workspace::update(&core.databases, &account.account, |cfg| {
        cfg["snowluma"]["autoConnect"] = json!(false);
        Ok(())
    })
    .await?;
    core.connections.disconnect(&account.account).await;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct SendMessage {
    account: String,
    chat: String,
    text: String,
}
async fn send(State(core): State<Core>, Json(m): Json<SendMessage>) -> ResultJson {
    let config = crate::workspace::load(&core.databases, &m.account).await?;
    crate::agent::send(&core, &m.account, &m.chat, &m.text, &config).await?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct ModelSave {
    account: String,
    config: ModelConfig,
    #[serde(default)]
    api_key: Option<String>,
}
async fn save_model(State(core): State<Core>, Json(s): Json<ModelSave>) -> ResultJson {
    if let Some(key) = s.api_key {
        core.model_keys.lock().await.insert(s.account.clone(), key);
    }
    let encoded = serde_json::to_string(&s.config).map_err(|_| Error("配置编码失败".into()))?;
    core.databases
        .call(s.account, move |store| {
            store
                .set_preference("model-config", &encoded)
                .map_err(|_| "保存配置失败".into())
        })
        .await?;
    Ok(Json(json!({"ok":true})))
}
async fn load_model(core: &Core, account: String) -> Result<ModelConfig, String> {
    let value = core
        .databases
        .call(account, |s| {
            s.preference("model-config")
                .map_err(|_| "读取配置失败".into())
        })
        .await?;
    match value {
        Some(value) => serde_json::from_str(&value).map_err(|_| "模型配置损坏".into()),
        None => Ok(ModelConfig::default()),
    }
}
async fn get_model(State(core): State<Core>, Query(account): Query<Account>) -> ResultJson {
    Ok(Json(json!(load_model(&core, account.account).await?)))
}
#[derive(Deserialize)]
struct MediaMessage {
    account: String,
    chat: String,
    text: String,
    #[serde(default)]
    images: Vec<String>,
}
async fn chat_model(State(core): State<Core>, Json(m): Json<MediaMessage>) -> ResultJson {
    if m.images.len() > 8 || m.images.iter().any(|s| s.len() > 4096) {
        return Err(Error("最多8张图片，每个 URL 最长4096字节".into()));
    }
    let workspace = crate::workspace::load(&core.databases, &m.account).await?;
    if workspace["api"]["model"]
        .as_str()
        .is_some_and(|m| !m.is_empty())
    {
        return Ok(Json(json!(
            crate::agent::run_media(&core, &m.account, &m.chat, &m.text, false, m.images).await?
        )));
    }
    if !m.images.is_empty() {
        return Err(Error("请先配置默认模型".into()));
    }
    let mut config = load_model(&core, m.account.clone()).await?;
    let memory_chat = m.chat.clone();
    let memories = core
        .databases
        .call(m.account.clone(), move |s| {
            s.memories(&memory_chat).map_err(|_| "读取记忆失败".into())
        })
        .await?;
    let memory_text: String = memories
        .iter()
        .rev()
        .map(|(_, text)| text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(8000)
        .collect();
    if !memory_text.is_empty() {
        config.system_prompt.push_str("\n会话记忆（供参考）：\n");
        config.system_prompt.push_str(&memory_text);
    }
    let key = core
        .model_keys
        .lock()
        .await
        .get(&m.account)
        .cloned()
        .unwrap_or_default();
    let chat = format!("model:{}", m.chat);
    let hchat = chat.clone();
    let mut history = core
        .databases
        .call(m.account.clone(), move |s| {
            s.recent(&hchat, None, 20)
                .map_err(|_| "读取上下文失败".into())
        })
        .await?;
    history.reverse();
    let mut remaining = 24000usize;
    let mut turns: Vec<Value> = history
        .iter()
        .rev()
        .filter_map(|m| {
            let length = m.text.chars().count();
            if length > remaining {
                return None;
            }
            remaining -= length;
            Some(json!({"role":if m.sender=="assistant"{"assistant"}else{"user"},"content":m.text}))
        })
        .collect();
    turns.reverse();
    turns.push(json!({"role":"user","content":m.text}));
    let answer = model::complete(&core.http, &config, &key, turns).await?;
    let usage_model = config.model.clone();
    let result = json!(answer);
    core.databases
        .call(m.account, move |s| {
            s.save_completion(&chat, &m.text, &usage_model, &answer, now())
                .map_err(|_| "保存会话与用量失败".to_string())
        })
        .await?;
    Ok(Json(result))
}
pub(crate) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
async fn preferences(State(core): State<Core>) -> ResultJson {
    let value = core
        .databases
        .call("local-settings".into(), |s| {
            s.preference("ui").map_err(|_| "读取偏好失败".into())
        })
        .await?;
    Ok(Json(
        value
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or(json!({"theme":"light","skin":"default"})),
    ))
}
async fn save_preferences(State(core): State<Core>, Json(mut value): Json<Value>) -> ResultJson {
    value["winefox_enabled"] = json!(false);
    core.databases
        .call("local-settings".into(), move |s| {
            s.set_preference("ui", &value.to_string())
                .map_err(|_| "保存偏好失败".into())
        })
        .await?;
    Ok(Json(json!({"ok":true})))
}
async fn shutdown(State(core): State<Core>) -> Json<Value> {
    let _ = core.shutdown.send(true);
    Json(json!({"ok":true}))
}

async fn stats(State(core): State<Core>, Query(account): Query<Account>) -> ResultJson {
    Ok(Json(
        core.databases
            .call(account.account, |s| {
                s.stats().map_err(|_| "读取用量失败".into())
            })
            .await?,
    ))
}
async fn read_memory(State(core): State<Core>, Query(page): Query<Page>) -> ResultJson {
    Ok(Json(json!(
        core.databases
            .call(page.account, move |s| s
                .memories(&page.chat)
                .map_err(|_| "读取记忆失败".into()))
            .await?
    )))
}
async fn write_memory(State(core): State<Core>, Json(m): Json<SendMessage>) -> ResultJson {
    if m.text.trim().is_empty() || m.text.chars().count() > 8000 {
        return Err(Error("记忆需为 1–8000 字符".into()));
    }
    core.databases
        .call(m.account, move |s| {
            s.remember(&m.chat, &m.text)
                .map_err(|_| "写入记忆失败".into())
        })
        .await?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct Forget {
    account: String,
    id: i64,
}
async fn delete_memory(State(core): State<Core>, Json(m): Json<Forget>) -> ResultJson {
    core.databases
        .call(m.account, move |s| {
            s.forget(m.id).map_err(|_| "删除记忆失败".into())
        })
        .await?;
    Ok(Json(json!({"ok":true})))
}
