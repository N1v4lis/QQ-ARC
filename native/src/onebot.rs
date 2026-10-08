use serde::{Deserialize, Serialize};

// JSON is the OneBot wire protocol, never the message storage format.
#[derive(Debug, Serialize)]
pub struct Action<'a> {
    pub action: &'a str,
    pub params: serde_json::Value,
    pub echo: &'a str,
}

pub fn version_probe() -> String {
    serde_json::to_string(&Action {
        action: "get_version_info",
        params: serde_json::json!({}),
        echo: "qqaf-native-version-probe",
    })
    .expect("serialize fixed OneBot action")
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
pub struct IncomingMessage {
    pub self_id: i64,
    pub user_id: i64,
    pub group_id: Option<i64>,
    pub message_id: i64,
    pub time: i64,
    pub raw_message: String,
}

impl IncomingMessage {
    pub fn chat_key(&self) -> String {
        match self.group_id {
            Some(id) => format!("group:{id}"),
            None => format!("private:{}", self.user_id),
        }
    }
}

// Only message events are accepted here; no outbound QQ action is triggered.
pub fn parse_message(value: &str) -> Result<Option<IncomingMessage>, serde_json::Error> {
    let value: serde_json::Value = serde_json::from_str(value)?;
    if value.get("post_type").and_then(|v| v.as_str()) != Some("message") {
        return Ok(None);
    }
    serde_json::from_value(value).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routes_by_receiving_account_and_chat() {
        let message = parse_message(r#"{"post_type":"message","self_id":123,"user_id":456,"group_id":789,"message_id":1,"time":2,"raw_message":"你好"}"#).unwrap().unwrap();
        assert_eq!(message.self_id, 123);
        assert_eq!(message.chat_key(), "group:789");
        assert_eq!(message.raw_message, "你好");
        assert!(
            parse_message(r#"{"post_type":"meta_event"}"#)
                .unwrap()
                .is_none()
        );
        let probe: serde_json::Value = serde_json::from_str(&version_probe()).unwrap();
        assert_eq!(probe["action"], "get_version_info");
    }
}
