-- Synthetic/publicly authorized excerpts ONLY. Not a live diary importer.
CREATE TABLE IF NOT EXISTS oleshka_vk_diary (
 owner_id INTEGER NOT NULL,post_id INTEGER NOT NULL,
 published_at INTEGER NOT NULL,published_day_msk TEXT NOT NULL,
 source_url TEXT NOT NULL,source_text TEXT NOT NULL,
 category TEXT NOT NULL,ingested_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,post_id)
);
CREATE INDEX IF NOT EXISTS idx_diary_mirror_day
 ON oleshka_vk_diary(owner_id,published_day_msk,published_at);
