// Offline reproducible comparison. No live APIs, secrets or Cloudflare writes.
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {writeFileSync} from "node:fs";
import {dayInMoscow} from "../worker/src/lib.js";
const [oldPath,newPath]=process.argv.slice(2);
if(!oldPath||!newPath)throw Error("Need baseline and candidate Worker files");
const [baseline,candidate]=await Promise.all([oldPath,newPath].map(async p=>(await import(pathToFileURL(resolve(p)).href)).default));
const today=dayInMoscow(),yesterday=new Date(Date.parse(today+"T00:00:00Z")-86400000).toISOString().slice(0,10);
const fill=(s,n)=>s.repeat(Math.ceil(n/s.length)).slice(0,n);
const profile=fill("TEST_ONLY_PROFILE",29090),current=fill("TEST_ONLY_CURRENT",3409);
const posts=Array.from({length:12},(_,i)=>{
 const ending="END_OF_COMPLETE_SOURCE_"+i,tag=i<6?today:yesterday;
 return {post_id:6000+i,owner_id:850667816,published_day_msk:tag,published_at:100000-i,
  source_url:"https://vk.com/wall850667816_"+(6000+i),
  source_text:fill("TEST_ONLY_CANON_SOURCE_"+i+" "+([2,8,10].includes(i)?"руман ":""),4300-ending.length)+ending};
});
function database(stats){
 return {prepare(sql){
  return {v:[],bind(...a){this.v=a;return this;},
   async first(){return sql.includes("INSERT INTO chat_admissions")?{request_id:"fake"}:{n:0};},
   async run(){return {success:true};},
   async all(){
    if(sql.includes("sanko_canon_chunks"))return {results:[{id:"fixture",scope:"diary",
     source:"TEST",priority:1,published_day:today,content:fill("TEST_RAG",1200)}]};
    if(!sql.includes("ole shka_vk_diary".replace(" ","")))return {results:[]};
    stats.diaryQueries++;
    let rows=posts.slice();
    if(sql.includes("published_day_msk=?"))rows=rows.filter(p=>p.published_day_msk===this.v[1]);
    if(sql.includes("published_day_msk<?"))rows=rows.filter(p=>p.published_day_msk<this.v[1]);
    if(sql.includes("source_text LIKE ?")){
     const words=this.v.slice(1).map(w=>String(w).replace(/%/g,"").toLowerCase());
     rows=rows.filter(p=>words.some(w=>p.source_text.toLowerCase().includes(w)));
    }
    const match=/\bLIMIT\s+(\d+)/iu.exec(sql);
    return {results:match?rows.slice(0,Number(match[1])):rows};
   }};
 }};
}
function makeEnv(stats){
 return {GEMINI_API_KEY:"DEMO-NOT-A-KEY",IP_HASH_SECRET:"DEMO-NOT-A-SECRET",
  GUARD_DB:database(stats),DIARY_DB:database(stats),
  CURRENT_CONTEXT:{get:async k=>k==="sanko:profile:v1"?profile:
   k==="sanko:current:v1"?JSON.stringify({asOf:today,text:current}):null},
  AI:{run:async()=>{stats.embeddings++;return {data:[Array(1024).fill(.001)]};}},
  KNOWLEDGE:{query:async()=>{stats.vectorQueries++;return {matches:[
   {score:.99,metadata:{character:"sanko",date:today,source:"TEST",
    text:fill("TEST_VECTOR",1900)}}]};}}
 };
}
async function run(worker,question,history=[]){
 const stats={embeddings:0,vectorQueries:0,diaryQueries:0},env=makeEnv(stats);
 const req=new Request("https://example.com/api/chat",{method:"POST",
  headers:{Origin:"https://socman2023.github.io","Content-Type":"application/json",
   "CF-Connecting-IP":"198.51.100.55"},
  body:JSON.stringify({message:question,history,conversationId:crypto.randomUUID()})});
 let prompt="";
 const oldFetch=globalThis.fetch,oldLog=console.info;
 globalThis.fetch=async(_url,opts)=>{
  prompt=JSON.parse(opts.body).systemInstruction.parts[0].text;
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"Здрав будь. Говори, шо спросить хотел."}]}}]}),{status:200});
 };
 console.info=()=>{};
 try{
  const response=await worker.fetch(req,env,{waitUntil(p){p?.catch(()=>{});}});
  if(response.status!==200)throw Error("HTTP "+response.status+" "+JSON.stringify(await response.json())+" for "+question);
  const answer=await response.json();
  return {prompt,stats,posts:answer.knowledge.diaryPosts};
 }finally{globalThis.fetch=oldFetch;console.info=oldLog;}
}
const cases=[
 ["greeting","Привет",[]],["social","Как дела?",[]],["current","Что нового?",[]],
 ["person","Где сейчас Руман?",[]],
 ["continuation","А потом?",[{role:"user",text:"Расскажи про Румана"},{role:"model",text:"Ищем наших."}]],
 ["dated","Что было "+today+"?",[]],["detailed","Расскажи подробно про Румана",[]]
];
const results=[];
for(const [kind,q,history] of cases){
 const before=await run(baseline,q,history),after=await run(candidate,q,history);
 // Voice, religion, first-person identity and the distinction between
 // witnessed and reported events must survive every optimization mode.
 for(const constraint of ["Слава Вароку","ОБЯЗАТЕЛЬНО ДЛЯ СОБСТВЕННОЙ РЕЧИ",
   "Поднебесье"]){
  if(!after.prompt.includes(constraint))
   throw Error("Lost approved character constraint "+constraint+" in "+kind);
 }
 if(!after.prompt.includes(current)&&kind!=="dated")
  throw Error("Lost latest approved personal snapshot in "+kind);
 const selected=posts.filter((p)=>after.prompt.includes("TEST_ONLY_CANON_SOURCE_"+(p.post_id-6000)));
 for(const p of selected)if(!after.prompt.includes("END_OF_COMPLETE_SOURCE_"+(p.post_id-6000)))
  throw Error("Truncated selected source "+p.post_id);
 if(["person","continuation","dated","detailed"].includes(kind)&&!after.prompt.includes(profile))
  throw Error("Full profile missing for "+kind);
 if(kind==="greeting"&&(selected.length||after.stats.embeddings))
  throw Error("Unnecessary knowledge lookup for greeting");
 if(kind==="current"&&selected.length<4)throw Error("Lost recent entries");
 if(kind==="dated"&&selected.length<6)throw Error("Explicit day lost entries");
 if(kind==="person"&&!selected.some(p=>p.post_id===6008||p.post_id===6010))
  throw Error("Missed older Ruman diary post through Russian name inflections");
 results.push({kind,oldChars:before.prompt.length,newChars:after.prompt.length,
  savedPct:Math.round(1000*(1-after.prompt.length/before.prompt.length))/10,
  oldPosts:before.posts,newPosts:after.posts,
  oldEmbeddings:before.stats.embeddings,newEmbeddings:after.stats.embeddings});
}
for(const result of results)console.log(JSON.stringify(result));
// A complete eight-turn conversation with the SAME history on both Workers.
// This detects unwanted compression of topical followups after small talk.
const dialogue=[
 "Привет","Как дела?","Что нового?","А где сейчас Руман?",
 "А потом?","Чего «опосля»?","Расскажи про отца","А у тебя?"
];
const dialogueHistory=[],dialogueStats=[];
for(const question of dialogue){
 const old=await run(baseline,question,dialogueHistory);
 const next=await run(candidate,question,dialogueHistory);
 dialogueStats.push({turn:dialogueStats.length+1,question,
  oldChars:old.prompt.length,newChars:next.prompt.length});
 if(question==="А потом?"&&!next.prompt.includes(profile))
  throw Error("Lost full profile during long-dialogue continuation");
 if(question==="А у тебя?"&&!next.prompt.includes(profile))
  throw Error("Lost subject continuity in social-looking followup");
 dialogueHistory.push({role:"user",text:question},
  {role:"model",text:"Здрав будь. Говори, шо спросить хотел."});
}
const dialogueTotals=dialogueStats.reduce((a,r)=>({
 old:a.old+r.oldChars,now:a.now+r.newChars}),{old:0,now:0});
console.log("MULTITURN_TOTALS "+JSON.stringify(dialogueTotals));

// The four REAL user questions from the 2026-11-05 barge conversation.
// Replies below are only conversation-memory references, not trusted facts.
// Full diary source material remains the synthetic approved-source fixture.
const bargeTurns=[
 ["Лучше скажи, что у тебя нового?","Плывём по реке на джонке, за баржей следим."],
 ["Баржу еще не видели?","Одну приметили, да не ту, чужая."],
 ["А там что будет?","Надо посмотреть, что в следующем месте."],
 ["Чаешь, успеете?","Чаем. Поглядим, как пойдёт."]
];
const bargeHistory=[],bargeResults=[];
for(const [question,answer] of bargeTurns){
 const old=await run(baseline,question,bargeHistory);
 const next=await run(candidate,question,bargeHistory);
 const number=bargeResults.length+1;
 const selected=posts.filter(p=>next.prompt.includes("TEST_ONLY_CANON_SOURCE_"+(p.post_id-6000)));
 if(!next.prompt.includes(current))throw Error("Lost approved current context on barge turn "+number);
 if(!next.prompt.includes("Слава Вароку"))throw Error("Lost Sanko voice on barge turn "+number);
 for(const p of selected){
  if(!next.prompt.includes("END_OF_COMPLETE_SOURCE_"+(p.post_id-6000)))
   throw Error("Lost full diary ending on barge turn "+number);
 }
 if(number===1||number>=3){
  if(next.prompt.includes(profile))
   throw Error("Heavy personal archive unnecessarily sent on barge turn "+number);
  if(selected.length!==4)
   throw Error("Recent canon not fully loaded on barge turn "+number);
 }
 if(number>=3&&!next.prompt.includes("НЕ подтверждают факты"))
  throw Error("Missing previous-model-answer provenance guard on barge followup "+number);
 if(number===2&&!next.prompt.includes(profile))
  throw Error("Specific barge topic must retain full canonical profile");
 bargeResults.push({turn:number,question,oldChars:old.prompt.length,
  newChars:next.prompt.length,selectedPosts:selected.length,
  sourceSearches:next.stats.vectorQueries});
 bargeHistory.push({role:"user",text:question},{role:"model",text:answer});
}
const bargeTotals=bargeResults.reduce((a,r)=>({
 old:a.old+r.oldChars,now:a.now+r.newChars}),{old:0,now:0});
console.log("BARGE_FOUR_TURNS "+JSON.stringify({totals:bargeTotals,turns:bargeResults}));
if(bargeTotals.now>bargeTotals.old*.75)
 throw Error("Newly measured barge conversation improvement below 25%");


const lines=["# Offline A/B — identical synthetic sources and questions","",
 "These are SYSTEM PROMPT CHARACTERS, not real Gemini token usage.",
 "No Gemini calls were made. A mock cannot certify the characters' actual replies.","",
 "| Scenario | Baseline chars | Candidate chars | Saved | Selected diary posts |",
 "|---|---:|---:|---:|---:|",
 ...results.map(r=>"| "+r.kind+" | "+r.oldChars+" | "+r.newChars+" | "+r.savedPct+"% | "+r.newPosts+" |"),
 "",
 "Full selected source texts and their ending markers were validated.",
 "For factual, continuation and dated cases the full approved profile remains present.",
 "",
 "## Eight-turn connected conversation (same history on both Workers)",
 "",
 "| Turn | Question | Baseline chars | Candidate chars |",
 "|---:|---|---:|---:|",
 ...dialogueStats.map(r=>"| "+r.turn+" | "+r.question+" | "+r.oldChars+" | "+r.newChars+" |"),
 "",
 "Total baseline characters: "+dialogueTotals.old,
 "Total experimental characters: "+dialogueTotals.now,
 "Reduction: "+(100*(1-dialogueTotals.now/dialogueTotals.old)).toFixed(1)+"%",
 "",
 "## User-observed four-turn barge conversation",
 "",
 "| Turn | User question | v0.6.16 chars | v0.6.17 chars | Canon posts |",
 "|---:|---|---:|---:|---:|",
 ...bargeResults.map(r=>"| "+r.turn+" | "+r.question+" | "+r.oldChars+" | "+r.newChars+" | "+r.selectedPosts+" |"),
 "",
 "Total 0.6.16 chars: "+bargeTotals.old,
 "Total 0.6.17 chars: "+bargeTotals.now,
 "Reduction: "+(100*(1-bargeTotals.now/bargeTotals.old)).toFixed(1)+"%",
 "The previous generated replies are used to resolve the topic, never as canon."];
writeFileSync("context-ab-results.md",lines.join("\n")+"\n");
// Comparing two optimized Workers: unaffected modes must not regress.
for(const mode of ["greeting","social","person","dated","detailed"]){
 const row=results.find(x=>x.kind===mode);
 if(row.newChars>row.oldChars*1.03)
  throw Error("Unexpected prompt regression in mode "+mode);
}
