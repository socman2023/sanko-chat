import test from 'node:test';
import assert from 'node:assert/strict';
import {createSankoHandler} from '../worker.mjs';

const api='https://test.invalid/api/chat';
const env={GUARD_DB:{prepare:()=>({})},DIARY_DB:{prepare:()=>({})},CURRENT_CONTEXT:{get:async()=>null},
  GEMINI_API_KEY:'mock',GEMINI_MODEL:'gemini-test',IP_HASH_SECRET:'12345678901234567890'};
function worker(){return createSankoHandler({
  personaLoader:async()=>({approved:true,instructions:'Ты Санко'}),
  contextLoader:async()=>({sourcePosts:[],today:'2026-11-06',verifiedPersonalClaims:[]}),
  knowledgeLoader:async()=>({hits:[]}),
  modelFactory:()=>({generate:async()=>{throw Error('should not run');}}),
  quota:async()=>{throw Error('should not admit');}
});}
test('JSON body exceeding 35kb via stream fails before quota/model calls',async()=>{
  let chunks=0;
  const stream=new ReadableStream({pull(c){chunks++;
    c.enqueue(new TextEncoder().encode('X'.repeat(18000)));
    if(chunks>20)c.close();}});
  const req=new Request(api,{method:'POST',body:stream,duplex:'half',
    headers:{Origin:'https://socman2023.github.io'}});
  const r=await worker().fetch(req,env);
  assert.equal(r.status,400);
  assert.equal((await r.json()).error,'body_too_large');
  assert(chunks<10);
});
test('declared oversized body is rejected before buffering',async()=>{
  const req=new Request(api,{method:'POST',body:'{}',headers:{
    Origin:'https://socman2023.github.io','Content-Length':'40000'}});
  const r=await worker().fetch(req,env);
  assert.equal(r.status,400);
  assert.equal((await r.json()).error,'body_too_large');
});
