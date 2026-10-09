//! Native event scheduler and tool loop. No archived Node process is launched.
use crate::{core::Core, model::Completion, network, onebot::IncomingMessage, workspace};
use chrono::Timelike;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use tokio::sync::{Mutex, Semaphore};

#[derive(Clone, Default)]
pub struct Runtime {
    queue: Arc<Mutex<Queue>>,
    slots: Arc<Mutex<HashMap<String, Arc<Semaphore>>>>,
    sent: Arc<Mutex<HashMap<String, (String, i64)>>>,
    send_gates: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    send_times: Arc<Mutex<HashMap<String, std::collections::VecDeque<i64>>>>,
    muted: Arc<Mutex<HashMap<String, i64>>>,
    active: Arc<Mutex<HashMap<String, (String, tokio::sync::watch::Sender<bool>)>>>,
}
pub fn recordable(cfg: &Value, event: &IncomingMessage) -> bool {
    let id = event.group_id.unwrap_or(event.user_id).to_string();
    let sender = event.user_id.to_string();
    let contains = |list: &Value, id: &str| {
        list.as_array().is_some_and(|values| {
            values.iter().any(|v| {
                v.as_str()
                    .map(str::to_owned)
                    .or_else(|| v.as_i64().map(|v| v.to_string()))
                    .as_deref()
                    == Some(id)
            })
        })
    };
    if event.user_id == event.self_id {
        return true;
    }
    !contains(&cfg["globalBlocklist"], &sender) && !contains(&cfg["blocklist"][&id], &sender)
}
pub fn permitted(cfg: &Value, event: &IncomingMessage) -> bool {
    if event.self_id == event.user_id
        || cfg["runtime"]["enabled"] != true
        || !recordable(cfg, event)
    {
        return false;
    }
    let kind = if event.group_id.is_some() {
        "groups"
    } else {
        "private"
    };
    let id = event.group_id.unwrap_or(event.user_id).to_string();
    let contains = |list: &Value, id: &str| {
        list.as_array().is_some_and(|v| {
            v.iter().any(|v| {
                v.as_str()
                    .map(str::to_string)
                    .or_else(|| v.as_i64().map(|n| n.to_string()))
                    .as_deref()
                    == Some(id)
            })
        })
    };
    if contains(&cfg["deny"][kind], &id)
        || contains(&cfg["globalBlocklist"], &event.user_id.to_string())
        || contains(&cfg["blocklist"][&id], &event.user_id.to_string())
    {
        return false;
    }
    contains(&cfg["allow"][kind], &id)
        || (cfg["allowAllWhenEmpty"] == true
            && cfg["allow"][kind].as_array().is_some_and(Vec::is_empty))
}
pub fn triggered(cfg: &Value, event: &IncomingMessage, random: f64) -> bool {
    if event.group_id.is_none() {
        return true;
    }
    let store = &cfg["store"];
    let (tier, probability) = effective_tier(
        cfg,
        event.group_id,
        chrono::Local::now().hour() * 60 + chrono::Local::now().minute(),
    );
    let mentioned = event
        .raw_message
        .contains(&format!("[CQ:at,qq={}", event.self_id))
        || cfg["persona"]["botName"]
            .as_str()
            .filter(|v| !v.is_empty())
            .is_some_and(|v| event.raw_message.contains(v));
    mentioned
        || tier >= 4
        || (tier >= 2
            && store["keywords"].as_array().is_some_and(|a| {
                a.iter().any(|s| {
                    s.as_str()
                        .filter(|s| !s.is_empty())
                        .is_some_and(|s| event.raw_message.contains(s))
                })
            }))
        || (tier >= 3 && random * 100. < probability)
}
pub fn effective_tier(cfg: &Value, group: Option<i64>, minute: u32) -> (u64, f64) {
    let store = &cfg["store"];
    let mut pos = store["contextSliderPos"].as_f64();
    let id = group.map(|g| g.to_string()).unwrap_or_default();
    if store["unifiedTier"] == false {
        if let Some(value) = store["groupSliderPos"][&id].as_f64() {
            pos = Some(value);
        }
    }
    if store["peakSchedule"]["enabled"] == true {
        let clock = |value: &Value| {
            value
                .as_str()
                .and_then(|v| v.split_once(':'))
                .and_then(|(h, m)| Some(h.parse::<u32>().ok()? * 60 + m.parse::<u32>().ok()?))
        };
        let schedule = &store["peakSchedule"];
        if let (Some(start), Some(end)) = (
            clock(&schedule["peak"]["start"]),
            clock(&schedule["peak"]["end"]),
        ) {
            let peak = if start < end {
                minute >= start && minute < end
            } else {
                minute >= start || minute < end
            };
            let period = if peak { "peak" } else { "valley" };
            pos = if store["unifiedTier"] == false {
                store["groupPeakPos"][&id][period].as_f64()
            } else {
                None
            }
            .or_else(|| schedule[period]["sliderPos"].as_f64());
        }
    }
    if let Some(pos) = pos {
        let pos = pos.clamp(0., 100.);
        if pos <= 10. {
            (1, 0.)
        } else if pos <= 20. {
            (2, 0.)
        } else if pos <= 90. {
            (3, (pos - 20.) / 70. * 100.)
        } else {
            (4, 100.)
        }
    } else {
        (
            store["contextTier"].as_u64().unwrap_or(1),
            store["randomPercent"].as_f64().unwrap_or(0.),
        )
    }
}
#[derive(Default)]
struct Queue {
    latest: HashMap<String, IncomingMessage>,
    workers: HashSet<String>,
}
// At most one worker and one replacement event per chat, even while an API is slow.
// Replacement events refer to messages already committed to SQL, so coalescing
// never discards history or cancels a tool that may already have sent a message.
pub fn start(core: Core) {
    let mut events = core.connections.subscribe();
    let mut shutdown = core.shutdown.subscribe();
    tokio::spawn(async move {
        loop {
            let event = tokio::select! {
                _ = shutdown.changed() => break,
                result = events.recv() => match result {
                    Ok(event) => event,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    Err(_) => continue,
                }
            };
            let account = event.self_id.to_string();
            let Ok(cfg) = workspace::load(&core.databases, &account).await else {
                continue;
            };
            if !permitted(&cfg, &event) {
                continue;
            }
            let key = format!("{account}:{}", event.chat_key());
            let mentioned = event
                .raw_message
                .contains(&format!("[CQ:at,qq={}", event.self_id));
            if cfg["commandMute"]["enabled"] == true
                && mentioned
                && cfg["commandMute"]["command"]
                    .as_str()
                    .filter(|c| !c.is_empty())
                    .is_some_and(|c| event.raw_message.contains(c))
            {
                let minutes = cfg["commandMute"]["durationMin"]
                    .as_i64()
                    .unwrap_or(30)
                    .clamp(0, 10080);
                let until = if minutes == 0 {
                    i64::MAX
                } else {
                    crate::core::now() + minutes * 60
                };
                core.runtime.muted.lock().await.insert(key.clone(), until);
                let chat_id = event.chat_key();
                let _ = workspace::update(&core.databases, &account, move |c| {
                    if !c["commandMute"]["active"].is_object() {
                        c["commandMute"]["active"] = json!({});
                    }
                    c["commandMute"]["active"][chat_id] = json!(until);
                    Ok(())
                })
                .await;
                continue;
            }
            let random =
                u64::from_le_bytes(uuid::Uuid::new_v4().as_bytes()[..8].try_into().unwrap()) as f64
                    / u64::MAX as f64;
            if !triggered(&cfg, &event, random) {
                continue;
            }
            if !mentioned
                && cfg["commandMute"]["active"][event.chat_key()]
                    .as_i64()
                    .is_some_and(|until| until > crate::core::now())
            {
                continue;
            }
            if !mentioned
                && core
                    .runtime
                    .muted
                    .lock()
                    .await
                    .get(&key)
                    .is_some_and(|until| *until > crate::core::now())
            {
                continue;
            }
            let mut queue = core.runtime.queue.lock().await;
            if !queue.workers.contains(&key) && queue.workers.len() >= 256 {
                continue;
            }
            queue.latest.insert(key.clone(), event);
            if !queue.workers.insert(key.clone()) {
                continue;
            }
            let child = core.clone();
            let wait = cfg["wakeDelayMs"].as_u64().unwrap_or(2000).min(30000);
            let slots = core
                .runtime
                .slots
                .lock()
                .await
                .entry(account.clone())
                .or_insert_with(|| {
                    Arc::new(Semaphore::new(
                        cfg["maxConcurrentRuns"].as_u64().unwrap_or(2).clamp(1, 16) as usize,
                    ))
                })
                .clone();
            tokio::spawn(async move {
                let mut shutdown = child.shutdown.subscribe();
                loop {
                    let stopped = tokio::select! {
                        _ = shutdown.changed() => true,
                        _ = tokio::time::sleep(std::time::Duration::from_millis(wait)) => false,
                    };
                    if stopped {
                        break;
                    }
                    let Ok(permit) = slots.clone().acquire_owned().await else {
                        break;
                    };
                    let event = child.runtime.queue.lock().await.latest.remove(&key);
                    if let Some(event) = event {
                        if let Ok(current) = workspace::load(&child.databases, &account).await {
                            if permitted(&current, &event) {
                                let chat = event.chat_key();
                                let _ =
                                    run(&child, &account, &chat, &event.raw_message, true).await;
                            }
                        }
                    }
                    drop(permit);
                    let mut queue = child.runtime.queue.lock().await;
                    if !queue.latest.contains_key(&key) {
                        queue.workers.remove(&key);
                        return;
                    }
                }
                let mut queue = child.runtime.queue.lock().await;
                queue.latest.remove(&key);
                queue.workers.remove(&key);
            });
        }
    });
}
pub fn tools(cfg: &Value) -> Vec<Value> {
    if cfg["tools"]["enabled"] != true {
        return vec![];
    }
    let candidates = [
        (
            "send_message",
            "messaging",
            "向当前会话发送文字。",
            json!({"messages":{"oneOf":[{"type":"string"},{"type":"array","items":{"type":"string"}}]},"text":{"type":"string"}}),
            vec![],
        ),
        (
            "remember",
            "memory",
            "保存该会话的一条长期记忆。",
            json!({"content":{"type":"string"}}),
            vec!["content"],
        ),
        (
            "recall_memory",
            "memory",
            "读取当前会话长期记忆。",
            json!({}),
            vec![],
        ),
        (
            "memory_append",
            "memory",
            "保存当前会话的群友印象。",
            json!({"content":{"type":"string"},"userId":{"type":"string"},"target":{"type":"string"}}),
            vec!["content"],
        ),
        (
            "memory_query",
            "memory",
            "查询当前会话长期记忆。",
            json!({}),
            vec![],
        ),
        (
            "memory_remove",
            "memory",
            "删除当前会话的一条记忆。",
            json!({"id":{"type":"integer"}}),
            vec!["id"],
        ),
        (
            "get_recent_messages",
            "query",
            "读取当前会话最近消息。",
            json!({"search":{"type":"string"}}),
            vec![],
        ),
        (
            "read_messages",
            "query",
            "查找当前会话最近消息。",
            json!({"search":{"type":"string"}}),
            vec![],
        ),
        (
            "web_search",
            "web",
            "搜索网络。",
            json!({"query":{"type":"string"}}),
            vec!["query"],
        ),
        (
            "web_fetch",
            "web",
            "读取公共网页正文。",
            json!({"url":{"type":"string"}}),
            vec!["url"],
        ),
        (
            "finish",
            "system",
            "结束处理；没有必要回应时直接结束。",
            json!({}),
            vec![],
        ),
    ];
    let mut values: Vec<Value> = candidates.into_iter().filter(|(id,category,_,_,_)|cfg["tools"]["categories"][category]!=false && cfg["tools"]["overrides"][id]!=false && (*id!="web_search" || cfg["webSearch"]["enabled"]==true)).map(|(id,_,description,properties,required)|json!({"type":"function","function":{"name":id,"description":description,"parameters":{"type":"object","properties":properties,"required":required}}})).collect();
    values.extend(crate::qq_tools::specs(cfg));
    if cfg["tools"]["overrides"]["delegate_agent"] == true
        && cfg["harnesses"]
            .as_array()
            .is_some_and(|list| list.iter().any(|p| p["enabled"] == true))
    {
        values.push(json!({"type":"function","function":{"name":"delegate_agent","description":"调用用户显式配置并启用的本机 Agent/Harness。","parameters":{"type":"object","properties":{"id":{"type":"string"},"prompt":{"type":"string"}},"required":["id","prompt"]}}}));
    }
    values
}
pub async fn send(
    core: &Core,
    account: &str,
    chat: &str,
    text: &str,
    cfg: &Value,
) -> Result<(), String> {
    let count = text.chars().count();
    if count == 0 || count > 64000 {
        return Err("发送文本须为 1–64000 字符".into());
    }
    let max = cfg["send"]["hardSplitAt"]
        .as_u64()
        .unwrap_or(4000)
        .clamp(200, 4000) as usize;
    let mut chunk = String::new();
    let mut length = 0;
    for c in text.chars() {
        chunk.push(c);
        length += 1;
        if length >= max {
            send_chunk(core, account, chat, &chunk, cfg, count > max).await?;
            chunk.clear();
            length = 0;
        }
    }
    if !chunk.is_empty() {
        send_chunk(core, account, chat, &chunk, cfg, count > max).await?;
    }
    Ok(())
}
async fn send_chunk(
    core: &Core,
    account: &str,
    chat: &str,
    text: &str,
    cfg: &Value,
    multipart: bool,
) -> Result<(), String> {
    if text.trim().is_empty() || text.chars().count() > 4000 {
        return Err("发送文本须为 1–4000 字符".into());
    }
    let gate_key = format!("{account}:{chat}");
    let dedupe = cfg["send"]["dedupeWindowMs"].as_i64().unwrap_or(8000) / 1000;
    let gap = cfg["send"]["minGapMs"]
        .as_u64()
        .unwrap_or(1000)
        .max(
            (text.chars().count() as u64)
                .saturating_mul(cfg["send"]["byLengthMs"].as_u64().unwrap_or(20)),
        )
        .min(cfg["send"]["maxGapMs"].as_u64().unwrap_or(3000))
        .min(30000);
    // Keep network waits isolated to the sending account.
    let gate = core
        .runtime
        .send_gates
        .lock()
        .await
        .entry(account.into())
        .or_default()
        .clone();
    let _account_gate = gate.lock().await;
    let now = crate::core::now();
    let previous = core.runtime.sent.lock().await.get(&gate_key).cloned();
    if let Some((last, time)) = previous {
        if !multipart && last == text && now - time < dedupe {
            return Ok(());
        }
        let elapsed = (now - time).max(0) as u64 * 1000;
        if elapsed < gap {
            tokio::time::sleep(std::time::Duration::from_millis(gap - elapsed)).await;
        }
    }
    {
        let mut all = core.runtime.send_times.lock().await;
        let times = all.entry(account.into()).or_default();
        while times.front().is_some_and(|time| now - time >= 3600) {
            times.pop_front();
        }
        let minute = times.iter().filter(|time| now - **time < 60).count() as u64;
        if minute
            >= cfg["send"]["maxPerMinute"]
                .as_u64()
                .unwrap_or(80)
                .clamp(1, 10000)
            || times.len() as u64
                >= cfg["send"]["maxPerHour"]
                    .as_u64()
                    .unwrap_or(500)
                    .clamp(1, 100000)
        {
            return Err("当前账号发送速率已达上限".into());
        }
    }
    let (kind, id) = chat.split_once(':').ok_or("会话标识无效")?;
    let id: u64 = id.parse().map_err(|_| "会话标识无效")?;
    let action = match kind {
        "group" => {
            json!({"action":"send_group_msg","params":{"group_id":id,"message":text,"auto_escape":true}})
        }
        "private" => {
            json!({"action":"send_private_msg","params":{"user_id":id,"message":text,"auto_escape":true}})
        }
        _ => return Err("会话类型无效".into()),
    };
    // Do not automatically retry ambiguous OneBot sends after a timeout.
    core.connections.action(account, action).await?;
    core.runtime
        .sent
        .lock()
        .await
        .insert(gate_key, (text.into(), crate::core::now()));
    core.runtime
        .send_times
        .lock()
        .await
        .entry(account.into())
        .or_default()
        .push_back(crate::core::now());
    let chat = chat.to_string();
    let text = text.to_string();
    core.databases
        .call(account.into(), move |s| {
            s.append(&chat, "self", &text, crate::core::now())
                .map(|_| ())
                .map_err(|_| "已发送，记录写入失败".into())
        })
        .await
}
pub async fn cancel(core: &Core, account: &str, run_id: &str) -> Result<bool, String> {
    let active = core.runtime.active.lock().await;
    let key_prefix = format!("{account}:");
    for (key, (id, signal)) in active.iter() {
        if key.starts_with(&key_prefix) && id == run_id {
            signal.send_replace(true);
            return Ok(true);
        }
    }
    Ok(false)
}
pub async fn is_active(core: &Core, account: &str, run_id: &str) -> bool {
    let active = core.runtime.active.lock().await;
    let key_prefix = format!("{account}:");
    active.iter().any(|(key, (id, _))| key.starts_with(&key_prefix) && id == run_id)
}
async fn event(
    core: &Core,
    account: &str,
    run_id: &str,
    kind: &str,
    content: String,
) -> Result<(), String> {
    let id = run_id.to_owned();
    let kind = kind.to_owned();
    core.databases
        .call(account.into(), move |s| {
            s.run_event(&id, &kind, &content)
                .map_err(|_| "运行事件写入失败".into())
        })
        .await
}
pub async fn run(
    core: &Core,
    account: &str,
    chat: &str,
    prompt: &str,
    qq: bool,
) -> Result<Completion, String> {
    run_media(core, account, chat, prompt, qq, vec![]).await
}
pub async fn run_media(
    core: &Core,
    account: &str,
    chat: &str,
    prompt: &str,
    qq: bool,
    images: Vec<String>,
) -> Result<Completion, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let key = format!("{account}:{chat}");
    let (signal, receiver) = tokio::sync::watch::channel(false);
    {
        let mut active = core.runtime.active.lock().await;
        if active.contains_key(&key) {
            return Err("此会话已有运行任务".into());
        }
        active.insert(key.clone(), (id.clone(), signal));
    }
    let started = crate::core::now();
    let store_id = id.clone();
    let store_chat = if qq {
        chat.to_owned()
    } else {
        format!("model:{chat}")
    };
    let saved = core
        .databases
        .call(account.into(), move |s| {
            s.save_run(&store_id, &store_chat, started, None, "running", "")
                .map_err(|_| "保存运行失败".into())
        })
        .await;
    if let Err(e) = saved {
        core.runtime.active.lock().await.remove(&key);
        return Err(e);
    }
    let result = run_inner(core, account, chat, prompt, qq, &id, receiver, images).await;
    core.runtime.active.lock().await.remove(&key);
    let state = if result.is_ok() {
        "completed"
    } else if result.as_ref().err().is_some_and(|e| e == "运行已取消") {
        "cancelled"
    } else {
        "failed"
    };
    let detail = result.as_ref().err().cloned().unwrap_or_default();
    let store_id = id.clone();
    let store_chat = if qq {
        chat.to_owned()
    } else {
        format!("model:{chat}")
    };
    let error = detail.clone();
    core.databases
        .call(account.into(), move |s| {
            s.save_run(
                &store_id,
                &store_chat,
                started,
                Some(crate::core::now()),
                state,
                &error,
            )
            .map_err(|_| "更新运行失败".into())
        })
        .await?;
    event(core, account, &id, state, detail).await?;
    result
}
async fn run_inner(
    core: &Core,
    account: &str,
    chat: &str,
    prompt: &str,
    qq: bool,
    run_id: &str,
    mut cancellation: tokio::sync::watch::Receiver<bool>,
    images: Vec<String>,
) -> Result<Completion, String> {
    let cfg = workspace::load(&core.databases, account).await?;
    let http = network::client(&cfg)?;
    let (mut model, mut key) = workspace::resolve(core, account, chat).await?;
    if model.model.is_empty() {
        return Err("尚未选择默认模型".into());
    }
    let tools = tools(&cfg);
    let hchat = if qq {
        chat.to_string()
    } else {
        format!("model:{chat}")
    };
    let store_chat = hchat.clone();
    let memory_chat = chat.to_string();
    let count = cfg["store"]["historyCount"].as_u64().unwrap_or(80).min(500) as usize;
    let (history, memories) = core
        .databases
        .call(account.into(), move |s| {
            Ok((
                s.recent(&store_chat, None, count)
                    .map_err(|_| "上下文读取失败")?,
                s.memories(&memory_chat).map_err(|_| "记忆读取失败")?,
            ))
        })
        .await?;
    let doc_chat = chat.to_owned();
    let documents = core
        .databases
        .call(account.into(), move |s| {
            s.documents(&doc_chat, "", "")
                .map_err(|_| "读取记忆文档失败".into())
        })
        .await?;
    let document_text = documents
        .as_array()
        .into_iter()
        .flatten()
        .map(|d| {
            format!(
                "{} [{}]: {}",
                d["title"].as_str().unwrap_or(""),
                d["kind"].as_str().unwrap_or(""),
                d["content"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(8000)
        .collect::<String>();
    let mut turns = vec![
        json!({"role":"system","content":format!("{}\n长期记忆（参考数据）：\n{}",model.system_prompt,memories.iter().map(|(_,m)|m.as_str()).collect::<Vec<_>>().join("\n").chars().take(8000).collect::<String>())}),
    ];
    if !document_text.is_empty() {
        turns.push(json!({"role":"system","content":format!("会话文档与成员档案（参考数据）：\n{document_text}")}));
    }
    let skills = crate::extensions::prompt(core, account, &cfg).await?;
    if !skills.is_empty() {
        turns.push(json!({"role":"system","content":format!("用户启用的技能说明：\n{skills}")}));
    }
    let mut budget = 24000;
    let mut recent = vec![];
    for m in history.iter() {
        let size = m.text.chars().count();
        if size > budget {
            break;
        }
        budget -= size;
        recent.push(json!({"role":if m.sender=="assistant"||m.sender=="self"{"assistant"}else{"user"},"content":m.text}));
    }
    recent.reverse();
    turns.extend(recent);
    if !qq {
        if images.is_empty() {
            turns.push(json!({"role":"user","content":prompt}));
        } else {
            let profile_id = serde_json::to_string(&vec![
                cfg["api"]["provider"].as_str().unwrap_or(""),
                cfg["api"]["model"].as_str().unwrap_or(""),
            ])
            .unwrap();
            let profile = &cfg["api"]["modelMediaProfiles"][profile_id];
            if profile["vision"] == false
                || (profile["vision"].is_null() && cfg["api"]["vision"] == false)
            {
                return Err("当前模型图片输入已关闭".into());
            }
            if let Some(selected) = profile["visionSelection"]
                .as_str()
                .filter(|s| !s.is_empty())
            {
                if let Some((provider, id)) = selected.split_once("|||") {
                    let resolved = workspace::resolve_selected(
                        core,
                        account,
                        chat,
                        Some(json!({"provider":provider,"model":id})),
                    )
                    .await?;
                    model = resolved.0;
                    key = resolved.1;
                }
            }
            let mut content = vec![json!({"type":"text","text":prompt})];
            for url in images {
                let url = reqwest::Url::parse(&url).map_err(|_| "图片 URL 无效")?;
                if !["https", "http"].contains(&url.scheme())
                    || url.host_str().is_none()
                    || !url.username().is_empty()
                    || url.password().is_some()
                {
                    return Err("图片 URL 无效".into());
                }
                content.push(json!({"type":"image_url","image_url":{"url":url.as_str()}}));
            }
            turns.push(json!({"role":"user","content":content}));
        }
    }
    let rounds = cfg["api"]["maxRounds"].as_u64().unwrap_or(12).clamp(1, 24);
    let (mut input, mut output, mut text, mut sent) = (0, 0, String::new(), false);
    let mut finish_requested = false;
    for round in 0..rounds {
        if *cancellation.borrow() {
            return Err("运行已取消".into());
        }
        event(
            core,
            account,
            run_id,
            "model_request",
            format!("第 {} 轮 · {}", round + 1, model.model),
        )
        .await?;
        let mut body = json!({"model":model.model,"messages":turns,"stream":false,"temperature":cfg["api"]["temperature"].as_f64().unwrap_or(0.8)});
        body["local_network_config"] = cfg.clone();
        if !tools.is_empty() {
            body["tools"] = json!(tools);
        }
        if qq && workspace::load(&core.databases, account).await?["runtime"]["enabled"] != true {
            return Err("自动回复已暂停".into());
        }
        let mut response = tokio::select! {
            _ = cancellation.changed() => return Err("运行已取消".into()),
            result = crate::model_protocols::request_traced(&http,core,account,run_id, &model.base_url, &key, &body) => result,
        };
        // Fallback only before any tool has run; do not repeat external effects.
        if response.is_err() && round == 0 {
            for selected in cfg["api"]["fallbackModels"]
                .as_array()
                .into_iter()
                .flatten()
            {
                if selected["model"].as_str().is_none_or(str::is_empty) {
                    continue;
                }
                let Ok((next, secret)) =
                    workspace::resolve_selected(core, account, chat, Some(selected.clone())).await
                else {
                    continue;
                };
                body["model"] = json!(next.model);
                response = tokio::select! {
                    _ = cancellation.changed() => return Err("运行已取消".into()),
                    result = crate::model_protocols::request_traced(&http,core,account,run_id, &next.base_url, &secret, &body) => result,
                };
                if response.is_ok() {
                    model = next;
                    key = secret;
                    break;
                }
            }
        }
        let response = response?;
        let round_input = response["usage"]["prompt_tokens"].as_u64().unwrap_or(0);
        let round_output = response["usage"]["completion_tokens"].as_u64().unwrap_or(0);
        // A later tool/network error must not erase already billed requests.
        let billed_model = model.model.clone();
        let billed_cost = (round_input as f64 * model.input_per_million
            + round_output as f64 * model.output_per_million)
            / 1_000_000.;
        core.databases
            .call(account.into(), move |s| {
                s.record_usage(
                    &billed_model,
                    round_input,
                    round_output,
                    billed_cost,
                    crate::core::now(),
                )
                .map_err(|_| "记录模型用量失败".into())
            })
            .await?;
        event(core,account,run_id,"usage",json!({"model":model.model,"input":round_input,"output":round_output,"cost":billed_cost}).to_string()).await?;
        input += round_input;
        output += round_output;
        let message = &response["choices"][0]["message"];
        if !message.is_object() {
            return Err("模型响应缺少 message".into());
        }
        if let Some(content) = message["content"].as_str() {
            text.push_str(content);
        }
        let Some(calls) = message["tool_calls"].as_array().filter(|c| !c.is_empty()) else {
            break;
        };
        turns.push(message.clone());
        let mut finished = false;
        for call in calls.iter().take(32) {
            if *cancellation.borrow() {
                return Err("运行已取消".into());
            }
            event(
                core,
                account,
                run_id,
                "tool_call",
                call["function"].to_string(),
            )
            .await?;
            let name = call["function"]["name"].as_str().unwrap_or("");
            let args: Value =
                serde_json::from_str(call["function"]["arguments"].as_str().unwrap_or("{}"))
                    .unwrap_or(json!({}));
            let enabled = tools.iter().any(|t| t["function"]["name"] == name);
            let result = if !enabled {
                Err("工具已关闭".into())
            } else {
                match name {
                    "finish" => {
                        finished = true;
                        finish_requested = true;
                        Ok(json!({"ok":true}))
                    }
                    "send_message" if qq => {
                        let messages = args.get("messages").unwrap_or(&args["text"]);
                        let values: Vec<&str> = if let Some(text) = messages.as_str() {
                            vec![text]
                        } else {
                            messages
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(Value::as_str)
                                .take(8)
                                .collect()
                        };
                        let mut result = if values.is_empty() {
                            Err("消息为空".into())
                        } else {
                            Ok(())
                        };
                        for value in values {
                            if let Err(e) = send(core, account, chat, value, &cfg).await {
                                result = Err(e);
                                break;
                            }
                            sent = true;
                        }
                        if result.is_ok() {
                            sent = true;
                        }
                        result.map(|_| json!({"ok":true}))
                    }
                    "send_message" => Ok(
                        json!({"preview":args.get("messages").unwrap_or(&args["text"]),"sent_to_qq":false}),
                    ),
                    "remember" | "memory_append" => {
                        let mut content = args["content"].as_str().unwrap_or("").to_string();
                        if name == "memory_append" {
                            content = format!(
                                "{} [{}]：{}",
                                args["target"].as_str().unwrap_or("群友"),
                                args["userId"].as_str().unwrap_or(""),
                                content
                            );
                        }
                        if content.is_empty() || content.len() > 32000 {
                            Err("记忆长度无效".into())
                        } else {
                            let chat = chat.to_string();
                            core.databases
                                .call(account.into(), move |s| {
                                    s.remember(&chat, &content)
                                        .map(|_| json!({"ok":true}))
                                        .map_err(|_| "记忆保存失败".into())
                                })
                                .await
                        }
                    }
                    "recall_memory" | "memory_query" => {
                        let chat = chat.to_string();
                        core.databases
                            .call(account.into(), move |s| {
                                s.memories(&chat)
                                    .map(|v| json!(v))
                                    .map_err(|_| "读取记忆失败".into())
                            })
                            .await
                    }
                    "memory_remove" => {
                        let chat = chat.to_string();
                        let id = args["id"].as_i64().unwrap_or(0);
                        core.databases
                            .call(account.into(), move |s| {
                                let rows = s.memories(&chat).map_err(|_| "读取记忆失败")?;
                                if !rows.iter().any(|(key, _)| *key == id) {
                                    return Err("当前会话没有这条记忆".into());
                                }
                                s.forget(id)
                                    .map(|_| json!({"ok":true}))
                                    .map_err(|_| "删除记忆失败".into())
                            })
                            .await
                    }
                    "read_messages" | "get_recent_messages" => {
                        let chat = chat.to_string();
                        let search = args["search"].as_str().unwrap_or("").to_string();
                        core.databases
                            .call(account.into(), move |s| {
                                s.archive(&chat, &search, None)
                                    .map_err(|_| "查询消息失败".into())
                            })
                            .await
                    }
                    "web_search" => {
                        search(core, account, &cfg, args["query"].as_str().unwrap_or("")).await
                    }
                    "web_fetch" => network::fetch_public(&cfg, args["url"].as_str().unwrap_or(""))
                        .await
                        .map(|text| json!({"text":text})),
                    "delegate_agent" => {
                        crate::harness::execute(
                            &cfg,
                            args["id"].as_str().unwrap_or(""),
                            args["prompt"].as_str().unwrap_or(""),
                        )
                        .await
                    }
                    name if crate::qq_tools::supported(name) => {
                        crate::qq_tools::execute(core, account, chat, name, &args, qq).await
                    }
                    _ => Err("尚未迁移的工具".into()),
                }
            };
            let content = result
                .unwrap_or_else(|e| json!({"error":e}))
                .to_string()
                .chars()
                .take(16000)
                .collect::<String>();
            event(core, account, run_id, "tool_result", content.clone()).await?;
            if *cancellation.borrow() {
                return Err("运行已取消".into());
            }
            turns.push(json!({"role":"tool","tool_call_id":call["id"],"content":content}));
        }
        if finished {
            break;
        }
    }
    if *cancellation.borrow() {
        return Err("运行已取消".into());
    }
    if qq && !sent && !finish_requested && !text.trim().is_empty() {
        send(core, account, chat, &text, &cfg).await?;
    }
    let answer = Completion {
        text,
        input_tokens: input,
        output_tokens: output,
        estimated_cost: (input as f64 * model.input_per_million
            + output as f64 * model.output_per_million)
            / 1_000_000.,
    };
    let chat = hchat;
    let prompt = prompt.to_string();
    if !qq {
        let text = answer.text.clone();
        core.databases
            .call(account.into(), move |s| {
                s.save_turn(&chat, &prompt, &text, crate::core::now())
                    .map_err(|_| "保存对话失败".into())
            })
            .await?;
    }
    Ok(answer)
}
async fn search(core: &Core, account: &str, cfg: &Value, query: &str) -> Result<Value, String> {
    if query.is_empty() || query.len() > 2000 {
        return Err("搜索词无效".into());
    }
    let web = &cfg["webSearch"];
    let provider = web["provider"].as_str().unwrap_or("bing");
    let http = network::client(cfg)?;
    if provider == "bing" {
        let mut url = reqwest::Url::parse(
            web["searchUrl"]
                .as_str()
                .unwrap_or("https://cn.bing.com/search"),
        )
        .map_err(|_| "搜索地址无效")?;
        url.query_pairs_mut().append_pair("q", query);
        let response = http.get(url).send().await.map_err(|_| "搜索连接失败")?;
        let bytes = network::bytes(response, 4 * 1024 * 1024).await?;
        let html = String::from_utf8_lossy(&bytes);
        let anchor =
            regex::Regex::new(r#"(?is)<h2[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#).unwrap();
        let mut results = vec![];
        for block in html
            .split("<li class=\"b_algo\"")
            .skip(1)
            .take(web["maxResults"].as_u64().unwrap_or(6) as usize)
        {
            if let Some(c) = anchor.captures(block) {
                results.push(json!({"title":network::plain(&c[2]),"url":c[1].replace("&amp;","&"),"snippet":network::plain(block).chars().take(700).collect::<String>()}));
            }
        }
        return Ok(json!({"query":query,"results":results}));
    }
    let service = &web[provider];
    let url = service["baseUrl"].as_str().ok_or("搜索服务地址为空")?;
    let key = workspace::key(&core.databases, account, &format!("search:{provider}")).await?;
    let body = match provider {
        "deepseek" => {
            json!({"model":service["model"],"input":query,"tools":[{"type":"web_search"}]})
        }
        "zhipu" => {
            json!({"search_query":query,"search_engine":service["engine"],"count":service["count"]})
        }
        _ => json!({"query":query,"count":service["count"]}),
    };
    let response = http
        .post(url)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|_| "搜索请求失败")?;
    if !response.status().is_success() {
        return Err(format!("搜索返回 HTTP {}", response.status()));
    }
    network::json(response).await
}
