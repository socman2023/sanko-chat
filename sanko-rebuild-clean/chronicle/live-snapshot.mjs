/**
 * Incremental READ ONLY lookback of D1, safe to run with isolated Worker binding.
 * Actual publication acquisition is delegated to the existing Oleshka collector.
 * No source is silently truncated and no model-extracted claim is approved.
 */
import {isDay,normalizePost} from './normalize.mjs';
import {inspectDiarySchema,readDiaryWindow} from './d1-source.mjs';
import {makeEventExtractionRequest,validateEventCandidates} from './event-extraction.mjs';
import {buildCurrentContext} from './current-context.mjs';

function daysBefore(day,n) {
  return new Date(Date.parse(day+'T00:00:00.000Z')-n*86400_000).toISOString().slice(0,10);
}

export async function readRecentD1({diaryDb,today,lookbackDays=2,
  pageSize=40,maxPagesPerDay=4}={}) {
  if (!diaryDb?.prepare || !isDay(today) || !Number.isInteger(lookbackDays)||
      lookbackDays<1 || lookbackDays>10)throw new TypeError('invalid_recent_d1_request');
  const schema=await inspectDiarySchema(diaryDb);
  if (!schema.compatible) return {ok:false,error:'incompatible_schema',missing:schema.missing};
  const posts=[];
  const pagesByDay=[];
  for(let n=0;n<lookbackDays;n++) {
    const day=daysBefore(today,n);
    let batch;
    try {
      batch=await readDiaryWindow(diaryDb,{publicationDay:day,
        pageSize,maxPages:maxPagesPerDay,includeExcluded:false});
    }catch(err){return {ok:false,error:'read_failed',day,reason:String(err?.message||'unknown')};}
    if(!batch.complete)return {ok:false,error:'incomplete_day',day,
      pagesRead:batch.pagesRead,nextCursor:batch.nextCursor};
    pagesByDay.push({day,count:batch.rows.length});
    for (const row of batch.rows) {
      try {
        const p=await normalizePost(row);
        if(p.anomalies.length)return {ok:false,error:'timestamp_day_mismatch',day,postId:p.postId};
        posts.push(p);
      }catch(err){return {ok:false,error:'invalid_post',day,reason:String(err?.message||'unknown')};}
    }
  }
  return {ok:true,today,lookbackDays,pagesByDay,
    posts:posts.sort((a,b)=>b.publishedAtEpoch-a.publishedAtEpoch||b.postId-a.postId),
    sourceReadComplete:true,
    // This only proves a DB SELECT succeeded; no evidence of a fresh VK poll.
    lastSuccessfulSourcePollAt:null};
}

export async function refreshChronicleDraft({diaryDb,today,approvedClaims=[],
  previousPosts=[],previousCandidates=[],extractor=null,maxNewExtractions=2,
  lookbackDays=2}={}) {
  const snapshot=await readRecentD1({diaryDb,today,lookbackDays});
  if(!snapshot.ok)return snapshot;
  const oldHashes=new Map(previousPosts.map(p=>[p.id,p.contentHash]));
  const oldCandidatesBySource=new Map();
  for(const c of previousCandidates) {
    if(!oldCandidatesBySource.has(c.sourcePostId))oldCandidatesBySource.set(c.sourcePostId,[]);
    oldCandidatesBySource.get(c.sourcePostId).push(c);
  }
  const extractions=[];
  const updated=[];
  const existing=[];
  let used=0;
  for(const post of snapshot.posts) {
    const cached=oldCandidatesBySource.get(post.id)||[];
    if(oldHashes.get(post.id)===post.contentHash){
      existing.push(...cached.filter(c=>c.sourceContentHash===post.contentHash));
      continue;
    }
    updated.push({sourcePostId:post.id,type:oldHashes.has(post.id)?'revised':'new'});
    if(!extractor || used>=maxNewExtractions)continue;
    used++;
    try{
      const raw=await extractor(makeEventExtractionRequest(post));
      const validated=await validateEventCandidates(post,raw);
      extractions.push({sourcePostId:post.id,ok:true,...validated});
    }catch(err){
      extractions.push({sourcePostId:post.id,ok:false,
        reason:String(err?.message||'extraction_failed')});
    }
  }
  // Updated sources invalidate earlier approvals at personal-state level.
  const candidates=[...existing,...extractions.filter(x=>x.ok).flatMap(x=>x.candidates)];
  const context=buildCurrentContext({today,posts:snapshot.posts,
    approvedClaims,candidates,sourceReadComplete:true});
  return {ok:true,context,posts:snapshot.posts,candidates,updated,
    extractionAttempts:extractions.length,extractions,
    currentDayPostCount:snapshot.pagesByDay[0].count,
    latestPublicationDay:context.lastKnownPublicationDay,
    noTodayPostIsNotNoTodayEvents:true,
    sourcePollVerified:false,
    writesToProduction:0};
}
