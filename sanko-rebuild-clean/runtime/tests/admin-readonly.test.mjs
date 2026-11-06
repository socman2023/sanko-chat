import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ipHash} from '../guard-store.mjs';
import {readAdminStats,readAdminConversationList,readAdminConversation,
  readAdminKnowledgeStatus,readAdminProfileStatus} from '../admin-readonly.mjs';
import {readTokenReport} from '../token-report.mjs';

const NOW=Date.parse('2026-11-06T15:45:00Z'),DAY='2026-11-06';
const CID='a1c7aa27-32dc-420a-9442-976b42e8b2ad';
const IP='203.0.113.200';
const SECRET='fixture-only-do-not-use-in-cloudflare';
const wrapper=db=>({prepare(q){return {bind(...args){return {
  all:async()=>({results:db.prepare(q).all(...args)}),
  first:async()=>db.prepare(q).get(...args)??null,
  run:async()=>db.prepare(q).run(...args)
  };}};}});
function fixture(){
 const raw=new DatabaseSync(':memory:');
 raw.exec(`CREATE TABLE chat_admissions(request_id TEXT PRIMARY KEY,day TEXT,month TEXT,client_hash TEXT,created_at INTEGER);
 CREATE TABLE chat_turns(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT,
 admission_id TEXT,asked_at INTEGER,question TEXT,reply TEXT,model TEXT,status TEXT);
 CREATE TABLE token_usage(id INTEGER PRIMARY KEY AUTOINCREMENT,admission_id TEXT,
 attempted_at INTEGER,day TEXT,model TEXT,result TEXT,prompt_tokens INTEGER,
 candidate_tokens INTEGER,thoughts_tokens INTEGER,cached_tokens INTEGER,total_tokens INTEGER);
 CREATE TABLE sanko_canon_chunks(id TEXT PRIMARY KEY,source TEXT,scope TEXT,priority INTEGER,
 published_day TEXT,title TEXT,content TEXT,search_text TEXT,indexed INTEGER);`);
 return {raw,db:wrapper(raw),close:()=>raw.close()};
}
async function seed(f){
 const hash=await ipHash({day:DAY,ip:IP,secret:SECRET});
 f.raw.prepare('INSERT INTO chat_admissions VALUES (?,?,?,?,?)')
  .run('R1',DAY,'2026-11',hash,Math.floor(NOW/1000)-100);
 f.raw.prepare('INSERT INTO chat_turns(conversation_id,admission_id,asked_at,question,reply,model,status) VALUES(?,?,?,?,?,?,?)')
  .run(CID,'R1',Math.floor(NOW/1000),'Привет!','Здрав будь!','gemini-test','answered');
 f.raw.prepare('INSERT INTO token_usage(admission_id,attempted_at,day,model,result,prompt_tokens,candidate_tokens,thoughts_tokens,cached_tokens,total_tokens) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run('R1',Math.floor(NOW/1000),DAY,'gemini-test','answered',3300,18,5,100,3323);
 f.raw.prepare('INSERT INTO sanko_canon_chunks VALUES (?,?,?,?,?,?,?,?,?)')
  .run('c1','book1.docx','books',5,'','Санко','Подлинные сведения','санко подлинные сведения',1);
}

test('statistics adapter returns all existing admin scalar and token keys',async t=>{
 const f=fixture();t.after(f.close);await seed(f);
 const x=await readAdminStats({db:f.db,now:NOW,ip:IP,ipHashSecret:SECRET});
 assert.equal(x.ok,true);assert.equal(x.limits.daily,500);
 assert.equal(x.today.admitted,1);assert.equal(x.today.fromThisIp,1);
 assert.equal(x.month.remaining,14999);assert.equal(x.conversations30d,1);
 assert.equal(x.models[0].model,'gemini-test');
 assert.equal(x.daily.length,30);
 assert.equal(x.tokenUsage.status,'ready');
 assert.equal(x.tokenUsage.today.prompt,3300);
 assert.equal(x.tokenUsage.month.total,3323);
 assert.equal(x.tokenUsage.month.cached,100);
 assert.equal(x.tokenUsage.averagePerMeteredCall,3323);
});
test('conversation list matches old admin UI fields and search by question',async t=>{
 const f=fixture();t.after(f.close);await seed(f);
 const x=await readAdminConversationList({db:f.db,now:NOW,query:'Привет'});
 assert.equal(x.total,1);assert.equal(x.threads[0].conversationId,CID);
 assert.equal(x.threads[0].turns,1);
 assert.equal(x.threads[0].preview,'Привет!');
 const y=await readAdminConversationList({db:f.db,now:NOW,query:'Несуществующее'});
 assert.equal(y.total,0);assert.deepEqual(y.threads,[]);
});
test('conversation view links per-attempt token accounting without leaking IP hash',async t=>{
 const f=fixture();t.after(f.close);await seed(f);
 const x=await readAdminConversation({db:f.db,now:NOW,conversationId:CID});
 assert.equal(x.ok,true);assert.equal(x.turns.length,1);
 assert.equal(x.turns[0].reply,'Здрав будь!');
 assert.equal(x.turns[0].attempts[0].totalTokens,3323);
 assert.equal(JSON.stringify(x).includes('203.0.113.200'),false);
 assert.equal(JSON.stringify(x).includes('client_hash'),false);
});
test('reject malformed conversation IDs in read-only admin helper',async t=>{
 const f=fixture();t.after(f.close);
 await assert.rejects(readAdminConversation({db:f.db,now:NOW,conversationId:'abc'}),/invalid_conversation_id/);
});
test('knowledge status keeps existing stored/indexed/sources contract',async t=>{
 const f=fixture();t.after(f.close);await seed(f);
 const x=await readAdminKnowledgeStatus({db:f.db});
 assert.equal(x.stored,1);assert.equal(x.indexed,1);
 assert.equal(x.sources[0].source,'book1.docx');assert.equal(x.sources[0].n,1);
});
test('legacy profile and new profile status distinct, no private text in response',async()=>{
 const legacy='САНКО — ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ v0.4.\n'+('приватные данные '.repeat(900));
 const kv={get:async k=>({
  'sanko:profile:v1':legacy,
  'sanko:profile:lastBackup':'sanko:profile:backup:1792-abc',
  'sanko:vnext:approved-persona':JSON.stringify({status:'review',character:'sanko'})
 })[k]||null};
 const x=await readAdminProfileStatus({kv});
 assert.equal(x.ok,true);assert.equal(x.present,true);
 assert.equal(x.hasBackup,true);assert.equal(x.vnextStatus,'review');
 assert.equal(x.sha256.length,64);
 assert(!JSON.stringify(x).includes('приватные данные'));
});
test('unknown token counts remain unknown, not zero as success',async t=>{
 const f=fixture();t.after(f.close);
 f.raw.prepare('INSERT INTO token_usage (admission_id,attempted_at,day,model,result) VALUES(?,?,?,?,?)')
  .run('R',Math.floor(NOW/1000),DAY,'gemini-test','api_error');
 const x=await readTokenReport(f.db,DAY);
 assert.equal(x.status,'ready');
 assert.equal(x.month.calls,1);
 assert.equal(x.month.unknownCalls,1);
 assert.equal(x.month.meteredCalls,0);
 assert.equal(x.averagePerMeteredCall,null);
});
