// Retrieval is entirely read-only for Oleshka's diary D1. Every included
// original entry arrives uncut; source metadata and day are never discarded.
// New current sources take priority over old book/vector snippets.
import {isRealDay,EMBEDDING_MODEL,strictCharacterFilter,safeVectorMatches} from "../lib.js";
import {canonLexical} from "../canon-store.js";
const OWNER=850667816;
const SELECT="SELECT post_id,published_day_msk,source_url,source_text "+
 "FROM oleshka_vk_diary WHERE owner_id=? "+
 "AND category NOT IN ('excluded','rejected') ";
const stop=new Set(["было","скажите","расскажи","откуда","знаете","неужто",
 "баржа","баржу","твоего","здесь","тебя","тебе","какую","разве",
 "когда","почему","видели","видали","потом","дальше","тогда",
 "сегодня","вчера","позавчера","что","такое","такой"]);
function queryWords(q){
 const text=String(q||"").toLowerCase();
 const anchors=[];
 // Strictly source lookups; no invention of speaker/place by the router.
 if(/лодочн/u.test(text))anchors.push("лодочн");
 if(/тицзюй|тицзюя|застав/u.test(text))anchors.push("тицз");
 if(/лунцзин/u.test(text))anchors.push("лунцзин");
 if(/шицяо/u.test(text))anchors.push("шицяо");
 if(/невольник|пленник/u.test(text))anchors.push("невольн");
 if(/барж/u.test(text))anchors.push("барж");
 const other=(text.match(/[\p{L}]{5,}/gu)||[]).filter(w=>!stop.has(w));
 for(const word of other){
  const stem=word.length>6?word.replace(/(?:иями|ями|ами|ого|его|ому|ему|остей|овым|ыми|ими|ость|ова|евы|ом|ем|ов|ев|ах|ях|ой|ий|ый|а|я|ы|и|у|е)$/u,""):word;
  if(stem.length>=4&&!anchors.includes(stem))anchors.push(stem);
 }
 return anchors.slice(0,4);
}
const cleanPost=row=>{
 const id=Number(row?.post_id),date=String(row?.published_day_msk||"");
 if(!Number.isSafeInteger(id)||id<=0||!isRealDay(date))return null;
 const text=typeof row.source_text==="string"?row.source_text:"";
 if(!text.trim())return null;
 const raw=String(row?.source_url||"");
 const url=/^https:\/\/vk\.(?:com|ru)\/wall850667816_\d+$/u.test(raw)?raw:"";
 return {id:"diary-"+id,type:"diary",date,text,source:url,
  priority:1,provenance:"public_author_diary"};
};
async function readDiary(db,sql,params){
 const x=await db.prepare(sql).bind(...params).all();
 return (x?.results||[]).map(cleanPost).filter(Boolean);
}
export async function loadDiaryEvidence(db,plan,today) {
 if(!db?.prepare)return {available:false,posts:[],reason:"binding_missing"};
 if(plan.diary==="none")return {available:true,posts:[],reason:"skipped"};
 const rows=[];
 try{
  if(plan.diary==="date"){
   rows.push(...await readDiary(db,SELECT+"AND published_day_msk=? "+
     "ORDER BY published_at DESC,post_id DESC",[OWNER,plan.date]));
   // The user requested a specific date. NEVER substitute another day.
  }else{
   const count=Math.min(9,Math.max(1,Number(plan.take)||4));
   rows.push(...await readDiary(db,SELECT+
    "ORDER BY published_at DESC,post_id DESC LIMIT "+count,[OWNER]));
   if(plan.diary==="topical"||plan.diary==="source-check"){
    const terms=queryWords(plan.focus);
    if(terms.length){
     const filter=terms.map(()=>"source_text LIKE ? ESCAPE '\\'").join(" OR ");
     const limit=plan.diary==="source-check"?8:7;
     rows.push(...await readDiary(db,SELECT+"AND ("+filter+") "+
      "ORDER BY published_at DESC,post_id DESC LIMIT "+limit,
      [OWNER,...terms.map(t=>"%"+t.replace(/[%_\\]/g,"\\$&")+"%")]));
    }
   }
  }
  const seen=new Set(),posts=[];
  for(const row of rows){
   if(seen.has(row.id))continue;
   seen.add(row.id);posts.push(row);
  }
  // All posts are included completely, never clipped in the middle. That
  // policy is author-approved, even for a long entry.
  return {available:true,posts,reason:posts.length?"found":"no_matching_post"};
 }catch(err){
  console.warn("Sanko v2 diary read unavailable",err?.name||"error");
  return {available:false,posts:[],reason:"read_error"};
 }
}
function corpusHit(hit){
 const text=String(hit?.text||"");
 if(!text.trim())return null;
 return {id:String(hit?.id||hit.source||"unknown").slice(0,130),
  type:"canon",date:String(hit?.date||""),
  text,source:String(hit?.source||""),
  priority:Number(hit?.priority)||7,
  provenance:"canon_index"};
}
export async function loadCanonEvidence(env,plan){
 if(!plan.search)return {hits:[],status:"not_required"};
 const lexical=await canonLexical(env,plan.focus,Math.min(9,plan.searchLimit))
  .catch(()=>[]);
 let vector=[];
 if(env.AI?.run&&env.KNOWLEDGE?.query){
  try{
   const emb=await env.AI.run(EMBEDDING_MODEL,{text:[plan.focus.slice(0,1200)]});
   const v=emb?.data?.[0];
   if(Array.isArray(v)&&v.length===1024){
    const found=await env.KNOWLEDGE.query(v,{topK:Math.min(12,plan.searchLimit*2),
      returnMetadata:"all",returnValues:false,
      filter:strictCharacterFilter(plan.date)});
    vector=safeVectorMatches(found?.matches||[],{
     date:plan.date,max:Math.min(9,plan.searchLimit)});
   }
  }catch(err){console.warn("Sanko v2 vector unavailable",err?.name||"error");}
 }
 const candidates=[...lexical.map(corpusHit),...vector.map(corpusHit)].filter(Boolean);
 // Keep nearest-relevant unique fragments; date filters apply to DATED
 // questions, otherwise the latest current record outranks historic fragments.
 const unique=[],seen=new Set();
 for(const hit of candidates){
  const key=hit.id+"|"+hit.text.slice(0,110);
  if(seen.has(key))continue;
  seen.add(key);unique.push(hit);
  if(unique.length>=plan.searchLimit)break;
 }
 return {hits:unique,status:unique.length?"found":"no_matching_canon"};
}
export function evidenceCoverage({diary,canon,facts},plan){
 const count=(diary?.posts||[]).length+(canon?.hits||[]).length+(facts?.facts||[]).length;
 return {enough:count>0,sourceCount:count,
  diaryAvailable:diary?.available===true,diaryCount:diary?.posts?.length||0,
  canonCount:canon?.hits?.length||0,approvedFacts:facts?.facts?.length||0,
  status:count?"ready":"unverified"};
}
