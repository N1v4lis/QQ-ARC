use axum::{Router, response::IntoResponse, routing::post};
use futures_util::{SinkExt, StreamExt};
use qqaf_native::{
    core::{Core, DatabasePool, router},
    model::{self, ModelConfig},
};
use serde_json::{Value, json};
use tower::ServiceExt;

fn root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("qqaf-core-{}", uuid::Uuid::new_v4()))
}

#[tokio::test]
async fn loopback_api_requires_session_token_and_rejects_browser_origin() {
    let app = router(Core::new(root(), "test-session-token".into()));
    let response = app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .uri("/status")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    let response = app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .uri("/status")
                .header("Authorization", "Bearer test-session-token")
                .header("Origin", "https://example.invalid")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .uri("/status")
                .header("Authorization", "Bearer test-session-token")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
}

#[tokio::test]
async fn account_writers_commit_concurrently_and_reopen_with_exact_text() {
    let path = root();
    let pool = DatabasePool::new(path.clone());
    let mut jobs = Vec::new();
    for account in ["a", "b"] {
        for n in 0..100 {
            let pool = pool.clone();
            jobs.push(tokio::spawn(async move {
                pool.call(account.into(), move |store| {
                    store
                        .append("group:1", "test", &format!("🦊\0{account}{n}"), n)
                        .map(|_| ())
                        .map_err(|e| e.to_string())
                })
                .await
                .unwrap();
            }));
        }
    }
    for job in jobs {
        job.await.unwrap();
    }
    for account in ["a", "b"] {
        let rows = pool
            .call(account.into(), |store| {
                store
                    .recent("group:1", None, 500)
                    .map_err(|e| e.to_string())
            })
            .await
            .unwrap();
        assert_eq!(rows.len(), 100);
        assert!(rows.iter().all(|m| m.text.contains(account)));
    }
    assert!(pool.call("../escape".into(), |_| Ok(())).await.is_err());
    let reopened = DatabasePool::new(path);
    assert_eq!(
        reopened
            .call("a".into(), |s| s
                .recent("group:1", None, 1)
                .map_err(|e| e.to_string()))
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn onebot_receives_messages_and_correlates_send_without_cross_account_leak() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let mock = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(socket).await.unwrap();
        for account in ["999", "123"] {
            ws.send(tokio_tungstenite::tungstenite::Message::Text(json!({"post_type":"message","self_id":account.parse::<i64>().unwrap(),"user_id":456,"group_id":789,"message_id":1,"time":2,"raw_message":"fixture incoming"}).to_string().into())).await.unwrap();
        }
        while let Some(Ok(message)) = ws.next().await {
            if let Ok(text) = message.into_text() {
                let action: Value = serde_json::from_str(&text).unwrap();
                assert_eq!(action["action"], "send_group_msg");
                ws.send(tokio_tungstenite::tungstenite::Message::Text(
                    json!({"status":"ok","data":{"message_id":42},"echo":action["echo"]})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
                break;
            }
        }
    });
    let core = Core::new(root(), "test-token".into());
    core.connections
        .connect(
            "123".into(),
            format!("ws://{address}"),
            "".into(),
            core.databases.clone(),
        )
        .await
        .unwrap();
    let response=core.connections.action("123",json!({"action":"send_group_msg","params":{"group_id":789,"message":"fixture outgoing"}})).await.unwrap();
    assert_eq!(response["message_id"], 42);
    let rows = core
        .databases
        .call("123".into(), |s| {
            s.recent("group:789", None, 50).map_err(|e| e.to_string())
        })
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].text, "fixture incoming");
    assert!(!core.databases.accounts().contains(&"999".to_string()));
    core.connections.disconnect("123").await;
    mock.await.unwrap();
}

#[tokio::test]
async fn model_sse_is_decoded_and_usage_is_priced_without_real_api() {
    async fn mock(axum::Json(body): axum::Json<Value>) -> impl IntoResponse {
        assert_eq!(body["model"], "fixture-model");
        assert_eq!(body["messages"][0]["content"], "fixture system");
        (
            [("content-type", "text/event-stream")],
            "data: {\"choices\":[{\"delta\":{\"content\":\"你好🦊\"}}]}\n\ndata: {\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":20}}\n\ndata: [DONE]\n\n",
        )
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/v1/chat/completions", post(mock)),
        )
        .await
        .unwrap();
    });
    let config = ModelConfig {
        base_url: format!("http://{address}/v1"),
        model: "fixture-model".into(),
        system_prompt: "fixture system".into(),
        input_per_million: 1.0,
        output_per_million: 4.0,
    };
    let result = model::complete(
        &reqwest::Client::new(),
        &config,
        "fixture-key",
        vec![json!({"role":"user","content":"fixture prompt"})],
    )
    .await
    .unwrap();
    assert_eq!(result.text, "你好🦊");
    assert_eq!(result.input_tokens, 100);
    assert_eq!(result.output_tokens, 20);
    assert!((result.estimated_cost - 0.00018).abs() < 1e-10);
    server.abort();
}

#[tokio::test]
async fn long_unicode_messages_send_all_identical_chunks_without_dedup_loss() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let mock = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(socket).await.unwrap();
        let mut texts = vec![];
        while let Some(Ok(message)) = ws.next().await {
            if let Ok(text) = message.into_text() {
                let action: Value = serde_json::from_str(&text).unwrap();
                texts.push(action["params"]["message"].as_str().unwrap().to_owned());
                ws.send(tokio_tungstenite::tungstenite::Message::Text(
                    json!({"status":"ok","data":{"message_id":texts.len()},"echo":action["echo"]})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
                if texts.len() == 3 {
                    break;
                }
            }
        }
        texts
    });
    let core = Core::new(root(), "fixture".into());
    core.connections
        .connect(
            "123".into(),
            format!("ws://{address}"),
            "".into(),
            core.databases.clone(),
        )
        .await
        .unwrap();
    let mut cfg = qqaf_native::workspace::defaults();
    cfg["send"]["hardSplitAt"] = json!(200);
    cfg["send"]["minGapMs"] = json!(0);
    cfg["send"]["maxGapMs"] = json!(0);
    cfg["send"]["byLengthMs"] = json!(0);
    let text = "🦊".repeat(401);
    qqaf_native::agent::send(&core, "123", "group:8", &text, &cfg)
        .await
        .unwrap();
    let chunks = mock.await.unwrap();
    assert_eq!(chunks.concat(), text);
    assert_eq!(
        chunks.iter().map(|c| c.chars().count()).collect::<Vec<_>>(),
        vec![200, 200, 1]
    );
    core.connections.disconnect("123").await;
}
