import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { dayInMoscow } from "../src/lib.js";

const URL="https://sanko-chat-api.example/api/chat";
function envStub(opts={}) {
 const observed={queries:[],gemini:[],insertions:[],kv:[]};
 const env={
  GEMINI_API_KEY:"FAKE_TEST_KEY_NOT_REAL",
  IP_HASH_SECRET:"FAKE_PEPPER_NOT_REAL",
  AI:{run:async(_model,_body)=>({data:[Array(1024).fill(.001)]})},
  KNOWLEDGE:{query:async(_vector,opts)=>{
    observed.queries.push(opts);
    return {matches:[
      {score:.99,metadata:{character:"oleshka",date:"2026-10-31",text:"Oleshka private"}},
      {score:.88,metadata:{character:"sanko",date:"2026-10-31",text:"Sanko witnessed"}},
    ]};
  }},
  CURRENT_CONTEXT:{get:async(key)=>{
    observed.kv.push(key);
    if(opts.noProfile && key==="sanko:profile:v1")return null;
    if(key==="sanko:profile:v1")return "Approved personal profile of Sanko. ".repeat(12);
    if(key==="sanko:current:v1")return JSON.stringify({asOf:"2026-10-31",text:"Approved snapshot."});
    return null;
  }},
  GUARD_DB:{prepare:(sql)=>({
    bind(...params){this.params=params;return this;},
    async first(){
      if(sql.includes("INSERT INTO chat_admissions")){
        observed.insertions.push(this.params);
        return opts.quotaExhausted?null:{request_id:"quota-approved"};
      }
      if(sql.includes("SELECT COUNT(*)")){
        if(sql.includes("month=?"))return {n:opts.quotaExhausted?15000:0};
        return {n:0};
      }
      return null;
    },
    async run(){return {success:true};}
  })}
 };
 if(opts.diary) {
  env.DIARY_DB={prepare:(sql)=>{
    observed.diarySql=sql;
    return {bind(...params){observed.diaryParams=params;return this;},
      async all(){return {results:opts.diaryPosts||[{
        post_id:12345,owner_id:850667816,published_day_msk:"2026-10-31",
        source_url:"https://vk.com/wall850667816_12345",
        source_text:"Олешка написал в дневнике: перелетели Стену."
      }]};}};
  }};
 }
 return {env,observed};
}
function req(message,extraHeaders={}) {
 return new Request(URL,{method:"POST",headers:{
  Origin:"https://socman2023.github.io","Content-Type":"application/json",
  "CF-Connecting-IP":"198.51.100.10",...extraHeaders
 },body:JSON.stringify({message,history:[],conversationId:"123e4567-e89b-42d3-a456-426614174000"})});
}
const ctx={waitUntil(p){p.catch(()=>{});}};
test("GET health identifies Sanko and not Oleshka",async()=>{
 const r=await worker.fetch(new Request("https://sanko-chat-api.example/"),{},ctx);
 const data=await r.json();assert.equal(r.status,200);assert.equal(data.character,"sanko");
 assert.match(data.version,/sanko-worker/);
});
test("untrusted website origin is forbidden before API work",async()=>{
 const {env}=envStub();
 const r=await worker.fetch(req("Привет",{Origin:"https://evil.example"}),env,ctx);
 assert.equal(r.status,403);
});
test("missing approved profile returns 503 without charging quota",async()=>{
 const {env,observed}=envStub({noProfile:true});
 const r=await worker.fetch(req("Привет"),env,ctx);
 assert.equal(r.status,503);assert.equal(observed.insertions.length,0);
});
test("successful reply isolates profile, Vectorize and date",async()=>{
 const {env,observed}=envStub();
 const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{observed.gemini.push({
   url,
   system:JSON.parse(init.body).systemInstruction.parts[0].text
  });return new Response(JSON.stringify({
  candidates:[{finishReason:"STOP",content:{parts:[{text:"Про то я тебе и расскажу."}]}}]
 }),{status:200,headers:{"Content-Type":"application/json"}});};
 try{
  const r=await worker.fetch(req("Что было 31 октября 2026?"),env,ctx);
  assert.equal(r.status,200);
  const response=await r.json();
  assert.equal(response.reply,"Про то я тебе и расскажу.");
  assert.equal(response.knowledge.matches,1);
  assert.equal(response.knowledge.focusDate,"2026-10-31");
  assert.deepEqual(observed.queries[0].filter.character.$in,["shared","sanko"]);
  assert.equal(observed.queries[0].filter.date.$gte,"2026-10-31");
  assert.equal(observed.insertions.length,1);
  assert(observed.kv.includes("sanko:profile:v1"));
  assert(!observed.kv.some(x=>x.startsWith("oleshka:")));
  const instructions=observed.gemini[0].system;
  assert.match(instructions,/одна или две короткие фразы/);
  assert.match(instructions,/примерно 8–30 слов/);
  assert.match(instructions,/Обычно ты был рядом с Олешкой/);
  assert.match(instructions,/Не сообщай выдуманные текущие события/);
  assert(!instructions.includes("Олешка написал в дневнике: перелетели Стену."));

 }finally{globalThis.fetch=original;}
});
test("monthly quota returns 429 without calling Gemini",async()=>{
 const {env}=envStub({quotaExhausted:true});
 const r=await worker.fetch(req("Расскажи про лес"),env,ctx);
 assert.equal(r.status,429);
 const data=await r.json();
 assert.equal(data.error,"quota_exhausted");
 assert(Number.isFinite(data.retryAt));
});

test("Sanko can read Oleshka's published diary read-only, without changing his D1",async()=>{
 const {env,observed}=envStub({diary:true});
 const nativeFetch=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
   observed.gemini.push({system:JSON.parse(init.body).systemInstruction.parts[0].text});
   return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
     content:{parts:[{text:"Олешка написал, что Стену перелетели. Я тоже там был."}]}}]}),
     {status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
   const r=await worker.fetch(req("А про 31 октября Олешка что написал?"),env,ctx);
   assert.equal(r.status,200);
   assert.match(observed.diarySql,/FROM oleshka_vk_diary/);
   assert.match(observed.diarySql,/^SELECT/);
   assert(!/\b(UPDATE|DELETE|INSERT)\b/i.test(observed.diarySql));
   assert.deepEqual(observed.diaryParams,[850667816,"2026-10-31"]);
   assert.match(observed.gemini[0].system,/Олешка написал в дневнике: перелетели Стену/);
   assert.match(observed.gemini[0].system,/Санко почти всегда рядом с Олешкой/);
   assert.match(observed.gemini[0].system,/улетел/);
   assert.match(observed.gemini[0].system,/Без необходимости не называй источник сведений/);
   assert.equal(observed.insertions.length,1);
 }finally{globalThis.fetch=nativeFetch;}
});

test("Undated query consults older published diary entries by topic and latest posts",async()=>{
 const {env,observed}=envStub({diary:true});
 const requests=[];
 const base=env.DIARY_DB.prepare;
 env.DIARY_DB.prepare=(sql)=>{
   const stmt=base(sql);
   const bind=stmt.bind;
   stmt.bind=function(...values){
     requests.push({sql,values});
     return bind.apply(this,values);
   };
   return stmt;
 };
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
   observed.gemini.push({system:JSON.parse(init.body).systemInstruction.parts[0].text});
   return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"Помню. Разберёмся."}]}}]}),
     {status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
  const r=await worker.fetch(req("А что там было с Мстиславом?"),env,ctx);
  assert.equal(r.status,200);
  assert.equal(requests.length,4);
  assert(requests.every(x=>x.sql.startsWith("SELECT ")));
  assert(requests.every(x=>!/\b(?:UPDATE|DELETE|INSERT)\b/i.test(x.sql)));
  assert.match(requests[0].sql,/published_day_msk/);
  assert.deepEqual(requests[0].values,[850667816,dayInMoscow()]);
  assert.match(requests[1].sql,/published_day_msk/);
  assert.match(requests[2].sql,/source_text LIKE/);
  assert.deepEqual(requests[2].values,[850667816,"%мстиславом%"]);
  assert.deepEqual(requests[3].values,[850667816]);
  assert.equal((await r.json()).knowledge.diaryPosts,1);
 }finally{globalThis.fetch=oldFetch;}
});

test("Today diary includes morning plus afternoon, including text beyond 1900 chars",async()=>{
 const today=dayInMoscow();
 const afternoon="ПОСЛЕ ОБЕДА КНЯЖИЧ ВЕРНУЛСЯ ОТ КУПЦА, И ВЫЯСНИЛОСЬ НОВОЕ.";
 const {env,observed}=envStub({diary:true,diaryPosts:[
  {post_id:2002,owner_id:850667816,published_day_msk:today,
   source_url:"https://vk.com/wall850667816_2002",source_text:"А после обеда: "+afternoon},
  {post_id:2001,owner_id:850667816,published_day_msk:today,
   source_url:"https://vk.com/wall850667816_2001",source_text:"Утро. "+"Переговоры длились. ".repeat(130)+afternoon}
 ]});
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  observed.gemini.push({system:JSON.parse(init.body).systemInstruction.parts[0].text});
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
    content:{parts:[{text:"Вернулся княжич от купца. Теперь решаем, что дальше."}]}}]}),
    {status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
  const r=await worker.fetch(req("А потом?"),env,ctx);
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.knowledge.diaryPosts,2);
  const prompt=observed.gemini[0].system;
  assert(prompt.includes(afternoon));
  assert(prompt.includes("Переговоры длились."));
  assert(prompt.includes("wall850667816_2002"));
  assert(prompt.includes("wall850667816_2001"));
 }finally{globalThis.fetch=original;}
});

test("Entire published posts reach Gemini: 6k, 15k, >16k and >62k total",async()=>{
 const today=dayInMoscow();
 const makePost=(id,prefix,len,tail)=>({
   post_id:id, owner_id:850667816, published_day_msk:today,
   source_url:"https://vk.com/wall850667816_"+id,
   source_text:prefix+"X".repeat(len-prefix.length-tail.length)+tail
 });
 // The Olleshka importer's usual posts are 5–6k; these longer fixtures
 // prevent any future arbitrary source or aggregate cut at 16k/30k/62k.
 const p1=makePost(3001,"Утром: ",6000,"КОНЕЦ_УТРА_3001");
 const p2=makePost(3002,"После обеда: ",15500,"КОНЕЦ_ДНЯ_3002");
 const p3=makePost(3003,"Вечером: ",21000,"КОНЕЦ_ВЕЧЕРА_3003");
 const p4=makePost(3004,"Поздно вечером: ",24000,"КОНЕЦ_ПОЗДНО_3004");
 const all=[p4,p3,p2,p1];
 const {env,observed}=envStub({diary:true,diaryPosts:all});
 const priorFetch=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
   observed.gemini.push({system:JSON.parse(init.body).systemInstruction.parts[0].text});
   return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
     content:{parts:[{text:"Княжич вернулся. Дела сделали."}]}}]}),
     {status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
   const r=await worker.fetch(req("А потом?"),env,ctx);
   assert.equal(r.status,200);
   const data=await r.json();
   assert.equal(data.knowledge.diaryPosts,4);
   const prompt=observed.gemini[0].system;
   for(const post of all) {
     assert(prompt.includes(post.source_text), "Post "+post.post_id+" must survive verbatim");
     assert(prompt.includes("wall850667816_"+post.post_id));
   }
   assert(prompt.length>62000,"All diary content must survive old 62k prompt ceiling");
   assert(!prompt.includes("Средняя часть длинной публикации пропущена"));
 }finally{globalThis.fetch=priorFetch;}
});


test("model fallback after 429: primary overloaded, first reserve succeeds",async()=>{
 const {env,observed}=envStub();
 env.GEMINI_MODEL_ORDER="gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3.8-flash";
 const calls=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{
  const model=String(url).split("/models/")[1].split(":")[0];
  calls.push({model,body:JSON.parse(init.body)});
  if(calls.length===1)return new Response(JSON.stringify({error:{code:429,status:"RESOURCE_EXHAUSTED"}}),
   {status:429,headers:{"Content-Type":"application/json"}});
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"Я тут. Скажи, чего хотел?"}]}}]}),
   {status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
  const response=await worker.fetch(req("Здрав будь, Санко."),env,ctx);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.model,"gemini-3.1-flash-lite");
  assert.equal(data.fallbackUsed,true);
  assert.equal(data.reply,"Я тут. Скажи, чего хотел?");
  assert.deepEqual(calls.map(x=>x.model),["gemini-3.5-flash-lite","gemini-3.1-flash-lite"]);
  assert.deepEqual(calls[0].body.systemInstruction,calls[1].body.systemInstruction);
  assert.deepEqual(calls[0].body.contents,calls[1].body.contents);
  assert.equal(observed.insertions.length,1,"Fallback must consume one Sanko admission");
 }finally{globalThis.fetch=original;}
});

test("fallback steps through transient error, empty and truncated replies to fourth model",async()=>{
 const {env,observed}=envStub();
 env.GEMINI_MODEL_ORDER="gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3.8-flash";
 const calls=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(url)=>{
  const model=String(url).split("/models/")[1].split(":")[0];
  calls.push(model);
  if(calls.length===1)return new Response(JSON.stringify({error:{code:503}}),{status:503});
  if(calls.length===2)return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[]}}]}),{status:200});
  if(calls.length===3)return new Response(JSON.stringify({candidates:[{finishReason:"MAX_TOKENS",content:{parts:[{text:"Only start"}]}}]}),{status:200});
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"Ага. Разберёмся."}]}}]}),{status:200});
 };
 try{
  const response=await worker.fetch(req("Как дела?"),env,ctx);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.model,"gemini-3.8-flash");
  assert.equal(data.fallbackUsed,true);
  assert.deepEqual(calls,["gemini-3.5-flash-lite","gemini-3.1-flash-lite",
   "gemini-3.6-flash","gemini-3.8-flash"]);
  assert.equal(observed.insertions.length,1);
 }finally{globalThis.fetch=original;}
});

test("safety-blocked reply is not bypassed via fallback",async()=>{
 const {env}=envStub();
 env.GEMINI_MODEL_ORDER="gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3.8-flash";
 const calls=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(url)=>{
  calls.push(String(url));
  return new Response(JSON.stringify({candidates:[{finishReason:"SAFETY",content:{parts:[]}}]}),{status:200});
 };
 try{
  const response=await worker.fetch(req("Как поживаешь?"),env,ctx);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,"blocked");
  assert.equal(calls.length,1,"Do not hop models to bypass a safety block");
 }finally{globalThis.fetch=original;}
});
