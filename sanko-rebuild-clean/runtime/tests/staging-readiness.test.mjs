import test from 'node:test';
import assert from 'node:assert/strict';
import {createSankoHandler} from '../worker.mjs';
const now=Date.parse('2026-11-06T17:00:00Z');
const baseEnv={STAGING_MODE:'true',ENABLE_REAL_MODEL:'false',
  GUARD_DB:{prepare:()=>({})},DIARY_DB:{prepare:()=>({})},
  CURRENT_CONTEXT:{get:async()=>null},GEMINI_API_KEY:'dummy',
  GEMINI_MODEL:'gemini-3.5-flash-lite',IP_HASH_SECRET:'12345678901234567890'};
const chat=()=>new Request('https://sanko-chat-next-staging.example/api/chat',{
  method:'POST',headers:{Origin:'https://socman2023.github.io'},
  body:JSON.stringify({message:'Здрав будь!'})});
test('staging model switch denies provider and quota before approval',async()=>{
  let calls=0,quotaCalls=0;
  const handler=createSankoHandler({now:()=>now,
    quota:async()=>{quotaCalls++;return {ok:true,requestId:'req1'};},
    modelFactory:()=>({generate:async()=>{calls++;return {text:'Хорошо.'};}})});
  const r=await handler.fetch(chat(),baseEnv);
  assert.equal(r.status,503);
  assert.equal((await r.json()).error,'staging_model_disabled');
  assert.equal(calls,0);assert.equal(quotaCalls,0);
});
test('staging quota fields are strict subset of production limits',async()=>{
  const handler=createSankoHandler({now:()=>now});
  const r=await handler.fetch(new Request('https://staging.example/health'),baseEnv);
  const data=await r.json();
  assert.equal(data.realGeminiEnabled,false);
  assert.deepEqual(data.quota,{day:20,month:100,ipDay:10});
  assert.equal(data.diarySync.status,'read_error');
});
test('staging-only quota is passed to D1 admission on an enabled fixture',async()=>{
  let limits=null;
  const handler=createSankoHandler({now:()=>now,
    personaLoader:async()=>({approved:true,instructions:'Ты Санко. Шо?'}),
    contextLoader:async()=>({today:'2026-11-06',lastKnownPublicationDay:null,sourcePosts:[],
      verifiedPersonalClaims:[],unselectedSourceCount:0,sourceStatus:'read_complete'}),
    knowledgeLoader:async()=>({hits:[]}),
    quota:async info=>{limits=info.limits;return {ok:false};},
    modelFactory:()=>{throw Error('should not call');}
  });
  const r=await handler.fetch(chat(),{...baseEnv,ENABLE_REAL_MODEL:'true'});
  assert.equal(r.status,429);
  assert.deepEqual(limits,{day:20,month:100,ipDay:10});
});
test('health reads only public diary timing metadata',async()=>{
  const queries=[],db={prepare(sql){queries.push(sql);return {
    bind(){return this;},async first(){return sql.includes('COUNT')?{n:1}:
      {post_id:32244,published_day_msk:'2026-11-06',
        published_at:1793998800,ingested_at:1794000600};}}}};
  const handler=createSankoHandler({now:()=>now});
  const r=await handler.fetch(new Request('https://staging.example/health'),
    {...baseEnv,DIARY_DB:db});
  const j=await r.json();
  assert.equal(j.diarySync.status,'ok');
  assert.equal(j.diarySync.postsToday,1);
  assert.equal(j.diarySync.latestPostDay,'2026-11-06');
  assert(!JSON.stringify(j).includes('source_text'));
  assert(queries.every(s=>!/(INSERT|UPDATE|DELETE)\s/u.test(s)));
});
test('preview Worker accepts same-origin web clients without widening access',async()=>{
  const handler=createSankoHandler({now:()=>now});
  const local='http://127.0.0.1:8787';
  const health=new Request(local+'/health',{headers:{Origin:local}});
  const a=await handler.fetch(health,baseEnv);
  assert.equal(a.status,200);
  const bad=new Request(local+'/health',{headers:{Origin:'https://attacker.example'}});
  const b=await handler.fetch(bad,baseEnv);
  assert.equal(b.status,403);
});
