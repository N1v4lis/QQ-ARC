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
const OFFICIAL_DOWNLOAD_URL: &str = "https://github.com/SnowLuma/SnowLuma/releases";
fn complete_directory(dir: &std::path::Path) -> bool {
    dir.is_dir() && dir.join("node.exe").is_file() && dir.join("index.mjs").is_file()
}
fn resolve_directory(cfg: &Value, application_dir: &std::path::Path) -> Result<PathBuf, String> {
    if let Some(dir) = cfg["snowluma"]["dir"]
        .as_str()
        .filter(|v| !v.trim().is_empty())
    {
        let dir = std::fs::canonicalize(dir).map_err(|_| "SnowLuma 目录不存在")?;
        if !complete_directory(&dir) {
            return Err(
                "请指定完整 SnowLuma Windows 发行目录，需包含 node.exe 和 index.mjs".into(),
            );
        }
        return Ok(dir);
    }
    // Discover a manually prepared component next to this app only. Never scan
    // the previous installation or copy its configuration, caches or accounts.
    for relative in ["components/snowluma", "snowluma"] {
        let candidate = application_dir.join(relative);
        if complete_directory(&candidate) {
            return std::fs::canonicalize(candidate).map_err(|_| "SnowLuma 目录不可用".into());
        }
    }
    Err("尚未准备 SnowLuma：请从官方发行页获取 Windows 完整版，解压后填写组件目录；本安装包未附带 SnowLuma".into())
}
fn directory(cfg: &Value) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| "无法定位 QQAF 程序目录")?;
    resolve_directory(cfg, exe.parent().ok_or("无法定位 QQAF 程序目录")?)
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
    let dir = match directory(&cfg) {
        Ok(dir) => dir,
        Err(message) => {
            return Ok(Json(
                json!({"available":false,"listening":false,"ownedPid":null,"message":message,"downloadUrl":OFFICIAL_DOWNLOAD_URL,"externalRuntime":true}),
            ));
        }
    };
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
        json!({"available":true,"directory":dir,"ownedPid":pid,"listening":listening,"webuiUrl":format!("http://127.0.0.1:{port}/"),"downloadUrl":OFFICIAL_DOWNLOAD_URL,"externalRuntime":true}),
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
        if q.repository.trim().is_empty() {
            "SnowLuma/SnowLuma"
        } else {
            q.repository.as_str()
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn missing_component_reports_unavailable_without_starting_a_process() {
        let root = std::env::temp_dir().join(format!("qqaf-snow-status-{}", uuid::Uuid::new_v4()));
        let core = Core::new(root.clone(), "fixture".into());
        let mut cfg = workspace::load(&core.databases, "123").await.unwrap();
        cfg["snowluma"]["dir"] = json!(root.join("not-installed"));
        workspace::store(&core.databases, "123", &cfg).await.unwrap();
        let Json(result) = status(
            State(core.clone()),
            Query(Account {
                account: "123".into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(result["available"], false);
        assert_eq!(result["listening"], false);
        assert!(result["webuiUrl"].is_null());
        assert_eq!(result["downloadUrl"], OFFICIAL_DOWNLOAD_URL);
        assert!(core.snow.children.lock().unwrap().is_empty());
        assert_eq!(
            workspace::load(&core.databases, "123").await.unwrap()["snowluma"]["dir"],
            cfg["snowluma"]["dir"]
        );
    }
    #[test]
    fn discovery_requires_complete_files_and_respects_explicit_directory() {
        let root =
            std::env::temp_dir().join(format!("qqaf-snow-discovery-{}", uuid::Uuid::new_v4()));
        let sibling = root.join("components/snowluma");
        std::fs::create_dir_all(&sibling).unwrap();
        assert!(resolve_directory(&json!({}), &root).is_err());
        std::fs::write(sibling.join("index.mjs"), "fixture only; never execute").unwrap();
        assert!(resolve_directory(&json!({}), &root).is_err());
        std::fs::write(sibling.join("node.exe"), "fixture only; never execute").unwrap();
        assert_eq!(
            resolve_directory(&json!({}), &root).unwrap(),
            std::fs::canonicalize(&sibling).unwrap()
        );
        let invalid = root.join("missing");
        assert!(resolve_directory(&json!({"snowluma":{"dir":invalid}}), &root).is_err());
        let explicit = root.join("explicit");
        std::fs::create_dir_all(&explicit).unwrap();
        std::fs::write(explicit.join("node.exe"), "fixture").unwrap();
        std::fs::write(explicit.join("index.mjs"), "fixture").unwrap();
        assert_eq!(
            resolve_directory(&json!({"snowluma":{"dir":explicit}}), &root).unwrap(),
            std::fs::canonicalize(&explicit).unwrap()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
