/**
 * A clean, stand-alone Chronicle normalization contract.
 * Does NOT import or invoke the legacy Sanko Worker.
 * Public posts are immutable evidence; an event is a separate authored claim.
 */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_TEXT_LENGTH = 500_000; // refuse pathological inputs; NEVER truncate a legitimate publication

export function isDay(v) {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function publishedDayMoscow(unixSeconds) {
  if (!Number.isSafeInteger(unixSeconds)) throw new TypeError('invalid_unix_seconds');
  // Chronicle source explicitly stores a Moscow-calendar day (UTC+03:00).
  return new Date(unixSeconds * 1000 + 3 * 3600_000).toISOString().slice(0, 10);
}

export function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  return crypto.subtle.digest('SHA-256', bytes).then(buffer =>
    [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join(''));
}

export async function normalizePost(row, expectedOwner = 850667816) {
  if (!row || typeof row !== 'object' || Array.isArray(row))
    throw new TypeError('post_not_object');
  const ownerId = Number(row.owner_id);
  const postId = Number(row.post_id);
  const publishedAt = Number(row.published_at);
  const day = row.published_day_msk;
  if (!Number.isSafeInteger(ownerId) || ownerId !== expectedOwner)
    throw new TypeError('wrong_source_owner');
  if (!Number.isSafeInteger(postId) || postId <= 0)
    throw new TypeError('invalid_post_id');
  if (!Number.isSafeInteger(publishedAt) || publishedAt < 1_450_000_000 || publishedAt > 4_100_000_000)
    throw new TypeError('invalid_published_at');
  if (!isDay(day)) throw new TypeError('invalid_published_day');
  if (typeof row.source_text !== 'string' || !row.source_text.trim())
    throw new TypeError('empty_post_text');
  if (row.source_text.length > MAX_TEXT_LENGTH)
    throw new TypeError('post_over_max_safe_length');
  const url = row.source_url;
  const validUrl = typeof url === 'string' &&
    new RegExp(`^https:\\/\\/vk\\.(?:com|ru)\\/wall${expectedOwner}_${postId}$`, 'u').test(url);
  if (!validUrl) throw new TypeError('unverified_source_url');
  const category = typeof row.category === 'string' && row.category.trim() ? row.category.trim() : 'unclassified';
  const exclusion = category === 'excluded' || category === 'rejected';
  const text = row.source_text; // exact original; do NOT trim or truncate
  const contentHash = await sha256Hex(text);
  const metaSignature = await sha256Hex(JSON.stringify({postId, ownerId, publishedAt, day, category, url}));
  return {
    id: `${ownerId}_${postId}`,
    postId, ownerId,
    publishedAt: new Date(publishedAt * 1000).toISOString(),
    publishedAtEpoch: publishedAt,
    publishedDayMsk: day,
    sourceUrl: url, category, excluded: exclusion,
    fullText: text,
    contentHash, metaSignature,
    anomalies: publishedDayMoscow(publishedAt) !== day ? ['timestamp_day_mismatch'] : [],
    // No extraction of eventDay: a publication day is NOT the date of each event.
    eventDay: null
  };
}
