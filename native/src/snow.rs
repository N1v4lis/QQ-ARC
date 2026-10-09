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
    qq_children: Arc<Mutex<HashMap<String, Child>>>,
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
    // Accept both full (has node.exe) and lite (no node.exe) installs; only index.mjs is required.
    dir.is_dir() && dir.join("index.mjs").is_file()
}
fn resolve_directory(cfg: &Value, application_dir: &std::path::Path) -> Result<PathBuf, String> {
    if let Some(dir) = cfg["snowluma"]["dir"]
        .as_str()
        .filter(|v| !v.trim().is_empty())
    {
        let dir = std::fs::canonicalize(dir).map_err(|_| "SnowLuma 目录不存在")?;
        if !complete_directory(&dir) {
            return Err(
                "请指定完整 SnowLuma 发行目录，需包含 index.mjs（Lite 包需系统安装 Node.js 22.13+）".into(),
            );
        }
        return Ok(dir);
    }
    // Discover a manually prepared component next to this app only. Never scan
    // the previous installation or copy its configuration, caches or accounts.
    for relative in ["Snowluma", "components/snowluma", "snowluma"] {
        let candidate = application_dir.join(relative);
        if complete_directory(&candidate) {
            return std::fs::canonicalize(candidate).map_err(|_| "SnowLuma 目录不可用".into());
        }
    }
    Err("尚未准备 SnowLuma：请从官方发行页获取发行包，解压后填写组件目录；本安装包未附带 SnowLuma".into())
}

/// Resolve the Node.js executable: prefer bundled node.exe, fall back to system PATH.
fn find_node(dir: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let bundled = dir.join("node.exe");
    if bundled.is_file() {
        return Ok(bundled);
    }
    // Lite package: find node in system PATH via `where node`.
    let output = std::process::Command::new("where")
        .arg("node")
        .output()
        .map_err(|_| "Lite 包需要系统安装 Node.js 22.13+ 或 23.4+，但 where 命令失败".to_string())?;
    if output.status.success() {
        let path_str = std::str::from_utf8(&output.stdout)
            .unwrap_or("")
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        if !path_str.is_empty() {
            return Ok(std::path::PathBuf::from(path_str));
        }
    }
    Err("Lite 包需要系统安装 Node.js 22.13+ 或 23.4+，未在 PATH 中找到 node.exe".into())
}

/// Ensure {snow_dir}/config/runtime.json exists with at minimum {"webuiPort": 5099}.
/// If the file already exists it is left untouched.
fn ensure_runtime_config(dir: &std::path::Path) {
    let config_dir = dir.join("config");
    let config_file = config_dir.join("runtime.json");
    if config_file.exists() {
        return;
    }
    if std::fs::create_dir_all(&config_dir).is_ok() {
        let _ = std::fs::write(
            &config_file,
            serde_json::to_vec_pretty(&serde_json::json!({"webuiPort": 5099})).unwrap(),
        );
    }
}
fn directory(cfg: &Value) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| "无法定位 QQAF 程序目录")?;
    resolve_directory(cfg, exe.parent().ok_or("无法定位 QQAF 程序目录")?)
}
fn version_number(value: &str) -> Option<[u64; 3]> {
    let parts = value
        .trim_start_matches('v')
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    parts.try_into().ok()
}
pub(crate) fn component_info(cfg: &Value, target: &str) -> Value {
    let dir = match directory(cfg) {
        Ok(dir) => dir,
        Err(message) => {
            return json!({"available":false,"targetVersion":target,"updateAvailable":false,"message":message});
        }
    };
    let read = |name: &str| -> Option<Value> {
        let file = dir.join(name);
        if !std::fs::metadata(&file).is_ok_and(|m| m.len() < 262144) {
            return None;
        }
        serde_json::from_slice(&std::fs::read(file).ok()?).ok()
    };
    let package = read("package.json");
    let marker = read("qqaf-component.json");
    let version = package
        .as_ref()
        .and_then(|p| p["version"].as_str())
        .or_else(|| marker.as_ref().and_then(|p| p["version"].as_str()));
    let old = version.and_then(version_number);
    let wanted = version_number(target);
    json!({"available":true,"directory":dir,"installedVersion":version,"targetVersion":target,"updateAvailable":old.zip(wanted).is_some_and(|(old,wanted)|old<wanted),"matchesTarget":old.zip(wanted).is_some_and(|(old,wanted)|old==wanted),"newerInstalled":old.zip(wanted).is_some_and(|(old,wanted)|old>wanted)})
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
pub(crate) async fn folder_in_use(dir: &std::path::Path) -> bool {
    listening(port(dir)).await
}
pub fn routes() -> Router<Core> {
    Router::new()
        .route("/snow/status", get(status))
        .route("/snow/launch", post(launch))
        .route("/snow/stop", post(stop))
        .route("/snow/logs", get(logs))
        .route("/snow/open-folder", post(open_folder))
        .route("/qq-portable/launch", post(qq_launch))
        .route("/qq-portable/stop", post(qq_stop))
        .route("/qq-portable/logs", get(qq_logs))
        .route("/qq-portable/status", get(qq_status))
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
    let entry = dir.join("index.mjs");
    if !entry.is_file() {
        return Err(error("目录需包含 SnowLuma 的 index.mjs"));
    }
    let node = find_node(&dir).map_err(error)?;
    // Ensure SnowLuma config exists so its OneBot WS server can start.
    ensure_runtime_config(&dir);
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
        .env(
            "NODE_COMPILE_CACHE",
            dir.join("data").join(".arcfox-compile-cache"),
        )
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
async fn open_folder(State(core): State<Core>, Json(a): Json<Account>) -> ResultJson {
    let cfg = workspace::load(&core.databases, &a.account)
        .await
        .map_err(error)?;
    let dir = directory(&cfg).map_err(error)?;
    #[cfg(windows)]
    std::process::Command::new("explorer.exe")
        .arg(&dir)
        .spawn()
        .map_err(|_| error("打开目录失败"))?;
    Ok(Json(json!({"ok":true})))
}

fn find_qq_exe(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    for name in ["QQ.exe", "qq.exe"] {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.filter_map(Result::ok) {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("exe")) == Some(true) {
                return Some(p);
            }
        }
    }
    None
}

fn qq_portable_dir(cfg: &Value) -> Result<std::path::PathBuf, String> {
    let dir = cfg["qqPortable"]["dir"]
        .as_str()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| "未设置便携 QQ 目录".to_string())?;
    let path = std::path::PathBuf::from(dir);
    if !path.is_dir() {
        return Err("便携 QQ 目录不存在".into());
    }
    Ok(path)
}

async fn qq_launch(State(core): State<Core>, Json(a): Json<Account>) -> ResultJson {
    let cfg = workspace::load(&core.databases, &a.account)
        .await
        .map_err(error)?;
    let dir = qq_portable_dir(&cfg).map_err(|e| error(e))?;
    let exe = find_qq_exe(&dir).ok_or_else(|| error("在便携 QQ 目录中未找到可执行文件"))?;
    let mut children = core.snow.qq_children.lock().map_err(|_| error("进程锁失败"))?;
    if let Some(child) = children.get_mut(&a.account) {
        if child.try_wait().ok().flatten().is_none() {
            return Ok(Json(json!({"ok":true,"alreadyRunning":true,"pid":child.id()})));
        }
    }
    let log_path = core
        .data_root
        .join("accounts")
        .join(&a.account)
        .join("qq-portable.log");
    std::fs::create_dir_all(log_path.parent().unwrap()).map_err(|_| error("日志目录创建失败"))?;
    let output = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|_| error("日志打开失败"))?;
    let mut command = std::process::Command::new(&exe);
    command
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(output.try_clone().map_err(|_| error("日志打开失败"))?))
        .stderr(Stdio::from(output));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn().map_err(|_| error("便携 QQ 启动失败"))?;
    let pid = child.id();
    children.insert(a.account, child);
    Ok(Json(json!({"ok":true,"pid":pid})))
}

async fn qq_stop(State(core): State<Core>, Json(a): Json<Account>) -> ResultJson {
    let mut children = core.snow.qq_children.lock().map_err(|_| error("进程锁失败"))?;
    if let Some(mut child) = children.remove(&a.account) {
        if child.try_wait().ok().flatten().is_none() {
            child.kill().map_err(|_| error("停止失败"))?;
            let _ = child.wait();
        }
    }
    Ok(Json(json!({"ok":true})))
}

async fn qq_logs(State(core): State<Core>, Query(a): Query<Account>) -> ResultJson {
    workspace::load(&core.databases, &a.account)
        .await
        .map_err(error)?;
    let file = core
        .data_root
        .join("accounts")
        .join(&a.account)
        .join("qq-portable.log");
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

async fn qq_status(State(core): State<Core>, Query(a): Query<Account>) -> ResultJson {
    let cfg = workspace::load(&core.databases, &a.account)
        .await
        .map_err(error)?;
    let dir_result = qq_portable_dir(&cfg);
    let dir_str = dir_result
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ready = dir_result.as_ref().map(|d| find_qq_exe(d).is_some()).unwrap_or(false);
    let mut children = core.snow.qq_children.lock().map_err(|_| error("进程锁失败"))?;
    let (running, pid) = if let Some(child) = children.get_mut(&a.account) {
        if child.try_wait().ok().flatten().is_none() {
            (true, Some(child.id()))
        } else {
            (false, None)
        }
    } else {
        (false, None)
    };
    Ok(Json(json!({"ready":ready,"running":running,"pid":pid,"dir":dir_str})))
}

pub async fn snow_account_status(core: &Core, account: &str) -> Value {
    let cfg = match workspace::load(&core.databases, account).await {
        Ok(c) => c,
        Err(e) => {
            return json!({"available":false,"listening":false,"ownedPid":null,"running":false,"pid":null,"dir":"","webuiUrl":"","message":e});
        }
    };
    let dir = match directory(&cfg) {
        Ok(d) => d,
        Err(message) => {
            return json!({"available":false,"listening":false,"ownedPid":null,"running":false,"pid":null,"dir":"","webuiUrl":"","embedded":false,"message":message});
        }
    };
    let p = port(&dir);
    let is_listening = listening(p).await;
    let dir_str = dir.to_string_lossy().into_owned();
    let webui = format!("http://127.0.0.1:{p}/");
    let pid = match core.snow.children.lock() {
        Ok(mut children) => children.get_mut(&dir).and_then(|c| {
            if c.try_wait().ok().flatten().is_none() { Some(c.id()) } else { None }
        }),
        Err(_) => None,
    };
    json!({
        "available": true,
        "running": pid.is_some(),
        "pid": pid,
        "ownedPid": pid,
        "dir": dir_str,
        "webuiUrl": webui,
        "listening": is_listening,
        "embedded": false
    })
}

pub async fn qq_portable_account_status(core: &Core, account: &str) -> Value {
    let cfg = match workspace::load(&core.databases, account).await {
        Ok(c) => c,
        Err(_) => return json!({"ready":false,"running":false,"pid":null,"dir":""}),
    };
    let dir_result = qq_portable_dir(&cfg);
    let dir_str = dir_result
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ready = dir_result.as_ref().map(|d| find_qq_exe(d).is_some()).unwrap_or(false);
    let (running, pid) = match core.snow.qq_children.lock() {
        Ok(mut children) => {
            if let Some(child) = children.get_mut(account) {
                if child.try_wait().ok().flatten().is_none() {
                    (true, Some(child.id()))
                } else {
                    (false, None)
                }
            } else {
                (false, None)
            }
        }
        Err(_) => (false, None),
    };
    json!({"ready":ready,"running":running,"pid":pid,"dir":dir_str})
}

pub async fn launch_for_account(core: &Core, account: &str) -> Result<(), String> {
    let cfg = workspace::load(&core.databases, account).await?;
    let dir = directory(&cfg)?;
    if listening(port(&dir)).await {
        return Ok(());
    }
    let entry = dir.join("index.mjs");
    if !entry.is_file() {
        return Err("SnowLuma 组件不完整：缺少 index.mjs".into());
    }
    let node = find_node(&dir)?;
    ensure_runtime_config(&dir);
    let mut children = core
        .snow
        .children
        .lock()
        .map_err(|_| "进程锁失败".to_string())?;
    if let Some(child) = children.get_mut(&dir) {
        if child.try_wait().ok().flatten().is_none() {
            return Ok(());
        }
    }
    let logs = core
        .data_root
        .join("accounts")
        .join(account)
        .join("snowluma.log");
    std::fs::create_dir_all(logs.parent().unwrap()).map_err(|_| "日志目录创建失败")?;
    let output = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&logs)
        .map_err(|_| "日志打开失败")?;
    let mut command = Command::new(node);
    command
        .arg(entry)
        .current_dir(&dir)
        .env(
            "NODE_COMPILE_CACHE",
            dir.join("data").join(".arcfox-compile-cache"),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::from(
            output.try_clone().map_err(|_| "日志打开失败")?,
        ))
        .stderr(Stdio::from(output));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn().map_err(|_| "SnowLuma 启动失败")?;
    children.insert(dir, child);
    Ok(())
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
        workspace::store(&core.databases, "123", &cfg)
            .await
            .unwrap();
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
        // Empty directory: must fail.
        assert!(resolve_directory(&json!({}), &root).is_err());
        // index.mjs alone is sufficient (lite package without bundled node.exe).
        std::fs::write(sibling.join("index.mjs"), "fixture only; never execute").unwrap();
        assert_eq!(
            resolve_directory(&json!({}), &root).unwrap(),
            std::fs::canonicalize(&sibling).unwrap()
        );
        // Adding node.exe (full package) still resolves correctly.
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
        // Explicit directory with only index.mjs (lite) is also accepted.
        let explicit_lite = root.join("explicit-lite");
        std::fs::create_dir_all(&explicit_lite).unwrap();
        std::fs::write(explicit_lite.join("index.mjs"), "fixture").unwrap();
        assert_eq!(
            resolve_directory(&json!({"snowluma":{"dir":explicit_lite}}), &root).unwrap(),
            std::fs::canonicalize(&explicit_lite).unwrap()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod version_tests {
    use super::*;
    #[test]
    fn installed_version_only_prompts_when_lower_than_the_adapted_target() {
        let root = std::env::temp_dir().join(format!("qqaf-snow-version-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("node.exe"), "fixture never execute").unwrap();
        std::fs::write(root.join("index.mjs"), "fixture never execute").unwrap();
        let cfg = json!({"snowluma":{"dir":root}});
        for (version, update, newer) in [
            ("1.14.19", true, false),
            ("1.14.22", false, false),
            ("1.15.0", false, true),
            ("invalid", false, false),
        ] {
            std::fs::write(
                root.join("package.json"),
                json!({"version":version}).to_string(),
            )
            .unwrap();
            let info = component_info(&cfg, "v1.14.22");
            assert_eq!(info["updateAvailable"], update);
            assert_eq!(info["newerInstalled"], newer);
        }
        std::fs::write(
            root.join("package.json"),
            json!({"version":"1.14.22"}).to_string(),
        )
        .unwrap();
        assert_eq!(component_info(&cfg, "v1.14.23")["updateAvailable"], true);
        std::fs::remove_dir_all(root).unwrap();
    }
}
