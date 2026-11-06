import test from 'node:test';
import assert from 'node:assert/strict';
import {createSankoHandler} from '../worker.mjs';
import stagingEntry from '../index.mjs';

const api='https://sanko-chat-next-staging.example';
const origin='https://socman2023.github.io';
const env={STAGING_MODE:'true',ENABLE_REAL_MODEL:'false',
  GUARD_DB:{prepare:()=>({})},DIARY_DB:{prepare:()=>({})},
  CURRENT_CONTEXT:{get:async()=>null},GEMINI_API_KEY:'dummy',
  GEMINI_MODEL:'gemini-3.5-flash-lite',IP_HASH_SECRET:'1234567890123456789012345'};
const request=(path,body,headers={})=>new Request(api+path,{
  method:'POST',body:typeof body==='string'?body:JSON.stringify(body),
  headers:{Origin:origin,'Content-Type':'application/json',...headers}
});

test('actual staging entry fails closed when STAGING_MODE is absent or changed',async()=>{
  for(const unsafe of [{}, {STAGING_MODE:'false'}, {STAGING_MODE:'TRUE'}]){
    const r=await stagingEntry.fetch(request('/api/chat',{message:'Здрав будь!'}),{...env,...unsafe,...(!Object.hasOwn(unsafe,'STAGING_MODE')?{STAGING_MODE:undefined}:{})});
    assert.equal(r.status,503);
    assert.equal((await r.json()).error,'staging_configuration_invalid');
  }
});

test('staging entry cannot reveal admin pages when mandatory stage flag is missing',async()=>{
  const r=await stagingEntry.fetch(new Request(api+'/admin/stats'),{...env,STAGING_MODE:'false'});
  assert.equal(r.status,503);
});

test('missing staging flag stops quota and model before any billing or D1 writes',async()=>{
  let providerCalls=0,quotaCalls=0;
  const handler=createSankoHandler({stagingMandatory:true,
    personaLoader:async()=>({approved:true,instructions:'Ты Санко'}),
    contextLoader:async()=>({today:'2026-11-06',verifiedPersonalClaims:[],sourcePosts:[]}),
    knowledgeLoader:async()=>({hits:[]}),
    quota:async()=>{quotaCalls++;return {ok:true,requestId:'x'};},
    modelFactory:()=>({generate:async()=>{providerCalls++;return {text:'Порядок.'};}})
  });
  const r=await handler.fetch(request('/api/chat',{message:'Здрав будь!'}),
    {...env,STAGING_MODE:undefined,ENABLE_REAL_MODEL:'true'});
  assert.equal(r.status,503);assert.equal(quotaCalls,0);assert.equal(providerCalls,0);
});

test('VK session rejects oversized untrusted streamed body before identity verification',async()=>{
  let pulls=0,verifyCalls=0;
  const handler=createSankoHandler({stagingMandatory:true,
    vkVerifier:async()=>{verifyCalls++;return null;}});
  const stream=new ReadableStream({pull(c){pulls++;
    c.enqueue(new TextEncoder().encode('X'.repeat(2400)));
    if(pulls>30)c.close();}});
  const req=new Request(api+'/api/session',{method:'POST',headers:{Origin:origin},
    body:stream,duplex:'half'});
  const r=await handler.fetch(req,env);
  assert.equal(r.status,400);assert.equal((await r.json()).error,'body_too_large');
  assert.equal(verifyCalls,0);assert(pulls<10);
});

test('VK session denies oversized declared body, arrays and invalid JSON',async()=>{
  let verifies=0;
  const handler=createSankoHandler({stagingMandatory:true,
    vkVerifier:async()=>{verifies++;return null;}});
  const declared=await handler.fetch(request('/api/session',{vkLaunch:'x'},
    {'Content-Length':'90000'}),env);
  assert.equal(declared.status,400);
  assert.equal((await declared.json()).error,'body_too_large');
  const array=await handler.fetch(request('/api/session','[]'),env);
  assert.equal(array.status,400);
  assert.equal((await array.json()).error,'invalid_json');
  const invalid=await handler.fetch(request('/api/session','not-json'),env);
  assert.equal(invalid.status,400);
  assert.equal((await invalid.json()).error,'invalid_json');
  assert.equal(verifies,0);
});

test('staging quota response reports staged limits rather than production limits',async()=>{
  const handler=createSankoHandler({stagingMandatory:true,
    now:()=>Date.parse('2026-11-06T18:00:00Z'),
    personaLoader:async()=>({approved:true,instructions:'Ты Санко, отвечай по делу.'}),
    contextLoader:async()=>({today:'2026-11-06',lastKnownPublicationDay:null,
      sourcePosts:[],verifiedPersonalClaims:[],sourceStatus:'read_complete'}),
    knowledgeLoader:async()=>({hits:[]}),
    quota:async()=>({ok:false}),
    modelFactory:()=>{throw Error('not called');}
  });
  const r=await handler.fetch(request('/api/chat',{message:'Привет'}),
    {...env,ENABLE_REAL_MODEL:'true'});
  assert.equal(r.status,429);
  const body=await r.json();
  assert.deepEqual(body.quota,{day:20,month:100,ipDay:10});
});
