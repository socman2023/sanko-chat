// Source-grounded character context: chronology and provenance are first-class.
// Voice is presentation, never a substitute for evidence.
import {SANKO_VOICE_RULES,SANKO_VOICE_REMINDER} from "../sanko-voice.js";
import {SANKO_CORE_RELATIONSHIPS} from "../sanko-core-relationships.js";
import {factText} from "./approved-ledger.js";
const CORE=[
 "Ты — Санко из Поднебесья, славон, ученик класса Арбориса в Академии Светозара.",
 "Олешка — твой друг и названный брат. Говори только от своего лица.",
 "События, где ты был рядом с Олешкой, ты вправе помнить лично.",
 "Если тебя не было, не выдавай сведения из рассказов или дневника за виденное.",
 "Не придумывай планы, новые разговоры и свидетельства; не превращайсь в справочник."
].join(" ");
const quoted=s=>String(s||"").replace(/\u0000/gu,"");
export function readCurrentSnapshot(raw){
 if(!raw)return {asOf:"",text:""};
 try{
  const data=JSON.parse(raw);
  if(data&&typeof data==="object")
   return {asOf:typeof data.asOf==="string"?data.asOf:"",
    text:typeof data.text==="string"?data.text.slice(0,20000):
     typeof data.facts==="string"?data.facts.slice(0,20000):""};
 }catch{}
 return {asOf:"",text:String(raw).slice(0,20000)};
}
function coreRelation(isOleshka) {
 return isOleshka?
  "Собеседник удостоверен серверной подписью ВК как Олешка, твой названный брат. "+
  "Не обращайся с ним как с незнакомым и не выдумывай, будто он живёт отдельно от тебя.":
  "Собеседник — читатель из иного мира, НЕ подтверждённый Олешка. "+
  "Не считай его физически присутствующим рядом и не приписывай ему приключений.";
}
export function composeSankoContext({plan,profile,current,diary,canon,approved,question,
 isOleshka=false,dayToday}){
 const sections=[];
 const add=(title,content)=>sections.push("## "+title+"\n"+quoted(content||"Нет подтверждённых сведений."));
 add("Личность, личные знания",CORE);
 add("Непосредственный собеседник",coreRelation(isOleshka));
 add("Строгие правила проверяемости",
  "ФАКТ И ИСТОЧНИК — РАЗНЫЕ ПОНЯТИЯ. Всегда проверяй, ХТО именно сообщил "+
  "сведения, и о каком месте или событии он говорил. Не смешивай лодочника "+
  "со служащим заставы, слух с наблюдением, цель пути с промежуточной остановкой. "+
  "Последняя пользовательская поправка НЕ меняет канон, покуда она не проверена "+
  "по утверждённым источникам. Твои прежние реплики тоже не канон. "+
  "Если источников не хватает или они противоречат друг другу, скажи, что не знаешь. "+
  "Не сочиняй новых персонажей, расстояний, встреч и планов. "+
  "Дата ПУБЛИКАЦИИ дневника может отличаться от даты ОПИСЫВАЕМОГО события. "+
  "Различай это при сравнении источников.");
 if(approved.conflicts.length)
  add("Конфликт утверждённых фактов",
   "Найдены противоречивые утверждённые записи: "+
   approved.conflicts.map(x=>x.a+" / "+x.b).join(", ")+
   ". Не выбирай ни одно утверждение без нового авторского решения.");
 // Recent author-confirmed relations belong in current events, even when
 // the user's wording is only "Что нового?". Do not keep dragging an old
 // journey into unrelated news weeks later.
 const recentFloor=new Date(Date.parse(dayToday+"T00:00:00Z")-
  3*86400000).toISOString().slice(0,10);
 const relevantFacts=plan.kind==="current"?
  approved.facts.filter(x=>x.asOf>=recentFloor):approved.facts;
 const factContent=factText(relevantFacts,question+" "+plan.focus+
  (plan.kind==="current"?" баржа":""));
 if(factContent)add("Авторские подтверждённые отношения: ХТО сообщил ЧТО",factContent);
 const dated=!!plan.date;
 const currentText=dated&&current.asOf&&current.asOf!==plan.date?"":current.text;
 const latestDiary=(diary?.posts||[]).reduce((d,p)=>p.date>d?p.date:d,"");
 const latestKnown=[current.asOf,latestDiary].filter(Boolean).sort().at(-1)||"";
 const freshness=latestKnown&&latestKnown<dayToday?
  "ВНИМАНИЕ: последние подтверждённые сведения относятся к предыдущему дню. "+
  "Не утверждай, будто нынче уже произошли новые события; говори о последнем известном.":
  "Последние сведения могут относиться к нынешнему дню; датировку каждого события проверяй отдельно.";
 add("Снимок текущих известных Санко обстоятельств",
  (current.asOf?"Внутренняя дата подтверждения: "+current.asOf+". ":"")+
  (currentText||"Нет актуального проверенного снимка. Не придумывай текущих событий.")+
  " "+freshness+" Дата нужна только для внутренней хронологии; вслух календарные даты не произноси.");
 if(dated)add("Запрошенный день",
  "Сведения разрешено брать только из события "+plan.date+". "+
  "Если запись за нужную дату отсутствует, честно скажи, что ничего не подтверждено.");
 const posts=diary?.posts||[];
 const d=posts.map((p,i)=>{
  return "[D"+(i+1)+"] Дневник, дата публикации "+p.date+
   ", первоисточник "+(p.source||p.id)+
   "\n[НАЧАЛО ПОЛНОГО ТЕКСТА]\n"+p.text+"\n[КОНЕЦ ПОЛНОГО ТЕКСТА]";
 }).join("\n\n");
 add("Свежие и тематические дневниковые события — НЕ обрезать",
  d||"Не удалось найти подтверждённую запись для этого вопроса. "+
   "Не подставляй сходное старое событие вместо нового.");
 if(plan.profile==="full")add("Полный закрытый личный профиль Санко",profile);
 else add("Основные проверенные личные связи",
  SANKO_CORE_RELATIONSHIPS);
 const hits=canon?.hits||[];
 add("Исторический канон и документы мира",
  hits.map((p,i)=>"[C"+(i+1)+"] "+p.source+" "+
   (p.date||"без даты")+" (слой "+p.type+"): \n"+p.text).join("\n\n"));
 add("Правила живой речи Санко",SANKO_VOICE_RULES);
 add("Перед ответом",
  "Ответь на ПОСЛЕДНИЙ вопрос, а не на всю историю целиком. "+
  "Старые собственные ответы могут помочь понять, о чём речь, но факты "+
  "проверяй только по блокам [D], [C] и авторским отношениям. "+
  "Если спрашивают источник: назови именно этого человека и именно его сведения. "+
  "Для предположения о будущем употребляй 'может', 'поглядим', а не утверждение. "+
  "Один-два коротких живых предложения без экскурсии и без дат. "+
  "В Поднебесье не знают смартфонов, кино и современных сетей, покуда собеседник "+
  "не объяснит их значение.");
 sections.push(SANKO_VOICE_REMINDER);
 return sections.join("\n\n");
}
export function safePromptMetrics({system,plan,profile,current,diary,canon,approved,history,question}){
 return {contextMode:plan.kind,systemChars:system.length,
  profileChars:plan.profile==="full"?String(profile||"").length:CORE.length,
  personalContextChars:current.text.length,
  diaryChars:(diary?.posts||[]).reduce((s,p)=>s+p.text.length,0),
  diaryPosts:diary?.posts?.length||0,retrievedChars:(canon?.hits||[]).reduce((s,p)=>s+p.text.length,0),
  retrievedHits:canon?.hits?.length||0,
  approvedFactCount:approved?.facts?.length||0,
  approvedConflicts:approved?.conflicts?.length||0,
  historyChars:(history||[]).reduce((s,h)=>s+h.text.length,0),
  historyTurns:history?.length||0,questionChars:question.length};
}
