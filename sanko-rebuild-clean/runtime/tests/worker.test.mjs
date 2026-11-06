import test from 'node:test';
import assert from 'node:assert/strict';
import {createSankoHandler} from '../worker.mjs';
import {admit,ipHash,storeTokenAttempt,storeTurn,QUOTAS} from '../guard-store.mjs';
import {buildCurrentContext} from '../../chronicle/current-context.mjs';

const day='2026-11-06';
const mockTime=()=>Date.parse('2026-11-06T14:30:00Z');
const context=buildCurrentContext({today:day,posts:[],approvedClaims:[],sourceReadComplete:true});
const persona={approved:true,instructions:'Ты Санко. Отвечай от первого лица. Пиши шо вместо что.'};
const env={GUARD_DB:{prepare:()=>({})},DIARY_DB:{prepare:()=>({})},
 CURRENT_CONTEXT:{get:async()=>null},GEMINI_API_KEY:'test_only',GEMINI_MODEL:'gemini-test',
 IP_HASH_SECRET:'a-secret-that-is-long-enough-for-testing'};
const url='https://test.invalid/api/chat';
const request=(message,origin='https://socman2023.github.io',additional={})=>new Request(url,{
 method:'POST',headers:{'Content-Type':'application/json','Origin':origin,
   'CF-Connecting-IP':'203.0.113.1'},body:JSON.stringify({message,...additional})});
function createFixture({reply='Не слыхал пока новых вестей.',modelThrows=false,approve=true,
  quotaOk=true,failStorage=false}={}){
 let calls=0,dbWrites=0,usageWrites=0,quotaCalls=0;
 const worker=createSankoHandler({
  now:mockTime,
  personaLoader:async()=>approve?persona:null,
  contextLoader:async()=>context,
  modelFactory:()=>({generate:async()=>{calls++;if(modelThrows)throw Error('api_closed');
    return {text:reply,model:'model-test',usage:{promptTokenCount:10,totalTokenCount:20}};}}),
  quota:async()=>{quotaCalls++;return quotaOk?{ok:true,requestId:'req-123'}:{ok:false};},
  saveTurn:async()=>{dbWrites++;if(failStorage)throw Error('db_closed');},
  saveUsage:async()=>{usageWrites++;}
 });
 return {worker,getStats:()=>({calls,dbWrites,usageWrites,quotaCalls})};
}

test('readiness endpoint remains staging-only and sends no private data',async()=>{
 const {worker,getStats}=createFixture();
 const r=await worker.fetch(new Request('https://test.invalid/health'),env);
 assert.equal(r.status,200);
 assert.equal((await r.json()).status,'staging_only');
 assert.equal(getStats().calls,0);
});
test('isolated Worker accepts one conversation and records counts',async()=>{
 const {worker,getStats}=createFixture({reply:'Нынче нового не слыхал.'});
 const r=await worker.fetch(request('А сегодня?'),env);
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.reply,'Нынче нового не слыхал.');
 assert.match(body.conversationId,/^[a-f0-9-]{36}$/iu);
 assert.equal(body.knowledge.latestPublicationDay,null);
 assert.deepEqual(getStats(),{calls:1,dbWrites:1,usageWrites:1,quotaCalls:1});
});
test('origin restriction rejects outside website without model or DB writes',async()=>{
 const {worker,getStats}=createFixture();
 const r=await worker.fetch(request('Привет','https://evil.example'),env);
 assert.equal(r.status,403);assert.equal(getStats().calls,0);
});
test('missing cloud bindings fails closed',async()=>{
 const {worker,getStats}=createFixture();
 const r=await worker.fetch(request('Привет'),{});
 assert.equal(r.status,503);assert.equal(getStats().calls,0);
});
test('unapproved persona fails closed before quota or generation',async()=>{
 const {worker,getStats}=createFixture({approve:false});
 const r=await worker.fetch(request('Привет'),env);
 assert.equal(r.status,503);
 assert.deepEqual(getStats(),{calls:0,dbWrites:0,usageWrites:0,quotaCalls:0});
});
test('quota 429 blocks the model before invocation',async()=>{
 const {worker,getStats}=createFixture({quotaOk:false});
 const r=await worker.fetch(request('Привет'),env);
 assert.equal(r.status,429);
 assert.equal(getStats().calls,0);
 assert.equal((await r.json()).quota.day,500);
});
test('provider errors are recorded without inventing character speech',async()=>{
 const {worker,getStats}=createFixture({modelThrows:true});
 const r=await worker.fetch(request('Что нового?'),env);
 assert.equal(r.status,503);
 assert.equal((await r.json()).error,'provider_unavailable');
 assert.equal(getStats().dbWrites,1);assert.equal(getStats().calls,1);
});
test('failed unnatural response must not escape to reader',async()=>{
 const {worker,getStats}=createFixture({reply:'По доступным записям, сегодня 6 ноября 2026.'});
 const r=await worker.fetch(request('А сегодня?'),env);
 assert.equal(r.status,422);
 const j=await r.json();
 assert.equal(j.error,'response_quality_failed');
 assert.equal(j.reply,undefined);
 assert.equal(getStats().dbWrites,1);
});
test('storage error is explicit and never claims successful conversation',async()=>{
 const {worker}=createFixture({failStorage:true});
 const r=await worker.fetch(request('Привет'),env);
 assert.equal(r.status,503);
 assert.equal((await r.json()).error,'log_storage_failed');
});
test('invalid JSON, missing message and overlong message rejected',async()=>{
 const {worker,getStats}=createFixture();
 const bad=new Request(url,{method:'POST',headers:{Origin:'https://socman2023.github.io'},body:'NOJSON'});
 assert.equal((await worker.fetch(bad,env)).status,400);
 assert.equal((await worker.fetch(request(' '),env)).status,400);
 assert.equal((await worker.fetch(request('а'.repeat(4001)),env)).status,400);
 assert.equal(getStats().quotaCalls,0);
});
test('OPTIONS sends allowed CORS only',async()=>{
 const {worker}=createFixture();
 const r=await worker.fetch(new Request(url,{method:'OPTIONS',headers:{Origin:'https://socman2023.github.io'}}),env);
 assert.equal(r.status,204);
 assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://socman2023.github.io');
});
test('IP hashing is deterministic per day but changes between days',async()=>{
 const a=await ipHash({day,ip:'203.0.113.1',secret:env.IP_HASH_SECRET});
 const b=await ipHash({day,ip:'203.0.113.1',secret:env.IP_HASH_SECRET});
 const c=await ipHash({day:'2026-11-07',ip:'203.0.113.1',secret:env.IP_HASH_SECRET});
 assert.equal(a,b);assert.notEqual(a,c);
});
test('D1 quota query is one atomic conditional insert, same limits',async()=>{
 let sql='',values=[];
 const db={prepare(q){sql=q;return {bind(...p){values=p;return this;},async first(){return {request_id:values[0]};}}}};
 const r=await admit({db,day,ip:'203.0.113.1',secret:env.IP_HASH_SECRET,clock:mockTime()});
 assert.equal(r.ok,true);assert.match(sql,/INSERT INTO chat_admissions/u);
 assert.match(sql,/RETURNING request_id/u);
 assert.deepEqual(values.filter(v=>v===500||v===15000||v===100),[500,15000,100]);
 assert.equal(QUOTAS.day,500);assert.equal(QUOTAS.month,15000);
 assert.equal(QUOTAS.ipDay,100);
});
test('token accounting uses explicit null for unknown usage',async()=>{
 let values,sql;
 const db={prepare(q){sql=q;return {bind(...p){values=p;return this;},async run(){return {};}}}};
 await storeTokenAttempt({db,requestId:'R',day,model:'gemini-test',usage:{promptTokenCount:20}});
 assert.match(sql,/INSERT INTO token_usage/u);
 assert.equal(values[5],20);
 assert.equal(values[6],null);assert.equal(values[9],null);
});
test('conversation saved in existing D1 schema without needing migration',async()=>{
 let captured;
 const db={prepare(q){return {bind(...p){captured={q,p};return this;},async run(){}}}};
 await storeTurn({db,requestId:'R',conversationId:'C',message:'Привет',reply:'Здрав будь!',
   model:'test',status:'answered'});
 assert.match(captured.q,/INSERT INTO chat_turns/u);
 assert.equal(captured.p[3],'Привет');assert.equal(captured.p[4],'Здрав будь!');
});
