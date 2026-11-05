// Post-generation fact assertions are audited independently of the language
// model. The model is never allowed to silently change "who said what".
import {sourceMap} from "./approved-ledger.js";
const boat=/лодочн/iu,official=/тицзюй|тицзю[юя]/iu;
const city=/лунцзин/iu,checkpoint=/шицяо/iu;
const signals=/сказ|говор|толков|сообщ|узнал|слышал|откуда|разве|пута/iu;
const trim=s=>String(s||"").trim();
const clauses=s=>trim(s).split(/[\n.!?;,]+/u).map(x=>x.trim()).filter(Boolean);
function assertion(clause,subject,wrongPlace){
 if(!subject.test(clause)||!wrongPlace.test(clause))return false;
 // A valid explicit negation should never be "corrected" into the opposite.
 if(/(?:не\s+(?:говор|сказ|сообщ|утвержд))|(?:ничего\s+не\s+говор)/iu.test(clause))return false;
 return true;
}
export function incorrectSourceAttributions(reply,approved){
 const pairs=sourceMap(approved?.facts||[]);
 if(!pairs["лодочник"]||!pairs["тицзюй"])return [];
 const conflicts=[];
 for(const clause of clauses(reply)){
  if(assertion(clause,boat,checkpoint)&&signals.test(clause))conflicts.push("boatman_to_shiqiao");
  if(assertion(clause,official,city)&&signals.test(clause))conflicts.push("official_to_lunzin");
 }
 return [...new Set(conflicts)];
}
function relevantQuestion(question,history){
 const q=String(question||"");
 if(boat.test(q)||official.test(q)||city.test(q)||checkpoint.test(q)||
  /застав|высад|пута|откуда\s+знае/iu.test(q))return true;
 const previous=Array.isArray(history)?history.filter(x=>x?.role==="user").slice(-3):[];
 return previous.some(x=>boat.test(x.text)||official.test(x.text)||checkpoint.test(x.text));
}
function canonicalCorrection(approved){
 const pairs=sourceMap(approved?.facts||[]);
 const boatPlace=pairs["лодочник"]?.place||"";
 const officialPlace=pairs["тицзюй"]?.place||"";
 if(!boatPlace||!officialPlace)return "";
 return "Оплошал я, перепутал. Лодочник говорил про "+boatPlace+
  ", а Тицзюй на заставе — про "+officialPlace+".";
}
export function auditReplyAgainstFacts(reply,approved,question,history=[]){
 const violations=incorrectSourceAttributions(reply,approved);
 if(violations.length){
  const correction=canonicalCorrection(approved);
  return {reply:correction||"Запутался я. Не стану повторять, покуда не разберусь.",
   passed:false,violations,action:"source_contradiction_corrected"};
 }
 // When a visitor explicitly challenges a disputed source, avoid merely
 // accepting the visitor's assertion. Correct using AUTHOR evidence instead.
 const q=trim(question);
 const challenge=/(?:разве|ты\s+перепутал|не\s+(?:он|лодочник|тицзюй)\s+говорил|запутался)/iu.test(q);
 if(challenge&&relevantQuestion(q,history)){
  const correct=canonicalCorrection(approved);
  if(correct)return {reply:correct,passed:true,violations:[],
   action:"author_source_reaffirmed"};
 }
 return {reply,passed:true,violations:[],action:"unmodified"};
}
