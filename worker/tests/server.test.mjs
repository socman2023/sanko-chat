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
  assert.match(instructions,/Строго запрещены буквы/);
  assert.match(instructions,/понятным русским языком/);
  assert.match(instructions,/Не объявляй, что сегодня кормишь коней/);
  assert.match(instructions,/Отдельной дневной заметки нет/);

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
