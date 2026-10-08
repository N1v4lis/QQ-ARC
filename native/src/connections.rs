use crate::{core::DatabasePool, onebot::parse_message};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};
type Reply = oneshot::Sender<Result<Value, String>>;
#[derive(Clone, Default)]
pub struct Connections {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}
struct Session {
    sender: mpsc::Sender<(Value, Reply)>,
    task: tokio::task::JoinHandle<()>,
}
impl Connections {
    pub async fn connect(
        &self,
        account: String,
        address: String,
        access_token: String,
        databases: DatabasePool,
    ) -> Result<(), String> {
        let url = reqwest::Url::parse(&address).map_err(|_| "OneBot 地址无效")?;
        if !matches!(url.scheme(), "ws" | "wss")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
        {
            return Err("需要不含凭据或查询参数的 OneBot 正向 WS 地址".into());
        }
        if account.is_empty() || !account.bytes().all(|c| c.is_ascii_digit()) {
            return Err("QQ 账号必须为数字".into());
        }
        let mut request = address
            .into_client_request()
            .map_err(|_| "OneBot 地址无效")?;
        if !access_token.is_empty() {
            request.headers_mut().insert(
                "Authorization",
                format!("Bearer {access_token}")
                    .parse()
                    .map_err(|_| "OneBot token 无效")?,
            );
        }
        let (socket, _) =
            tokio::time::timeout(std::time::Duration::from_secs(10), connect_async(request))
                .await
                .map_err(|_| "OneBot 连接超时")?
                .map_err(|_| "OneBot 连接失败")?;
        self.disconnect(&account).await;
        let (mut sink, mut stream) = socket.split();
        let (sender, mut receiver) = mpsc::channel::<(Value, Reply)>(32);
        let account_task = account.clone();
        let task = tokio::spawn(async move {
            let mut pending: HashMap<String, Reply> = HashMap::new();
            loop {
                tokio::select! {
                    outgoing=receiver.recv()=>{
                        let Some((mut action,reply))=outgoing else{break;};pending.retain(|_,r|!r.is_closed());
                        let echo=uuid::Uuid::new_v4().to_string();action["echo"]=json!(echo);
                        if sink.send(Message::Text(action.to_string().into())).await.is_err(){let _=reply.send(Err("OneBot 已断开".into()));break;}
                        pending.insert(echo,reply);
                    }
                    incoming=stream.next()=>{
                        let Some(Ok(message))=incoming else{break;};match message{
                            Message::Text(text)=>{
                                if let Ok(value)=serde_json::from_str::<Value>(&text){if let Some(echo)=value["echo"].as_str(){if let Some(reply)=pending.remove(echo){let result=if value["status"]=="ok"{Ok(value["data"].clone())}else{Err("OneBot 操作失败".into())};let _=reply.send(result);}}}
                                if let Ok(Some(event))=parse_message(&text){if event.self_id.to_string()!=account_task{continue;}let chat=event.chat_key();let _=databases.call(account_task.clone(),move|store|store.append(&chat,&event.user_id.to_string(),&event.raw_message,event.time).map(|_|()).map_err(|_|"消息写入失败".into())).await;}
                            }
                            Message::Ping(bytes)=>{if sink.send(Message::Pong(bytes)).await.is_err(){break;}}
                            Message::Close(_)=>break,_=>{}
                        }
                    }
                }
            }
            for (_, reply) in pending {
                let _ = reply.send(Err("OneBot 已断开".into()));
            }
        });
        self.sessions
            .lock()
            .await
            .insert(account, Session { sender, task });
        Ok(())
    }
    pub async fn disconnect(&self, account: &str) {
        if let Some(session) = self.sessions.lock().await.remove(account) {
            session.task.abort();
        }
    }
    pub async fn status(&self) -> Vec<String> {
        self.sessions
            .lock()
            .await
            .iter()
            .filter(|(_, s)| !s.task.is_finished())
            .map(|(id, _)| id.clone())
            .collect()
    }
    pub async fn action(&self, account: &str, action: Value) -> Result<Value, String> {
        let sender = self
            .sessions
            .lock()
            .await
            .get(account)
            .map(|s| s.sender.clone())
            .ok_or("该账号未连接 OneBot")?;
        let (reply, receive) = oneshot::channel();
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            sender
                .send((action, reply))
                .await
                .map_err(|_| "OneBot 已断开".to_string())?;
            receive.await.map_err(|_| "OneBot 已断开".to_string())?
        })
        .await
        .map_err(|_| "OneBot 操作超时".to_string())?
    }
}
