/**
 * Read-only freshness interpretation of the existing public /health response.
 * No request to /api/chat, no tokens, no access to private admin data.
 */
import {isDay, publishedDayMoscow} from './normalize.mjs';

export const DEFAULT_HEALTH_URL = 'https://sanko-chat-api.boysinger2008.workers.dev/health';

function parseIso(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u.test(v))
    return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}
function numericId(v) {
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}

export function evaluatePublicHealth(health, {checkedAt} = {}) {
  const checkedMs = parseIso(checkedAt);
  if (checkedMs === null) throw new TypeError('invalid_health_checked_at');
  const todayMsk = publishedDayMoscow(Math.floor(checkedMs / 1000));
  if (!health || typeof health !== 'object' || Array.isArray(health))
    return {status:'invalid_health',todayMsk,sourceVerified:false};
  const sync = health.diarySync;
  if (health.diaryConnected !== true || !sync || sync.status !== 'ok')
    return {status:'diary_unavailable',todayMsk,sourceVerified:false,
      diagnosis: typeof sync?.status === 'string' ? sync.status : 'no_diary_status'};
  if (!Number.isSafeInteger(sync.postsToday) || sync.postsToday < 0 ||
      (sync.latestPostId !== null && numericId(sync.latestPostId) === null) ||
      (sync.latestPostDay !== '' && !isDay(sync.latestPostDay)))
    return {status:'invalid_diary_status',todayMsk,sourceVerified:false};
  const publishedMs = sync.latestPublishedAt == null ? null : parseIso(sync.latestPublishedAt);
  const ingestedMs = sync.latestIngestedAt == null ? null : parseIso(sync.latestIngestedAt);
  if ((sync.latestPublishedAt && publishedMs === null) ||
      (sync.latestIngestedAt && ingestedMs === null))
    return {status:'invalid_diary_timestamps',todayMsk,sourceVerified:false};
  const observedDay = sync.latestPostDay || null;
  if (observedDay && observedDay > todayMsk)
    return {status:'future_dated_diary',todayMsk,sourceVerified:false};
  if (sync.postsToday > 0 && observedDay !== todayMsk)
    return {status:'inconsistent_diary_day_and_count',todayMsk,sourceVerified:false};
  if (sync.latestPostId === null && sync.postsToday > 0)
    return {status:'inconsistent_diary_missing_latest',todayMsk,sourceVerified:false};
  const todayHasPost = sync.postsToday > 0 && observedDay === todayMsk;
  return {
    status: todayHasPost ? 'current_day_publication_seen' :
      sync.latestPostId == null ? 'no_diary_posts' : 'no_current_day_publication',
    todayMsk,
    latestPostDay: observedDay,
    latestPostId: sync.latestPostId,
    latestPublishedAt: publishedMs === null ? null : new Date(publishedMs).toISOString(),
    latestIngestedAt: ingestedMs === null ? null : new Date(ingestedMs).toISOString(),
    postsToday: sync.postsToday,
    checkedAt,
    // /health reads DB state. It cannot prove that VK was checked recently.
    sourceVerified:false,
    liveDatabaseRead: true,
    todayEventsKnown: false,
    canClaimNoEventsToday: false,
    meaning:'Publication presence is not an event chronology or sync completion proof'
  };
}

export async function checkPublicHealth({url = DEFAULT_HEALTH_URL, now = new Date(),
  fetchFn = fetch, timeoutMs = 8000} = {}) {
  if (url !== DEFAULT_HEALTH_URL) throw new TypeError('unapproved_health_url');
  if (!(now instanceof Date) || Number.isNaN(now.valueOf()))
    throw new TypeError('invalid_now');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30000)
    throw new TypeError('invalid_timeout');
  const response = await fetchFn(url,{method:'GET',redirect:'error',
    headers:{'Accept':'application/json'},signal:AbortSignal.timeout(timeoutMs)});
  if (!response.ok) throw new Error(`health_http_${response.status}`);
  const raw = await response.text();
  if (raw.length > 32768) throw new Error('health_payload_too_large');
  let json;
  try {json=JSON.parse(raw);} catch {throw new Error('health_invalid_json');}
  return evaluatePublicHealth(json,{checkedAt:now.toISOString()});
}
