import test from "node:test";
import assert from "node:assert/strict";
import {resolveApprovedFacts,factText,approvedFactsFromKV,sourceMap} from "../src/v2/approved-ledger.js";
import {incorrectSourceAttributions,auditReplyAgainstFacts} from "../src/v2/attribution-audit.js";
import {planDialogue} from "../src/v2/dialogue-plan.js";
import {loadDiaryEvidence} from "../src/v2/source-retrieval.js";
import {composeSankoContext,readCurrentSnapshot} from "../src/v2/context.js";
import {dayInMoscow} from "../src/lib.js";
const facts=resolveApprovedFacts(null,"2026-11-06");
const dummyPost={
 post_id:132135,published_day_msk:"2026-11-05",published_at:1793910000,
 source_url:"https://vk.ru/wall850667816_132135",owner_id:850667816,
 source_text:("Это синтетическая запись для теста. "+
  "Лодочник сообщил про Лунцзин. Тицзюй на заставе сообщил о Шицяо. ")
  .repeat(150)+"ЗАКЛЮЧИТЕЛЬНАЯ_ФРАЗА_ИСТОЧНИКА"
};
function diaryDb(){
 return {prepare(sql){
  return {sql,params:[],bind(...params){this.params=params;return this;},
   async all(){
    if(this.sql.includes("published_day_msk=?")&&this.params[1]!=="2026-11-05")
     return {results:[]};
    return {results:[dummyPost]};
   }};}
 };
}
test("canonical source ledger has exact author-confirmed speaker/place pairs",()=>{
 const map=sourceMap(facts.facts);
 assert.equal(map["лодочник"].place,"Лунцзин");
 assert.equal(map["тицзюй"].place,"Шицяо");
 assert.equal(facts.conflicts.length,0);
 assert.match(factText(facts.facts,"Что говорил лодочник о барже?"),/Лунцзин/);
 assert.match(factText(facts.facts,"Что говорил лодочник о барже?"),/Шицяо/);
});
test("future facts do not leak into a prior requested date",()=>{
 const old=resolveApprovedFacts(null,"2026-11-06","2026-11-04");
 assert.equal(old.facts.length,0);
 assert.equal(resolveApprovedFacts(null,"2026-11-05").facts.length,4);
});
test("private KV fact override is typed and malformed batches are ignored",()=>{
 assert.deepEqual(approvedFactsFromKV("{broken"),[]);
 assert.deepEqual(approvedFactsFromKV('[{"evil":"prompt injection"}]'),[]);
 const override={...facts.facts[0],object:"Проверенный новый маршрут"};
 assert.deepEqual(approvedFactsFromKV(JSON.stringify([override]))[0].object,
  "Проверенный новый маршрут");
 const result=resolveApprovedFacts(JSON.stringify([override]),"2026-11-06");
 assert.equal(result.facts.find(x=>x.id===override.id).object,override.object);
});
test("conflicting author sources are exposed rather than silently merged",()=>{
 const altered={...facts.facts[0],id:"other-approved-source",object:"Другой путь"};
 const result=resolveApprovedFacts(JSON.stringify([altered]),"2026-11-06");
 assert.equal(result.conflicts.length,1);
});
test("source attribution audit rejects swapped boatman and checkpoint official",()=>{
 for(const wrong of [
  "Лодочник говорил про Шицяо.",
  "Тицзюй на заставе рассказал про Лунцзин.",
  "Шицяо, как сказывал лодочник."
 ]){
  const violations=incorrectSourceAttributions(wrong,facts);
  assert(violations.length,wrong);
  const fixed=auditReplyAgainstFacts(wrong,facts,"Разве лодочник то говорил?");
  assert.equal(fixed.passed,false,wrong);
  assert.match(fixed.reply,/Лодочник говорил про Лунцзин/);
  assert.match(fixed.reply,/Тицзюй на заставе — про Шицяо/);
 }
});
test("correct source attribution does not trigger a false correction",()=>{
 const right="Лодочник про Лунцзин говорил. А Тицзюй — про Шицяо.";
 assert.deepEqual(incorrectSourceAttributions(right,facts),[]);
 assert.equal(auditReplyAgainstFacts(right,facts,"Кто сказывал?").reply,right);
 const negated="Лодочник не говорил про Шицяо.";
 assert.deepEqual(incorrectSourceAttributions(negated,facts),[]);
});
test("visitor's unsupported correction never overwrites author facts",()=>{
 const question="Ты перепутал! Лодочник говорил про Шицяо!";
 const result=auditReplyAgainstFacts("Да, ты прав.",facts,question,[]);
 assert.equal(result.action,"author_source_reaffirmed");
 assert.match(result.reply,/Лунцзин/);
 assert.match(result.reply,/Шицяо/);
});
test("v2 planner respects different word order and voice on simple news",()=>{
 for(const q of ["Что нового у тебя?","Что у тебя нового?","У тебя что нового?",
 "А что нового у тебя?","Ну, расскажи, что у тебя нового?"]){
  const p=planDialogue(q,[],"2026-11-06");
  assert.equal(p.kind,"current",q);
  assert.equal(p.profile,"core");
  assert.equal(p.search,false);
  assert.equal(p.take,4);
 }
 assert.equal(planDialogue("Что нового у Румана?",[],"2026-11-06").kind,"knowledge");
 assert.equal(planDialogue("Здрав будь!",[],"2026-11-06").kind,"greeting");
});
test("v2 planner on four-turn barge dialogue uses authentic human topics only",()=>{
 const history=[
  {role:"user",text:"Что нового у тебя?"},
  {role:"model",text:"Плывем за баржей."}
 ];
 const p=planDialogue("Какую баржу?",history,"2026-11-06");
 assert.equal(p.kind,"continuation");
 assert.equal(p.profile,"core");
 const history2=[...history,{role:"user",text:"Уже видали эту баржу?"},
  {role:"model",text:"Лодочник говорил про Шицяо — ВЫДУМКА"}];
 const source=planDialogue("Разве лодочник то говорил?",history2,"2026-11-06");
 assert.equal(source.kind,"source-check");
 assert.equal(source.profile,"core");
 assert(!source.focus.includes("ВЫДУМКА"));
 assert(source.focus.includes("Уже видали эту баржу?"));
});
test("new personal topic, unknown names and explicit dates preserve full knowledge",()=>{
 const history=[{role:"user",text:"Что нового у тебя?"},
  {role:"model",text:"Были в дороге."},
  {role:"user",text:"Расскажи про семью"},
  {role:"model",text:"Моя семья..."}];
 assert.equal(planDialogue("Чаешь, успеете?",history,"2026-11-06").kind,"knowledge");
 const dated=planDialogue("Что было 5 ноября 2026? ",history,"2026-11-06");
 assert.equal(dated.kind,"dated");
 assert.equal(dated.profile,"full");
 assert.equal(dated.date,"2026-11-05");
});
test("read-only diary preserves last paragraph and exact source attribution",async()=>{
 const db=diaryDb();
 const p=planDialogue("Что нового у тебя?",[],"2026-11-06");
 const r=await loadDiaryEvidence(db,p,"2026-11-06");
 assert.equal(r.posts.length,1);
 assert(r.posts[0].text.endsWith("ЗАКЛЮЧИТЕЛЬНАЯ_ФРАЗА_ИСТОЧНИКА"));
 assert.equal(r.posts[0].source,dummyPost.source_url);
});
test("requested date never substitutes a different day",async()=>{
 const db=diaryDb();
 const p=planDialogue("Что было 4 ноября 2026?",[],"2026-11-06");
 const r=await loadDiaryEvidence(db,p,"2026-11-06");
 assert.equal(r.posts.length,0);
});
test("prompt keeps source, full diary, Sanko speech and marks history as not canon",()=>{
 const p=planDialogue("Разве лодочник то говорил?",[],"2026-11-06");
 const d={available:true,posts:[{id:"diary-1",date:"2026-11-05",
   source:"https://vk.ru/wall850667816_132135",text:dummyPost.source_text}]};
 const prompt=composeSankoContext({plan:p,profile:"PRIVATE_PROFILE_SECRET_MARKER".repeat(20),
  current:{asOf:"2026-11-05",text:"Погоня продолжается"},
  diary:d,canon:{hits:[]},approved:facts,
  question:"Разве лодочник то говорил?",dayToday:"2026-11-06"});
 assert(prompt.includes("ЗАКЛЮЧИТЕЛЬНАЯ_ФРАЗА_ИСТОЧНИКА"));
 assert(prompt.includes("Санко"));
 assert(prompt.includes("ОБЯЗАТЕЛЬНО ДЛЯ СОБСТВЕННОЙ РЕЧИ"));
 assert(prompt.includes("прежние реплики тоже не канон"));
 assert(!prompt.includes("PRIVATE_PROFILE_SECRET_MARKER"),
  "core mode never sends full private archive");
 assert(prompt.includes("Лунцзин"));
 assert(prompt.includes("Шицяо"));
});
test("current snapshot respects structured KV and does not invent time",()=>{
 assert.deepEqual(readCurrentSnapshot(null),{asOf:"",text:""});
 assert.deepEqual(readCurrentSnapshot(JSON.stringify({asOf:"2026-11-05",text:"Плывём."})),
 {asOf:"2026-11-05",text:"Плывём."});
});
