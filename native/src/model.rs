use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ModelConfig {
    pub base_url: String,
    pub model: String,
    pub system_prompt: String,
    #[serde(default)]
    pub input_per_million: f64,
    #[serde(default)]
    pub output_per_million: f64,
}
#[derive(Debug, Serialize)]
pub struct Completion {
    pub text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated_cost: f64,
}

pub async fn complete(
    client: &reqwest::Client,
    config: &ModelConfig,
    key: &str,
    history: Vec<Value>,
) -> Result<Completion, String> {
    let mut url = reqwest::Url::parse(&config.base_url).map_err(|_| "模型连接地址无效")?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("模型连接地址不能包含凭据、查询或片段".into());
    }
    url.set_path(&format!(
        "{}/chat/completions",
        url.path().trim_end_matches('/')
    ));
    if config.model.is_empty() {
        return Err("请选择模型".into());
    }
    let mut messages = vec![json!({"role":"system","content":config.system_prompt})];
    messages.extend(history);
    let response=client.post(url).bearer_auth(key).json(&json!({"model":config.model,"messages":messages,"stream":true,"stream_options":{"include_usage":true}})).send().await.map_err(|_|"模型请求失败，请检查连接或代理")?;
    if !response.status().is_success() {
        return Err(format!("模型服务返回 HTTP {}", response.status().as_u16()));
    }
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    let mut text = String::new();
    let (mut input, mut output) = (0, 0);
    let mut finished = false;
    while let Some(chunk) = stream.next().await {
        buffer.extend_from_slice(&chunk.map_err(|_| "模型响应中断")?);
        if buffer.len() > 4 * 1024 * 1024 || text.len() > 4 * 1024 * 1024 {
            return Err("模型响应超过限制".into());
        }
        while let Some(end) = buffer.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = buffer.drain(..=end).collect();
            let line = std::str::from_utf8(&line)
                .map_err(|_| "模型响应编码无效")?
                .trim();
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data == "[DONE]" {
                    finished = true;
                    continue;
                }
                let event: Value = serde_json::from_str(data).map_err(|_| "模型流数据无效")?;
                if event.get("error").is_some() {
                    return Err("模型流返回错误".into());
                }
                if event
                    .pointer("/choices/0/finish_reason")
                    .is_some_and(|v| !v.is_null())
                {
                    finished = true;
                }
                if let Some(delta) = event
                    .pointer("/choices/0/delta/content")
                    .and_then(Value::as_str)
                {
                    text.push_str(delta);
                }
                if let Some(usage) = event.get("usage") {
                    input = usage["prompt_tokens"].as_u64().unwrap_or(input);
                    output = usage["completion_tokens"].as_u64().unwrap_or(output);
                }
            }
        }
    }
    if !finished || !buffer.iter().all(u8::is_ascii_whitespace) {
        return Err("模型响应未完整结束，请重试".into());
    }
    if text.is_empty() {
        return Err("模型没有返回文本".into());
    }
    Ok(Completion {
        text,
        input_tokens: input,
        output_tokens: output,
        estimated_cost: (input as f64 * config.input_per_million
            + output as f64 * config.output_per_million)
            / 1_000_000.0,
    })
}
