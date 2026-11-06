import test from 'node:test';
import assert from 'node:assert/strict';
import {syncPersonalChronicle,INDEX_KEY,REPORT_KEY} from '../chronicle-sync.mjs';
const post={owner_id:850667816,post_id:32243,published_at:1793898000,
  published_day_msk:'2026-11-05',source_url:'https://vk.com/wall850667816_32243',
  source_text:'Санко с Олешкой подошли к реке. Там стояла большая баржа.',
  category:'diary',ingested_at:1793899100};
function fakeEnv(rows=[post]) {
  const kv=new Map(),writes=[];
  const columns=['owner_id','post_id','published_at','published_day_msk',
    'source_url','source_text','category','ingested_at'];
  const db={prepare(sql){return {bind(...params){this.params=params;return this;},
    async all(){if(sql.startsWith('PRAGMA'))return {results:columns.map(name=>({name}))};
      return {results:rows.filter(r=>r.published_day_msk===this.params[1]).slice(0,this.params.at(-1))};}}}};
  return {env:{DIARY_DB:db,CURRENT_CONTEXT:{get:async key=>kv.get(key)||null,
    put:async(key,v)=>{writes.push(key);kv.set(key,v);}}},kv,writes};
}
const clock=()=> '2026-11-06T17:35:00.000Z';
test('read-only indexing writes nothing anywhere',async()=>{
 const t=fakeEnv();
 const r=await syncPersonalChronicle({env:t.env,today:'2026-11-06',clock,readOnly:true});
 assert.equal(r.ok,true);assert.equal(r.writes,0);assert.deepEqual(t.writes,[]);
 assert.equal(r.report.currentDayPostCount,0);
 assert.equal(r.report.sourceVkPollVerified,false);
});
test('isolated KV keys only, no writes to Oleshka D1',async()=>{
 const t=fakeEnv();
 const r=await syncPersonalChronicle({env:t.env,today:'2026-11-06',clock});
 assert.equal(r.ok,true);assert.equal(r.writes,2);
 assert.deepEqual(t.writes,[INDEX_KEY,REPORT_KEY]);
 const idx=JSON.parse(t.kv.get(INDEX_KEY));
 assert.equal(idx.posts.length,1);
 assert.equal(idx.posts[0].publishedDayMsk,'2026-11-05');
 assert(!t.kv.get(INDEX_KEY).includes(post.source_text));
});
test('unchanged post requires no second extraction call',async()=>{
 const t=fakeEnv();let calls=0;
 const model={generate:async()=>{calls++;return {text:JSON.stringify({events:[]})};}};
 await syncPersonalChronicle({env:t.env,today:'2026-11-06',clock,model});
 await syncPersonalChronicle({env:t.env,today:'2026-11-06',clock,model});
 assert.equal(calls,1);
});
test('bad extraction creates an explicit error, but cannot erase true D1 post',async()=>{
 const t=fakeEnv();
 const model={generate:async()=>({text:'not json'})};
 const r=await syncPersonalChronicle({env:t.env,today:'2026-11-06',clock,model});
 assert.equal(r.ok,true);
 assert.equal(r.report.extractionErrors,1);
 assert.equal(r.report.newOrRevisedPublications,1);
 assert.equal(r.report.confirmedNewPersonalFacts,0);
 assert.equal(JSON.parse(t.kv.get(INDEX_KEY)).posts.length,1);
});
test('corrupt KV index is never silently treated as empty',async()=>{
 const t=fakeEnv();t.kv.set(INDEX_KEY,'{nope');
 await assert.rejects(()=>syncPersonalChronicle({env:t.env,today:'2026-11-06',clock}),/chronicle_index_corrupt/);
 assert.equal(t.writes.length,0);
});
test('a source revision invalidates old candidate cache',async()=>{
 const t=fakeEnv();
 const quote='Санко с Олешкой подошли к реке.';
 const model={generate:async()=>({text:JSON.stringify({events:[{
  kind:'past_event',statement:'Санко подошёл к реке',exactQuote:quote,
  quoteStart:0,eventDay:'2026-11-05',dayBasis:'assumed',eventDayEvidence:'',
  people:['Санко','Олешка'],place:null,epistemicNote:''
 }]})})};
 const first=await syncPersonalChronicle({env:t.env,today:'2026-11-06',clock,model});
 assert.equal(first.candidateCount,1);
 post.source_text+=' И потом вернулись.';
 const revised=await syncPersonalChronicle({env:t.env,today:'2026-11-06',clock,model});
 assert.equal(revised.candidateCount,1);
 assert.equal(revised.report.newOrRevisedPublications,1);
 post.source_text=post.source_text.replace(' И потом вернулись.','');
});
