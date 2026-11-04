// Exact, author-approved reductions of awkward Gemini wording.
// This is intentionally NOT an open-ended dialect rewrite: no new facts,
// no new actions, no new declensions, and no additional LLM calls.
export function smoothSankoSpeech(value) {
 let reply=String(value||"");
 // Author correction: «Воры туташние нас приютили».
 // The extra «энто» and tautological «ночлегом» make it unnatural.
 reply=reply.replace(
  /(?<![\p{L}\p{N}])(?:энто\s+)?воры\s+туташние\s+нас\s+ночлегом\s+приютили(?=[\s.!?,;:]|$)/giu,
  match=>/^[А-ЯЁ]/u.test(match)?"Воры туташние нас приютили":"воры туташние нас приютили"
 );
 // Do not append «тута» as a purely decorative word after this action.
 // Leave legitimate spatial statements («Тута в складе сидим») intact.
 reply=reply.replace(
  /(?<![\p{L}\p{N}])([Ее]ле\s+удрали)\s+тута(?=\s*[.!?]|$)/giu,
  "$1"
 );
 // If Gemini invents a courtly «чинуша» where it actually describes
 // the city guard arriving, retain the stated action but remove that actor.
 reply=reply.replace(
  /(?<![\p{L}\p{N}])чинуша\s+со\s+стражей\s+(?:заявился|явился|пришёл)(?=[\s.!?,;:]|$)/giu,
  match=>/^[А-ЯЁ]/u.test(match)?"Стража явилась":"стража явилась"
 );
 // «Хошь» means 2nd person singular «хочешь», not plural «мы хотели».
 reply=reply.replace(
  /(?<![\p{L}\p{N}])(мы\s+его\s+обмануть)\s+хошь(?=[\s.!?,;:]|$)/giu,
  "$1 хотели"
 );
 // In "Плывём опосля по реке" the time word has no antecedent and
 // interrupts a present-tense description of where the boat is moving.
 // Remove ONLY this confirmed malformed construction. Legitimate "опосля
 // ужина", "мы сами опосля заскочим" and other time uses stay untouched.
 reply=reply.replace(
  /(?<![\p{L}\p{N}])(плыв(?:ём|ем|у|ут))\s+опосля(?=\s+по\s+реке\b)/giu,
  "$1"
 );

 // «Покуда» is temporal, not a natural one-word goodbye.
 // Avoid turning a modern parting «Пока!» into «Покуда!».
 reply=reply.replace(/^\s*(?:Ну,?\s*)?Пока[.!\s]*$/iu,"Бывай!");
 return reply;
}
