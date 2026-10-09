use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use qqaf_native::{
    agent,
    core::{Core, DatabasePool, router},
    onebot::IncomingMessage,
    prices, workspace,
};
use serde_json::{Value, json};
use tower::ServiceExt;

fn root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("qqaf-workspace-{}", uuid::Uuid::new_v4()))
}
async fn request(core: &Core, path: &str, body: Value) -> (u16, Value) {
    let response = router(core.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("Authorization", "Bearer fixture")
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let value = serde_json::from_slice(
        &to_bytes(response.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    (status, value)
}
#[tokio::test]
async fn concurrent_page_saves_do_not_overwrite_each_other_or_other_accounts() {
    let core = Core::new(root(), "fixture".into());
    let (a, b) = tokio::join!(
        request(
            &core,
            "/config",
            json!({"account":"123","patch":{"api":{"model":"fixture-model"}}})
        ),
        request(
            &core,
            "/config",
            json!({"account":"123","patch":{"store":{"historyCount":17}}})
        )
    );
    assert_eq!(a.0, 200);
    assert_eq!(b.0, 200);
    let cfg = workspace::load(&core.databases, "123").await.unwrap();
    assert_eq!(cfg["api"]["model"], "fixture-model");
    assert_eq!(cfg["store"]["historyCount"], 17);
    assert_ne!(
        workspace::load(&core.databases, "456").await.unwrap()["api"]["model"],
        "fixture-model"
    );
    assert_eq!(
        request(
            &core,
            "/config",
            json!({"account":"123","patch":{"api":{"apiKey":"never-save-plain"}}})
        )
        .await
        .0,
        400
    );
    assert_eq!(
        request(
            &core,
            "/config",
            json!({"account":"123","patch":{"store":{"historyCount":-1}}})
        )
        .await
        .0,
        400
    );
    assert_eq!(
        workspace::load(&core.databases, "123").await.unwrap()["store"]["historyCount"],
        17
    );
}
#[tokio::test]
async fn persona_section_save_preserves_other_drafts_and_builtin_policy() {
    let core = Core::new(root(), "fixture".into());
    let base = json!({"account":"123","target":"group:8","section":"identity","value":{"botName":"fixture","roleText":"unsaved","templateRef":{"builtin":false,"id":"custom"}}});
    assert_eq!(request(&core, "/persona", base).await.0, 200);
    let cfg = workspace::load(&core.databases, "123").await.unwrap();
    assert_eq!(cfg["personaByChat"]["group:8"]["botName"], "fixture");
    assert!(cfg["personaByChat"]["group:8"].get("roleText").is_none());
    assert_eq!(request(&core,"/persona",json!({"account":"123","target":"group:8","section":"body","value":{"roleText":"saved","botName":"ignored"}})).await.0,200);
    let cfg = workspace::load(&core.databases, "123").await.unwrap();
    assert_eq!(cfg["personaByChat"]["group:8"]["botName"], "fixture");
    assert_eq!(cfg["personaByChat"]["group:8"]["roleText"], "saved");
    assert_eq!(request(&core,"/persona",json!({"account":"123","target":"group:8","section":"all","value":{"templateRef":{"builtin":true,"id":"deepseek"},"roleText":"tampered"}})).await.0,400);
    let cfg = workspace::load(&core.databases, "123").await.unwrap();
    assert_eq!(
        cfg["personaByChat"]["group:8"]["templateRef"]["builtin"],
        false
    );
}
#[tokio::test]
async fn receipt_survives_reopen_and_keeps_same_ids_in_different_chats() {
    let path = root();
    let pool = DatabasePool::new(path.clone());
    let event = IncomingMessage {
        self_id: 123,
        user_id: 456,
        group_id: Some(8),
        message_id: 99,
        time: 2,
        raw_message: "TEXT\0🦊".into(),
    };
    let copy = event.clone();
    assert!(
        pool.call("123".into(), move |s| s
            .receive(&copy)
            .map_err(|e| e.to_string()))
            .await
            .unwrap()
    );
    let reopen = DatabasePool::new(path);
    let copy = event.clone();
    assert!(
        !reopen
            .call("123".into(), move |s| s
                .receive(&copy)
                .map_err(|e| e.to_string()))
            .await
            .unwrap()
    );
    let mut copy = event.clone();
    copy.group_id = Some(9);
    assert!(
        reopen
            .call("123".into(), move |s| s
                .receive(&copy)
                .map_err(|e| e.to_string()))
            .await
            .unwrap()
    );
    let rows = reopen
        .call("123".into(), |s| {
            s.recent("group:8", None, 50).map_err(|e| e.to_string())
        })
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].text, "TEXT\0🦊");
}
#[cfg(windows)]
#[tokio::test]
async fn windows_credentials_are_encrypted_at_rest_and_account_isolated() {
    let path = root();
    let pool = DatabasePool::new(path.clone());
    workspace::set_key(&pool, "123", "provider", "fixture-secret-🦊")
        .await
        .unwrap();
    let encoded = pool
        .call("123".into(), |s| {
            s.preference("credential:provider")
                .map_err(|e| e.to_string())
        })
        .await
        .unwrap()
        .unwrap();
    assert!(!encoded.contains("fixture-secret"));
    assert_eq!(
        workspace::key(&DatabasePool::new(path), "123", "provider")
            .await
            .unwrap(),
        "fixture-secret-🦊"
    );
    assert_eq!(workspace::key(&pool, "456", "provider").await.unwrap(), "");
}
#[test]
fn response_permissions_peak_schedule_and_official_hosts_are_explicit() {
    let mut cfg = workspace::defaults();
    let event = IncomingMessage {
        self_id: 123,
        user_id: 456,
        group_id: Some(8),
        message_id: 1,
        time: 1,
        raw_message: "hello".into(),
    };
    assert!(!agent::permitted(&cfg, &event));
    cfg["runtime"]["enabled"] = json!(true);
    cfg["allow"]["groups"] = json!(["8"]);
    assert!(agent::permitted(&cfg, &event));
    cfg["globalBlocklist"] = json!(["456"]);
    assert!(!agent::recordable(&cfg, &event));
    cfg["store"]["peakSchedule"] = json!({"enabled":true,"peak":{"start":"22:00","end":"06:00","sliderPos":10},"valley":{"sliderPos":100}});
    assert_eq!(agent::effective_tier(&cfg, Some(8), 23 * 60).0, 1);
    assert_eq!(agent::effective_tier(&cfg, Some(8), 12 * 60).0, 4);
    assert!(prices::official("https://api.openai.com/v1", "openai"));
    for url in [
        "https://api.openai.com.evil.invalid/v1",
        "http://api.openai.com/v1",
        "https://user@api.openai.com/v1",
        "https://api.openai.com/relay",
        "https://api.openai.com/v1?q=x",
    ] {
        assert!(!prices::official(url, "openai"));
    }
    assert!(prices::parse("glm", "unrecognized layout").is_err());
}

#[tokio::test]
async fn fallback_and_tool_round_trip_persist_memory_without_sending_qq() {
    use axum::{Json, Router, extract::State, routing::post};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let failed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let failed_address = failed.local_addr().unwrap();
    let failed_task = tokio::spawn(async move {
        axum::serve(
            failed,
            Router::new().route(
                "/v1/chat/completions",
                post(|| async { axum::http::StatusCode::SERVICE_UNAVAILABLE }),
            ),
        )
        .await
        .unwrap();
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let observed = count.clone();
    async fn fixture(
        State(count): State<Arc<AtomicUsize>>,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        assert_eq!(body["model"], "fixture-backup");
        let round = count.fetch_add(1, Ordering::SeqCst);
        if round == 0 {
            Json(
                json!({"choices":[{"message":{"role":"assistant","content":"","tool_calls":[{"id":"remember_1","function":{"name":"remember","arguments":"{\"content\":\"fixture long-term memory\"}"}}]}}],"usage":{"prompt_tokens":100,"completion_tokens":10}}),
            )
        } else {
            assert_eq!(
                body["messages"].as_array().unwrap().last().unwrap()["tool_call_id"],
                "remember_1"
            );
            Json(
                json!({"choices":[{"message":{"role":"assistant","content":"fixture answer"}}],"usage":{"prompt_tokens":200,"completion_tokens":20}}),
            )
        }
    }
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new()
                .route("/v1/chat/completions", post(fixture))
                .with_state(count),
        )
        .await
        .unwrap();
    });
    let core = Core::new(root(), "fixture".into());
    let config = json!({"providers":[{"id":"primary","baseUrl":format!("http://{failed_address}/v1"),"models":[]},{"id":"backup","baseUrl":format!("http://{address}/v1"),"models":[]}],"api":{"provider":"primary","model":"fixture-primary","fallbackModels":[{"provider":"backup","model":"fixture-backup"}],"priceInputPerM":1,"priceOutputPerM":4,"useOfficialPrice":false}});
    assert_eq!(
        request(&core, "/config", json!({"account":"123","patch":config}))
            .await
            .0,
        200
    );
    let answer = agent::run(&core, "123", "group:8", "fixture prompt", false)
        .await
        .unwrap();
    assert_eq!(answer.text, "fixture answer");
    assert_eq!(answer.input_tokens, 300);
    assert_eq!(observed.load(Ordering::SeqCst), 2);
    assert!((answer.estimated_cost - 0.00042).abs() < 1e-10);
    let memories = core
        .databases
        .call("123".into(), |s| {
            s.memories("group:8").map_err(|e| e.to_string())
        })
        .await
        .unwrap();
    assert_eq!(memories[0].1, "fixture long-term memory");
    assert!(core.connections.status().await.is_empty());
    let stats = core
        .databases
        .call("123".into(), |s| s.stats().map_err(|e| e.to_string()))
        .await
        .unwrap();
    assert_eq!(stats["input_tokens"], 300);
    task.abort();
    failed_task.abort();
}

#[tokio::test]
async fn portable_prompt_skill_and_legacy_script_are_not_confused() {
    let path = root();
    std::fs::create_dir_all(path.join("fixture-skill")).unwrap();
    std::fs::write(
        path.join("fixture-skill/SKILL.md"),
        "fixture prompt instructions",
    )
    .unwrap();
    let core = Core::new(root(), "fixture".into());
    let (status, item) = request(
        &core,
        "/extensions/import",
        json!({"account":"123","path":path.join("fixture-skill").to_str().unwrap()}),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(item["runtime"], "prompt");
    let mut cfg = workspace::defaults();
    cfg["skills"]["fixture-skill"] = json!({"enabled":true});
    assert!(
        qqaf_native::extensions::prompt(&core, "123", &cfg)
            .await
            .unwrap()
            .contains("fixture prompt instructions")
    );
    std::fs::write(
        path.join("fixture-skill/index.js"),
        "throw new Error('must never execute')",
    )
    .unwrap();
    let (status, item) = request(
        &core,
        "/extensions/import",
        json!({"account":"123","path":path.join("fixture-skill").to_str().unwrap()}),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(item["runtime"], "legacy-js");
    assert!(
        qqaf_native::extensions::prompt(&core, "123", &cfg)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        qqaf_native::extensions::entries(&core, "456")
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn official_import_is_explicit_idempotent_and_rolls_back_invalid_rows() {
    let directory = root();
    std::fs::create_dir_all(&directory).unwrap();
    let file = directory.join("messages.json");
    let fixture = json!({"chatKey":"group:8","messages":[{"id":1,"ts":2000,"senderId":"456","text":"fixture 🦊","media":[{"kind":"image","url":"https://example.invalid/image.png"}],"reply":{"sender":"fixture","text":"prior"}}]});
    std::fs::write(&file, fixture.to_string()).unwrap();
    let core = Core::new(root(), "fixture".into());
    let payload = json!({"account":"123","path":file.to_str().unwrap(),"confirmed":false});
    assert_eq!(
        request(&core, "/migration/official-messages", payload)
            .await
            .0,
        400
    );
    let payload = json!({"account":"123","path":file.to_str().unwrap(),"confirmed":true});
    let (status, value) = request(&core, "/migration/official-messages", payload.clone()).await;
    assert_eq!(status, 200);
    assert_eq!(value["importedMessages"], 1);
    assert_eq!(
        request(&core, "/migration/official-messages", payload.clone())
            .await
            .1["importedMessages"],
        0
    );
    assert_eq!(std::fs::read_to_string(&file).unwrap(), fixture.to_string());
    let broken = json!({"chatKey":"group:8","messages":[{"id":2,"text":"should rollback"},{"id":3,"text":null}]});
    std::fs::write(&file, broken.to_string()).unwrap();
    assert_eq!(
        request(&core, "/migration/official-messages", payload)
            .await
            .0,
        400
    );
    let rows = core
        .databases
        .call("123".into(), |s| {
            s.recent("group:8", None, 50).map_err(|e| e.to_string())
        })
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
}

#[tokio::test]
async fn finish_stays_silent_and_failed_later_round_keeps_billed_usage() {
    use axum::{Json, Router, extract::State, routing::post};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    async fn failing(
        State(count): State<Arc<AtomicUsize>>,
    ) -> (axum::http::StatusCode, Json<Value>) {
        if count.fetch_add(1, Ordering::SeqCst) == 0 {
            (
                axum::http::StatusCode::OK,
                Json(
                    json!({"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"m","function":{"name":"remember","arguments":"{\"content\":\"fixture\"}"}}]}}],"usage":{"prompt_tokens":100,"completion_tokens":10}}),
                ),
            )
        } else {
            (axum::http::StatusCode::SERVICE_UNAVAILABLE, Json(json!({})))
        }
    }
    let task = tokio::spawn(async move {
        axum::serve(listener, Router::new()
            .route("/finish/v1/chat/completions", post(|| async {Json(json!({"choices":[{"message":{"role":"assistant","content":"must stay silent","tool_calls":[{"id":"f","function":{"name":"finish","arguments":"{}"}}]}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}))}))
            .route("/failure/v1/chat/completions", post(failing)).with_state(Arc::new(AtomicUsize::new(0))))
            .await.unwrap();
    });
    let core = Core::new(root(), "fixture".into());
    for (account, path) in [("123", "finish"), ("456", "failure")] {
        let cfg = json!({"providers":[{"id":"p","baseUrl":format!("http://{address}/{path}/v1"),"models":[]}],"runtime":{"enabled":true},"api":{"provider":"p","model":"fixture","useOfficialPrice":false}});
        assert_eq!(
            request(&core, "/config", json!({"account":account,"patch":cfg}))
                .await
                .0,
            200
        );
    }
    // No OneBot connection exists: an accidental automatic send would fail.
    assert!(
        agent::run(&core, "123", "group:8", "fixture", true)
            .await
            .is_ok()
    );
    assert!(
        agent::run(&core, "456", "group:9", "fixture", false)
            .await
            .is_err()
    );
    let stats = core
        .databases
        .call("456".into(), |s| s.stats().map_err(|e| e.to_string()))
        .await
        .unwrap();
    assert_eq!(stats["input_tokens"], 100);
    assert_eq!(stats["calls"], 1);
    task.abort();
}

#[tokio::test]
async fn custom_prices_are_scoped_to_endpoint_and_model() {
    let core = Core::new(root(), "fixture".into());
    let cfg = json!({"api":{"useOfficialPrice":false,"priceInputPerM":0,"priceOutputPerM":0,"modelPrices":{"https://relay-a.invalid/v1：same":{"in":1,"out":4},"https://relay-b.invalid/v1：same":{"in":2,"out":8}}}});
    assert_eq!(
        prices::effective(&core, &cfg, "https://relay-a.invalid/v1/", "same").await,
        (1., 4.)
    );
    assert_eq!(
        prices::effective(&core, &cfg, "https://relay-b.invalid/v1", "same").await,
        (2., 8.)
    );
    assert_eq!(
        prices::effective(&core, &cfg, "https://relay-c.invalid/v1", "same").await,
        (0., 0.)
    );
}

#[test]
fn clean_release_has_empty_model_configuration_and_persona() {
    if !cfg!(feature = "clean-release") {
        return;
    }
    let cfg = workspace::defaults();
    assert_eq!(cfg["providers"], json!([]));
    for field in ["apiKey", "model", "provider", "baseUrl"] {
        assert_eq!(cfg["api"][field], "");
    }
    for field in [
        "botName",
        "selfNickname",
        "roleText",
        "customRules",
        "systemPromptOverride",
    ] {
        assert_eq!(cfg["persona"][field], "");
    }
    assert_eq!(cfg["personaByChat"], json!({}));
    assert_eq!(cfg["runtime"]["enabled"], false);
}
