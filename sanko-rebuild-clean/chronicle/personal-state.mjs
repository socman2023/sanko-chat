/**
 * Canon-first personal-knowledge evidence. Fresh publication != witnessed event.
 * Clean implementation: no imports from any old Sanko conversation engine.
 * This module does not read private profile keys, write to D1, or call an LLM.
 */
import {isDay} from './normalize.mjs';

const EVENT_KINDS = new Set(['past_event','present_status','reported_plan','hearsay']);
const STATUS = new Set(['approved','pending','rejected']);
const MAX_CLAIMS = 3000;

function validUtc(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value));
}
function validClaim(c) {
  return c && typeof c === 'object' && !Array.isArray(c) &&
    typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 180 &&
    typeof c.sourcePostId === 'string' && c.sourcePostId.length > 0 &&
    typeof c.sourceContentHash === 'string' && /^[0-9a-f]{64}$/u.test(c.sourceContentHash) &&
    isDay(c.eventDay) && isDay(c.assertedDay) &&
    typeof c.assertion === 'string' && c.assertion.length > 0 && c.assertion.length <= 1500 &&
    typeof c.subject === 'string' && c.subject.length > 0 &&
    typeof c.predicate === 'string' && c.predicate.length > 0 &&
    typeof c.object === 'string' && c.object.length > 0 &&
    EVENT_KINDS.has(c.kind) && STATUS.has(c.status) &&
    Array.isArray(c.witnesses) && c.witnesses.every(x => typeof x === 'string') &&
    Array.isArray(c.informed) && c.informed.every(x => typeof x === 'string');
}
function deriveKnowledge(c,character,asOfDay,post) {
  if (!validClaim(c)) return {status:'invalid_claim',reason:'invalid_schema'};
  if (c.status !== 'approved') return {status:'withheld',reason:'not_approved'};
  if (c.assertedDay > asOfDay) return {status:'withheld',reason:'not_yet_known'};
  if (c.kind !== 'reported_plan' && c.eventDay > asOfDay)
    return {status:'withheld',reason:'future_event_not_observed'};
  if (!post) return {status:'withheld',reason:'source_not_found'};
  if (post.excluded) return {status:'withheld',reason:'source_excluded'};
  if (post.contentHash !== c.sourceContentHash)
    return {status:'withheld',reason:'source_edited_since_approval'};
  if (post.publishedDayMsk > asOfDay) return {status:'withheld',reason:'source_not_yet_published'};
  const firsthand = c.witnesses.includes(character);
  const informed = c.informed.includes(character);
  if (!firsthand && !informed) return {status:'withheld',reason:'not_known_to_character'};
  return {status:'known',epistemicStatus:firsthand?'firsthand':'reported_to_character'};
}

/**
 * Accepted posts contain exact primary text and SHA-256. Claim records come
 * only from the author-approved fact layer; raw LLM extraction is pending.
 * No claims may be silently inferred from source text or chat history.
 */
export function buildPersonalState({
  character='sanko', asOfDay, posts=[], claims=[], lastSuccessfulSourcePollAt=null,
  sourceReadComplete=false
}={}) {
  if (!/^[a-z][a-z0-9_-]{1,50}$/u.test(character) || !isDay(asOfDay) ||
      !Array.isArray(posts) || !Array.isArray(claims) || claims.length > MAX_CLAIMS ||
      typeof sourceReadComplete !== 'boolean' ||
      (lastSuccessfulSourcePollAt !== null && !validUtc(lastSuccessfulSourcePollAt)))
    throw new TypeError('invalid_personal_state_input');
  const sourceMap = new Map();
  for (const post of posts) {
    if (!post || typeof post.id !== 'string' || !/^[0-9a-f]{64}$/u.test(post.contentHash) ||
       !isDay(post.publishedDayMsk) || typeof post.fullText !== 'string' ||
       typeof post.excluded !== 'boolean' || sourceMap.has(post.id))
      throw new TypeError('invalid_or_duplicate_post');
    sourceMap.set(post.id,post);
  }
  const known = [], withheld = [], invalid = [];
  const ids = new Set();
  for (const claim of claims) {
    if (claim?.id && ids.has(claim.id)) {
      invalid.push({id:claim.id,reason:'duplicate_claim_id'});continue;
    }
    if (claim?.id) ids.add(claim.id);
    const decision = deriveKnowledge(claim,character,asOfDay,sourceMap.get(claim?.sourcePostId));
    if (decision.status === 'invalid_claim') {invalid.push({id:claim?.id??null,reason:decision.reason});continue;}
    if (decision.status === 'withheld') {withheld.push({id:claim.id,reason:decision.reason});continue;}
    known.push({...claim,epistemicStatus:decision.epistemicStatus,
      sourceUrl:sourceMap.get(claim.sourcePostId).sourceUrl});
  }
  // Two approved, equally dated statements giving different objects for the
  // same subject/predicate cannot be reconciled by guessing which is true.
  const groups = new Map();
  for (const c of known) {
    const key=[c.eventDay,c.subject,c.predicate,c.kind].join('\u0000');
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(c);
  }
  const conflicted = new Set(), conflicts = [];
  for (const group of groups.values()) {
    if (new Set(group.map(c=>c.object)).size > 1) {
      conflicts.push({eventDay:group[0].eventDay,subject:group[0].subject,
        predicate:group[0].predicate,claimIds:group.map(c=>c.id)});
      for (const c of group) conflicted.add(c.id);
    }
  }
  const safeClaims = known.filter(c=>!conflicted.has(c.id));
  for (const c of known) if (conflicted.has(c.id))
    withheld.push({id:c.id,reason:'conflicting_approved_facts'});
  safeClaims.sort((a,b)=>b.eventDay.localeCompare(a.eventDay)||a.id.localeCompare(b.id));
  const latestEvidenceDay = safeClaims[0]?.eventDay ?? null;
  const latestPostDay = [...sourceMap.values()].filter(p=>!p.excluded && p.publishedDayMsk<=asOfDay)
    .map(p=>p.publishedDayMsk).sort().at(-1)??null;
  const sourcePollDay = lastSuccessfulSourcePollAt ?
    new Date(Date.parse(lastSuccessfulSourcePollAt)+3*3600_000).toISOString().slice(0,10):null;
  return {
    character,asOfDay,latestEvidenceDay,latestPostDay,sourcePollDay,
    lastSuccessfulSourcePollAt, sourceReadComplete,
    claims:safeClaims,withheld,invalid,conflicts,
    // Even a complete source read is not evidence of the day's events if there
    // are no approved, character-accessible observations.
    todayEvidenceStatus:safeClaims.some(c=>c.eventDay===asOfDay && c.kind!=='reported_plan')?
      'character_facts_verified':'no_verified_character_facts_for_today',
    sourceReadStatus:sourceReadComplete?'read_complete':'unverified_or_partial',
    canClaimNoEventsToday:false
  };
}

/** A current-status claim from yesterday is last known, not today's fact. */
export function viewPersonalDay(state, {day, includePlans=true}={}) {
  if (!state || !isDay(day) || day > state.asOfDay)
    throw new TypeError('invalid_personal_day');
  const facts=state.claims.filter(c=>c.eventDay===day && (includePlans||c.kind!=='reported_plan'));
  const plansAnnounced=state.claims.filter(c=>c.kind==='reported_plan' && c.assertedDay===day && c.eventDay!==day);
  const firsthand=facts.filter(c=>c.epistemicStatus==='firsthand');
  const reported=facts.filter(c=>c.epistemicStatus==='reported_to_character');
  return {day,asOfDay:state.asOfDay,firsthand,reported,plansAnnounced,
    hasVerifiedFacts:facts.length>0,
    canClaimNothingHappened:false,
    sourcePollDay:state.sourcePollDay,
    sourceReadComplete:state.sourceReadComplete,
    freshness:state.asOfDay===day?'day_requested_is_today':'historical_day'};
}

/**
 * Strictly bounded response evidence; do not put entire corpus in prompts.
 * The original full text remains in source storage, not clipped or rewritten.
 */
export function makeEvidencePacket(state, {focusDay, maxFacts=8}={}) {
  if (!state || !isDay(focusDay) || focusDay > state.asOfDay ||
    !Number.isSafeInteger(maxFacts)||maxFacts<1||maxFacts>40)
    throw new TypeError('invalid_evidence_packet_request');
  const view = viewPersonalDay(state,{day:focusDay});
  const all = [...view.firsthand,...view.reported,...view.plansAnnounced].sort((a,b)=>a.id.localeCompare(b.id));
  return {
    character:state.character, focusDay, nowDay:state.asOfDay,
    sourcePollDay:state.sourcePollDay,sourceReadComplete:state.sourceReadComplete,
    hasVerifiedFacts:all.length>0, truncatedFactSelection:all.length>maxFacts,
    facts:all.slice(0,maxFacts).map(c=>({
      id:c.id, claim:c.assertion,kind:c.kind,epistemicStatus:c.epistemicStatus,
      eventDay:c.eventDay,sourcePostId:c.sourcePostId,sourceUrl:c.sourceUrl
    })),
    instructions:[
      'Используй только подтверждённые сведения из facts; не считай чат или догадку источником канона.',
      'firsthand — собственная память героя; reported_to_character — сведения со слов других.',
      'reported_plan — намерение, а не уже произошедшее событие.',
      'Если facts пусты, не утверждай, будто ничего не случилось.',
      'Не подменяй сегодняшний день прошлым; даты служат внутренней хронологии.'
    ],
    canClaimNoEventsToday:false
  };
}
