import test from "node:test";
import assert from "node:assert/strict";
import { needsVoiceRepair,makeVoiceRepairPrompt,CANON_SANKO_SPEECH } from "../src/sanko-voice-check.js";

test("quality gate catches the real generic and forced-modernism examples",()=>{
 const screenshots=[
  "Эх, денек выдался! От стражи городского чинуши еле удрали, а ночлег теперь у местных воров на складе у реки.",
  "Да тот купчик на нас стражу натравил! Чинуша в управу волочь хотел, вот мы сполохом им глаза засыпали да и дали деру.",
  "Да из-за того проклятого купчика! На нас стражу натравил, будто мы его обмануть хотели. Пришлось деру давать."
 ];
 for(const x of screenshots)assert(needsVoiceRepair(x),x);
});
test("short canonical plain speech is NOT artificially dialected",()=>{
 for(const x of ["Надо посмотреть.","К утру опять зябко будет.","Большой.","Ничего мы не решили."])
  assert(!needsVoiceRepair(x),x);
});
test("contextual dialect and natural speech remain without a second API call",()=>{
 for(const x of [
  "Ты шо, дырку протереть хошь?",
  "Давеча в городе от стражи удрали. Нынче у реки сидим, покуда не сыщем след."
 ])assert(!needsVoiceRepair(x),x);
});
test("repair prompt uses canonical speech, not mechanical word swaps or invented details",()=>{
 const prompt=makeVoiceRepairPrompt(
  "А чего от стражи бежали?",
  "Чинуша на нас стражу натравил, мы сполохом им глаза засыпали.",
  [{role:"user",text:"Шо нынче было?"},{role:"model",text:"Ночуем у реки."}],
  "Вчера отряд убегал от городской стражи. Ночлег в складе."
 );
 assert(prompt.system.includes("НЕ прибавляй ни единого факта"));
 assert(prompt.system.includes("никаких")===false || prompt.system.includes("Никаких календарных дат"));
 assert(prompt.request.includes("А чего от стражи бежали?"));
 assert(prompt.request.includes("Вчера отряд убегал"));
 assert(prompt.request.includes("Ночуем у реки"));
 assert(CANON_SANKO_SPEECH.length>=10);
 assert(prompt.system.includes("Тятя слов на ветер не бросает"));
 assert(prompt.system.includes("Надо посмотреть"));
});
