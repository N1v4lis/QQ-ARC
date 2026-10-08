//! Own only explicitly launched external SnowLuma processes. Its bundled runtime
//! belongs to the OneBot component, not the QQAF business core.
use crate::{core::Core, network, workspace};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};
#[derive(Clone, Default)]
pub struct Manager {
    children: Arc<Mutex<HashMap<PathBuf, Child>>>,
}
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
fn directory(cfg: &Value) -> Result<PathBuf, String> {
    let dir = cfg["snowluma"]["dir"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or("请填写 SnowLuma 目录")?;
    let dir = std::fs::canonicalize(dir).map_err(|_| "SnowLuma 目录不存在")?;
    if !dir.is_dir() {
        return Err("SnowLuma 路径不是目录".into());
    }
    Ok(dir)
}
fn port(dir: &std::path::Path) -> u16 {
    let file = dir.join("config/runtime.json");
    if std::fs::metadata(&file).is_ok_and(|m| m.len() < 1024 * 1024) {
        if let Ok(value) = std::fs::read(file)
            .and_then(|b| serde_json::from_slice::<Value>(&b).map_err(std::io::Error::other))
        {
            if let Some(port) = value["webuiPort"]
                .as_u64()
                .filter(|v| *v > 0 && *v <= 65535)
            {
                return port as u16;
            }
        }
    }
    5099
}
async fn listening(port: u16) -> bool {
    tokio::time::timeout(
        std::time::Duration::from_millis(500),
        tokio::net::TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    .is_ok_and(|v| v.is_ok())
}
pub fn routes() -> Router<Core> {
    Router::new()
        .route("/snow/status", get(status))
        .route("/snow/launch", post(launch))
        .route("/snow/stop", post(stop))
        .route("/snow/logs", get(logs))
        .route("/updates/check", post(update))
}
async fn status(State(core): State<Core>, Query(a): Query<Account>) -> ResultJson {
    let cfg = workspace::load(&core.databases, &a.account)
        .await
        .map_err(error)?;
    let dir = directory(&cfg).map_err(error)?;
    let port = port(&dir);
    let listening = listening(port).await;
    let mut children = core.snow.children.lock().map_err(|_| error("进程锁失败"))?;
    let pid = children.get_mut(&dir).and_then(|c| {
        if c.try_wait().ok().flatten().is_none() {
            Some(c.id())
        } else {
            None
        }
    });
    Ok(Json(
        json!({"ownedPid":pid,"listening":listening,"webuiUrl":format!("http://127.0.0.1:{port}/"),"externalRuntime":true}),
    ))
}
async fn launch(State(core): State<Core>, Json(a): Json<Account>) -> ResultJson {
    let cfg = workspace::load(&core.databases, &a.account)
        .await
        .map_err(error)?;
    let dir = directory(&cfg).map_err(error)?;
    if listening(port(&dir)).await {
        return Ok(Json(json!({"ok":true,"alreadyRunning":true,"owned":false})));
    }
    let node = dir.join("node.exe");
    let entry = dir.join("index.mjs");
    if !node.is_file() || !entry.is_file() {
        return Err(error("目录需包含 SnowLuma 的 node.exe 和 index.mjs"));
    }
    let mut children = core.snow.children.lock().map_err(|_| error("进程锁失败"))?;
    if let Some(child) = children.get_mut(&dir) {
        if child.try_wait().ok().flatten().is_none() {
            return Ok(Json(
                json!({"ok":true,"alreadyRunning":true,"pid":child.id()}),
            ));
        }
    }
    let logs = core
        .data_root
        .join("accounts")
        .join(&a.account)
        .join("snowluma.log");
    std::fs::create_dir_all(logs.parent().unwrap()).map_err(|_| error("日志目录创建失败"))?;
    let output = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&logs)
        .map_err(|_| error("日志打开失败"))?;
    let mut command = Command::new(node);
    command
        .arg(entry)
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(
            output.try_clone().map_err(|_| error("日志打开失败"))?,
        ))
        .stderr(Stdio::from(output));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn().map_err(|_| error("SnowLuma 启动失败"))?;
    let pid = child.id();
    children.insert(dir, child);
    Ok(Json(json!({"ok":true,"pid":pid,"owned":true})))
}
async fn stop(State(core): State<Core>, Json(a): Json<Account>) -> ResultJson {
    let cfg = workspace::load(&core.databases, &a.account)
        .await
        .map_err(error)?;
    let dir = directory(&cfg).map_err(error)?;
    let mut children = core.snow.children.lock().map_err(|_| error("进程锁失败"))?;
    let child = children
        .get_mut(&dir)
        .ok_or_else(|| error("只能停止本次 QQAF 启动的 SnowLuma"))?;
    if child
        .try_wait()
        .map_err(|_| error("读取进程状态失败"))?
        .is_none()
    {
        child.kill().map_err(|_| error("停止失败"))?;
        let _ = child.wait();
    }
    children.remove(&dir);
    Ok(Json(json!({"ok":true})))
}
async fn logs(State(core): State<Core>, Query(a): Query<Account>) -> ResultJson {
    // Validate the account before constructing a local file path.
    workspace::load(&core.databases, &a.account)
        .await
        .map_err(error)?;
    let file = core
        .data_root
        .join("accounts")
        .join(&a.account)
        .join("snowluma.log");
    let text = if let Ok(mut f) = std::fs::File::open(file) {
        let len = f.metadata().map_err(|_| error("日志读取失败"))?.len();
        let _ = f.seek(SeekFrom::Start(len.saturating_sub(65536)));
        let mut bytes = Vec::new();
        f.take(65536)
            .read_to_end(&mut bytes)
            .map_err(|_| error("日志读取失败"))?;
        String::from_utf8_lossy(&bytes).into_owned()
    } else {
        String::new()
    };
    Ok(Json(json!({"text":text})))
}
#[derive(Deserialize)]
struct Update {
    account: String,
    component: String,
    #[serde(default)]
    repository: String,
}
async fn update(State(core): State<Core>, Json(q): Json<Update>) -> ResultJson {
    let repo = if q.component == "qqaf" {
        "N1v4lis/QQARCFOX"
    } else if q.component == "snowluma" {
        q.repository.as_str()
    } else {
        return Err(error("组件无效"));
    };
    let pieces: Vec<_> = repo.split('/').collect();
    if pieces.len() != 2
        || pieces.iter().any(|p| {
            p.is_empty()
                || !p
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        })
    {
        return Err(error("请填写 owner/repository 格式的 GitHub 来源"));
    }
    let cfg = workspace::load(&core.databases, &q.account)
        .await
        .map_err(error)?;
    let response = network::client(&cfg)
        .map_err(error)?
        .get(format!(
            "https://api.github.com/repos/{repo}/releases/latest"
        ))
        .header("User-Agent", "QQARCFOX-experimental")
        .send()
        .await
        .map_err(|_| error("GitHub 连接失败"))?;
    let data = network::json(response).await.map_err(error)?;
    Ok(Json(
        json!({"tag":data["tag_name"],"name":data["name"],"url":data["html_url"],"publishedAt":data["published_at"],"notes":data["body"],"assets":data["assets"],"installed":if q.component=="qqaf"{env!("CARGO_PKG_VERSION")}else{"unknown"},"experimental":true,"automaticInstall":false}),
    ))
}
