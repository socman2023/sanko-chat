import test from "node:test";
import assert from "node:assert/strict";
import { sankoClarificationCue,repairSankoLexicalClarification } from "../src/sanko-clarity.js";

const history=[
 {role:"user",text:"А у тебя?"},
 {role:"model",text:"Покудь догоним их, тама и поглядим."}
];

test("ordinary questions never trigger special clarification instructions",()=>{
 for(const q of ["Привет, Санко","А у тебя?","Где твой отец?","Знаешь, где Руман?"])
  assert.equal(sankoClarificationCue(q,history),"",q);
 assert.equal(sankoClarificationCue("Чего? Не понял.",[]),"");
});
test("explicit objections to incomprehensible speech trigger grounded plain explanation",()=>{
 for(const q of [
  "Чего? Не понял.","Что ты несёшь?","Блин, что ты несешь?",
  "У тебя совсем язык заплетается.","Говори понятнее.",
  "Объясни нормально.","Чего «догоним»?","Что значит?"
 ]){
  const cue=sankoClarificationCue(q,history);
  assert.match(cue,/Собеседник НЕ ПОНЯЛ/,q);
  assert.match(cue,/без новых выдуманных событий|не придумывай новых событий/,q);
  assert.match(cue,/В ОДНОЙ-ДВУХ простых фразах/,q);
  assert(!cue.includes("Покудь догоним"),"Never copy an invented model answer to the system");
 }
});
test("a clarification must never treat a bad model answer as confirmed canon",()=>{
 const cue=sankoClarificationCue("Блин, что ты несёшь?",history);
 assert.match(cue,/свои[мх] прошлым словам/);
 assert.match(cue,/утверждённому канону/);
 assert.equal(sankoClarificationCue("Не понял",{not:"a history"}),"");
});

test("a language question protects literary glosses instead of changing after into опосля",()=>{
 assert.equal(repairSankoLexicalClarification(
  "Опосля — энто значит после.","Чего «опосля»?",[
   {role:"model",text:"Опосля ужина поплывём."}
  ]),"Опосля — энто значит «после».");
 assert.equal(repairSankoLexicalClarification(
  "Опосля — энто значит опосля.","Чего «опосля»?",[
   {role:"model",text:"Опосля ужина поплывём."}
  ]),"Опосля — энто значит «после».");
 assert.equal(repairSankoLexicalClarification(
  "Опосля ужина выйдем.","Что было?",history),"Опосля ужина выйдем.");
});

test("the exact screenshot's bad earlier turn triggers plain correction, not circular explanation",()=>{
 const old=[{role:"user",text:"Сам говори, что было?"},
  {role:"model",text:"Плывем опосля по реке на джонке. Ищем баржу, куды Элинку увезли."}];
 for(const proposed of [
  "Опосля — энто значит опосля. Опосля того, як поговорили...",
  "Опосля — энто значит после."
 ]){
  const out=repairSankoLexicalClarification(proposed,'Чего "опосля"?',old);
  assert.equal(out,"Лишнее слово вставил. Плывем по реке на джонке.");
  assert(!out.includes("после")&&!out.includes("опосля"));
 }
 assert.equal(repairSankoLexicalClarification("Опосля ужина сели на лодку.",
  "А что было дальше?",old),"Опосля ужина сели на лодку.");
});
