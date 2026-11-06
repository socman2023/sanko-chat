-- DEDICATED STAGING D1 ONLY. Never run against production D1.
CREATE TABLE IF NOT EXISTS chat_admissions (
 request_id TEXT PRIMARY KEY NOT NULL,day TEXT NOT NULL,month TEXT NOT NULL,
 client_hash TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admissions_day ON chat_admissions(day);
CREATE INDEX IF NOT EXISTS idx_admissions_month ON chat_admissions(month);
CREATE INDEX IF NOT EXISTS idx_admissions_day_client ON chat_admissions(day,client_hash);
CREATE TABLE IF NOT EXISTS chat_turns (
 id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT NOT NULL,
 admission_id TEXT,asked_at INTEGER NOT NULL,question TEXT NOT NULL,
 reply TEXT NOT NULL,model TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'answered'
);
CREATE INDEX IF NOT EXISTS idx_turns_conversation ON chat_turns(conversation_id,asked_at);
CREATE INDEX IF NOT EXISTS idx_turns_retention ON chat_turns(asked_at);
CREATE TABLE IF NOT EXISTS token_usage (
 id INTEGER PRIMARY KEY AUTOINCREMENT,admission_id TEXT NOT NULL,
 attempted_at INTEGER NOT NULL,day TEXT NOT NULL,model TEXT NOT NULL,
 result TEXT NOT NULL,prompt_tokens INTEGER,candidate_tokens INTEGER,
 thoughts_tokens INTEGER,cached_tokens INTEGER,total_tokens INTEGER
);
CREATE INDEX IF NOT EXISTS idx_token_usage_day ON token_usage(day);
CREATE INDEX IF NOT EXISTS idx_token_usage_admission ON token_usage(admission_id);
CREATE TABLE IF NOT EXISTS sanko_canon_chunks (
 id TEXT PRIMARY KEY,source TEXT NOT NULL,scope TEXT NOT NULL,
 priority INTEGER NOT NULL,published_day TEXT NOT NULL,title TEXT NOT NULL,
 content TEXT NOT NULL,search_text TEXT NOT NULL DEFAULT '',
 indexed INTEGER NOT NULL DEFAULT 0
);
