/**
 * Live-boundary read path for the new Sanko runtime, Cloudflare Worker compatible.
 * Reads existing Oleshka diary D1 only. This module DOES NOT run outside of a
 * Worker with DIARY_DB binding (or isolated integration test with SQLite).
 * No calls to old Worker, no schema mutations, no Gemini or Vectorize calls.
 */
import {inspectDiarySchema,readDiaryWindow} from './d1-source.mjs';
import {isDay,normalizePost} from './normalize.mjs';
import {buildPersonalState,makeEvidencePacket} from './personal-state.mjs';

/**
 * The primary diary is also available to the future model as direct source
 * evidence, NOT automatically as Sanko's firsthand memory. Full original
 * texts are preserved and selected by whole post, never clipped mid-entry.
 */
export function selectWholeSourcePosts(posts,{maxSources=2}={}) {
  if (!Array.isArray(posts) || !Number.isSafeInteger(maxSources) || maxSources<1 || maxSources>20)
    throw new TypeError('invalid_source_post_selection');
  for (const p of posts) if (!p || !Number.isSafeInteger(p.postId) ||
    typeof p.fullText!=='string' || !p.fullText.trim() ||
    typeof p.sourceUrl!=='string' || !isDay(p.publishedDayMsk))
    throw new TypeError('invalid_source_post');
  const ordered=[...posts].sort((a,b)=>
    b.publishedAtEpoch-a.publishedAtEpoch||b.postId-a.postId);
  return {
    selected:ordered.slice(0,maxSources).map(p=>({
      postId:p.postId,sourceUrl:p.sourceUrl,publishedDay:p.publishedDayMsk,
      narrator:'oleshka',eventDay:'not_inferred',
      fullSourceText:p.fullText,
      textSha256:p.contentHash,
      evidenceType:'original_public_diary_not_sanko_memory'
    })),
    totalAvailable:ordered.length,
    selectionComplete:ordered.length<=maxSources,
    textsAreComplete:true,
    needsAdditionalRetrieval:ordered.length>maxSources
  };
}

export async function loadCharacterDayEvidence({
  diaryDb,day,character='sanko',claims=[],pageSize=25,maxPages=8,
  lastSuccessfulSourcePollAt=null
}={}) {
  if (!diaryDb?.prepare || !isDay(day) || !Array.isArray(claims))
    throw new TypeError('invalid_d1_personal_load_request');
  const schema=await inspectDiarySchema(diaryDb);
  if (!schema.compatible) return {ok:false,error:'diary_schema_incompatible',missing:schema.missing};
  const batch=await readDiaryWindow(diaryDb,{
    publicationDay:day,pageSize,maxPages,includeExcluded:false
  });
  if (!batch.complete) return {
    ok:false,error:'diary_read_incomplete',pagesRead:batch.pagesRead,
    returned:batch.rows.length, nextCursor:batch.nextCursor
  };
  const posts=[];
  for (const row of batch.rows) {
    try {
      const normalized=await normalizePost(row);
      if (normalized.anomalies.length)
        return {ok:false,error:'diary_source_date_anomaly',postId:normalized.postId};
      posts.push(normalized);
    } catch (err) {
      return {ok:false,error:'diary_post_invalid',reason:String(err?.message||'unknown')};
    }
  }
  const state=buildPersonalState({character,asOfDay:day,posts,claims,
    lastSuccessfulSourcePollAt,sourceReadComplete:true});
  return {ok:true,day,publicationsRead:posts.length,allOriginalTextsComplete:true,
    knownClaims:state.claims.length,withheldClaims:state.withheld.length,
    personalState:state,evidence:makeEvidencePacket(state,{focusDay:day}),
    primarySources:selectWholeSourcePosts(posts,{maxSources:2})};
}
