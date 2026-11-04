import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join,dirname } from "node:path";
import { contract,lintSankoReply,containsMandatoryForm } from "./check_reply.mjs";
const dir=dirname(fileURLToPath(import.meta.url));
const src=JSON.parse(readFileSync(join(dir,"source_quotes.json"),"utf8"));
const evals=JSON.parse(readFileSync(join(dir,"eval_cases.json"),"utf8"));

test("author-approved forms ALWAYS, with no optional mode",()=>{
 assert.equal(contract.mandatoryLexemes.length,18);
 assert(contract.globalRule.includes("ВСЕГДА"));
 assert(contract.mandatoryLexemes.every(x=>x.mode==="ALWAYS_WHEN_MEANING_IS_USED_IN_OWN_SPEECH"));
 for(const [standard,form] of [
  ["что","шо"],["это","энто"],["как","як"],["какой","якой"],
  ["только","токмо"],["этот","энтот"],["если","ежли"],
  ["кто","хто"],["куда","куды"]
 ]) {
  const entry=contract.mandatoryLexemes.find(x=>x.standard===standard);
  assert(entry,"Missing mandatory "+standard);
  assert(entry.required.includes(form),"Missing form "+form);
 }
});
test("every mandatory literary equivalent is rejected in own speech",()=>{
 for(const lexeme of contract.mandatoryLexemes) {
  const problems=lintSankoReply("Скажу: "+lexeme.standard+".");
  assert(problems.some(x=>x.type==="literary_equivalent"&&x.rule===lexeme.standard),
   "Didn't reject literary "+lexeme.standard);
  for(const form of lexeme.required) {
   const p=lintSankoReply("Скажу: "+form+".");
   assert(!p.some(x=>x.type==="literary_equivalent"),"Rejected approved "+form);
  }
 }
});
test("all known screenshot failures are rejected",()=>{
 for(const line of [
  "А выбор какой?",
  "Ну, здрав будь. Как у тебя дела?",
  "Что у вас сегодня было?",
  "Это мы сделали только вчера.",
  "За энту дату нема никаких новых вестей.",
  "Чинота со стражниками пришла.",
  "Далебени мы их обманули.",
  "В ноябре была морось.",
  "На дворе 2026-11-04."
 ]) {
  assert(lintSankoReply(line).length>0,line);
 }
});
test("allowed sentences need not be stuffed with dialect words",()=>{
 for(const line of [
  "Надо посмотреть.",
  "К утру опять зябко будет.",
  "Утром приду.",
  "Шо ты хотел?",
  "Энто дело серьёзное, тока спешить не след."
 ])assert.deepEqual(lintSankoReply(line),[],line);
 assert(!containsMandatoryForm("Надо посмотреть."));
 assert(containsMandatoryForm("Шо ты хотел?"));
});
test("Unicode boundaries are correct: never flag substring inside another word",()=>{
 for(const line of ["Никак не получается.", "Кое-что неясно."]) {
  const issues=lintSankoReply(line);
  if(line.startsWith("Никак"))assert.equal(issues.length,0);
  else assert.equal(issues.length,0); // Compound not asserted until approved.
 }
});
test("direct canon quote bank has source attribution and links",()=>{
 assert(src.items.length>=20);
 assert(new Set(src.items.map(x=>x.id)).size===src.items.length);
 for(const x of src.items){
  assert.match(x.url,/^https:\/\/vk\.ru\/wall850667816_\d+$/);
  assert.match(x.date,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(x.attribution,"Санко");
  assert(x.quote.length>=5);
 }
 assert(src.items.some(x=>x.quote.includes("Ты шо, дырку протереть хошь")));
 assert(src.items.some(x=>x.quote.includes("Пишу, як обещал брату")));
});
test("benchmark checks complete dialogue, without frozen facts",()=>{
 assert(evals.cases.length>=25);
 assert(evals.cases.filter(x=>x.category==="recent").length>=4);
 assert(evals.cases.filter(x=>x.category==="followup").length>=3);
 assert(evals.cases.every(x=>x.lexicalContract==="zero_literary_equivalents_of_mandatory_18"));
 assert(evals.cases.every(x=>x.dates==="no_calendar_dates"));
});
