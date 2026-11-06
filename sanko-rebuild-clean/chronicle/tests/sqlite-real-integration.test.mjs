import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {inspectDiarySchema,readDiaryWindow,readDiaryFreshness} from '../d1-source.mjs';
import {normalizePost} from '../normalize.mjs';
import {loadCharacterDayEvidence,selectWholeSourcePosts} from '../d1-personal-bridge.mjs';

function sqliteFixture({missingColumn=false}={}) {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE oleshka_vk_diary (
    owner_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    published_at INTEGER NOT NULL,
    published_day_msk TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_text TEXT NOT NULL,
    category TEXT NOT NULL,
    ${missingColumn?'':'ingested_at INTEGER NOT NULL,'}
    PRIMARY KEY(owner_id,post_id)
  );`);
  const wrapper={prepare(sql){
    const stmt=db.prepare(sql);
    return {bind(...params){return {
      all:async()=>({results:stmt.all(...params)}),
      first:async()=>stmt.get(...params)??null
    };},all:async()=>({results:stmt.all()})};
  }};
  function add(id,text='Всё на месте', {day='2026-11-06',timestamp=1793988000,category='diary'}={}) {
    const names=missingColumn?'owner_id,post_id,published_at,published_day_msk,source_url,source_text,category':
      'owner_id,post_id,published_at,published_day_msk,source_url,source_text,category,ingested_at';
    const values=[850667816,id,timestamp,day,`https://vk.ru/wall850667816_${id}`,text,category];
    if (!missingColumn) values.push(timestamp+30);
    db.prepare(`INSERT INTO oleshka_vk_diary(${names}) VALUES(${values.map(()=>'?').join(',')})`).run(...values);
  }
  return {db,wrapper,add};
}
const today='2026-11-06';
test('real SQLite PRAGMA and SELECT match D1 binding adapter SQL',async()=>{
  const {wrapper,add,db}=sqliteFixture();
  add(9);const meta=await inspectDiarySchema(wrapper);
  assert.equal(meta.compatible,true);
  const result=await readDiaryWindow(wrapper,{publicationDay:today});
  assert.equal(result.complete,true);assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].post_id,9);
  db.close();
});
test('real SQLite keyset pagination reads all 52 records with equal timestamps',async()=>{
  const {wrapper,add,db}=sqliteFixture();
  for(let i=1;i<=52;i++)add(i,'Сообщение '+i);
  const result=await readDiaryWindow(wrapper,{publicationDay:today,pageSize:10,maxPages:8});
  assert.equal(result.complete,true);assert.equal(result.rows.length,52);
  assert.deepEqual(result.rows.map(r=>r.post_id),Array.from({length:52},(_,i)=>52-i));
  db.close();
});
test('read boundary never treats 2/52 pages as complete',async()=>{
  const {wrapper,add,db}=sqliteFixture();
  for(let i=1;i<=52;i++)add(i,'Сообщение '+i);
  const out=await loadCharacterDayEvidence({diaryDb:wrapper,day:today,pageSize:10,maxPages:2});
  assert.equal(out.ok,false);assert.equal(out.error,'diary_read_incomplete');
  db.close();
});
test('full text > 12000 chars survives real SQL read and SHA validation',async()=>{
  const {wrapper,add,db}=sqliteFixture();const long='И'.repeat(12191)+'\nФИНАЛ';add(777,long);
  const page=await readDiaryWindow(wrapper,{publicationDay:today});
  assert.equal(page.rows[0].source_text,long);
  const post=await normalizePost(page.rows[0]);
  assert.equal(post.fullText,long);assert.equal(post.fullText.endsWith('ФИНАЛ'),true);
  db.close();
});
test('excluded or rejected posts are never considered canonical day entries',async()=>{
  const {wrapper,add,db}=sqliteFixture();add(4,'ИСКЛЮЧИТЬ',{category:'excluded'});
  add(5,'ОТКЛОНИТЬ',{category:'rejected'});add(6,'ВКЛЮЧИТЬ');
  const out=await loadCharacterDayEvidence({diaryDb:wrapper,day:today,claims:[]});
  assert.equal(out.publicationsRead,1);
  assert.equal(out.evidence.hasVerifiedFacts,false);
  db.close();
});
test('known facts bind to exact source text hash; edited sources invalidate',async()=>{
  const {wrapper,add,db}=sqliteFixture();add(3,'Исходная запись');
  const post=await normalizePost((await readDiaryWindow(wrapper,{publicationDay:today})).rows[0]);
  const claim={id:'observed',sourcePostId:post.id,sourceContentHash:post.contentHash,
    eventDay:today,assertedDay:today,assertion:'Санко видел событие.',subject:'Санко',
    predicate:'был',object:'там',kind:'past_event',status:'approved',witnesses:['sanko'],informed:[]};
  const before=await loadCharacterDayEvidence({diaryDb:wrapper,day:today,claims:[claim]});
  assert.equal(before.knownClaims,1);assert.equal(before.evidence.facts[0].epistemicStatus,'firsthand');
  db.prepare('UPDATE oleshka_vk_diary SET source_text=? WHERE post_id=3').run('Изменённая запись');
  const after=await loadCharacterDayEvidence({diaryDb:wrapper,day:today,claims:[claim]});
  assert.equal(after.knownClaims,0);assert.equal(after.personalState.withheld[0].reason,'source_edited_since_approval');
  db.close();
});
test('missing required source column blocks D1 bridge without continuing',async()=>{
  const {wrapper,db}=sqliteFixture({missingColumn:true});
  const out=await loadCharacterDayEvidence({diaryDb:wrapper,day:today});
  assert.equal(out.ok,false);assert.equal(out.error,'diary_schema_incompatible');
  assert.deepEqual(out.missing,['ingested_at']);db.close();
});
test('read source freshness is different from inferred last successful VK poll',async()=>{
  const {wrapper,add,db}=sqliteFixture();add(8);
  const result=await readDiaryFreshness(wrapper,{today});
  assert.equal(result.postsToday,1);assert.equal(result.isSourceRefreshVerified,false);
  db.close();
});
test('empty current-day D1 yields unknown events, not false nothing happened',async()=>{
  const {wrapper,add,db}=sqliteFixture();add(9,'Вчера',{day:'2026-11-05',timestamp:1793901600});
  const out=await loadCharacterDayEvidence({diaryDb:wrapper,day:today,claims:[]});
  assert.equal(out.publicationsRead,0);assert.equal(out.evidence.canClaimNoEventsToday,false);
  db.close();
});

test('new runtime includes full primary diary as a source, not Sanko memory',async()=>{
  const {wrapper,add,db}=sqliteFixture();const long='Дневник. '+('Подробности '.repeat(700));
  add(21,long);const out=await loadCharacterDayEvidence({diaryDb:wrapper,day:today});
  assert.equal(out.knownClaims,0);
  assert.equal(out.primarySources.selected[0].fullSourceText,long);
  assert.equal(out.primarySources.selected[0].narrator,'oleshka');
  assert.equal(out.primarySources.selected[0].evidenceType,'original_public_diary_not_sanko_memory');
  assert.equal(out.primarySources.selected[0].eventDay,'not_inferred');
  assert.equal(out.primarySources.textsAreComplete,true);db.close();
});
test('whole source selection is capped by number of posts, never by text length',()=>{
  const posts=Array.from({length:3},(_,i)=>({postId:i+1,publishedAtEpoch:1793988000+i,
    publishedDayMsk:today,fullText:'А'.repeat(15000)+i,sourceUrl:'https://vk.ru/p'+i,contentHash:'a'.repeat(64)}));
  const p=selectWholeSourcePosts(posts,{maxSources:2});
  assert.equal(p.selected.length,2);
  assert.equal(p.selected[0].fullSourceText.length,15001);
  assert.equal(p.selectionComplete,false);assert.equal(p.needsAdditionalRetrieval,true);
});
