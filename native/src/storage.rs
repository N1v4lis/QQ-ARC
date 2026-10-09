use rusqlite::{Connection, params};
use std::path::{Path, PathBuf};

pub struct AccountStore {
    connection: Connection,
    cached_workspace: Option<serde_json::Value>,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
pub struct Message {
    pub id: i64,
    pub chat: String,
    pub sender: String,
    pub text: String,
    pub timestamp: i64,
}

// This prototype never opens or upgrades the archived Node/V8 database.
impl AccountStore {
    pub fn open(root: &Path, account: &str) -> Result<Self, Box<dyn std::error::Error>> {
        if account.is_empty()
            || !account
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err("invalid account identifier".into());
        }
        let directory = root.join("accounts").join(account);
        std::fs::create_dir_all(&directory)?;
        let connection = Connection::open(directory.join("native-prototype.sqlite"))?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=-2048;
             CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS messages(
                 id INTEGER PRIMARY KEY, chat TEXT NOT NULL, sender TEXT NOT NULL,
                 text TEXT NOT NULL, timestamp INTEGER NOT NULL);
             CREATE INDEX IF NOT EXISTS messages_chat_id ON messages(chat, id);
             CREATE TABLE IF NOT EXISTS incoming_receipts(chat TEXT NOT NULL,message_id INTEGER NOT NULL,PRIMARY KEY(chat,message_id));
             CREATE TABLE IF NOT EXISTS message_media(message_id INTEGER NOT NULL,position INTEGER NOT NULL,kind TEXT,url TEXT,file TEXT,summary TEXT,PRIMARY KEY(message_id,position));
             CREATE TABLE IF NOT EXISTS message_replies(message_id INTEGER PRIMARY KEY,sender TEXT,text TEXT);
             CREATE TABLE IF NOT EXISTS imported_rows(source TEXT NOT NULL,source_id TEXT NOT NULL,message_id INTEGER NOT NULL,PRIMARY KEY(source,source_id));
             CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY, chat TEXT NOT NULL, content TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS usage(id INTEGER PRIMARY KEY, model TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cost REAL NOT NULL, timestamp INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,chat TEXT NOT NULL,started INTEGER NOT NULL,finished INTEGER,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
             CREATE INDEX IF NOT EXISTS runs_started ON runs(started DESC);
             PRAGMA user_version=1;",
        )?;
        Ok(Self {
            connection,
            cached_workspace: None,
        })
    }

    pub fn append(
        &mut self,
        chat: &str,
        sender: &str,
        text: &str,
        timestamp: i64,
    ) -> rusqlite::Result<i64> {
        self.connection.execute(
            "INSERT INTO messages(chat,sender,text,timestamp) VALUES(?1,?2,?3,?4)",
            params![chat, sender, text, timestamp],
        )?;
        Ok(self.connection.last_insert_rowid())
    }

    pub fn receive(&mut self, event: &crate::onebot::IncomingMessage) -> rusqlite::Result<bool> {
        let chat = event.chat_key();
        let tx = self.connection.transaction()?;
        if tx.execute(
            "INSERT OR IGNORE INTO incoming_receipts(chat,message_id) VALUES(?1,?2)",
            params![chat, event.message_id],
        )? == 0
        {
            return Ok(false);
        }
        tx.execute(
            "INSERT INTO messages(chat,sender,text,timestamp) VALUES(?1,?2,?3,?4)",
            params![
                chat,
                event.user_id.to_string(),
                event.raw_message,
                event.time
            ],
        )?;
        tx.commit()?;
        Ok(true)
    }

    // JSON is accepted only at the explicit official-format migration boundary.
    // The destination always stores message and media fields in SQL columns.
    pub fn import_official_messages(
        &mut self,
        source: &str,
        value: &serde_json::Value,
    ) -> Result<usize, String> {
        let chat = value["chatKey"]
            .as_str()
            .filter(|s| s.starts_with("group:") || s.starts_with("private:"))
            .ok_or("迁入文件缺少有效 chatKey")?;
        let rows = value["messages"]
            .as_array()
            .ok_or("迁入文件缺少 messages 数组")?;
        if rows.len() > 1_000_000 {
            return Err("单个迁入文件消息过多".into());
        }
        let tx = self
            .connection
            .transaction()
            .map_err(|_| "迁入事务创建失败")?;
        let mut count = 0;
        for row in rows {
            let source_id = row["id"]
                .as_i64()
                .map(|n| n.to_string())
                .ok_or("消息缺少有效本地 id")?;
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM imported_rows WHERE source=?1 AND source_id=?2)",
                    params![source, source_id],
                    |r| r.get(0),
                )
                .map_err(|_| "迁入状态查询失败")?;
            if exists {
                continue;
            }
            let text = row["text"].as_str().ok_or("消息正文不是文本，迁入已回滚")?;
            let sender = if row["self"] == true {
                "self".into()
            } else {
                row["senderId"]
                    .as_str()
                    .map(String::from)
                    .or_else(|| row["senderId"].as_i64().map(|n| n.to_string()))
                    .unwrap_or_default()
            };
            let time = (row["ts"].as_f64().unwrap_or(0.) / 1000.).floor() as i64;
            tx.execute(
                "INSERT INTO messages(chat,sender,text,timestamp) VALUES(?1,?2,?3,?4)",
                params![chat, sender, text, time],
            )
            .map_err(|_| "消息迁入失败")?;
            let id = tx.last_insert_rowid();
            for (position, media) in row["media"].as_array().into_iter().flatten().enumerate() {
                tx.execute("INSERT INTO message_media(message_id,position,kind,url,file,summary) VALUES(?1,?2,?3,?4,?5,?6)",params![id,position as i64,media["kind"].as_str(),media["url"].as_str(),media["file"].as_str(),media["summary"].as_str()]).map_err(|_|"媒体迁入失败")?;
            }
            if let Some(reply) = row["reply"].as_object() {
                tx.execute(
                    "INSERT INTO message_replies(message_id,sender,text) VALUES(?1,?2,?3)",
                    params![
                        id,
                        reply.get("sender").and_then(serde_json::Value::as_str),
                        reply.get("text").and_then(serde_json::Value::as_str)
                    ],
                )
                .map_err(|_| "引用迁入失败")?;
            }
            tx.execute(
                "INSERT INTO imported_rows(source,source_id,message_id) VALUES(?1,?2,?3)",
                params![source, source_id, id],
            )
            .map_err(|_| "迁入状态记录失败")?;
            count += 1;
        }
        tx.commit().map_err(|_| "迁入提交失败")?;
        Ok(count)
    }
    // Keyset pagination avoids an increasingly expensive OFFSET for deep history.
    pub fn recent(
        &self,
        chat: &str,
        before: Option<i64>,
        limit: usize,
    ) -> rusqlite::Result<Vec<Message>> {
        let mut query = self.connection.prepare(
            "SELECT id,chat,sender,text,timestamp FROM messages WHERE chat=?1 AND id<?2 ORDER BY id DESC LIMIT ?3",
        )?;
        query
            .query_map(
                params![chat, before.unwrap_or(i64::MAX), limit.min(500) as i64],
                |row| {
                    Ok(Message {
                        id: row.get(0)?,
                        chat: row.get(1)?,
                        sender: row.get(2)?,
                        text: row.get(3)?,
                        timestamp: row.get(4)?,
                    })
                },
            )?
            .collect()
    }

    pub fn chats(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self
            .connection
            .prepare("SELECT chat FROM messages GROUP BY chat ORDER BY MAX(id) DESC")?;
        stmt.query_map([], |row| row.get(0))?.collect()
    }

    pub fn remember(&mut self, chat: &str, content: &str) -> rusqlite::Result<()> {
        self.connection.execute(
            "INSERT INTO memories(chat,content) VALUES(?1,?2)",
            params![chat, content],
        )?;
        Ok(())
    }
    pub fn memories(&self, chat: &str) -> rusqlite::Result<Vec<(i64, String)>> {
        let mut query = self
            .connection
            .prepare("SELECT id,content FROM memories WHERE chat=?1 ORDER BY id DESC LIMIT 100")?;
        query
            .query_map([chat], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect()
    }
    pub fn forget(&mut self, id: i64) -> rusqlite::Result<()> {
        self.connection
            .execute("DELETE FROM memories WHERE id=?1", [id])?;
        Ok(())
    }
    pub fn record_usage(
        &mut self,
        model: &str,
        input: u64,
        output: u64,
        cost: f64,
        timestamp: i64,
    ) -> rusqlite::Result<()> {
        self.connection.execute(
            "INSERT INTO usage(model,input,output,cost,timestamp) VALUES(?1,?2,?3,?4,?5)",
            params![model, input, output, cost, timestamp],
        )?;
        Ok(())
    }
    pub fn save_turn(
        &mut self,
        chat: &str,
        prompt: &str,
        answer: &str,
        timestamp: i64,
    ) -> rusqlite::Result<()> {
        let tx = self.connection.transaction()?;
        for (sender, text) in [("user", prompt), ("assistant", answer)] {
            tx.execute(
                "INSERT INTO messages(chat,sender,text,timestamp) VALUES(?1,?2,?3,?4)",
                params![chat, sender, text, timestamp],
            )?;
        }
        tx.commit()
    }
    pub fn stats(&self) -> rusqlite::Result<serde_json::Value> {
        let messages: i64 =
            self.connection
                .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?;
        self.connection.query_row("SELECT COUNT(*),COALESCE(SUM(input),0),COALESCE(SUM(output),0),COALESCE(SUM(cost),0) FROM usage",[],|row|Ok(serde_json::json!({"messages":messages,"calls":row.get::<_,i64>(0)?,"input_tokens":row.get::<_,i64>(1)?,"output_tokens":row.get::<_,i64>(2)?,"estimated_cost":row.get::<_,f64>(3)?})))
    }

    // Keep a completed turn and its accounting inseparable, including on failure.
    pub fn save_completion(
        &mut self,
        chat: &str,
        prompt: &str,
        model: &str,
        completion: &crate::model::Completion,
        timestamp: i64,
    ) -> rusqlite::Result<()> {
        let tx = self.connection.transaction()?;
        tx.execute(
            "INSERT INTO usage(model,input,output,cost,timestamp) VALUES(?1,?2,?3,?4,?5)",
            params![
                model,
                completion.input_tokens,
                completion.output_tokens,
                completion.estimated_cost,
                timestamp
            ],
        )?;
        for (sender, text) in [("user", prompt), ("assistant", completion.text.as_str())] {
            tx.execute(
                "INSERT INTO messages(chat,sender,text,timestamp) VALUES(?1,?2,?3,?4)",
                params![chat, sender, text, timestamp],
            )?;
        }
        tx.commit()
    }

    pub fn preference(&self, key: &str) -> rusqlite::Result<Option<String>> {
        use rusqlite::OptionalExtension;
        self.connection
            .query_row("SELECT value FROM preferences WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()
    }

    pub fn set_preference(&mut self, key: &str, value: &str) -> rusqlite::Result<()> {
        self.connection.execute("INSERT INTO preferences(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value])?;
        if key == "workspace" {
            self.cached_workspace = None;
        }
        Ok(())
    }
    pub fn workspace(&mut self) -> Result<serde_json::Value, String> {
        if let Some(value) = &self.cached_workspace {
            return Ok(value.clone());
        }
        let mut cfg = crate::workspace::defaults();
        if let Some(saved) = self.preference("workspace").map_err(|_| "读取配置失败")? {
            crate::workspace::merge(
                &mut cfg,
                serde_json::from_str(&saved).map_err(|_| "配置损坏")?,
            );
        }
        self.cached_workspace = Some(cfg.clone());
        Ok(cfg)
    }

    pub fn save_preferences(&mut self, values: &[(String, String)]) -> rusqlite::Result<()> {
        let tx = self.connection.transaction()?;
        for (key, value) in values {
            tx.execute("INSERT INTO preferences(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value])?;
        }
        tx.commit()?;
        if values.iter().any(|(key, _)| key == "workspace") {
            self.cached_workspace = None;
        }
        Ok(())
    }
    pub fn save_run(
        &mut self,
        id: &str,
        chat: &str,
        started: i64,
        finished: Option<i64>,
        status: &str,
        error: &str,
    ) -> rusqlite::Result<()> {
        self.connection.execute("INSERT INTO runs(id,chat,started,finished,status,error) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET finished=excluded.finished,status=excluded.status,error=excluded.error",params![id,chat,started,finished,status,error])?;
        Ok(())
    }
    pub fn runs(&self) -> rusqlite::Result<serde_json::Value> {
        let mut q=self.connection.prepare("SELECT id,chat,started,finished,status,error FROM runs ORDER BY started DESC LIMIT 200")?;
        let values:Vec<serde_json::Value>=q.query_map([],|r|Ok(serde_json::json!({"id":r.get::<_,String>(0)?,"chat":r.get::<_,String>(1)?,"started":r.get::<_,i64>(2)?,"finished":r.get::<_,Option<i64>>(3)?,"status":r.get::<_,String>(4)?,"error":r.get::<_,String>(5)?})))?.collect::<Result<_,_>>()?;
        Ok(serde_json::json!(values))
    }
    pub fn archive(
        &self,
        chat: &str,
        search: &str,
        before: Option<i64>,
    ) -> rusqlite::Result<serde_json::Value> {
        let mut query=self.connection.prepare("SELECT id,chat,sender,text,timestamp FROM messages WHERE (?1='' OR chat=?1) AND instr(text,?2)>0 AND id<?3 ORDER BY id DESC LIMIT 200")?;
        let rows:Vec<serde_json::Value>=query.query_map(params![chat,search,before.unwrap_or(i64::MAX)],|r|Ok(serde_json::json!({"id":r.get::<_,i64>(0)?,"chat":r.get::<_,String>(1)?,"sender":r.get::<_,String>(2)?,"text":r.get::<_,String>(3)?,"timestamp":r.get::<_,i64>(4)?})))?.collect::<Result<_,_>>()?;
        Ok(serde_json::json!(rows))
    }
    pub fn delete_chat(&mut self, chat: &str) -> rusqlite::Result<usize> {
        let tx = self.connection.transaction()?;
        for table in ["message_media", "message_replies", "imported_rows"] {
            tx.execute(&format!("DELETE FROM {table} WHERE message_id IN (SELECT id FROM messages WHERE chat=?1)"), [chat])?;
        }
        let deleted = tx.execute("DELETE FROM messages WHERE chat=?1", [chat])?;
        tx.commit()?;
        Ok(deleted)
    }
    pub fn usage_breakdown(&self, since: i64) -> rusqlite::Result<serde_json::Value> {
        let mut query=self.connection.prepare("SELECT model,COUNT(*),SUM(input),SUM(output),SUM(cost) FROM usage WHERE timestamp>=?1 GROUP BY model ORDER BY SUM(cost) DESC")?;
        let models:Vec<serde_json::Value>=query.query_map([since],|r|Ok(serde_json::json!({"model":r.get::<_,String>(0)?,"calls":r.get::<_,i64>(1)?,"input":r.get::<_,i64>(2)?,"output":r.get::<_,i64>(3)?,"cost":r.get::<_,f64>(4)?})))?.collect::<Result<_,_>>()?;
        let mut query=self.connection.prepare("SELECT strftime('%Y-%m-%d',timestamp,'unixepoch','localtime'),COUNT(*),SUM(input),SUM(output),SUM(cost) FROM usage WHERE timestamp>=?1 GROUP BY 1 ORDER BY 1 DESC")?;
        let days:Vec<serde_json::Value>=query.query_map([since],|r|Ok(serde_json::json!({"date":r.get::<_,String>(0)?,"calls":r.get::<_,i64>(1)?,"input":r.get::<_,i64>(2)?,"output":r.get::<_,i64>(3)?,"cost":r.get::<_,f64>(4)?})))?.collect::<Result<_,_>>()?;
        Ok(serde_json::json!({"models":models,"days":days}))
    }
}

pub fn default_data_root() -> PathBuf {
    if let Some(root) = std::env::var_os("QQAF_NATIVE_DATA_DIR") {
        return root.into();
    }
    if let Some(root) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(root)
            .join("QQARCFOX")
            .join(if cfg!(feature = "clean-release") {
                "RS0.1"
            } else {
                "native-prototype"
            });
    }
    if let Some(root) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(root).join("qqarcfox-native-prototype");
    }
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local/share/qqarcfox-native-prototype")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "qqaf-native-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn separate_accounts_persist_exact_text_and_page_without_duplicates() {
        let root = temporary_root();
        {
            let mut a = AccountStore::open(&root, "account-a").unwrap();
            let mut b = AccountStore::open(&root, "account-b").unwrap();
            for n in 0..6 {
                a.append("group:1", "sender", &format!("你好🦊\0{n}"), n)
                    .unwrap();
            }
            b.append("group:1", "sender", "isolated", 7).unwrap();
            let first = a.recent("group:1", None, 3).unwrap();
            let second = a
                .recent("group:1", Some(first.last().unwrap().id), 3)
                .unwrap();
            assert_eq!(first.len(), 3);
            assert_eq!(second.len(), 3);
            assert!(first.iter().all(|a| second.iter().all(|b| a.id != b.id)));
            assert_eq!(b.recent("group:1", None, 3).unwrap()[0].text, "isolated");
            a.set_preference("winefox-enabled", "false").unwrap();
        }
        let reopened = AccountStore::open(&root, "account-a").unwrap();
        assert_eq!(
            reopened.recent("group:1", None, 1).unwrap()[0].text,
            "你好🦊\05"
        );
        assert_eq!(
            reopened.preference("winefox-enabled").unwrap().as_deref(),
            Some("false")
        );
        assert!(AccountStore::open(&root, "../old-client").is_err());
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }
}
