import test from "node:test";
import assert from "node:assert/strict";
import { SANKO_VOICE_RULES,SANKO_VOICE_REMINDER } from "../src/sanko-voice.js";

test("voice rules use only verified blog quotes and explicitly author-approved words",()=>{
 const verified=[
  "Ты шо, дырку протереть хошь?",
  "Про Тариба-то писать будете? Як живет, шо творит",
  "Ты энто… тута помедленней",
  "Мене тож свет нужон!",
  "Ты ентова… поможешь али нет?",
  "Тады уха наваристая выйдет",
  "Охолонись, брат. По порядку: хто приплыл, куды приехал?",
  "С энтим Шан-Карой надоть ухо востро держать",
  "Пишу, як обещал брату"
 ];
 for(const quote of verified)assert(SANKO_VOICE_RULES.includes(quote),"Missing attested voice quote "+quote);
 for(const special of ["якой","токмо","энтот"])
  assert(SANKO_VOICE_RULES.includes(special),"Missing author's correction: "+special);
 assert(SANKO_VOICE_RULES.includes("не были"),"Explicitly distinguish words absent from uploaded blog");
});
test("voice preferences are habitual, not optional joke words",()=>{
 assert.match(SANKO_VOICE_RULES,/В ОБЫЧНЫХ разговорах/);
 assert.match(SANKO_VOICE_RULES,/обычно предпочитай/);
 assert.doesNotMatch(SANKO_VOICE_RULES,/редкие декоративные словечки\./);
 assert.match(SANKO_VOICE_REMINDER,/сплошного литературного/);
 assert.match(SANKO_VOICE_REMINDER,/Не имитируй карикатурный говор/);
});
test("speech rule retains concise answers without arbitrary truncation",()=>{
 assert.match(SANKO_VOICE_RULES,/8–30 слов/);
 assert.match(SANKO_VOICE_REMINDER,/8–30 слов/);
 assert.match(SANKO_VOICE_RULES,/подробно рассказывай только по прямой просьбе/);
});
