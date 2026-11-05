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
 assert.equal(c.recentPosts,2);
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
