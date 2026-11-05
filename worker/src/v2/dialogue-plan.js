// Pure, auditable dialogue planner. It never treats earlier model replies
// as historical evidence; only earlier HUMAN questions carry search subjects.
// Unrecognized requests receive the full knowledge mode, never fabricated facts.
import {dateIntent,dayInMoscow} from "../lib.js";
const news=/^(?:(?:ну|а|лучше|скажи|расскажи|ты|мне)[\s,!?.]+)*(?:(?:что|шо)\s+(?:нового\s+у\s+(?:тебя|вас)|у\s+(?:тебя|вас)\s+нового|нового)|у\s+(?:тебя|вас)\s+(?:что|шо)\s+нового|какие\s+новости)[\s!?.,…]*$/iu;
const greeting=/^(?:привет(?:ик)?|здрав(?:ствуй|ствуйтесь|ствуйте|\s+будь)|добрый\s+(?:день|вечер)|здорово)[\s!?.,…]*$/iu;
const social=/^(?:как\s+(?:ты|дела|поживаешь)|чем\s+занят|что\s+делаешь)[\s!?.,…]*$/iu;
const historySignal=/(?:отец|отца|матер|детств|семь|родил|прошл|прежде|академи|учител|помнишь\s+как)/iu;
const provenance=/(?:откуда|хто|кто|сказывал|сказал|говорил|сообщил|верно\s+ли|правда|разве|пута|перепут|запут|на\s+заставе|лодочник|тицзюй)/iu;
const detail=/(?:подробн|с\s+самого\s+начала|по\s+порядку|всю\s+историю|всех\s+подробност)/iu;
const scene=/(?:барж|невольн|лунцзин|шицяо|река|джонк|высад|пленник|руман|элина)/iu;
const future=/^(?:(?:так|а|ну|может|так\s+может|да\s+может)[,\s]+)*(?:их\s+(?:там\s+)?высадят|там\s+их\s+высадят|успеете|чаешь[, ]+успеете|а\s+там\s+(?:что|шо)\s+будет|что\s+дальше|а\s+потом)[\s!?.,…]*$/iu;
const shortReply=/^(?:какую\s+баржу|уже\s+видали\s+(?:эту\s+)?баржу|неужто|а\s+(?:там|они|он|она)\s+что)[\s!?.,…]*$/iu;
const tokens=s=>(String(s||"").toLowerCase().match(/[\p{L}]{4,}/gu)||[]);
const stop=new Set(["вчера","сегодня","завтра","недавно","знаешь","знаете",
 "скажешь","скажи","расскажи","будет","будут","успеете","вопрос",
 "нового","лучше","говорил","сказал","вроде","потом","покуда","неужто"]);
export function humanTopic(history,max=8){
 const questions=Array.isArray(history)?history
  .filter(h=>h?.role==="user"&&typeof h.text==="string").slice(-max)
  .map(h=>h.text.trim()):[];
 const substantive=[...questions].reverse().find(q=>
  !greeting.test(q)&&!social.test(q)&&!news.test(q)&&
  !future.test(q)&&tokens(q).some(t=>!stop.has(t)));
 return substantive||"";
}
function hasCurrentTheme(history){
 if(!Array.isArray(history))return false;
 const user=history.filter(h=>h?.role==="user").slice(-8).map(h=>h.text||"");
 if(!user.length)return false;
 const seed=user.find(q=>news.test(q)||scene.test(q));
 if(!seed)return false;
 // A recent explicit switch to biography/history resets the current scene.
 const after=user.slice(user.indexOf(seed)+1);
 if(after.some(q=>historySignal.test(q)&&!scene.test(q)))return false;
 return true;
}
export function planDialogue(question,history=[],today=dayInMoscow()){
 const q=String(question||"").trim();
 const when=dateIntent(q,today);
 const topic=humanTopic(history);
 if(when)return {kind:"dated",date:when.day,focus:q,profile:"full",diary:"date",
  take:0,search:true,searchLimit:7,reason:"explicit_or_relative_day"};
 if(greeting.test(q))return {kind:"greeting",date:"",focus:"",profile:"core",
  diary:"none",take:0,search:false,searchLimit:0,reason:"exact_social"};
 if(news.test(q))return {kind:"current",date:"",focus:q,profile:"core",
  diary:"recent",take:4,search:false,searchLimit:0,reason:"current_events"};
 if(social.test(q)&&!topic)return {kind:"social",date:"",focus:q,profile:"core",
  diary:"recent",take:1,search:false,searchLimit:0,reason:"exact_social"};
 if(provenance.test(q)){
  // Provenance MUST be resolved from approved fact ledger and full cited
  // diary, not earlier assistant's unverified explanation.
  const focus=(q+" "+(topic&&topic!==q?topic:"")).slice(0,700);
  return {kind:"source-check",date:"",focus,profile:"core",
   diary:"source-check",take:7,search:true,searchLimit:5,reason:"who_said_what"};
 }
 if(historySignal.test(q)||detail.test(q))
  return {kind:"personal",date:"",focus:q,profile:"full",
   diary:"topical",take:9,search:true,searchLimit:8,reason:"person_or_history"};
 if(future.test(q)&&hasCurrentTheme(history))
  return {kind:"continuation",date:"",focus:topic||q,profile:"core",
   diary:"recent",take:4,search:!!topic,searchLimit:3,reason:"bounded_scene"};
 if(shortReply.test(q)&&hasCurrentTheme(history))
  return {kind:"continuation",date:"",focus:topic||q,profile:"core",
   diary:"recent",take:4,search:!!topic,searchLimit:4,reason:"short_followup"};
 // Avoid falsely simplifying a question about a named person, region or
 // an older event: the full approved private profile remains accessible.
 return {kind:"knowledge",date:"",focus:topic&&q.length<24?topic+" "+q:q,
  profile:"full",diary:"topical",take:7,search:true,searchLimit:8,
  reason:"conservative_factual"};
}
