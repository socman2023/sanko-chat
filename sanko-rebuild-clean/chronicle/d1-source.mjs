/**
 * Read-only Cloudflare D1 diary adapter. Independent of the old Sanko Worker.
 * The SELECT columns and keyset order follow the observed live D1 query contract.
 * Does not create, alter, delete, or update any Cloudflare resource.
 */
import {isDay} from './normalize.mjs';

export const OLESHKA_VK_OWNER_ID = 850667816;
export const DIARY_TABLE = 'oleshka_vk_diary';
const PAGE_MAX = 200;
const REQUIRED_COLUMNS = Object.freeze([
  'owner_id', 'post_id', 'published_at', 'published_day_msk',
  'source_url', 'source_text', 'category', 'ingested_at'
]);

function binding(db) {
  if (!db || typeof db.prepare !== 'function')
    throw new TypeError('missing_readonly_diary_binding');
  return db;
}
function safeOwner(ownerId) {
  if (ownerId !== OLESHKA_VK_OWNER_ID) throw new TypeError('unsupported_source_owner');
}
function safeLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX)
    throw new TypeError('invalid_page_size');
}
function safeCursor(cursor) {
  if (cursor === null) return;
  if (!cursor || !Number.isSafeInteger(cursor.publishedAt) ||
    !Number.isSafeInteger(cursor.postId) || cursor.postId <= 0 ||
    cursor.publishedAt <= 0) throw new TypeError('invalid_cursor');
}

/** Validate the actual DB schema before attempting to use the adapter. */
export async function inspectDiarySchema(db) {
  const result = await binding(db).prepare(`PRAGMA table_info(${DIARY_TABLE})`).all();
  if (!Array.isArray(result?.results)) throw new Error('invalid_diary_schema_result');
  const available = result.results.map(r => r?.name).filter(x => typeof x === 'string');
  const missing = REQUIRED_COLUMNS.filter(name => !available.includes(name));
  return {compatible: !missing.length, missing, available};
}

/** A stable DESC keyset cursor, never an offset (which is vulnerable to new posts). */
export async function readDiaryPage(db, {
  ownerId = OLESHKA_VK_OWNER_ID, cursor = null, limit = 100,
  publicationDay = null, includeExcluded = true
} = {}) {
  binding(db);
  safeOwner(ownerId);
  safeLimit(limit);
  safeCursor(cursor);
  if (publicationDay !== null && !isDay(publicationDay))
    throw new TypeError('invalid_publication_day');
  let sql = 'SELECT owner_id,post_id,published_at,published_day_msk,source_url,source_text,category,ingested_at ' +
    `FROM ${DIARY_TABLE} WHERE owner_id=?`;
  const params = [ownerId];
  if (publicationDay !== null) {
    sql += ' AND published_day_msk=?';
    params.push(publicationDay);
  }
  if (!includeExcluded) sql += " AND category NOT IN ('excluded','rejected')";
  if (cursor !== null) {
    sql += ' AND (published_at<? OR (published_at=? AND post_id<?))';
    params.push(cursor.publishedAt, cursor.publishedAt, cursor.postId);
  }
  sql += ' ORDER BY published_at DESC, post_id DESC LIMIT ?';
  params.push(limit);
  const result = await db.prepare(sql).bind(...params).all();
  const rows = result?.results;
  if (!Array.isArray(rows)) throw new Error('invalid_diary_result');
  if (rows.length > limit) throw new Error('invalid_diary_page_length');
  // The limit is not evidence that there are no further records.
  const last = rows.at(-1);
  if (last && (!Number.isSafeInteger(Number(last.published_at)) ||
    !Number.isSafeInteger(Number(last.post_id)) || Number(last.post_id) <= 0))
    throw new Error('invalid_diary_cursor_row');
  return {
    rows,
    nextCursor: rows.length === limit ?
      {publishedAt: Number(last.published_at), postId: Number(last.post_id)} : null
  };
}

/**
 * Bounded reads. A safety bound never silently pretends to be a complete day.
 * A caller wanting full days must follow nextCursor until complete=true.
 */
export async function readDiaryWindow(db, {
  publicationDay = null, pageSize = 50, maxPages = 5, includeExcluded = true
} = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw new TypeError('invalid_max_pages');
  let cursor = null;
  const rows = [];
  const seen = new Set();
  for (let page = 0; page < maxPages; page++) {
    const result = await readDiaryPage(db, {
      publicationDay, includeExcluded, cursor, limit: pageSize
    });
    for (const item of result.rows) {
      const key = String(item.owner_id) + '_' + String(item.post_id);
      if (seen.has(key)) throw new Error('diary_pagination_duplicate');
      seen.add(key);
      rows.push(item); // original text preserved as-is, no clipping
    }
    if (!result.nextCursor) return {
      rows, complete: true, nextCursor: null, pagesRead: page + 1
    };
    if (cursor && (result.nextCursor.publishedAt > cursor.publishedAt ||
       (result.nextCursor.publishedAt === cursor.publishedAt &&
        result.nextCursor.postId >= cursor.postId)))
      throw new Error('diary_pagination_not_descending');
    cursor = result.nextCursor;
  }
  return {rows, complete: false, nextCursor: cursor, pagesRead: maxPages};
}

/** Same public timestamps that the existing /health route uses. No chat text. */
export async function readDiaryFreshness(db, {today, ownerId = OLESHKA_VK_OWNER_ID} = {}) {
  binding(db);
  safeOwner(ownerId);
  if (!isDay(today)) throw new TypeError('invalid_today');
  const valid = "FROM oleshka_vk_diary WHERE owner_id=? AND category NOT IN ('excluded','rejected')";
  const latest = await db.prepare('SELECT post_id,published_day_msk,published_at,ingested_at,source_url ' +
    valid + ' ORDER BY published_at DESC,post_id DESC LIMIT 1').bind(ownerId).first();
  const count = await db.prepare('SELECT COUNT(*) AS total ' + valid +
    ' AND published_day_msk=?').bind(ownerId,today).first();
  if (!count || !Number.isSafeInteger(Number(count.total)) || Number(count.total) < 0)
    throw new Error('invalid_diary_count');
  return {
    latestPostId: latest?.post_id == null ? null : Number(latest.post_id),
    latestPostDay: latest?.published_day_msk ?? null,
    latestPublishedAt: latest?.published_at == null ? null : Number(latest.published_at),
    latestIngestedAt: latest?.ingested_at == null ? null : Number(latest.ingested_at),
    postsToday: Number(count.total),
    // This is a *read* timestamp, NOT a successful VK ingestion timestamp.
    isSourceRefreshVerified: false
  };
}
