import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const BASE="https://sanko-chat-api.boysinger2008.workers.dev";
const TOKEN="test-administrator-token-only-not-a-real-secret-1234567890";
const CONVERSATION="123e4567-e89b-42d3-a456-426614174000";
const wait={waitUntil(p){p?.catch(()=>{});}};
function createEnv() {
 const calls=[];
 const env={
  ADMIN_UPDATE_TOKEN:TOKEN,IP_HASH_SECRET:"testing-hash-only-no-real-secret-12345",
  GUARD_DB:{prepare(sql){
   const q={sql,values:[],bind(...values){this.values=values;return this;},
    async first(){
     calls.push({sql:this.sql,values:this.values});
     if(sql.includes("COUNT(DISTINCT conversation_id)"))return {n:1};
     if(sql.includes("COUNT(DISTINCT t.conversation_id)"))return {n:1};
     if(sql.includes("chat_admissions WHERE month"))return {n:7};
     if(sql.includes("AND client_hash="))return {n:2};
     return {n:0};
    },
    async all(){
     calls.push({sql:this.sql,values:this.values});
     if(sql.includes("GROUP BY day"))return {results:[{day:"2026-11-02",n:5,ips:3}]};
     if(sql.includes("GROUP BY model"))return {results:[{model:"gemini-3.5-flash-lite",n:4}]};
     if(sql.includes("GROUP BY status"))return {results:[{status:"answered",n:4}]};
     if(sql.includes("GROUP BY t.conversation_id"))return {results:[{
      conversationId:CONVERSATION,firstAt:1000,lastAt:1005,turns:2,preview:"Привет"
     }]};
     if(sql.includes("FROM chat_turns WHERE conversation_id"))return {results:[{
      id:1,askedAt:1000,question:"Привет",reply:"Здрав будь.",model:"gemini-3.5-flash-lite",status:"answered"
     }]};
     return {results:[]};
    }
   };
   return q;
  }}
 };
 return {env,calls};
}
function request(path,{method="GET",token="",origin="",body={}}={}) {
 const headers={};
 if(token)headers.Authorization="Bearer "+token;
 if(origin)headers.Origin=origin;
 if(method==="POST")headers["Content-Type"]="application/json";
 return new Request(BASE+path,{method,headers,
  ...(method==="POST"?{body:JSON.stringify(body)}:{})});
}
test("public admin pages display NO statistics or conversations",async()=>{
 const {env}=createEnv();
 for(const path of ["/admin/stats","/admin/chats"]){
  const response=await worker.fetch(request(path),env,wait);
  assert.equal(response.status,200);
  assert.match(response.headers.get("Cache-Control"),/no-store/);
  assert.match(response.headers.get("Content-Security-Policy"),/script-src 'self'/);
  const html=await response.text();
  assert(html.includes("Административный токен Санко"));
  assert(!html.includes(TOKEN));
  assert(!html.includes("Здрав будь."));
  assert(!html.includes("Oleshka private"));
 }
});
test("admin data cannot be accessed without a configured valid token",async()=>{
 const {env,calls}=createEnv();
 let response=await worker.fetch(request("/admin/stats/data",{method:"POST"}),env,wait);
 assert.equal(response.status,401);
 response=await worker.fetch(request("/admin/chats/list",{method:"POST",token:"x".repeat(40)}),env,wait);
 assert.equal(response.status,401);
 const noTokenEnv={...env,ADMIN_UPDATE_TOKEN:""};
 response=await worker.fetch(request("/admin/chats/thread",{method:"POST",token:TOKEN,
  body:{conversationId:CONVERSATION}}),noTokenEnv,wait);
 assert.equal(response.status,401);
 assert.equal(calls.length,0,"D1 queries must not run for unauthorized visitors");
});
test("admin rejects cross-origin POST even with real token",async()=>{
 const {env,calls}=createEnv();
 const r=await worker.fetch(request("/admin/stats/data",{method:"POST",token:TOKEN,
  origin:"https://socman2023.github.io"}),env,wait);
 assert.equal(r.status,403);
 assert.equal(calls.length,0);
});
test("admin stats show independent Sanko admissions, never client hash values",async()=>{
 const {env,calls}=createEnv();
 const r=await worker.fetch(request("/admin/stats/data",{method:"POST",token:TOKEN,
  origin:BASE}),env,wait);
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.character,"sanko");
 assert.deepEqual(body.limits,{daily:500,monthly:15000,ipDaily:100});
 assert.equal(body.month.admitted,7);
 assert.equal(body.today.fromThisIp,2);
 assert.equal(body.conversations30d,1);
 assert.equal(body.daily.length,30);
 assert.equal(body.models[0].model,"gemini-3.5-flash-lite");
 assert(!JSON.stringify(body).includes("client_hash"));
 assert(calls.every(c=>!c.sql.includes("oleshka_vk_diary")));
 assert(calls.every(c=>!c.sql.includes("DIARY_DB")));
});
test("admin conversations list, search and thread detail are authenticated",async()=>{
 const {env,calls}=createEnv();
 let r=await worker.fetch(request("/admin/chats/list",{method:"POST",token:TOKEN,
  origin:BASE,body:{query:"Привет",offset:0,limit:20}}),env,wait);
 assert.equal(r.status,200);
 const list=await r.json();
 assert.equal(list.total,1);
 assert.equal(list.threads[0].conversationId,CONVERSATION);
 assert(calls.some(c=>c.sql.includes("chat_turns")&&c.sql.includes("ESCAPE")));
 r=await worker.fetch(request("/admin/chats/thread",{method:"POST",token:TOKEN,
  origin:BASE,body:{conversationId:CONVERSATION}}),env,wait);
 assert.equal(r.status,200);
 const dialog=await r.json();
 assert.equal(dialog.turns[0].reply,"Здрав будь.");
 r=await worker.fetch(request("/admin/chats/thread",{method:"POST",token:TOKEN,
  origin:BASE,body:{conversationId:"invalid-uuid"}}),env,wait);
 assert.equal(r.status,400);
});
test("admin search escapes wildcard characters in LIKE patterns",async()=>{
 const {env,calls}=createEnv();
 const r=await worker.fetch(request("/admin/chats/list",{method:"POST",token:TOKEN,
  body:{query:"%_%"}}),env,wait);
 assert.equal(r.status,200);
 assert(calls.some(c=>c.values.some(v=>typeof v==="string"&&v.includes("\\%\\_\\%"))));
});
test("admin static assets do not load external scripts or store the admin token",async()=>{
 const {env}=createEnv();
 const r=await worker.fetch(request("/admin/assets/app.js"),env,wait);
 assert.equal(r.status,200);
 const js=await r.text();
 assert(js.includes("textContent"));
 assert(!js.includes("localStorage"));
 assert(!js.includes("sessionStorage"));
 assert(!js.includes("innerHTML"));
 assert(!js.includes(TOKEN));
});
