import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

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
      async all(){return {results:[{
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
  assert.equal(requests.length,2);
  assert(requests.every(x=>x.sql.startsWith("SELECT ")));
  assert(requests.every(x=>!/\b(?:UPDATE|DELETE|INSERT)\b/i.test(x.sql)));
  assert.match(requests[0].sql,/source_text LIKE/);
  assert.deepEqual(requests[0].values,[850667816,"%мстиславом%"]);
  assert.deepEqual(requests[1].values,[850667816]);
  assert.equal((await r.json()).knowledge.diaryPosts,1);
 }finally{globalThis.fetch=oldFetch;}
});
