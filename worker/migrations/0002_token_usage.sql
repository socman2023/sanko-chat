-- Per Gemini API attempt, not per user question. NULL = unreported component.
CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admission_id TEXT NOT NULL,
  attempted_at INTEGER NOT NULL,
  day TEXT NOT NULL,
  model TEXT NOT NULL,
  result TEXT NOT NULL,
  prompt_tokens INTEGER,
  candidate_tokens INTEGER,
  thoughts_tokens INTEGER,
  cached_tokens INTEGER,
  total_tokens INTEGER
);
CREATE INDEX IF NOT EXISTS idx_token_usage_day ON token_usage(day);
CREATE INDEX IF NOT EXISTS idx_token_usage_admission ON token_usage(admission_id);
