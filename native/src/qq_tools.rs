//! Scoped OneBot tools. Mutating group-management tools require explicit enablement.
use crate::core::Core;
use serde_json::{Value, json};
const QUERIES: &[&str] = &[
    "get_login_info",
    "get_group_list",
    "get_friend_list",
    "get_group_member_list",
    "get_group_member_info",
    "get_stranger_info",
    "get_message_detail",
];
const MANAGEMENT: &[&str] = &[
    "delete_message",
    "set_group_ban",
    "set_group_kick",
    "set_group_card",
    "group_poke",
];
pub fn specs(cfg: &Value) -> Vec<Value> {
    if cfg["tools"]["enabled"] != true {
        return vec![];
    }
    QUERIES.iter().chain(MANAGEMENT).chain(["send_image","send_at"].iter()).filter(|id|{
        let admin=MANAGEMENT.contains(id);
        let category=if admin{"management"}else if id.starts_with("send_"){"messaging"}else{"query"};
        cfg["tools"]["categories"][category]!=false && if admin{cfg["tools"]["overrides"][**id]==true}else{cfg["tools"]["overrides"][**id]!=false}
    }).map(|id|json!({"type":"function","function":{"name":id,"description":format!("OneBot：{id}，仅当前账号/群范围。"),"parameters":{"type":"object","properties":{"user_id":{"type":"integer"},"message_id":{"type":"integer"},"duration":{"type":"integer"},"card":{"type":"string"},"url":{"type":"string"},"text":{"type":"string"}},"required":[]}}})).collect()
}
pub fn prepare(name: &str, chat: &str, args: &Value) -> Result<Value, String> {
    let group = chat
        .strip_prefix("group:")
        .and_then(|v| v.parse::<u64>().ok());
    let user = || {
        args["user_id"]
            .as_u64()
            .filter(|n| *n > 0)
            .ok_or("请提供用户 QQ")
    };
    let message = || {
        args["message_id"]
            .as_i64()
            .filter(|n| *n != 0)
            .ok_or("请提供消息 ID")
    };
    let data = match name {
        "get_login_info" | "get_group_list" | "get_friend_list" => {
            json!({"action":name,"params":{}})
        }
        "get_group_member_list" => {
            json!({"action":name,"params":{"group_id":group.ok_or("此工具需要群聊")?}})
        }
        "get_group_member_info" => {
            json!({"action":name,"params":{"group_id":group.ok_or("此工具需要群聊")?,"user_id":user()?,"no_cache":true}})
        }
        "get_stranger_info" => json!({"action":name,"params":{"user_id":user()?,"no_cache":true}}),
        "get_message_detail" => json!({"action":"get_msg","params":{"message_id":message()?}}),
        "delete_message" => json!({"action":"delete_msg","params":{"message_id":message()?}}),
        "set_group_ban" => {
            json!({"action":name,"params":{"group_id":group.ok_or("此工具需要群聊")?,"user_id":user()?,"duration":args["duration"].as_u64().unwrap_or(60).min(30*86400)}})
        }
        "set_group_kick" => {
            json!({"action":name,"params":{"group_id":group.ok_or("此工具需要群聊")?,"user_id":user()?,"reject_add_request":false}})
        }
        "set_group_card" => {
            json!({"action":name,"params":{"group_id":group.ok_or("此工具需要群聊")?,"user_id":user()?,"card":args["card"].as_str().unwrap_or("").chars().take(60).collect::<String>()}})
        }
        "group_poke" => {
            json!({"action":name,"params":{"group_id":group.ok_or("此工具需要群聊")?,"user_id":user()?}})
        }
        "send_image" | "send_at" => {
            let mut segments = vec![];
            if name == "send_image" {
                let address = args["url"].as_str().ok_or("请提供图片 URL")?;
                let url = reqwest::Url::parse(address).map_err(|_| "图片 URL 无效")?;
                if !["https", "http"].contains(&url.scheme())
                    || url.host_str().is_none()
                    || !url.username().is_empty()
                    || url.password().is_some()
                    || address.len() > 4096
                {
                    return Err("图片只接受不含凭据的 HTTP/HTTPS URL".into());
                }
                segments.push(json!({"type":"image","data":{"file":address}}));
            } else {
                segments.push(json!({"type":"at","data":{"qq":user()?.to_string()}}));
            }
            if let Some(text) = args["text"].as_str() {
                segments.push(json!({"type":"text","data":{"text":text.chars().take(4000).collect::<String>()}}));
            }
            if let Some(group) = group {
                json!({"action":"send_group_msg","params":{"group_id":group,"message":segments}})
            } else {
                let user = chat
                    .strip_prefix("private:")
                    .and_then(|s| s.parse::<u64>().ok())
                    .ok_or("会话标识无效")?;
                json!({"action":"send_private_msg","params":{"user_id":user,"message":segments}})
            }
        }
        _ => return Err("未支持的 OneBot 工具".into()),
    };
    Ok(data)
}
pub fn supported(name: &str) -> bool {
    QUERIES.contains(&name)
        || MANAGEMENT.contains(&name)
        || ["send_image", "send_at"].contains(&name)
}
pub async fn execute(
    core: &Core,
    account: &str,
    chat: &str,
    name: &str,
    args: &Value,
    qq: bool,
) -> Result<Value, String> {
    let action = prepare(name, chat, args)?;
    if !qq && (MANAGEMENT.contains(&name) || name.starts_with("send_")) {
        return Ok(json!({"preview":true,"action":action,"sent":false}));
    }
    core.connections.action(account, action).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn management_requires_opt_in_and_group_scope_cannot_be_overridden() {
        let mut cfg = crate::workspace::defaults();
        cfg["tools"]["enabled"] = json!(true);
        assert!(
            !specs(&cfg)
                .iter()
                .any(|v| v["function"]["name"] == "set_group_ban")
        );
        cfg["tools"]["overrides"]["set_group_ban"] = json!(true);
        assert!(
            specs(&cfg)
                .iter()
                .any(|v| v["function"]["name"] == "set_group_ban")
        );
        let action = prepare(
            "set_group_ban",
            "group:8",
            &json!({"group_id":999,"user_id":123,"duration":u64::MAX}),
        )
        .unwrap();
        assert_eq!(action["params"]["group_id"], 8);
        assert_eq!(action["params"]["duration"], 30 * 86400);
        assert!(prepare("send_image", "group:8", &json!({"url":"file:///private"})).is_err());
        assert!(prepare("set_group_kick", "private:8", &json!({"user_id":123})).is_err());
    }
}
