//! Adapt official Claude/Gemini APIs to the core's tool loop. Proxies keep their
//! configured OpenAI-compatible interface; a model name never determines a host.
use serde_json::{Value, json};
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Protocol {
    OpenAi,
    Claude,
    Gemini,
}
pub fn prepare(base: &str, body: &Value) -> Result<(reqwest::Url, Value, Protocol), String> {
    let mut url = reqwest::Url::parse(base).map_err(|_| "模型地址无效")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("模型地址无效".into());
    }
    let protocol = match url.host_str() {
        Some("api.anthropic.com") => Protocol::Claude,
        Some("generativelanguage.googleapis.com") if !url.path().contains("openai") => {
            Protocol::Gemini
        }
        _ => Protocol::OpenAi,
    };
    let mut wire = body.clone();
    if protocol != Protocol::OpenAi && url.scheme() != "https" {
        return Err("官方接口须使用 HTTPS".into());
    }
    if protocol == Protocol::OpenAi {
        url.set_path(&format!(
            "{}/chat/completions",
            url.path().trim_end_matches('/')
        ));
        return Ok((url, wire, protocol));
    }
    let messages = body["messages"].as_array().ok_or("消息格式无效")?;
    let system = messages
        .iter()
        .filter(|m| m["role"] == "system")
        .filter_map(|m| m["content"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let tools = body["tools"].as_array().cloned().unwrap_or_default();
    if protocol == Protocol::Claude {
        url.set_path("/v1/messages");
        let mut turns: Vec<Value> = vec![];
        for message in messages.iter().filter(|m| m["role"] != "system") {
            let role = if message["role"] == "assistant" {
                "assistant"
            } else {
                "user"
            };
            let mut content = vec![];
            if message["role"] == "tool" {
                content.push(json!({"type":"tool_result","tool_use_id":message["tool_call_id"],"content":message["content"]}));
            } else {
                if let Some(text) = message["content"].as_str().filter(|t| !t.is_empty()) {
                    content.push(json!({"type":"text","text":text}));
                }
                for call in message["tool_calls"].as_array().into_iter().flatten() {
                    content.push(json!({"type":"tool_use","id":call["id"],"name":call["function"]["name"],"input":serde_json::from_str::<Value>(call["function"]["arguments"].as_str().unwrap_or("{}")).map_err(|_|"工具参数无效")?}));
                }
            }
            if content.is_empty() {
                continue;
            }
            if turns.last().is_some_and(|m| m["role"] == role) {
                turns.last_mut().unwrap()["content"]
                    .as_array_mut()
                    .unwrap()
                    .extend(content);
            } else {
                turns.push(json!({"role":role,"content":content}));
            }
        }
        wire = json!({"model":body["model"],"system":system,"messages":turns,"max_tokens":4096});
        if !tools.is_empty() {
            wire["tools"]=json!(tools.iter().map(|t|json!({"name":t["function"]["name"],"description":t["function"]["description"],"input_schema":t["function"]["parameters"]})).collect::<Vec<_>>());
        }
    } else {
        let id = body["model"].as_str().ok_or("模型 id 无效")?;
        if !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        {
            return Err("Gemini 模型 id 无效".into());
        }
        url.set_path(&format!("/v1beta/models/{id}:generateContent"));
        let mut turns: Vec<Value> = vec![];
        let mut names = std::collections::HashMap::new();
        for message in messages.iter().filter(|m| m["role"] != "system") {
            let role = if message["role"] == "assistant" {
                "model"
            } else {
                "user"
            };
            let mut parts = vec![];
            for call in message["tool_calls"].as_array().into_iter().flatten() {
                names.insert(
                    call["id"].as_str().unwrap_or("").to_string(),
                    call["function"]["name"].clone(),
                );
            }
            if let Some(original) = message["gemini_parts"].as_array() {
                parts = original.clone();
            } else if message["role"] == "tool" {
                let name = names
                    .get(message["tool_call_id"].as_str().unwrap_or(""))
                    .ok_or("找不到工具名称")?;
                parts.push(json!({"functionResponse":{"name":name,"response":serde_json::from_str::<Value>(message["content"].as_str().unwrap_or("{}")).unwrap_or(json!({"text":message["content"]}))}}));
            } else {
                if let Some(text) = message["content"].as_str().filter(|s| !s.is_empty()) {
                    parts.push(json!({"text":text}));
                }
                for call in message["tool_calls"].as_array().into_iter().flatten() {
                    parts.push(json!({"functionCall":{"name":call["function"]["name"],"args":serde_json::from_str::<Value>(call["function"]["arguments"].as_str().unwrap_or("{}")).map_err(|_|"工具参数无效")?}}));
                }
            }
            if parts.is_empty() {
                continue;
            }
            if turns.last().is_some_and(|m| m["role"] == role) {
                turns.last_mut().unwrap()["parts"]
                    .as_array_mut()
                    .unwrap()
                    .extend(parts);
            } else {
                turns.push(json!({"role":role,"parts":parts}));
            }
        }
        wire = json!({"systemInstruction":{"parts":[{"text":system}]},"contents":turns});
        if !tools.is_empty() {
            wire["tools"] = json!([{"functionDeclarations":tools.iter().map(|t|json!({"name":t["function"]["name"],"description":t["function"]["description"],"parameters":t["function"]["parameters"]})).collect::<Vec<_>>()}]);
        }
    }
    Ok((url, wire, protocol))
}
pub fn normalize(protocol: Protocol, response: Value) -> Result<Value, String> {
    if protocol == Protocol::OpenAi {
        return Ok(response);
    }
    if response.get("error").is_some() {
        return Err("模型接口返回错误".into());
    }
    let mut text = String::new();
    let mut calls = vec![];
    let (input, output) = if protocol == Protocol::Claude {
        for block in response["content"]
            .as_array()
            .ok_or("Claude 响应格式无效")?
        {
            if let Some(t) = block["text"].as_str() {
                text.push_str(t);
            }
            if block["type"] == "tool_use" {
                calls.push(json!({"id":block["id"],"type":"function","function":{"name":block["name"],"arguments":block["input"].to_string()}}));
            }
        }
        (
            response["usage"]["input_tokens"].clone(),
            response["usage"]["output_tokens"].clone(),
        )
    } else {
        for part in response["candidates"][0]["content"]["parts"]
            .as_array()
            .ok_or("Gemini 响应格式无效")?
        {
            if part["thought"] != true {
                if let Some(t) = part["text"].as_str() {
                    text.push_str(t);
                }
            }
            if part["functionCall"].is_object() {
                calls.push(json!({"id":format!("call_{}",uuid::Uuid::new_v4()),"type":"function","function":{"name":part["functionCall"]["name"],"arguments":part["functionCall"]["args"].to_string()}}));
            }
        }
        (
            response["usageMetadata"]["promptTokenCount"].clone(),
            response["usageMetadata"]["candidatesTokenCount"].clone(),
        )
    };
    let mut message = json!({"role":"assistant","content":text,"tool_calls":calls});
    if protocol == Protocol::Gemini {
        message["gemini_parts"] = response["candidates"][0]["content"]["parts"].clone();
    }
    Ok(
        json!({"choices":[{"message":message}],"usage":{"prompt_tokens":input,"completion_tokens":output}}),
    )
}
pub async fn request(
    http: &reqwest::Client,
    base: &str,
    key: &str,
    body: &Value,
) -> Result<Value, String> {
    let (url, wire, protocol) = prepare(base, body)?;
    let mut request = http.post(url).json(&wire);
    request = match protocol {
        Protocol::OpenAi => request.bearer_auth(key),
        Protocol::Claude => request
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"),
        Protocol::Gemini => request.header("x-goog-api-key", key),
    };
    let response = request.send().await.map_err(|_| "模型请求失败")?;
    normalize(protocol, crate::network::json(response).await?)
}
