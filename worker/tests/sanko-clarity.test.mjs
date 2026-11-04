import test from "node:test";
import assert from "node:assert/strict";
import { sankoClarificationCue } from "../src/sanko-clarity.js";

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
