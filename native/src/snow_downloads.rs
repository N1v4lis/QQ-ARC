//! Fixed v1.14.22 official archive retrieval and user-requested installation. No scheduled updates.
use crate::{core::Core, network, workspace};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::watch,
};

const REPOSITORY: &str = "SnowLuma/SnowLuma";
const SUPPORTED_TAG: &str = "v1.14.22";
const MAX_ARCHIVE: u64 = 512 * 1024 * 1024;
const CACHE_KEY: &str = "snowluma-release-check";
const JOB_KEY: &str = "snowluma-download";
const COMPATIBILITY: &str = include_str!("../resources/snowluma-compatibility.json");

#[derive(Clone, Default)]
pub struct Manager {
    jobs: Arc<Mutex<HashMap<String, Transfer>>>,
    targets: Arc<Mutex<HashSet<PathBuf>>>,
}
#[derive(Clone)]
struct Transfer {
    job: Job,
    cancel: watch::Sender<bool>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Release {
    tag: String,
    name: String,
    url: String,
    published_at: String,
    asset_name: String,
    download_url: String,
    bytes: u64,
    sha256: String,
    compatibility: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String,
    tag: String,
    phase: String,
    received: u64,
    total: u64,
    sha256: String,
    path: Option<String>,
    error: Option<String>,
    install_directory: Option<String>,
    backup_directory: Option<String>,
}
impl Job {
    fn active(&self) -> bool {
        matches!(
            self.phase.as_str(),
            "downloading" | "verifying" | "installing"
        )
    }
}
#[derive(Deserialize)]
struct Account {
    account: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    account: String,
    #[serde(default = "pinned")]
    channel: String,
    #[serde(default)]
    expected_tag: Option<String>,
    #[serde(default)]
    directory: Option<String>,
}
fn pinned() -> String {
    "compatible".into()
}
type ResultJson = Result<Json<Value>, (axum::http::StatusCode, Json<Value>)>;
fn error(message: impl Into<String>) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::BAD_REQUEST,
        Json(json!({"error":message.into()})),
    )
}
fn manifest() -> Value {
    serde_json::from_str(COMPATIBILITY).expect("embedded compatibility manifest")
}
fn channel_tag(channel: &str) -> Result<String, String> {
    match channel {
        "compatible" | "pinned" => Ok(SUPPORTED_TAG.into()),
        _ => Err("当前只支持指定适配版本 v1.14.22，不跟随最新版".into()),
    }
}
fn valid_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 80
        && tag
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_'))
        && tag != "."
        && tag != ".."
}
fn official_host(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.host_str().is_some_and(|host| {
            matches!(host, "github.com" | "api.github.com")
                || host.ends_with(".githubusercontent.com")
        })
}
fn client(cfg: &Value) -> Result<reqwest::Client, String> {
    network::builder(cfg)?
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 8 || !official_host(attempt.url()) {
                attempt.error("非官方下载重定向")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "下载客户端配置失败".into())
}
fn parse_release(data: &Value, channel: &str) -> Result<Release, String> {
    if data["draft"] == true || data["prerelease"] == true {
        return Err("不自动下载草稿或预发布版".into());
    }
    let tag = data["tag_name"]
        .as_str()
        .filter(|s| valid_tag(s))
        .ok_or("官方版本号无效")?;
    if tag != SUPPORTED_TAG {
        return Err("官方返回了非指定适配版本".into());
    }
    let name = format!("SnowLuma-{tag}-win-x64.zip");
    let asset = data["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|a| a["name"] == name && a["state"] == "uploaded")
        })
        .ok_or("该发行版没有 Windows x64 完整包；不使用 Lite 包替代")?;
    let bytes = asset["size"]
        .as_u64()
        .filter(|n| *n > 0 && *n <= MAX_ARCHIVE)
        .ok_or("官方发行包大小无效或超限")?;
    let sha256 = asset["digest"]
        .as_str()
        .and_then(|s| s.strip_prefix("sha256:"))
        .filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        .ok_or("官方未提供有效 SHA-256，无法自动校验；请使用官方发行页")?
        .to_ascii_lowercase();
    let pinned_asset = manifest()["asset"].clone();
    if pinned_asset["sha256"] != sha256 || pinned_asset["bytes"] != bytes {
        return Err("官方包已变化，与本版 QQAF 适配记录不一致，请等待重新验收".into());
    }
    let download_url = asset["browser_download_url"]
        .as_str()
        .ok_or("缺少官方下载地址")?;
    let expected = format!("https://github.com/{REPOSITORY}/releases/download/{tag}/{name}");
    if download_url != expected {
        return Err("下载地址不属于指定官方仓库和版本".into());
    }
    if channel_tag(channel)? != tag {
        return Err("发行版与适配记录不一致".into());
    }
    let compatibility = if manifest()["validated"]
        .as_array()
        .is_some_and(|list| list.iter().any(|v| v["tag"] == tag))
    {
        "validated"
    } else {
        "targeted"
    };
    Ok(Release {
        tag: tag.into(),
        name: data["name"].as_str().unwrap_or(tag).into(),
        url: format!("https://github.com/{REPOSITORY}/releases/tag/{tag}"),
        published_at: data["published_at"].as_str().unwrap_or("").into(),
        asset_name: name,
        download_url: download_url.into(),
        bytes,
        sha256,
        compatibility: compatibility.into(),
    })
}
async fn read(core: &Core, account: &str, key: &'static str) -> Result<Value, String> {
    core.databases
        .call(account.into(), move |s| {
            let text = s.preference(key).map_err(|_| "读取下载记录失败")?;
            Ok(text
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(Value::Null))
        })
        .await
}
async fn write(core: &Core, account: &str, key: &'static str, value: Value) -> Result<(), String> {
    core.databases
        .call(account.into(), move |s| {
            s.set_preference(key, &value.to_string())
                .map_err(|_| "保存下载记录失败".into())
        })
        .await
}
async fn fetch_release(
    core: &Core,
    account: &str,
    cfg: &Value,
    channel: &str,
) -> Result<Release, String> {
    let tag = channel_tag(channel)?;
    let endpoint = format!("tags/{tag}");
    let response = client(cfg)?
        .get(format!(
            "https://api.github.com/repos/{REPOSITORY}/releases/{endpoint}"
        ))
        .timeout(Duration::from_secs(30))
        .header("User-Agent", "QQARCFOX")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "无法连接官方 GitHub，可检查代理后重试")?;
    if response.status() == reqwest::StatusCode::FORBIDDEN
        || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err("GitHub 请求限流，请稍后重试".into());
    }
    let release = parse_release(&network::json(response).await?, channel)?;
    write(
        core,
        account,
        CACHE_KEY,
        json!({"checkedAt":chrono::Utc::now().timestamp(),"channel":channel,"release":release}),
    )
    .await?;
    Ok(release)
}
pub fn routes() -> Router<Core> {
    Router::new()
        .route("/snow/releases", post(releases))
        .route("/snow/download/status", get(status))
        .route("/snow/download/start", post(start))
        .route("/snow/download/cancel", post(cancel))
        .route("/snow/install/plan", get(plan))
        .route("/snow/install", post(install))
}
async fn releases(State(core): State<Core>, Json(q): Json<Request>) -> ResultJson {
    let cfg = workspace::load(&core.databases, &q.account)
        .await
        .map_err(error)?;
    let release = fetch_release(&core, &q.account, &cfg, &q.channel)
        .await
        .map_err(error)?;
    Ok(Json(json!({"release":release,"compatibility":manifest()})))
}
async fn status(State(core): State<Core>, Query(q): Query<Account>) -> ResultJson {
    workspace::load(&core.databases, &q.account)
        .await
        .map_err(error)?;
    let live = core
        .snow_downloads
        .jobs
        .lock()
        .map_err(|_| error("下载状态锁失败"))?
        .get(&q.account)
        .map(|t| t.job.clone());
    let job = if let Some(job) = live {
        json!(job)
    } else {
        let mut job = read(&core, &q.account, JOB_KEY).await.map_err(error)?;
        if matches!(
            job["phase"].as_str(),
            Some("downloading" | "verifying" | "installing")
        ) {
            job["phase"] = json!("interrupted");
            job["error"] = json!("上次下载随程序退出而中断，请重新下载");
        }
        job
    };
    Ok(Json(
        json!({"job":job,"check":read(&core,&q.account,CACHE_KEY).await.map_err(error)?,"compatibility":manifest(),"automaticInstall":false}),
    ))
}
async fn start(State(core): State<Core>, Json(q): Json<Request>) -> ResultJson {
    let cfg = workspace::load(&core.databases, &q.account)
        .await
        .map_err(error)?;
    let release = fetch_release(&core, &q.account, &cfg, &q.channel)
        .await
        .map_err(error)?;
    if q.expected_tag.is_some_and(|tag| tag != release.tag) {
        return Err(error("官方版本已变化，请重新检查后下载"));
    }
    let job = start_transfer(core, &q.account, cfg, release, None)
        .await
        .map_err(error)?;
    Ok(Json(json!({"job":job,"automaticInstall":false})))
}
async fn cancel(State(core): State<Core>, Json(q): Json<Account>) -> ResultJson {
    workspace::load(&core.databases, &q.account)
        .await
        .map_err(error)?;
    let jobs = core
        .snow_downloads
        .jobs
        .lock()
        .map_err(|_| error("下载状态锁失败"))?;
    let transfer = jobs
        .get(&q.account)
        .ok_or_else(|| error("当前没有下载任务"))?;
    if transfer.job.active() {
        let _ = transfer.cancel.send(true);
    }
    Ok(Json(json!({"ok":true})))
}
fn progress(manager: &Manager, account: &str, id: &str, received: u64, phase: &str) {
    if let Ok(mut jobs) = manager.jobs.lock() {
        if let Some(t) = jobs.get_mut(account).filter(|t| t.job.id == id) {
            t.job.received = received;
            t.job.phase = phase.into();
        }
    }
}
async fn hash_file(path: &Path) -> Result<(u64, String), String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "无法读取已下载文件")?;
    let mut bytes = 0;
    let mut hash = Sha256::new();
    let mut chunk = [0u8; 65536];
    loop {
        let n = file
            .read(&mut chunk)
            .await
            .map_err(|_| "无法读取已下载文件")?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        if bytes > MAX_ARCHIVE {
            return Err("已下载文件超限".into());
        }
        hash.update(&chunk[..n]);
    }
    Ok((bytes, format!("{:x}", hash.finalize())))
}
async fn plan(State(core): State<Core>, Query(q): Query<Account>) -> ResultJson {
    let cfg = workspace::load(&core.databases, &q.account)
        .await
        .map_err(error)?;
    Ok(Json(
        json!({"defaultDirectory":crate::snow_install::default_directory().map_err(error)?,"configuredDirectory":cfg["snowluma"]["dir"],"component":crate::snow::component_info(&cfg,SUPPORTED_TAG),"compatibility":manifest()}),
    ))
}
async fn install(State(core): State<Core>, Json(q): Json<Request>) -> ResultJson {
    let cfg = workspace::load(&core.databases, &q.account)
        .await
        .map_err(error)?;
    let target = crate::snow_install::target_directory(q.directory.as_deref()).map_err(error)?;
    if target.exists() && crate::snow::folder_in_use(&target).await {
        return Err(error(
            "所选 SnowLuma 的 WebUI 仍在运行，请先停止组件再安装更新",
        ));
    }
    let release = fetch_release(&core, &q.account, &cfg, &q.channel)
        .await
        .map_err(error)?;
    if q.expected_tag.is_some_and(|tag| tag != release.tag) {
        return Err(error("官方版本已变化，请重新检查后安装"));
    }
    let job = start_transfer(core, &q.account, cfg, release, Some(target))
        .await
        .map_err(error)?;
    Ok(Json(json!({"job":job,"userRequestedInstall":true})))
}
fn install_key(target: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        return PathBuf::from(target.to_string_lossy().to_lowercase());
    }
    #[cfg(not(windows))]
    {
        target.to_path_buf()
    }
}
async fn start_transfer(
    core: Core,
    account: &str,
    cfg: Value,
    release: Release,
    install_target: Option<PathBuf>,
) -> Result<Job, String> {
    {
        let jobs = core
            .snow_downloads
            .jobs
            .lock()
            .map_err(|_| "下载状态锁失败")?;
        if jobs.get(account).is_some_and(|t| t.job.active()) {
            return Err("该账号已有下载或安装任务".into());
        }
    }
    let previous = read(&core, account, JOB_KEY).await?;
    let cached = if matches!(previous["phase"].as_str(), Some("completed" | "installed"))
        && previous["tag"] == release.tag
        && previous["sha256"] == release.sha256
    {
        if let Some(path) = previous["path"].as_str() {
            let expected_root = core
                .data_root
                .join("accounts")
                .join(account)
                .join("downloads/snowluma");
            if Path::new(path).starts_with(&expected_root)
                && hash_file(Path::new(path))
                    .await
                    .is_ok_and(|(n, hash)| n == release.bytes && hash == release.sha256)
            {
                Some(PathBuf::from(path))
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };
    if install_target.is_none() && cached.is_some() {
        return serde_json::from_value(previous).map_err(|_| "下载记录无效".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let job = Job {
        id: id.clone(),
        tag: release.tag.clone(),
        phase: if cached.is_some() {
            "installing"
        } else {
            "downloading"
        }
        .into(),
        received: if cached.is_some() { release.bytes } else { 0 },
        total: release.bytes,
        sha256: release.sha256.clone(),
        path: cached.as_ref().map(|p| p.to_string_lossy().into()),
        error: None,
        install_directory: install_target.as_ref().map(|p| p.to_string_lossy().into()),
        backup_directory: None,
    };
    let (stop, receiver) = watch::channel(false);
    {
        let mut jobs = core
            .snow_downloads
            .jobs
            .lock()
            .map_err(|_| "下载状态锁失败")?;
        if jobs.get(account).is_some_and(|t| t.job.active()) {
            return Err("该账号已有下载或安装任务".into());
        }
        if let Some(target) = &install_target {
            let mut targets = core
                .snow_downloads
                .targets
                .lock()
                .map_err(|_| "安装状态锁失败")?;
            if !targets.insert(install_key(target)) {
                return Err("其他账号正在安装到同一位置，请等待完成".into());
            }
        }
        jobs.insert(
            account.into(),
            Transfer {
                job: job.clone(),
                cancel: stop,
            },
        );
    }
    if let Err(e) = write(&core, account, JOB_KEY, json!(job)).await {
        core.snow_downloads
            .jobs
            .lock()
            .map_err(|_| "下载状态锁失败")?
            .remove(account);
        if let Some(target) = &install_target {
            core.snow_downloads
                .targets
                .lock()
                .map_err(|_| "安装状态锁失败")?
                .remove(&install_key(target));
        }
        return Err(e);
    }
    let account = account.to_string();
    let initial = job.clone();
    tokio::spawn(async move {
        let mut final_job = initial;
        let outcome = async {
            let path = if let Some(path) = cached {
                path
            } else {
                retrieve(&core, &account, &cfg, &release, &id, receiver.clone()).await?
            };
            final_job.path = Some(path.to_string_lossy().into());
            final_job.received = release.bytes;
            if let Some(target) = &install_target {
                if crate::snow::folder_in_use(target).await {
                    return Err("SnowLuma 在下载期间启动了，请先停止再重试安装".into());
                }
                progress(
                    &core.snow_downloads,
                    &account,
                    &id,
                    release.bytes,
                    "installing",
                );
                let target = target.clone();
                let tag = release.tag.clone();
                let digest = release.sha256.clone();
                let cancel = receiver.clone();
                let shutdown = core.shutdown.subscribe();
                let installed = tokio::task::spawn_blocking(move || {
                    crate::snow_install::install(&path, &target, &tag, &digest, || {
                        *cancel.borrow() || *shutdown.borrow()
                    })
                })
                .await
                .map_err(|_| "安装工作线程异常")??;
                final_job.install_directory = Some(installed.directory.to_string_lossy().into());
                final_job.backup_directory = installed.backup.map(|p| p.to_string_lossy().into());
                let directory = final_job.install_directory.clone().unwrap();
                if workspace::update(&core.databases, &account, move |cfg| {
                    cfg["snowluma"]["dir"] = json!(directory);
                    Ok(())
                })
                .await
                .is_err()
                {
                    final_job.error =
                        Some("安装完成，但账号组件目录保存失败；请手动保存所示目录".into());
                }
                final_job.phase = "installed".into();
            } else {
                final_job.phase = "completed".into();
            }
            Ok::<(), String>(())
        }
        .await;
        if let Err(e) = outcome {
            final_job.phase = if e == "下载已取消" {
                "cancelled"
            } else {
                "failed"
            }
            .into();
            final_job.error = Some(e);
        }
        // Persist completion before releasing reservations, so a new transfer
        // cannot have its durable record overwritten by this worker.
        let _ = write(&core, &account, JOB_KEY, json!(final_job)).await;
        if let Ok(mut jobs) = core.snow_downloads.jobs.lock() {
            if let Some(t) = jobs.get_mut(&account).filter(|t| t.job.id == id) {
                t.job = final_job;
            }
        }
        if let Some(target) = install_target {
            if let Ok(mut targets) = core.snow_downloads.targets.lock() {
                targets.remove(&install_key(&target));
            }
        }
    });
    Ok(job)
}
async fn retrieve(
    core: &Core,
    account: &str,
    cfg: &Value,
    release: &Release,
    id: &str,
    mut cancel: watch::Receiver<bool>,
) -> Result<PathBuf, String> {
    let mut shutdown = core.shutdown.subscribe();
    let folder = core
        .data_root
        .join("accounts")
        .join(account)
        .join("downloads/snowluma")
        .join(&release.tag)
        .join(id);
    tokio::fs::create_dir_all(&folder)
        .await
        .map_err(|_| "创建下载目录失败")?;
    let temporary = folder.join(format!("{}.part", release.asset_name));
    let output = folder.join(&release.asset_name);
    if *cancel.borrow() || *shutdown.borrow() {
        return Err("下载已取消".into());
    }
    let operation = async {
        let http = client(cfg)?;
        let response = http
            .get(&release.download_url)
            .header("User-Agent", "QQARCFOX")
            .send()
            .await
            .map_err(|_| "官方包下载失败，请检查代理后重试")?;
        stream_archive(response, &temporary, release, |n, phase| {
            progress(&core.snow_downloads, account, id, n, phase)
        })
        .await?;
        tokio::fs::rename(&temporary, &output)
            .await
            .map_err(|_| "保存校验后的发行包失败")?;
        Ok(output.clone())
    };
    let result = tokio::select! { biased; _=cancel.changed()=>Err("下载已取消".into()), _=shutdown.changed()=>Err("下载已取消".into()), result=operation=>result };
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}
async fn stream_archive(
    response: reqwest::Response,
    path: &Path,
    release: &Release,
    mut update: impl FnMut(u64, &str),
) -> Result<(), String> {
    if !response.status().is_success() {
        return Err(format!(
            "官方包下载失败：HTTP {}",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|n| n != release.bytes)
    {
        return Err("下载长度与官方元数据不一致".into());
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .await
        .map_err(|_| "创建临时下载文件失败")?;
    let mut stream = response.bytes_stream();
    let mut received = 0u64;
    let mut hash = Sha256::new();
    let mut last = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "下载中断，请重新下载")?;
        received += chunk.len() as u64;
        if received > release.bytes || received > MAX_ARCHIVE {
            return Err("下载内容超过官方大小限制".into());
        }
        hash.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|_| "写入下载文件失败，检查磁盘空间")?;
        if last.elapsed() >= Duration::from_millis(250) {
            update(received, "downloading");
            last = std::time::Instant::now();
        }
    }
    update(received, "verifying");
    if received != release.bytes {
        return Err("下载不完整，请重新下载".into());
    }
    if format!("{:x}", hash.finalize()) != release.sha256 {
        return Err("SHA-256 与官方记录不一致，文件未保留为可用发行包".into());
    }
    file.flush().await.map_err(|_| "下载文件刷新失败")?;
    file.sync_all().await.map_err(|_| "下载文件保存失败")?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn release(bytes: u64, sha256: &str) -> Release {
        Release {
            tag: "v-fixture".into(),
            name: "fixture".into(),
            url: String::new(),
            published_at: String::new(),
            asset_name: "fixture.zip".into(),
            download_url: String::new(),
            bytes,
            sha256: sha256.into(),
            compatibility: "unverified".into(),
        }
    }
    fn metadata() -> Value {
        json!({"tag_name":"v1.14.22","draft":false,"prerelease":false,"assets":[{"name":"SnowLuma-v1.14.22-win-x64.zip","state":"uploaded","size":37866010,"digest":"sha256:c8076ba2fbcdc19afeb8e8bf9b2956eaab3605e5fa4618c4db702749ae501681","browser_download_url":"https://github.com/SnowLuma/SnowLuma/releases/download/v1.14.22/SnowLuma-v1.14.22-win-x64.zip"}]})
    }
    #[test]
    fn release_selection_requires_official_complete_verified_asset() {
        let good = metadata();
        assert_eq!(
            parse_release(&good, "compatible").unwrap().compatibility,
            "targeted"
        );
        let mut bad = good.clone();
        bad["assets"][0]["name"] = json!("SnowLuma-v1.14.22-win-x64-lite.zip");
        assert!(parse_release(&bad, "compatible").is_err());
        let mut bad = good.clone();
        bad["assets"][0]["digest"] = Value::Null;
        assert!(parse_release(&bad, "compatible").is_err());
        let mut bad = good.clone();
        bad["assets"][0]["browser_download_url"] = json!("https://untrusted.invalid/file.zip");
        assert!(parse_release(&bad, "compatible").is_err());
        let mut bad = good.clone();
        bad["tag_name"] = json!("../escape");
        assert!(parse_release(&bad, "compatible").is_err());
        let mut bad = good.clone();
        bad["prerelease"] = json!(true);
        assert!(parse_release(&bad, "compatible").is_err());
        assert_eq!(channel_tag("compatible").unwrap(), SUPPORTED_TAG);
        assert!(channel_tag("latest").is_err());
        assert!(channel_tag("arbitrary/tag").is_err());
        assert!(!official_host(
            &reqwest::Url::parse("https://github.com.attacker.invalid/foo").unwrap()
        ));
    }
    async fn server(payload: Vec<u8>) -> (String, tokio::task::JoinHandle<()>) {
        use axum::{body::Body, http::Response};
        let app = Router::new().route(
            "/asset",
            get(move || {
                let p = payload.clone();
                async move { Response::builder().body(Body::from(p)).unwrap() }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/asset", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (url, task)
    }
    #[tokio::test]
    async fn streamed_archive_matches_size_and_digest_without_buffering_the_package() {
        let payload = b"fixture official zip bytes".to_vec();
        let (url, server) = server(payload.clone()).await;
        let root = std::env::temp_dir().join(format!("qqaf-snow-stream-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let path = root.join("fixture.part");
        let expected = release(
            payload.len() as u64,
            &format!("{:x}", Sha256::digest(&payload)),
        );
        let response = reqwest::get(&url).await.unwrap();
        stream_archive(response, &path, &expected, |_, _| {})
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(&path).await.unwrap(), payload);
        let mut invalid = expected.clone();
        invalid.sha256 = "0".repeat(64);
        assert!(
            stream_archive(
                reqwest::get(&url).await.unwrap(),
                &root.join("invalid.part"),
                &invalid,
                |_, _| {}
            )
            .await
            .is_err()
        );
        server.abort();
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
    #[tokio::test]
    async fn cancelled_download_and_digest_failure_leave_no_available_archive() {
        let (url, server) = server(b"fixture".to_vec()).await;
        let root = std::env::temp_dir().join(format!("qqaf-snow-cancel-{}", uuid::Uuid::new_v4()));
        let core = Core::new(root.clone(), "fixture".into());
        let mut asset = release(7, &"0".repeat(64));
        asset.download_url = url;
        let (cancel, receiver) = watch::channel(false);
        cancel.send(true).unwrap();
        assert_eq!(
            retrieve(
                &core,
                "123",
                &workspace::defaults(),
                &asset,
                "cancelled",
                receiver
            )
            .await
            .unwrap_err(),
            "下载已取消"
        );
        let (_cancel, receiver) = watch::channel(false);
        assert!(
            retrieve(
                &core,
                "123",
                &workspace::defaults(),
                &asset,
                "bad-digest",
                receiver
            )
            .await
            .is_err()
        );
        let failed = root.join("accounts/123/downloads/snowluma/v-fixture/bad-digest");
        assert!(!failed.join("fixture.zip").exists());
        assert!(!failed.join("fixture.zip.part").exists());
        server.abort();
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
