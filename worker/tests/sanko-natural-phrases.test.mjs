import test from "node:test";
import assert from "node:assert/strict";
import { smoothSankoSpeech } from "../src/sanko-natural-phrases.js";
import { enforceMandatorySankoForms } from "../src/sanko-mandatory-forms.js";

test("the exact author-corrected lodging phrase is natural, not tautological",()=>{
 const before="Энто воры туташние нас ночлегом приютили. Сидим в складе у реки.";
 const after="Воры туташние нас приютили. Сидим в складе у реки.";
 assert.equal(enforceMandatorySankoForms(smoothSankoSpeech(before)),after);
 assert.equal(smoothSankoSpeech("Воры туташние нас приютили."),"Воры туташние нас приютили.");
});

test("no purposeless location word after escaping; meaningful locatives remain",()=>{
 assert.equal(smoothSankoSpeech("Еле удрали тута!"),"Еле удрали!");
 assert.equal(smoothSankoSpeech("Еле удрали тута. И сели отдыхать."),"Еле удрали. И сели отдыхать.");
 assert.equal(smoothSankoSpeech("Тута, у самой реки, переждали."),"Тута, у самой реки, переждали.");
 assert.equal(smoothSankoSpeech("Сюды не сунутся. Тута слишком топко."),
  "Сюды не сунутся. Тута слишком топко.");
});

test("temporal покуда never creates an absurd one-word goodbye",()=>{
 assert.equal(enforceMandatorySankoForms(smoothSankoSpeech("Пока!")),"Бывай!");
 assert.equal(enforceMandatorySankoForms(smoothSankoSpeech("Ну, пока!")),"Бывай!");
 assert.equal(enforceMandatorySankoForms(smoothSankoSpeech("Пока ветер не стих, сидим тута.")),
  "Покуда ветер не стих, сидим тута.");
});
test("smoothing is bounded, idempotent and does not invent events",()=>{
 const examples=[
  "Энто воры туташние нас ночлегом приютили.",
  "Еле удрали тута!",
  "Мы тута, у реки. Воры нас приютили.",
  "Шо делать? Покуда сидим.",
 ];
 for(const x of examples){
  const y=smoothSankoSpeech(x);
  assert.equal(smoothSankoSpeech(y),y);
  assert(!y.includes("тележк"));
  assert(!y.includes("сполох"));
 }
});

test("do not invent a чинуша or misuse second-person хошь for мы",()=>{
 const raw="Купчик донёс, будто мы его обмануть хошь. Чинуша со стражей заявился, ну мы и дали деру.";
 const expected="Купчик донёс, будто мы его обмануть хотели. Стража явилась, ну мы и дали деру.";
 assert.equal(smoothSankoSpeech(raw),expected);
 assert.equal(smoothSankoSpeech("Ты шо хошь?"),"Ты шо хошь?");
 assert.equal(smoothSankoSpeech(expected),expected);
});
