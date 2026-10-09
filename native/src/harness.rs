//! Explicitly configured external Agent/Harness execution; no shell command concatenation.
use crate::{core::Core, workspace};
use axum::{Json, Router, extract::State, routing::post};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{Read, Write};
use std::process::{Command, Stdio};
fn error(e: impl Into<String>) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::BAD_REQUEST,
        Json(json!({"error":e.into()})),
    )
}
pub fn routes() -> Router<Core> {
    Router::new().route("/harness/test", post(test))
}
#[derive(Deserialize)]
struct Test {
    account: String,
    id: String,
    prompt: String,
}
async fn test(
    State(core): State<Core>,
    Json(q): Json<Test>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let cfg = workspace::load(&core.databases, &q.account)
        .await
        .map_err(error)?;
    Ok(Json(execute(&cfg, &q.id, &q.prompt).await.map_err(error)?))
}
pub async fn execute(cfg: &Value, id: &str, prompt: &str) -> Result<Value, String> {
    let profile = cfg["harnesses"]
        .as_array()
        .and_then(|v| v.iter().find(|p| p["id"] == id))
        .ok_or("Harness 未配置")?
        .clone();
    if profile["enabled"] != true {
        return Err("Harness 尚未显式启用".into());
    }
    if prompt.is_empty() || prompt.len() > 64000 {
        return Err("Harness 输入长度无效".into());
    }
    let prompt = prompt.to_owned();
    tokio::task::spawn_blocking(move || run(&profile, &prompt))
        .await
        .map_err(|_| "Harness 任务失败")?
}
#[cfg(windows)]
mod process_tree {
    use std::ffi::c_void;
    #[repr(C)]
    struct Basic {
        per_process: i64,
        per_job: i64,
        flags: u32,
        min: usize,
        max: usize,
        active: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    struct Io {
        read_ops: u64,
        write_ops: u64,
        other_ops: u64,
        read_bytes: u64,
        write_bytes: u64,
        other_bytes: u64,
    }
    #[repr(C)]
    struct Extended {
        basic: Basic,
        io: Io,
        process_mem: usize,
        job_mem: usize,
        peak_process: usize,
        peak_job: usize,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> *mut c_void;
        fn SetInformationJobObject(
            job: *mut c_void,
            class: i32,
            info: *const c_void,
            size: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }
    pub struct Job(*mut c_void);
    impl Job {
        pub fn attach(child: &std::process::Child) -> Result<Self, String> {
            use std::os::windows::io::AsRawHandle;
            let handle = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
            if handle.is_null() {
                return Err("无法创建 Harness 进程组".into());
            }
            let job = Job(handle);
            let mut info: Extended = unsafe { std::mem::zeroed() };
            info.basic.flags = 0x2000;
            if unsafe {
                SetInformationJobObject(
                    handle,
                    9,
                    (&info as *const Extended).cast(),
                    std::mem::size_of::<Extended>() as u32,
                )
            } == 0
                || unsafe { AssignProcessToJobObject(handle, child.as_raw_handle().cast()) } == 0
            {
                return Err("无法隔离 Harness 子进程".into());
            }
            Ok(job)
        }
    }
    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}
fn run(profile: &Value, prompt: &str) -> Result<Value, String> {
    let file = profile["executable"]
        .as_str()
        .ok_or("请配置 Harness 可执行文件")?;
    let path = std::path::Path::new(file);
    if !path.is_absolute() || !path.is_file() {
        return Err("Harness 需要绝对可执行文件路径".into());
    }
    let mut command = Command::new(path);
    for arg in profile["args"]
        .as_array()
        .ok_or("Harness 参数须为数组")?
        .iter()
        .take(64)
    {
        let arg = arg.as_str().ok_or("Harness 参数须为文本")?;
        command.arg(arg.replace("{prompt}", prompt));
    }
    if let Some(folder) = profile["cwd"].as_str().filter(|s| !s.is_empty()) {
        if !std::path::Path::new(folder).is_absolute() || !std::path::Path::new(folder).is_dir() {
            return Err("Harness 工作目录无效".into());
        }
        command.current_dir(folder);
    }
    // Never allow child processes to use QQAF's privileged local IPC token.
    command
        .env_remove("QQAF_CORE_TOKEN")
        .env_remove("QQAF_CORE_EXECUTABLE")
        .env_remove("QQAF_NATIVE_DATA_DIR");
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|_| "Harness 进程启动失败")?;
    #[cfg(windows)]
    let tree = match process_tree::Job::attach(&child) {
        Ok(job) => job,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
    };
    let stdout = child.stdout.take().ok_or("无法读取 Harness 输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 Harness 错误")?;
    fn drain(mut reader: impl Read) -> std::io::Result<Vec<u8>> {
        let mut result = vec![];
        let mut buf = [0u8; 8192];
        loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            if result.len() < 2 * 1024 * 1024 {
                let left = 2 * 1024 * 1024 - result.len();
                result.extend_from_slice(&buf[..n.min(left)]);
            }
        }
        Ok(result)
    }
    let out = std::thread::spawn(move || drain(stdout));
    let err = std::thread::spawn(move || drain(stderr));
    if let Some(mut input) = child.stdin.take() {
        let data = if profile["stdin"] == true {
            prompt.as_bytes().to_vec()
        } else {
            vec![]
        };
        std::thread::spawn(move || {
            let _ = input.write_all(&data);
        });
    }
    let timeout = std::time::Duration::from_secs(
        profile["timeoutSeconds"]
            .as_u64()
            .unwrap_or(120)
            .clamp(1, 600),
    );
    let start = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "Harness 状态读取失败")? {
            break status;
        }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Harness 执行超时，已停止主进程".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    };
    #[cfg(windows)]
    drop(tree);
    let stdout = out
        .join()
        .map_err(|_| "Harness 输出读取失败")?
        .map_err(|_| "Harness 输出读取失败")?;
    let stderr = err
        .join()
        .map_err(|_| "Harness 输出读取失败")?
        .map_err(|_| "Harness 输出读取失败")?;
    Ok(
        json!({"ok":status.success(),"code":status.code(),"stdout":String::from_utf8_lossy(&stdout),"stderr":String::from_utf8_lossy(&stderr)}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn unconfigured_and_disabled_harnesses_cannot_run() {
        let cfg = json!({"harnesses":[{"id":"fixture","enabled":false,"executable":"missing","args":[]}]});
        assert!(
            execute(&cfg, "fixture", "hello")
                .await
                .unwrap_err()
                .contains("显式启用")
        );
        assert!(execute(&cfg, "other", "hello").await.is_err());
    }
}
