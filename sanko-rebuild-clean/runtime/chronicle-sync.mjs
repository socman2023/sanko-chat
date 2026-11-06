/**
 * Scheduled read-only diary check + isolated vnext KV candidate cache.
 * NEVER writes the primary Oleshka D1 or changes author-approved facts.
 * Intended to run only after explicit staging deployment and permission audit.
 */
import {refreshChronicleDraft} from '../chronicle/live-snapshot.mjs';
import {makeModelExtractor} from '../engine/extraction-adapter.mjs';

const INDEX_KEY='sanko:vnext:chronicle-index';
const REPORT_KEY='sanko:vnext:chronicle-refresh-report';
const MAX_INDEX_CHARS=800_000;

export function checkSyncBindings(env) {
  return !!env?.DIARY_DB?.prepare && !!env?.CURRENT_CONTEXT?.get &&
    !!env?.CURRENT_CONTEXT?.put;
}
function cleanPrevious(raw) {
  if(!raw)return {posts:[],candidates:[],status:'empty'};
  if(typeof raw!=='string'||raw.length>MAX_INDEX_CHARS)
    throw new TypeError('chronicle_index_oversized');
  let doc;
  try {doc=JSON.parse(raw);}catch{throw new TypeError('chronicle_index_corrupt');}
  if(doc?.schemaVersion!==1||!Array.isArray(doc.posts)||!Array.isArray(doc.candidates))
    throw new TypeError('chronicle_index_incompatible');
  if(doc.posts.some(p=>!p||typeof p.id!=='string'||!/^[a-f0-9]{64}$/u.test(p.contentHash)))
    throw new TypeError('chronicle_index_invalid_post');
  return {...doc,status:'available'};
}

export async function syncPersonalChronicle({env,today,model=null,readOnly=false,
  lookbackDays=3,maxNewExtractions=2,clock=()=>new Date().toISOString()}={}) {
  if(!checkSyncBindings(env))throw new TypeError('missing_chronicle_sync_bindings');
  const previous=cleanPrevious(await env.CURRENT_CONTEXT.get(INDEX_KEY));
  // No user conversations or private profile text enter a model extraction call.
  const extractor=model?makeModelExtractor(model):null;
  const result=await refreshChronicleDraft({diaryDb:env.DIARY_DB,today,
    previousPosts:previous.posts,previousCandidates:previous.candidates,
    approvedClaims:[],extractor,maxNewExtractions,lookbackDays});
  if(!result.ok)return {ok:false,error:result.error,writes:0};
  const checkedAt=clock();
  const newIndex={schemaVersion:1,checkedAt,today,
    posts:result.posts.map(p=>({id:p.id,contentHash:p.contentHash,
      publishedDayMsk:p.publishedDayMsk,publishedAtEpoch:p.publishedAtEpoch})),
    candidates:result.candidates};
  const serialized=JSON.stringify(newIndex);
  if(serialized.length>MAX_INDEX_CHARS)
    return {ok:false,error:'chronicle_index_too_large',writes:0};
  const report={checkedAt,today,
    lastKnownPublicationDay:result.latestPublicationDay,
    currentDayPostCount:result.currentDayPostCount,
    sourceD1ReadComplete:true,sourceVkPollVerified:false,
    newOrRevisedPublications:result.updated.length,
    extractionAttempts:result.extractionAttempts,
    extractionErrors:result.extractions.filter(x=>!x.ok).length,
    pendingCandidateCount:result.candidates.length,
    confirmedNewPersonalFacts:0,
    canClaimNothingHappenedToday:false};
  if(!readOnly){
    // Single designated index key. KV replication is eventually consistent;
    // direct D1 always remains authoritative at chat time.
    await env.CURRENT_CONTEXT.put(INDEX_KEY,serialized);
    await env.CURRENT_CONTEXT.put(REPORT_KEY,JSON.stringify(report));
  }
  return {ok:true,report,writes:readOnly?0:2,
    candidateCount:result.candidates.length,proposedEventsAreNotApproved:true};
}
export {INDEX_KEY,REPORT_KEY};
