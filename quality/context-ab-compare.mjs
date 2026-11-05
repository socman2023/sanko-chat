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
 const selected=posts.filter((p)=>after.prompt.includes("TEST_ONLY_CANON_SOURCE_"+(p.post_id-6000)));
 for(const p of selected)if(!after.prompt.includes("END_OF_COMPLETE_SOURCE_"+(p.post_id-6000)))
  throw Error("Truncated selected source "+p.post_id);
 if(["person","continuation","dated","detailed"].includes(kind)&&!after.prompt.includes(profile))
  throw Error("Full profile missing for "+kind);
 if(kind==="greeting"&&(selected.length||after.stats.embeddings))
  throw Error("Unnecessary knowledge lookup for greeting");
 if(kind==="current"&&selected.length<4)throw Error("Lost recent entries");
 if(kind==="dated"&&selected.length<6)throw Error("Explicit day lost entries");
 if(kind==="person"&&!after.prompt.toLowerCase().includes("руман"))
  throw Error("No topical Ruman evidence");
 results.push({kind,oldChars:before.prompt.length,newChars:after.prompt.length,
  savedPct:Math.round(1000*(1-after.prompt.length/before.prompt.length))/10,
  oldPosts:before.posts,newPosts:after.posts,
  oldEmbeddings:before.stats.embeddings,newEmbeddings:after.stats.embeddings});
}
for(const result of results)console.log(JSON.stringify(result));
const lines=["# Offline A/B — identical synthetic sources and questions","",
 "These are SYSTEM PROMPT CHARACTERS, not real Gemini token usage.",
 "No Gemini calls were made. A mock cannot certify the characters' actual replies.","",
 "| Scenario | Baseline chars | Candidate chars | Saved | Selected diary posts |",
 "|---|---:|---:|---:|---:|",
 ...results.map(r=>"| "+r.kind+" | "+r.oldChars+" | "+r.newChars+" | "+r.savedPct+"% | "+r.newPosts+" |"),
 "",
 "Full selected source texts and their ending markers were validated.",
 "For factual, continuation and dated cases the full approved profile remains present."];
writeFileSync("context-ab-results.md",lines.join("\n")+"\n");
if(results.find(x=>x.kind==="greeting").savedPct<45)throw Error("Greeting reduction below threshold");
if(results.find(x=>x.kind==="current").savedPct<25)throw Error("Current reduction below threshold");
