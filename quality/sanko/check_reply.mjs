// Offline quality gate only. No production Worker changes or API calls.
// Run: node quality/sanko/check_reply.mjs 'Что же это такое?'
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { maskQuotedSankoText } from "../../worker/src/sanko-mandatory-forms.js";

const dir=dirname(fileURLToPath(import.meta.url));
export const contract=JSON.parse(readFileSync(join(dir,"voice_contract.json"),"utf8"));
const escapeRe=s=>Array.from(s).map(c=>"|\\{}()[\\]^$+*?.".includes(c)?"\\"+c:c).join("");
const whole=s=>new RegExp("(?<![\\p{L}\\p{N}-])"+escapeRe(s)+"(?![\\p{L}\\p{N}-])","giu");
const rules=contract.mandatoryLexemes.map(x=>({source:x.standard,required:x.required,re:whole(x.standard)}));
const noCalendar=/(?<![\p{L}\p{N}])(?:(?:19|20)\d{2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|январ[яьеюём]|феврал[яьеюём]|март[аеуом]?|апрел[яьеюём]|ма[йяюе]|июн[яьеюём]|июл[яьеюём]|август[аеуом]?|сентябр[яьеюём]|октябр[яьеюём]|ноябр[яьеюём]|декабр[яьеюём]|понедельник[аеуом]?|вторник[аеуом]?|сред[аеуыой]?|четверг[аеуом]?|пятниц[аыеуой]?|суббот[аыеуой]?|воскресень[яеюем]?)(?![\p{L}\p{N}])/iu;
const bannedPhrases=[
 /за\s+энту\s+дату/iu,
 /по\s+доступным\s+записям/iu,
 /(?<![\p{L}\p{N}])(?:чинота|чинуша|чинушами|далебени)(?![\p{L}\p{N}])/iu
];
// Validate ONLY Sanko's own utterance, not a user message or source quote.
// Lint does NOT auto-rewrite or establish factual canon.
export function lintSankoReply(text) {
 const reply=String(text||"");
 const lexicalReply=maskQuotedSankoText(reply);
 const problems=[];
 for(const item of rules) {
  for(const match of lexicalReply.matchAll(item.re))
   problems.push({type:"literary_equivalent",word:match[0],position:match.index,
    expected:item.required,rule:item.source});
 }
 if(noCalendar.test(reply))problems.push({type:"calendar_date"});
 for(const re of bannedPhrases) {
  if(re.test(reply))problems.push({type:"invented_dialect_or_bookkeeping",pattern:String(re)});
 }
 return problems;
}
export function containsMandatoryForm(reply) {
 return rules.some(x=>x.required.some(variant=>whole(variant).test(reply)));
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const reply=process.argv.slice(2).join(" ");
 if(!reply) {
  console.error('Usage: node quality/sanko/check_reply.mjs "реплика Санко"');
  process.exitCode=2;
 } else {
  const problems=lintSankoReply(reply);
  process.stdout.write(JSON.stringify({pass:problems.length===0,problems},null,2)+"\n");
  if(problems.length)process.exitCode=1;
 }
}
