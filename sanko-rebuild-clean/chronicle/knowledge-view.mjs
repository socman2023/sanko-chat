import {isDay} from './normalize.mjs';

const VALID_KIND = new Set(['past_event', 'present_status', 'reported_plan', 'hearsay']);

/**
 * Only APPROVED assertions can become personal knowledge.
 * Visibility is an explicit author-reviewed epistemic link, never guessed
 * from keyword matches or inclusion in Oleshka's diary.
 */
export function approvedPersonalKnowledge(claims, {character = 'sanko', day, verifiedSourcePosts} = {}) {
  if (!Array.isArray(claims) || !isDay(day) || !Array.isArray(verifiedSourcePosts))
    throw new TypeError('invalid_claim_request');
  const approvedSources = new Set(verifiedSourcePosts.filter(p => p && !p.excluded &&
    typeof p.id === 'string' && typeof p.contentHash === 'string').map(p => p.id));
  const known = [], withheld = [], invalid = [];
  for (const item of claims) {
    if (!item || typeof item !== 'object' || !item.id || !isDay(item.eventDay) ||
      typeof item.assertion !== 'string' || !item.assertion.trim() ||
      !VALID_KIND.has(item.kind) || !item.sourcePostId || !Array.isArray(item.witnesses) ||
      !Array.isArray(item.informed) || !['approved', 'pending', 'rejected'].includes(item.status)) {
      invalid.push(item?.id || null); continue;
    }
    if (item.status !== 'approved' || item.eventDay !== day ||
      !approvedSources.has(item.sourcePostId)) { withheld.push(item.id); continue; }
    const firsthand = item.witnesses.includes(character);
    const heard = item.informed.includes(character);
    if (!firsthand && !heard) { withheld.push(item.id); continue; }
    known.push({id: item.id, assertion: item.assertion, eventDay: day,
      kind: item.kind, sourcePostId: item.sourcePostId,
      epistemicStatus: firsthand ? 'firsthand' : 'reported_to_character'});
  }
  return {
    day, character, known, withheld, invalid,
    // zero known facts MUST NOT be interpreted as "nothing happened".
    evidenceStatus: known.length ? 'known_facts_present' : 'no_verified_personal_facts',
    canClaimNothingHappened: false
  };
}
