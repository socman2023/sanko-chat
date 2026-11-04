import test from "node:test";
import assert from "node:assert/strict";
import { SANKO_VOICE_RULES,SANKO_VOICE_REMINDER } from "../src/sanko-voice.js";

test("Sanko voice uses natural phrases and preserves author-approved vocabulary",()=>{
 for(const quote of ["Ты шо, дырку протереть хошь?",
  "Про Тариба-то писать будете? Як живет, шо творит",
  "Ты энто… тута помедленней",
  "Мене тож свет нужон!",
  "Охолонись, брат. По порядку: хто приплыл, куды приехал?"])
  assert(SANKO_VOICE_RULES.includes(quote),quote);
 for(const word of ["якой","токмо","энтот"])
  assert(SANKO_VOICE_RULES.toLowerCase().includes(word),word);
 assert.match(SANKO_VOICE_RULES,/не переводишь их на говор/);
 assert.match(SANKO_VOICE_RULES,/Никакого нарочитого коверкания слов/);
});
test("Sanko never speaks calendar dates or the diary bookkeeping",()=>{
 assert.match(SANKO_VOICE_RULES,/Никогда не называй календарные даты/);
 assert.match(SANKO_VOICE_RULES,/даже если человек прямо спрашивает/);
 assert.match(SANKO_VOICE_REMINDER,/НИКАКИХ календарных дат/);
 assert.match(SANKO_VOICE_RULES,/Не говори «за энту дату»/);
});
test("Sanko remains brief unless more detail is requested",()=>{
 assert.match(SANKO_VOICE_RULES,/8–30 слов/);
 assert.match(SANKO_VOICE_REMINDER,/8–30 слов/);
 assert.match(SANKO_VOICE_RULES,/Если прямо попросили подробно/);
});
