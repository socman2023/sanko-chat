import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePost, publishedDayMoscow} from '../normalize.mjs';
import {reconcileChronicle} from '../reconcile.mjs';
import {approvedPersonalKnowledge} from '../knowledge-view.mjs';
import {readDiaryPage} from '../d1-source.mjs';

const epoch = Math.floor(Date.parse('2026-11-06T17:10:00Z') / 1000);
function row(id=900001, text='\nДлинная запись.\nВторой абзац.\n', day='2026-11-06') {
  return {owner_id:850667816,post_id:id,published_at:epoch,published_day_msk:day,
    category:'diary', source_text:text, source_url:`https://vk.ru/wall850667816_${id}`};
}
const checkedAt='2026-11-06T17:30:00.000Z';

test('full source text is exact and never clipped or trimmed', async()=>{
  const text='\n'+ 'А'.repeat(10000)+'\nФИНАЛЬНЫЙ АБЗАЦ\n';
  const p=await normalizePost(row(900001,text));
  assert.equal(p.fullText,text);
  assert.ok(p.fullText.endsWith('ФИНАЛЬНЫЙ АБЗАЦ\n'));
  assert.equal(p.eventDay,null);
});
test('publication day is stored separately from any event date',async()=>{
  const p=await normalizePost(row());
  assert.equal(p.publishedDayMsk,'2026-11-06');
  assert.equal(p.eventDay,null);
});
test('Moscow day derives from UTC+3, including after midnight',()=>{
  assert.equal(publishedDayMoscow(epoch),'2026-11-06');
  assert.equal(publishedDayMoscow(Math.floor(Date.parse('2026-11-05T22:01:00Z')/1000)), '2026-11-06');
});
test('repeated same source id and text is idempotent',async()=>{
  const first=await reconcileChronicle({rows:[row()],checkedAt});
  const second=await reconcileChronicle({rows:[row()],previous:first.snapshots,checkedAt});
  assert.equal(first.changeCounts.new,1);
  assert.equal(second.changeCounts.unchanged,1);
  assert.equal(second.changeCounts.new,0);
  assert.equal(second.snapshots.length,1);
});
test('edited publication is tracked as revision not a second post',async()=>{
  const first=await reconcileChronicle({rows:[row()],checkedAt});
  const second=await reconcileChronicle({rows:[row(900001,'ИСПРАВЛЕНО')],previous:first.snapshots,checkedAt});
  assert.equal(second.changeCounts.textRevision,1);
  assert.equal(second.snapshots.length,1);
  assert.equal(second.snapshots[0].fullText,'ИСПРАВЛЕНО');
});
test('metadata change is distinguished from text revision',async()=>{
  const a=await reconcileChronicle({rows:[row()],checkedAt});
  const changed={...row(),category:'podcast'};
  const b=await reconcileChronicle({rows:[changed],previous:a.snapshots,checkedAt});
  assert.equal(b.changeCounts.metadataRevision,1);
});
test('conflicting repeated ID is rejected without silently choosing second text',async()=>{
  const report=await reconcileChronicle({rows:[row(),row(900001,'другой текст')],checkedAt});
  assert.equal(report.status,'partial');
  assert.equal(report.accepted,1);
  assert.equal(report.invalid[0].reason,'conflicting_duplicate_post');
});
test('foreign author and unsupported source links never become verified evidence',async()=>{
  const bad={...row(),owner_id:2};
  const wrong={...row(900002),source_url:'https://example.org/other'};
  const r=await reconcileChronicle({rows:[bad,wrong],checkedAt});
  assert.equal(r.accepted,0);
  assert.equal(r.invalid.length,2);
  assert.equal(r.status,'partial');
});
test('no batch results do not delete preexisting posts or imply nothing happened',async()=>{
  const yesterday={...row(900001,'Старое','2026-11-05'),published_at:epoch-86400};
  const first=await reconcileChronicle({rows:[yesterday],checkedAt});
  const second=await reconcileChronicle({rows:[],previous:first.snapshots,checkedAt});
  assert.equal(second.snapshots.length,1);
  assert.equal(second.latestKnownDay,'2026-11-05');
  assert.equal(second.hasPostPublishedToday,false);
  assert.equal(second.completeness,'unknown_without_authoritative_source_total');
});
test('source error is visible and not disguised as empty successful day',async()=>{
  const out=await reconcileChronicle({rows:[],sourceStatus:'error',checkedAt});
  assert.equal(out.status,'error');
  assert.equal(out.hasPostPublishedToday,null);
});
test('mismatched publication timestamp and day are flagged',async()=>{
  const p=await normalizePost(row(900001,'Нормально','2026-11-05'));
  assert.deepEqual(p.anomalies,['timestamp_day_mismatch']);
});
test('excluded records retain source but do not count as valid diary publication',async()=>{
  const r=await reconcileChronicle({rows:[{...row(),category:'excluded'}],checkedAt});
  assert.equal(r.snapshots.length,1);
  assert.equal(r.snapshots[0].excluded,true);
  assert.equal(r.hasPostPublishedToday,false);
});
test('unapproved claims and news from another day never become today\'s memory',()=>{
  const claims=[
    {id:'a',sourcePostId:'850667816_2',status:'pending',eventDay:'2026-11-06',kind:'past_event',assertion:'НЕ ПОДТВЕРЖДЕНО',witnesses:['sanko'],informed:[]},
    {id:'b',sourcePostId:'850667816_1',status:'approved',eventDay:'2026-10-31',kind:'past_event',assertion:'Историческое событие',witnesses:['sanko'],informed:[]}
  ];
  const result=approvedPersonalKnowledge(claims,{character:'sanko',day:'2026-11-06',verifiedSourcePosts:[]});
  assert.equal(result.known.length,0);
  assert.equal(result.evidenceStatus,'no_verified_personal_facts');
  assert.equal(result.canClaimNothingHappened,false);
});
test('confirmed eyewitness differs from second-hand report and outsider knowledge',()=>{
  const claims=[
    {id:'a',sourcePostId:'850667816_1',status:'approved',eventDay:'2026-11-06',kind:'past_event',assertion:'Был рядом',witnesses:['sanko'],informed:[]},
    {id:'b',sourcePostId:'850667816_2',status:'approved',eventDay:'2026-11-06',kind:'hearsay',assertion:'Рассказали Санко',witnesses:['oleshka'],informed:['sanko']},
    {id:'c',sourcePostId:'850667816_3',status:'approved',eventDay:'2026-11-06',kind:'past_event',assertion:'Личный секрет Олешки',witnesses:['oleshka'],informed:[]}
  ];
  const v=approvedPersonalKnowledge(claims,{character:'sanko',day:'2026-11-06',verifiedSourcePosts:[
    {id:'850667816_1',contentHash:'checked',excluded:false},
    {id:'850667816_2',contentHash:'checked',excluded:false},
    {id:'850667816_3',contentHash:'checked',excluded:false}
  ]});
  assert.deepEqual(v.known.map(x=>x.epistemicStatus),['firsthand','reported_to_character']);
  assert.deepEqual(v.withheld,['c']);
});
test('select-only D1 adapter pages deterministically, no mutation',async()=>{
  let seenSQL='',seenArgs=[];
  const db={prepare(sql){seenSQL=sql;return {bind(...args){seenArgs=args;return this;},
    async all(){return {results:[row()]};}};}};
  const p=await readDiaryPage(db,{limit:3});
  assert.equal(p.rows.length,1);
  assert.equal(p.nextCursor,null);
  assert.match(seenSQL,/^SELECT /);
  assert.ok(!/(INSERT|UPDATE|DELETE|DROP|ALTER)/u.test(seenSQL));
  assert.deepEqual(seenArgs,[850667816,3]);
});
test('read-only cursor query includes stable ordering',async()=>{
  let sql='',bound=[];
  const db={prepare(s){sql=s;return {bind(...args){bound=args;return this;},async all(){return {results:[]};}};}};
  await readDiaryPage(db,{cursor:{publishedAt:epoch,postId:900003},limit:5});
  assert.match(sql,/published_at<\? OR \(published_at=\? AND post_id<\?\)/);
  assert.deepEqual(bound,[850667816,epoch,epoch,900003,5]);
});

test('claims with author approval but unknown source ID are withheld',()=>{
  const claims=[{id:'fake',sourcePostId:'850667816_100',status:'approved',
    eventDay:'2026-11-06',kind:'past_event',assertion:'Не проверено по источнику',
    witnesses:['sanko'],informed:[]}];
  const v=approvedPersonalKnowledge(claims,{character:'sanko',day:'2026-11-06',
    verifiedSourcePosts:[]});
  assert.deepEqual(v.known,[]);
  assert.deepEqual(v.withheld,['fake']);
});

test('upstream error never stages even valid-looking new rows',async()=>{
  const prior=await reconcileChronicle({rows:[row(900001,'было')],checkedAt});
  const failed=await reconcileChronicle({rows:[row(900002,'похоже, пришло')],
    previous:prior.snapshots,checkedAt,sourceStatus:'error'});
  assert.equal(failed.status,'error');
  assert.equal(failed.safeToPublish,false);
  assert.equal(failed.snapshots.length,1);
  assert.equal(failed.snapshots[0].postId,900001);
});

test('bad source day cannot be silently published even if the text is intact',async()=>{
  const out=await reconcileChronicle({rows:[row(900001,'запись','2026-11-05')],checkedAt});
  assert.equal(out.status,'partial');
  assert.equal(out.safeToPublish,false);
  assert.equal(out.snapshots.length,0);
  assert.equal(out.candidateSnapshots.length,1);
});
