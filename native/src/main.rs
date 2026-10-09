#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use qqaf_native::{
    core::{Core, router},
    storage::default_data_root,
};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let token = std::env::var("QQAF_CORE_TOKEN")
        .map_err(|_| "QQAF_CORE_TOKEN required; start through Flutter launcher")?;
    if token.len() < 24 {
        return Err("Core token must have at least 24 characters".into());
    }
    let core = Core::new(default_data_root(), token);
    qqaf_native::agent::start(core.clone());
    qqaf_native::connections::supervise(core.clone());
    let mut shutdown = core.shutdown.subscribe();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    println!(
        "{}",
        serde_json::json!({"port":listener.local_addr()?.port()})
    );
    // Auto-launch SnowLuma for accounts that have opted in.
    let auto_core = core.clone();
    tokio::spawn(async move {
        for account in auto_core.databases.accounts() {
            let Ok(cfg) = qqaf_native::workspace::load(&auto_core.databases, &account).await
            else {
                continue;
            };
            if cfg["snowluma"]["autoLaunch"] == true {
                let child = auto_core.clone();
                let acct = account.clone();
                tokio::spawn(async move {
                    let _ = qqaf_native::snow::launch_for_account(&child, &acct).await;
                });
            }
        }
    });
    axum::serve(listener, router(core))
        .with_graceful_shutdown(async move {
            tokio::select! { _=tokio::signal::ctrl_c()=>{},_=shutdown.changed()=>{} }
        })
        .await?;
    Ok(())
}
