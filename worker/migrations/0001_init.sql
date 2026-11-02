CREATE TABLE IF NOT EXISTS chat_admissions (
  request_id TEXT PRIMARY KEY NOT NULL,
  day TEXT NOT NULL,
  month TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admissions_day ON chat_admissions(day);
CREATE INDEX IF NOT EXISTS idx_admissions_month ON chat_admissions(month);
CREATE INDEX IF NOT EXISTS idx_admissions_day_client ON chat_admissions(day,client_hash);

CREATE TABLE IF NOT EXISTS chat_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  admission_id TEXT,
  asked_at INTEGER NOT NULL,
  question TEXT NOT NULL,
  reply TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'answered'
);
CREATE INDEX IF NOT EXISTS idx_turns_conversation ON chat_turns(conversation_id,asked_at);
CREATE INDEX IF NOT EXISTS idx_turns_retention ON chat_turns(asked_at);

CREATE TABLE IF NOT EXISTS sanko_day_events (
  day TEXT PRIMARY KEY NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN (0,1)),
  updated_at INTEGER NOT NULL
);
