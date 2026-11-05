import test from "node:test";
import assert from "node:assert/strict";
import { selectSankoContext,SANKO_COMPACT_IDENTITY } from "../src/context-selection.js";

const mode=(question,history=[],scope=null)=>selectSankoContext(question,history,scope);
test("only genuinely standalone greetings skip all historical sources",()=>{
 for(const q of ["Привет","Здрав будь!","Здорово","Здарово","Добрый вечер."]){
  const p=mode(q);
  assert.equal(p.kind,"greeting",q);
  assert.equal(p.profile,"compact");
  assert.equal(p.diary,"none");
  assert.equal(p.useRetrieval,false);
 }
 for(const q of ["Привет, Санко, где Руман?","Что было на джонке?","Расскажи про отца."]){
  assert.equal(mode(q).profile,"full",q);
  assert.equal(mode(q).useRetrieval,true,q);
 }
});
test("current questions always retain the latest full published events",()=>{
 const c=mode("Что нового?");
 assert.equal(c.kind,"current");
 assert.equal(c.diary,"recent");
 assert.equal(c.recentPosts,4);
 assert.equal(c.profile,"compact");
 const a=mode("Как дела?");
 assert.equal(a.kind,"social");
 assert.equal(a.recentPosts,1);
});
test("any explicit date means complete source retrieval, no semantic shortcut",()=>{
 for(const q of ["Привет","Как дела?","Что нового?"]){
  const result=mode(q,[],{day:"2026-11-04"});
  assert.equal(result.kind,"dated");
  assert.equal(result.diary,"date");
  assert.equal(result.profile,"full");
  assert.equal(result.useRetrieval,true);
 }
});
test("ambiguous followups keep full recent chronological sequence",()=>{
 const p=mode("А потом?",[{role:"user",text:"Где Руман?"},{role:"model",text:"Ищем."}]);
 assert.equal(p.kind,"continuation");
 assert.equal(p.diary,"continuation");
 assert.match(p.searchQuestion,/Где Руман\?/);
 assert(!p.searchQuestion.includes("Ищем"),"Never make prior generated answer a retrieval fact");
});
test("social-looking followup does not lose established topic",()=>{
 const history=[{role:"user",text:"Расскажи про отца"},{role:"model",text:"Про отца? Вот."}];
 assert.equal(mode("А у тебя?",history).profile,"full");
});
test("local word gloss requires real prior turn; no historical references needed",()=>{
 const history=[{role:"model",text:"Плывём опосля по реке."}];
 assert.equal(mode("Чего «опосля»?",history).kind,"gloss");
 assert.equal(mode("Чего «опосля»?",[]).profile,"full");
});
test("detailed questions retain full profile and more complete topical entries",()=>{
 const p=mode("Расскажи подробно, что было с Руманом");
 assert.equal(p.kind,"detailed");
 assert.equal(p.profile,"full");
 assert.equal(p.topicPosts,10);
 assert(p.useRetrieval);
 assert.match(SANKO_COMPACT_IDENTITY,/Санко/);
 assert.match(SANKO_COMPACT_IDENTITY,/Олешка/);
});

test("real user's natural news formulation uses current canon instead of full profile",()=>{
 for(const q of [
  "Лучше скажи, что у тебя нового?",
  "Ты лучше скажи, что у тебя нового?",
  "А скажи, что у вас нового?",
  "Ну, расскажи, шо у тебя нового."
 ]){
  const p=mode(q);
  assert.equal(p.kind,"current",q);
  assert.equal(p.profile,"compact");
  assert.equal(p.diary,"recent");
  assert.equal(p.recentPosts,4);
  assert.equal(p.useRetrieval,false);
 }
});

test("real barge conversation short scene questions use limited canon with source provenance",()=>{
 const h=[
  {role:"user",text:"Лучше скажи, что у тебя нового?"},
  {role:"model",text:"Плывем по реке на джонке, за баржей следим."},
  {role:"user",text:"Баржу еще не видели?"},
  {role:"model",text:"Одну приметили, да не ту."}
 ];
 const third=mode("А там что будет?",h);
 assert.equal(third.kind,"scene-followup");
 assert.equal(third.profile,"compact");
 assert.equal(third.diary,"recent");
 assert.equal(third.recentPosts,4);
 assert.equal(third.lexicalLimit,2);
 assert.equal(third.vectorLimit,4);
 assert.equal(third.maxHits,4);
 assert.equal(third.useRetrieval,true);
 assert.equal(third.searchQuestion,"Баржу еще не видели?");
 assert(!third.searchQuestion.includes("Одну приметили"));
 const fourth=mode("Чаешь, успеете?",[
  ...h,{role:"user",text:"А там что будет?"},
  {role:"model",text:"Там невольников высадят, опосля дальше поведут."}
 ]);
 assert.equal(fourth.kind,"scene-followup");
 assert.equal(fourth.searchQuestion,"Баржу еще не видели?");
 assert(!fourth.searchQuestion.includes("невольников высадят"));
});

test("unanchored pronouns, historical questions, why questions remain conservatively factual",()=>{
 const old=[{role:"user",text:"Расскажи про свою семью"},
  {role:"model",text:"Мне есть что рассказать."}];
 for(const q of ["А там что будет?","Чаешь, успеете?"]){
  assert.equal(mode(q,old).kind,"knowledge");
  assert.equal(mode(q,old).profile,"full");
 }
 const live=[{role:"user",text:"Что у тебя нового?"},
  {role:"model",text:"Есть новости."}];
 for(const q of ["А почему?","А где Руман?","Расскажи подробно о семье"]){
  assert.equal(mode(q,live).profile,"full",q);
 }
 assert.equal(mode("А там что будет?",live,{day:"2026-11-05"}).kind,"dated");
});

test("no untrusted assistant utterance may become a canonical search topic",()=>{
 const h=[
  {role:"user",text:"Что нового?"},
  {role:"model",text:"Выдуманный корабль причалил вчера."}
 ];
 const p=mode("Чаешь, успеете?",h);
 assert.equal(p.kind,"scene-followup");
 assert.equal(p.useRetrieval,false);
 assert(!p.searchQuestion.includes("Выдуманный корабль"));
});
