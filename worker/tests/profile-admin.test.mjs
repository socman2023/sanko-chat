import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {profileStatus,activateProfile,restoreProfile} from "../src/profile-admin.js";
import {ADMIN_SCRIPT} from "../src/admin-ui.js";
const BASE="https://sanko-chat-api.boysinger2008.workers.dev";
const TOKEN="test-admin-token-36-characters-long-never-use-real";
const PROFILE="САНКО — ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ v0.4.0 / ДЛЯ УТВЕРЖДЕНИЯ АВТОРОМ\n"+
 "ОЛЕШКА ВЛАСТОЯР ЯСМИН / ЛУНА БРОМ ХАСИМ СИЛЬВАРИЯ РАТША ЯРКО РУМАН "+
 "ЭЛИНА АЙОАН КЛАСС АРБОРИСА КЛАСС СИМЕОНА КЛАСС БРИНА "+
 "Поднебесья источников\n"+"Санко — самостоятельный главный герой. ".repeat(400);
function mock(){
 const map=new Map([["sanko:profile:v1","Previous, approved personal Sanko profile. ".repeat(300)]]);
 const events=[];
 const env={ADMIN_UPDATE_TOKEN:TOKEN,IP_HASH_SECRET:"test-hash-key",
  GUARD_DB:{prepare(){throw Error("Do not touch D1");}},
  CURRENT_CONTEXT:{
   async get(k){events.push({op:"get",k});return map.get(k)||null;},
   async put(k,v){events.push({op:"put",k});map.set(k,v);}
  }
 };
 return {env,map,events};
}
function request(path,{token=TOKEN,origin=BASE,body={},method="POST"}={}){
 const headers={"Content-Type":"application/json"};
 if(token)headers.Authorization="Bearer "+token;
 if(origin)headers.Origin=origin;
 return new Request(BASE+path,{method,headers,...(method==="POST"?{body:JSON.stringify(body)}:{})});
}
const ctx={waitUntil(){}};
test("profile replacement requires valid token and same-origin admin request",async()=>{
 const {env,events}=mock();
 let r=await worker.fetch(request("/admin/profile/activate",{token:"",body:{profile:PROFILE}}),env,ctx);
 assert.equal(r.status,401);
 r=await worker.fetch(request("/admin/profile/activate",{origin:"https://evil.example",
  body:{profile:PROFILE}}),env,ctx);
 assert.equal(r.status,403);
 assert.equal(events.length,0);
});
test("new personal profile does not accept incomplete or overlong canon",async()=>{
 const {env,map}=mock();
 for(const profile of ["Wrong personal profile","САНКО — ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ v0.4.0\n"+("abc".repeat(5000)),
   PROFILE+"t".repeat(40000)]){
  const r=await activateProfile(env,{profile});
  assert.equal(r.status,400);
 }
 assert.notEqual(map.get("sanko:profile:v1"),PROFILE);
});
test("private profile activation has a reversible backup and no writes to Oleshka",async()=>{
 const {env,map,events}=mock();
 const prior=map.get("sanko:profile:v1");
 const activate=await activateProfile(env,{profile:PROFILE});
 assert.equal(activate.status,200);
 const out=await activate.json();
 assert.equal(out.chars,PROFILE.length);
 assert.equal(out.sha256.length,64);
 assert.equal(map.get("sanko:profile:v1"),PROFILE);
 assert.equal(out.backupCreated,true);
 assert(events.some(e=>e.op==="put"&&e.k.startsWith("sanko:profile:backup:")));
 assert(events.every(e=>e.k.startsWith("sanko:")));
 const status=await (await profileStatus(env)).json();
 assert.equal(status.hasBackup,true);
 assert.equal(status.chars,PROFILE.length);
 assert.equal(status.sha256,out.sha256);
 assert(!JSON.stringify(status).includes("ЯСМИН"));
 const rollback=await restoreProfile(env);
 assert.equal(rollback.status,200);
 assert.equal(map.get("sanko:profile:v1"),prior);
});
test("protected profile routes work inside Sanko admin without exposing secret in HTML",async()=>{
 const {env,map}=mock();
 let r=await worker.fetch(request("/admin/profile",{method:"GET",token:"",origin:""}),env,ctx);
 assert.equal(r.status,200);
 const html=await r.text();
 assert(html.includes("Персональный профиль Санко"));
 assert(!html.includes(TOKEN));
 assert(!html.includes(map.get("sanko:profile:v1")));
 r=await worker.fetch(request("/admin/profile/status"),env,ctx);
 assert.equal(r.status,200);
 assert.equal((await r.json()).present,true);
 r=await worker.fetch(request("/admin/profile/activate",{body:{profile:PROFILE}}),env,ctx);
 assert.equal(r.status,200);
 assert.equal(map.get("sanko:profile:v1"),PROFILE);
});
test("admin browser script parses correctly with a separate profile route",()=>{
 assert.doesNotThrow(()=>new Function(ADMIN_SCRIPT));
 assert(ADMIN_SCRIPT.includes("profileFile"));
 assert(ADMIN_SCRIPT.includes("profileRestore"));
 assert(!ADMIN_SCRIPT.includes("localStorage"));
});
