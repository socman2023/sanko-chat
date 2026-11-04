// Author-approved mandatory words for Sanko's OWN speech (04.11.2026).
// Kept explicit to avoid runtime JSON import / network dependency in Cloudflare.
// The offline quality/sanko/voice_contract.json test must match exactly.
export const MANDATORY_SANKO_FORMS = [
 [
  "что",
  "шо"
 ],
 [
  "как",
  "як"
 ],
 [
  "какой",
  "якой"
 ],
 [
  "только",
  "тока"
 ],
 [
  "это",
  "энто"
 ],
 [
  "этот",
  "энтот"
 ],
 [
  "если",
  "ежли"
 ],
 [
  "тут",
  "тута"
 ],
 [
  "здесь",
  "тута"
 ],
 [
  "там",
  "тама"
 ],
 [
  "кто",
  "хто"
 ],
 [
  "куда",
  "куды"
 ],
 [
  "хочешь",
  "хошь"
 ],
 [
  "нет",
  "нема"
 ],
 [
  "мне",
  "мене"
 ],
 [
  "меня",
  "мя"
 ],
 [
  "этих",
  "энтих"
 ],
 [
  "каждый",
  "кажный"
 ],
 ["после","опосля"],
 ["до сих пор","досель"],
 ["сюда","сюды"],
 ["туда","туды"],
 ["пока","покуда"],
 ["дотуда","дотуль"],
 ["до туда","дотуль"]
];

// Whole Russian words, not substrings of names or hyphenated compounds.
// This is a narrow final guard for precisely author-approved forms.
// It must NEVER invent declensions or paraphrase the contents of an answer.
const matchWord=s=>new RegExp("(?<![\\p{L}\\p{N}-])"+s+"(?![\\p{L}\\p{N}-])","giu");
const compiled=MANDATORY_SANKO_FORMS.map(([standard,dialect])=>({
 standard,dialect,re:matchWord(standard)
})).sort((a,b)=>b.standard.length-a.standard.length); // Multiword phrases before their constituent words.
function preserveCase(original,replacement) {
 if(original===original.toUpperCase())return replacement.toUpperCase();
 if(original[0]===original[0].toUpperCase())
  return replacement[0].toUpperCase()+replacement.slice(1);
 return replacement;
}
export function literaryEquivalentsInSankoSpeech(text) {
 const value=String(text||""),violations=[];
 for(const x of compiled) {
  for(const match of value.matchAll(x.re))
   violations.push({word:match[0],required:x.dialect,index:match.index});
 }
 return violations;
}
export function enforceMandatorySankoForms(value) {
 let text=String(value||"");
 for(const x of compiled)
  text=text.replace(x.re,word=>preserveCase(word,x.dialect));
 return text;
}
