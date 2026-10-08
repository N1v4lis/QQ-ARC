use rusqlite::{Connection, params};
use std::path::{Path, PathBuf};

pub struct AccountStore {
    connection: Connection,
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
             CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY, chat TEXT NOT NULL, content TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS usage(id INTEGER PRIMARY KEY, model TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cost REAL NOT NULL, timestamp INTEGER NOT NULL);
             PRAGMA user_version=1;",
        )?;
        Ok(Self { connection })
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
        Ok(())
    }
}

pub fn default_data_root() -> PathBuf {
    if let Some(root) = std::env::var_os("QQAF_NATIVE_DATA_DIR") {
        return root.into();
    }
    if let Some(root) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(root)
            .join("QQARCFOX")
            .join("native-prototype");
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
