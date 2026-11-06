/**
 * Compact live context. Keeps proposed extraction separate from verified
 * personal knowledge and exact source text. No generic guess that Sanko witnessed
 * everything described by Oleshka.
 */
import {isDay} from './normalize.mjs';
import {buildPersonalState,makeEvidencePacket} from './personal-state.mjs';
import {selectWholeSourcePosts} from './d1-personal-bridge.mjs';

function calendarDayToday(nowMs) {
  const d = new Date(nowMs);
  if (Number.isNaN(d.valueOf())) throw new TypeError('invalid_clock');
  return new Date(d.getTime()+3*3600_000).toISOString().slice(0,10);
}

export function buildCurrentContext({today,posts=[],approvedClaims=[],candidates=[],
  lastSuccessfulSourcePollAt=null,sourceReadComplete=false,maxSourcePosts=2,
  character='sanko'}={}) {
  if (!isDay(today) || !Array.isArray(posts) || !Array.isArray(approvedClaims) ||
      !Array.isArray(candidates) || !Number.isInteger(maxSourcePosts)||maxSourcePosts<1||maxSourcePosts>10)
    throw new TypeError('invalid_current_context_input');
  const state=buildPersonalState({character,asOfDay:today,posts,
    claims:approvedClaims,lastSuccessfulSourcePollAt,sourceReadComplete});
  const validPosts=posts.filter(p=>!p.excluded && p.publishedDayMsk<=today);
  const whole=selectWholeSourcePosts(validPosts,{maxSources:maxSourcePosts});
  const dayEvidence=makeEvidencePacket(state,{focusDay:today,maxFacts:12});
  const postHashes=new Map(validPosts.map(p=>[p.id,p.contentHash]));
  const pendingCandidates=candidates.filter(c=>c?.approval==='pending'&&
    postHashes.get(c.sourcePostId)===c.sourceContentHash).map(c=>({
      id:c.id,sourcePostId:c.sourcePostId,eventDay:c.eventDay,
      kind:c.kind,dayBasis:c.dayBasis,quote:c.quote?.text||'',
      // Candidates are navigational hints; model may NOT state them as facts.
      status:'review_pending_not_facts'
    }));
  return {
    character,today,
    lastKnownPublicationDay:state.latestPostDay,
    lastVerifiedPersonalEventDay:state.latestEvidenceDay,
    sourceStatus:state.sourceReadStatus,
    sourcePollDay:state.sourcePollDay,
    hasVerifiedTodayEvents:dayEvidence.facts.some(x=>x.eventDay===today&&x.kind!=='reported_plan'),
    canAssertNothingHappenedToday:false,
    verifiedToday:dayEvidence,
    verifiedPersonalClaims:state.claims,
    pendingCandidates,
    sourcePosts:whole.selected,
    sourceSelectionComplete:whole.selectionComplete,
    unselectedSourceCount:whole.totalAvailable-whole.selected.length,
    originalTextStatus:'full_original_posts',
    // Useful for pure tests without relying on wall clock in model prompts.
    generatedForDay:today
  };
}

/** Entire original source posts are retained; only whole posts may be omitted. */
export function selectContextForQuestion(context,{maxSourceCharacters=28_000,
  maxPersonalClaims=14}={}) {
  if (!context || !Number.isInteger(maxSourceCharacters) || maxSourceCharacters<1000 ||
      !Number.isInteger(maxPersonalClaims)||maxPersonalClaims<1)
    throw new TypeError('invalid_context_selection');
  const posts=[];let used=0;
  for (const p of context.sourcePosts) {
    const length=p.fullSourceText.length;
    if (used+length > maxSourceCharacters) continue;
    posts.push(p);used+=length;
  }
  return {
    today:context.today,sourcePollDay:context.sourcePollDay,
    sourceStatus:context.sourceStatus,
    lastKnownPublicationDay:context.lastKnownPublicationDay,
    hasVerifiedTodayEvents:context.hasVerifiedTodayEvents,
    canAssertNothingHappenedToday:false,
    verifiedPersonalClaims:context.verifiedPersonalClaims.slice(0,maxPersonalClaims)
      .map(({id,assertion,kind,eventDay,epistemicStatus,sourceUrl})=>
        ({id,assertion,kind,eventDay,epistemicStatus,sourceUrl})),
    sourcePosts:posts,
    fullTextsPreserved:true,
    moreSourcesAvailable:context.unselectedSourceCount>0||posts.length<context.sourcePosts.length,
    sourceTextChars:used,
    candidateEventsExcluded:true
  };
}

export {calendarDayToday};
