import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname,join } from "node:path";
import { MANDATORY_SANKO_FORMS,enforceMandatorySankoForms,
 literaryEquivalentsInSankoSpeech } from "../src/sanko-mandatory-forms.js";
const dir=dirname(fileURLToPath(import.meta.url));
const authority=JSON.parse(readFileSync(join(dir,"../../quality/sanko/voice_contract.json"),"utf8"));

test("production mapping exactly follows latest author-approved 25 forms",()=>{
 assert.equal(MANDATORY_SANKO_FORMS.length,25);
 assert.deepEqual(MANDATORY_SANKO_FORMS,
  authority.mandatoryLexemes.map(x=>[x.standard,x.required[0]]));
});
test("every mandatory literary word converts to exactly its approved form",()=>{
 for(const [literary,sanko] of MANDATORY_SANKO_FORMS){
  const before="Говорю: "+literary+".";
  const after=enforceMandatorySankoForms(before);
  assert(after.includes(sanko+"."),literary+" -> "+after);
  assert.equal(literaryEquivalentsInSankoSpeech(after).length,0,literary);
  assert.equal(enforceMandatorySankoForms(after),after,"Idempotent: "+literary);
 }
});
test("Sanko never returns literary alternatives in ordinary conversation",()=>{
 const answers=[
  ["Ну, здрав будь. Как у тебя дела?","Ну, здрав будь. Як у тебя дела?"],
  ["Что у вас сегодня было?","Шо у вас сегодня было?"],
  ["А выбор какой?","А выбор якой?"],
  ["Это было только вчера.","Энто было тока вчера."],
  ["Это этот купец?","Энто энтот купец?"],
  ["Кто там? Куда идти?","Хто тама? Куды идти?"],
  ["Если тут нет меня, хочешь помощи?","Ежли тута нема мя, хошь помощи?"],
  ["Здесь нет этих людей. Каждый за себя.","Тута нема энтих людей. Кажный за себя."],
  ["Мне нужно время.","Мене нужно время."]
 ];
 for(const [before,after] of answers){
  assert.equal(enforceMandatorySankoForms(before),after,before);
  assert.equal(literaryEquivalentsInSankoSpeech(after).length,0);
 }
});
test("case and word boundaries preserve names, punctuation, and compounds",()=>{
 assert.equal(enforceMandatorySankoForms("ЧТО?! КАК?! Это! Только!"),
  "ШО?! ЯК?! Энто! Тока!");
 assert.equal(enforceMandatorySankoForms("Никак, какое-то, кое-что, человек, кто-нибудь."),
  "Никак, какое-то, кое-что, человек, кто-нибудь.");
 assert.equal(enforceMandatorySankoForms("Шо нынче стряслось? Надо посмотреть."),
  "Шо нынче стряслось? Надо посмотреть.");
});
test("fixed-form guard never invents content or extra API calls",()=>{
 const raw="Он сказал, что ушёл. Потом мы пошли домой.";
 const out=enforceMandatorySankoForms(raw);
 assert.equal(out,"Он сказал, шо ушёл. Потом мы пошли домой.");
 assert.equal(out.split(/[.!?]/u).length,raw.split(/[.!?]/u).length);
 assert.equal(out.includes("сполох"),false);
});

test("new directional and temporal forms are mandatory, with multiword priority",()=>{
 const input="До сих пор после дождя сюда шли, потом туда, а пока до туда не добрались.";
 const expected="Досель опосля дождя сюды шли, потом туды, а покуда дотуль не добрались.";
 assert.equal(enforceMandatorySankoForms(input),expected);
 for(const sentence of [
  "Мы после вернёмся.","До сих пор сидим.","Сюда иди.","Туда надо.",
  "Пока не стемнело, пойдём.","Пойдём дотуда.","Дойдём до туда."
 ]){
  const out=enforceMandatorySankoForms(sentence);
  assert.deepEqual(literaryEquivalentsInSankoSpeech(out),[],out);
 }
 assert.equal(enforceMandatorySankoForms("После ужина отправимся туды."),
  "Опосля ужина отправимся туды.");
});
