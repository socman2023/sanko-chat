import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDiarySchema,readDiaryPage,readDiaryWindow,readDiaryFreshness} from '../d1-source.mjs';
import {evaluatePublicHealth,checkPublicHealth,DEFAULT_HEALTH_URL} from '../health-check.mjs';

const now='2026-11-06T17:30:00.000Z';
const epoch=Math.floor(Date.parse('2026-11-06T17:10:00.000Z')/1000);
const R=(id,time=epoch,text='ТЕКСТ',day='2026-11-06')=>({
 owner_id:850667816,post_id:id,published_at:time,ingested_at:time+10,
 published_day_msk:day,source_url:`https://vk.ru/wall850667816_${id}`,
 source_text:text,category:'diary'
});
function mockDb(records, {schema=null, malformed=false}={}) {
  const log=[];
  const db={prepare(sql){
    log.push(sql);
    return {params:[],bind(...args){this.params=args;return this;},
      async all(){
        if(sql.startsWith('PRAGMA'))return {results: (schema||[
          'owner_id','post_id','published_at','published_day_msk',
          'source_url','source_text','category','ingested_at']).map(name=>({name}))};
        if(malformed)return {error:'no results'};
        const [owner]=this.params;
        let rows=records.filter(r=>r.owner_id===owner);
        let idx=1;
        if(sql.includes('published_day_msk=?')) { const day = this.params[idx++]; rows=rows.filter(r=>r.published_day_msk===day); }
        if(sql.includes("category NOT IN"))rows=rows.filter(r=>!['excluded','rejected'].includes(r.category));
        if(sql.includes('published_at<?')){
          const [before,before2,id] = this.params.slice(idx,idx+3);
          assert.equal(before,before2);
          rows=rows.filter(r=>r.published_at<before||(r.published_at===before&&r.post_id<id));
        }
        rows.sort((a,b)=>b.published_at-a.published_at||b.post_id-a.post_id);
        return {results:rows.slice(0,this.params.at(-1))};
      },
      async first(){
        const [owner]=this.params;
        const rows=records.filter(r=>r.owner_id===owner&&!['excluded','rejected'].includes(r.category));
        if(sql.startsWith('SELECT COUNT'))
          return {total:rows.filter(r=>r.published_day_msk===this.params[1]).length};
        return rows.sort((a,b)=>b.published_at-a.published_at||b.post_id-a.post_id)[0]||null;
      }
    };
  }};
  return {db,log};
}

test('actual diary column contract: present schema compatible',async()=>{
 const {db}=mockDb([]);
 const schema=await inspectDiarySchema(db);
 assert.equal(schema.compatible,true);
 assert.deepEqual(schema.missing,[]);
});
test('missing ingested_at is detected before attempting live reads',async()=>{
 const {db}=mockDb([],{schema:['owner_id','post_id','published_at','published_day_msk','source_url','source_text','category']});
 assert.deepEqual((await inspectDiarySchema(db)).missing,['ingested_at']);
});
test('schema and data access use only PRAGMA/SELECT, no DDL or mutation',async()=>{
 const {db,log}=mockDb([R(1)]);
 await inspectDiarySchema(db);
 await readDiaryPage(db);
 await readDiaryFreshness(db,{today:'2026-11-06'});
 assert.ok(log.every(sql=>/^(SELECT|PRAGMA) /u.test(sql)),log.join('\n'));
});
test('one calendar day is read exactly, without fallback to yesterday',async()=>{
 const {db}=mockDb([R(1,epoch-86400,'Вчера','2026-11-05'),R(2)]);
 const read=await readDiaryWindow(db,{publicationDay:'2026-11-07',pageSize:1});
 assert.deepEqual(read.rows,[]);
 assert.equal(read.complete,true);
});
test('complete paginated day keeps every full text and stable order at same second',async()=>{
 const long='А'.repeat(18000)+'\nЗАКЛЮЧИТЕЛЬНЫЙ АБЗАЦ';
 const {db}=mockDb([R(2,epoch,long),R(3,epoch,'третий'),R(1,epoch-1,'первый'),R(4,epoch-86400,'вчера','2026-11-05')]);
 const got=await readDiaryWindow(db,{publicationDay:'2026-11-06',pageSize:2,maxPages:4});
 assert.equal(got.complete,true);
 assert.deepEqual(got.rows.map(r=>r.post_id),[3,2,1]);
 assert.ok(got.rows[1].source_text.endsWith('ЗАКЛЮЧИТЕЛЬНЫЙ АБЗАЦ'));
 assert.equal(got.rows[1].source_text.length,long.length);
});
test('pagination cap is surfaced as partial, never presented as complete',async()=>{
 const {db}=mockDb([R(2),R(3),R(4),R(5)]);
 const got=await readDiaryWindow(db,{pageSize:2,maxPages:1});
 assert.equal(got.rows.length,2);
 assert.equal(got.complete,false);
 assert.deepEqual(got.nextCursor,{publishedAt:epoch,postId:4});
});
test('foreign source owner is forbidden',async()=>{
 const {db}=mockDb([R(1)]);
 await assert.rejects(readDiaryPage(db,{ownerId:123}),/unsupported_source_owner/);
});
test('malformed database result fails closed',async()=>{
 const {db}=mockDb([R(1)],{malformed:true});
 await assert.rejects(readDiaryPage(db),/invalid_diary_result/);
});
test('read-only count and ingestion timestamps are not confused with VK polling',async()=>{
 const {db}=mockDb([R(2),R(3),{...R(5),category:'excluded'}]);
 const p=await readDiaryFreshness(db,{today:'2026-11-06'});
 assert.equal(p.postsToday,2);
 assert.equal(p.latestPostId,3);
 assert.equal(p.isSourceRefreshVerified,false);
});
const health=(patch={})=>({version:'sanko-worker-2.0.0-canon-first',
  diaryConnected:true, diarySync:{status:'ok', latestPostDay:'2026-11-06',
   latestPostId:120000, latestPublishedAt:'2026-11-06T17:00:00.000Z',
   latestIngestedAt:'2026-11-06T17:15:00.000Z',postsToday:1},...patch});
test('live health says published today but does not assert specific event or VK check',()=>{
 const r=evaluatePublicHealth(health(),{checkedAt:now});
 assert.equal(r.status,'current_day_publication_seen');
 assert.equal(r.sourceVerified,false);
 assert.equal(r.todayEventsKnown,false);
});
test('no post today is not proof nothing happened',()=>{
 const h=health({diarySync:{...health().diarySync,latestPostDay:'2026-11-05',postsToday:0}});
 const r=evaluatePublicHealth(h,{checkedAt:now});
 assert.equal(r.status,'no_current_day_publication');
 assert.equal(r.canClaimNoEventsToday,false);
});
test('health error and schema mismatch remain visible',()=>{
 assert.equal(evaluatePublicHealth(health({diaryConnected:false}),{checkedAt:now}).status,'diary_unavailable');
 assert.equal(evaluatePublicHealth(health({diarySync:{status:'read_error'}}),{checkedAt:now}).status,'diary_unavailable');
 assert.equal(evaluatePublicHealth(health({diarySync:{...health().diarySync,postsToday:-2}}),{checkedAt:now}).status,'invalid_diary_status');
});
test('public health client makes only public GET; never calls Gemini or admin',async()=>{
 let called=false;
 const r=await checkPublicHealth({now:new Date(now),fetchFn:async(url,opts)=>{
   called=true;
   assert.equal(url,DEFAULT_HEALTH_URL);
   assert.equal(opts.method,'GET');
   assert.equal(opts.redirect,'error');
   assert.ok(!('Authorization' in opts.headers));
   return {ok:true, text:async()=>JSON.stringify(health())};
 }});
 assert.equal(called,true);
 assert.equal(r.liveDatabaseRead,true);
});
test('malformed remote health cannot be silently accepted',async()=>{
 await assert.rejects(checkPublicHealth({now:new Date(now),fetchFn:async()=>({ok:true,text:async()=>'{bad'})}),/health_invalid_json/);
 await assert.rejects(checkPublicHealth({now:new Date(now),url:'https://example.com/evil',fetchFn:async()=>({})}),/unapproved_health_url/);
});

test('impossible published-day/count combination is not reported as normal',()=>{
 const h=health({diarySync:{...health().diarySync,latestPostDay:'2026-11-05',postsToday:2}});
 assert.equal(evaluatePublicHealth(h,{checkedAt:now}).status,'inconsistent_diary_day_and_count');
});
