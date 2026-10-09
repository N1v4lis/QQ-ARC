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
                for part in message["content"].as_array().into_iter().flatten() {
                    if part["type"] == "text" {
                        content.push(json!({"type":"text","text":part["text"]}));
                    } else if part["type"] == "image_url" {
                        content.push(image_source(
                            part["image_url"]["url"].as_str().unwrap_or(""),
                        )?);
                    }
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
                for part in message["content"].as_array().into_iter().flatten() {
                    if part["type"] == "text" {
                        parts.push(json!({"text":part["text"]}));
                    } else if part["type"] == "image_url" {
                        parts.push(gemini_image(
                            part["image_url"]["url"].as_str().unwrap_or(""),
                        )?);
                    }
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
fn inline_data(address: &str) -> Option<(&str, &str)> {
    let rest = address.strip_prefix("data:")?;
    let (mime, data) = rest.split_once(";base64,")?;
    Some((mime, data))
}
fn image_source(address: &str) -> Result<Value, String> {
    if let Some((mime, data)) = inline_data(address) {
        Ok(json!({"type":"image","source":{"type":"base64","media_type":mime,"data":data}}))
    } else {
        Ok(json!({"type":"image","source":{"type":"url","url":address}}))
    }
}
fn gemini_image(address: &str) -> Result<Value, String> {
    let (mime, data) = inline_data(address).ok_or("Gemini 图片需在发送前读取为内联图片")?;
    Ok(json!({"inlineData":{"mimeType":mime,"data":data}}))
}
async fn inline_images(body: &Value) -> Result<Value, String> {
    use base64::Engine;
    let mut body = body.clone();
    let empty = json!({});
    let cfg = body.get("local_network_config").unwrap_or(&empty).clone();
    body.as_object_mut()
        .map(|m| m.remove("local_network_config"));
    for message in body["messages"].as_array_mut().into_iter().flatten() {
        for part in message["content"].as_array_mut().into_iter().flatten() {
            if part["type"] != "image_url" {
                continue;
            }
            let url = part["image_url"]["url"]
                .as_str()
                .ok_or("图片地址无效")?
                .to_owned();
            if url.starts_with("data:") {
                continue;
            }
            let bytes = crate::network::fetch_public_bytes(&cfg, &url, 5 * 1024 * 1024).await?;
            let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                "image/png"
            } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
                "image/jpeg"
            } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
                "image/gif"
            } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
                "image/webp"
            } else {
                return Err("图片格式不支持".into());
            };
            part["image_url"]["url"] = json!(format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ));
        }
    }
    Ok(body)
}
pub async fn request(
    http: &reqwest::Client,
    base: &str,
    key: &str,
    body: &Value,
) -> Result<Value, String> {
    let official_image_host = reqwest::Url::parse(base)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .is_some_and(|h| h == "generativelanguage.googleapis.com" || h == "api.anthropic.com");
    let transformed = if official_image_host {
        inline_images(body).await?
    } else {
        body.clone()
    };
    let (url, mut wire, protocol) = prepare(base, &transformed)?;
    if let Some(obj) = wire.as_object_mut() {
        obj.remove("local_network_config");
    }

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

/// OpenAI-compatible streaming with persisted deltas; JSON-only proxies fall back transparently.
pub async fn request_traced(
    http: &reqwest::Client,
    core: &crate::core::Core,
    account: &str,
    run_id: &str,
    base: &str,
    key: &str,
    body: &Value,
) -> Result<Value, String> {
    use futures_util::StreamExt;
    let host = reqwest::Url::parse(base)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned));
    if host
        .as_deref()
        .is_some_and(|h| h == "generativelanguage.googleapis.com" || h == "api.anthropic.com")
    {
        return request(http, base, key, body).await;
    }
    let (url, mut wire, protocol) = prepare(base, body)?;
    if let Some(obj) = wire.as_object_mut() {
        obj.remove("local_network_config");
    }
    if protocol != Protocol::OpenAi {
        return request(http, base, key, body).await;
    }
    wire["stream"] = json!(true);
    wire["stream_options"] = json!({"include_usage":true});
    let response = http
        .post(url)
        .bearer_auth(key)
        .json(&wire)
        .send()
        .await
        .map_err(|_| "模型请求失败")?;
    if !response.status().is_success() {
        return Err(format!("模型服务 HTTP {}", response.status().as_u16()));
    }
    if !response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/event-stream"))
    {
        return crate::network::json(response).await;
    }
    let mut stream = response.bytes_stream();
    let mut buffer = vec![];
    let mut text = String::new();
    let mut pending = String::new();
    let mut usage = json!({});
    let mut calls = std::collections::BTreeMap::<usize, Value>::new();
    let mut finished = false;
    let mut previous = std::time::Instant::now();
    let mut total = 0usize;
    let mut malformed = false;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "模型流式响应中断")?;
        total += chunk.len();
        if total > 8 * 1024 * 1024 {
            return Err("模型流式响应超过限制".into());
        }
        buffer.extend_from_slice(&chunk);
        while let Some(end) = buffer.iter().position(|b| *b == b'\n') {
            let bytes: Vec<_> = buffer.drain(..=end).collect();
            let line = std::str::from_utf8(&bytes)
                .map_err(|_| "模型流式编码错误")?
                .trim();
            let Some(payload) = line.strip_prefix("data:") else {
                continue;
            };
            let payload = payload.trim();
            if payload == "[DONE]" {
                finished = true;
                break;
            }
            let data: Value = serde_json::from_str(payload).map_err(|_| "模型流式数据无效")?;
            if data.get("error").is_some() {
                return Err("模型流式接口返回错误".into());
            }
            if data["usage"].is_object() {
                usage = data["usage"].clone();
            }
            let delta = &data["choices"][0]["delta"];
            if let Some(t) = delta["content"].as_str() {
                text.push_str(t);
                pending.push_str(t);
            }
            for item in delta["tool_calls"].as_array().into_iter().flatten() {
                let index = item["index"].as_u64().unwrap_or(0) as usize;
                let call = calls.entry(index).or_insert_with(
                    || json!({"id":"","type":"function","function":{"name":"","arguments":""}}),
                );
                for path in ["id", "function.name", "function.arguments"] {
                    let parts: Vec<_> = path.split('.').collect();
                    let val = if parts.len() == 1 {
                        &item[parts[0]]
                    } else {
                        &item[parts[0]][parts[1]]
                    };
                    if let Some(v) = val.as_str() {
                        let target = if parts.len() == 1 {
                            &mut call[parts[0]]
                        } else {
                            &mut call[parts[0]][parts[1]]
                        };
                        let mut current = target.as_str().unwrap_or("").to_owned();
                        current.push_str(v);
                        *target = json!(current);
                    }
                }
            }
            if data["choices"][0]["finish_reason"] == "length" {
                malformed = true;
            }
        }
        if !pending.is_empty()
            && (previous.elapsed() > std::time::Duration::from_millis(150) || finished)
        {
            let delta = std::mem::take(&mut pending);
            let id = run_id.to_owned();
            core.databases
                .call(account.into(), move |s| {
                    s.run_event(&id, "model_delta", &delta)
                        .map_err(|_| "保存流式进度失败".into())
                })
                .await?;
            previous = std::time::Instant::now();
        }
        if finished {
            break;
        }
    }
    if !pending.is_empty() {
        let id = run_id.to_owned();
        core.databases
            .call(account.into(), move |s| {
                s.run_event(&id, "model_delta", &pending)
                    .map_err(|_| "保存流式进度失败".into())
            })
            .await?;
    }
    if !finished {
        return Err("模型流式响应未完整结束".into());
    }
    // A length-limited tool call may contain invalid arguments; never execute it.
    if malformed && !calls.is_empty() {
        return Err("工具参数被模型长度限制截断".into());
    }
    Ok(
        json!({"choices":[{"message":{"role":"assistant","content":text,"tool_calls":calls.into_values().collect::<Vec<_>>()}}],"usage":usage}),
    )
}
