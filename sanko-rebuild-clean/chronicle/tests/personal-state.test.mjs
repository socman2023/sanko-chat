import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPersonalState,viewPersonalDay,makeEvidencePacket} from '../personal-state.mjs';
const H='f'.repeat(64), OTHER='b'.repeat(64);
const post={id:'850667816_99',contentHash:H,publishedDayMsk:'2026-11-06',
  sourceUrl:'https://vk.ru/wall850667816_99',fullText:'Санко и Олешка были у ручья.',excluded:false};
const claim=(patch={})=>({id:'a',sourcePostId:post.id,sourceContentHash:H,
  eventDay:'2026-11-06',assertedDay:'2026-11-06',assertion:'Санко видел лес.',
  subject:'Санко',predicate:'находился',object:'в лесу',kind:'past_event',status:'approved',
  witnesses:['sanko'],informed:[],...patch});
const state=(claims=[claim()],opt={})=>buildPersonalState({
  asOfDay:'2026-11-06',posts:[post],claims,
  sourceReadComplete:true,lastSuccessfulSourcePollAt:'2026-11-06T17:30:00.000Z',...opt});
test('proven firsthand fact is visible as personal knowledge',()=>{
  const x=state();assert.equal(x.claims.length,1);
  assert.equal(x.claims[0].epistemicStatus,'firsthand');
  assert.equal(x.todayEvidenceStatus,'character_facts_verified');
});
test('secondhand fact never becomes witness memory',()=>{
  const x=state([claim({witnesses:['oleshka'],informed:['sanko']})]);
  assert.equal(x.claims[0].epistemicStatus,'reported_to_character');
  assert.equal(viewPersonalDay(x,{day:'2026-11-06'}).firsthand.length,0);
});
test('Oleshka-only experience is withheld',()=>{
  const x=state([claim({witnesses:['oleshka'],informed:[]})]);
  assert.equal(x.claims.length,0);assert.equal(x.withheld[0].reason,'not_known_to_character');
  assert.equal(x.canClaimNoEventsToday,false);
});
test('unapproved model extraction cannot enter canon',()=>{
  const x=state([claim({status:'pending'})]);
  assert.equal(x.claims.length,0);assert.equal(x.withheld[0].reason,'not_approved');
});
test('edited original invalidates previously approved source hash',()=>{
  const x=state([claim()],{posts:[{...post,contentHash:OTHER}]});
  assert.equal(x.withheld[0].reason,'source_edited_since_approval');
});
test('excluded posts provide no accepted canonical events',()=>{
  const x=state([claim()],{posts:[{...post,excluded:true}]});
  assert.equal(x.withheld[0].reason,'source_excluded');
});
test('future event cannot be treated as already experienced',()=>{
  const x=state([claim({eventDay:'2026-11-07'})]);
  assert.equal(x.withheld[0].reason,'future_event_not_observed');
});
test('future plan can be known, but tagged unfulfilled',()=>{
  const x=state([claim({kind:'reported_plan',eventDay:'2026-11-07'})]);
  assert.equal(x.claims[0].kind,'reported_plan');
  assert.equal(viewPersonalDay(x,{day:'2026-11-06'}).hasVerifiedFacts,false);
});
test('source publication after as-of day cannot enter',()=>{
  const x=state([claim()],{posts:[{...post,publishedDayMsk:'2026-11-07'}]});
  assert.equal(x.withheld[0].reason,'source_not_yet_published');
});
test('two contradictory approved accounts are withheld, not averaged',()=>{
  const x=state([claim(),claim({id:'b',object:'у реки',assertion:'Санко был у реки.'})]);
  assert.equal(x.claims.length,0);assert.equal(x.conflicts.length,1);
  assert.equal(x.withheld.filter(e=>e.reason==='conflicting_approved_facts').length,2);
});
test('duplicate claim IDs never double count',()=>{
  const x=state([claim(),claim()]);assert.equal(x.claims.length,1);
  assert.equal(x.invalid[0].reason,'duplicate_claim_id');
});
test('no evidence must never be rewritten as nothing happened',()=>{
  const x=state([]);const p=makeEvidencePacket(x,{focusDay:'2026-11-06'});
  assert.equal(p.canClaimNoEventsToday,false);
  assert.equal(p.hasVerifiedFacts,false);assert.equal(x.canClaimNoEventsToday,false);
});
test('yesterday status not elevated to verified today',()=>{
  const x=state([claim({eventDay:'2026-11-05',kind:'present_status'})]);
  assert.equal(x.latestEvidenceDay,'2026-11-05');
  assert.equal(viewPersonalDay(x,{day:'2026-11-06'}).hasVerifiedFacts,false);
});
test('last source poll does not prove last event',()=>{
  const x=state([],{sourceReadComplete:false,
    lastSuccessfulSourcePollAt:'2026-11-06T14:34:12.614Z'});
  assert.equal(x.sourceReadStatus,'unverified_or_partial');
  assert.equal(x.todayEvidenceStatus,'no_verified_character_facts_for_today');
});
test('evidence packet labels plans and hearsay and includes primary source pointer',()=>{
  const x=state([claim({kind:'hearsay',witnesses:[],informed:['sanko']})]);
  const p=makeEvidencePacket(x,{focusDay:'2026-11-06'});
  assert.equal(p.facts[0].epistemicStatus,'reported_to_character');
  assert.equal(p.facts[0].kind,'hearsay');
  assert.equal(p.facts[0].sourceUrl,post.sourceUrl);
});
test('no claim truncation goes unnoticed',()=>{
  const x=state(Array.from({length:5},(_,i)=>claim({id:'n'+i,
    subject:'Санко'+i,object:'в лесу'+i})));
  const p=makeEvidencePacket(x,{focusDay:'2026-11-06',maxFacts:2});
  assert.equal(p.facts.length,2);assert.equal(p.truncatedFactSelection,true);
});
test('invalid source / claim schemas fail closed',()=>{
  assert.throws(()=>state([],{posts:[post,post]}),/duplicate_post/);
  const x=state([{...claim(),sourceContentHash:'invalid'}]);
  assert.equal(x.claims.length,0);assert.equal(x.invalid[0].reason,'invalid_schema');
});
test('no automatic current-status claim when publication missing',()=>{
  const x=state([claim({eventDay:'2026-11-05'})],{
    posts:[{...post,publishedDayMsk:'2026-11-05'}],sourceReadComplete:true});
  const p=makeEvidencePacket(x,{focusDay:'2026-11-06'});
  assert.equal(p.hasVerifiedFacts,false);assert.equal(p.canClaimNoEventsToday,false);
});

test('future plans known today appear as intentions, not completed events',()=>{
  const x=state([claim({kind:'reported_plan',eventDay:'2026-11-07',assertedDay:'2026-11-06',assertion:'Планируем выступить завтра'})]);
  const p=makeEvidencePacket(x,{focusDay:'2026-11-06'});
  assert.equal(p.hasVerifiedFacts,true);
  assert.equal(p.facts[0].kind,'reported_plan');
  assert.equal(p.facts[0].eventDay,'2026-11-07');
});
