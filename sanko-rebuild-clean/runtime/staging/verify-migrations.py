#!/usr/bin/env python3
"""Real SQLite fixture check for the two *staging-only* migration files.
Does not connect to Cloudflare or use any production data.
"""
import sqlite3
from pathlib import Path
import sys

BASE=Path(__file__).resolve().parent
GUARD=BASE/'migrations/0001_clean_staging.sql'
DIARY=BASE/'migrations/0001_diary_mirror.sql'

with sqlite3.connect(':memory:') as guard, sqlite3.connect(':memory:') as diary:
    guard.executescript(GUARD.read_text())
    diary.executescript(DIARY.read_text())
    # Check idempotency of DDL under replay, even if migrations are marked applied.
    guard.executescript(GUARD.read_text())
    diary.executescript(DIARY.read_text())
    expected_guard={'chat_turns','chat_admissions','token_usage','sanko_canon_chunks'}
    actual_guard={row[0] for row in guard.execute('SELECT name FROM sqlite_master WHERE type="table"')}
    assert expected_guard <= actual_guard,expected_guard-actual_guard
    rows=guard.execute('PRAGMA table_info(chat_turns)').fetchall()
    columns={row[1] for row in rows}
    assert {'id','conversation_id','admission_id','asked_at','question','reply','model','status'}<=columns
    columns={row[1] for row in guard.execute('PRAGMA table_info(token_usage)')}
    assert {'prompt_tokens','candidate_tokens','thoughts_tokens','cached_tokens','total_tokens'}<=columns
    columns={row[1] for row in diary.execute('PRAGMA table_info(oleshka_vk_diary)')}
    assert {'owner_id','post_id','published_at','published_day_msk','source_url','source_text','category','ingested_at'}<=columns
    source='Начало записи. '+'Подробное наблюдение. '*750+'Конец записи.'
    assert len(source)>12_000
    diary.execute('INSERT INTO oleshka_vk_diary (owner_id,post_id,published_at,published_day_msk,source_url,source_text,category,ingested_at) VALUES(?,?,?,?,?,?,?,?)',
                 (850667816,32259,1794002401,'2026-11-06','https://vk.ru/wall850667816_32259',source,'diary',1794004229))
    result=diary.execute('SELECT source_text FROM oleshka_vk_diary WHERE owner_id=? AND post_id=?',(850667816,32259)).fetchone()
    assert result[0]==source
    # Compare the published SQL contract, including the required full text.
    row=diary.execute("SELECT owner_id,post_id,published_at,published_day_msk,source_url,source_text,category,ingested_at FROM oleshka_vk_diary WHERE owner_id=? AND category NOT IN ('excluded','rejected') ORDER BY published_at DESC,post_id DESC LIMIT 1",(850667816,)).fetchone()
    assert row and row[5]==source
    print('PASS: fresh staging GUARD_DB and DIARY_DB SQLite schemas, repeated migrations, full untruncated synthetic text')
