import {
 CHARACTER, EMBEDDING_MODEL, LIMITS, CHAT_MAX_BYTES, CHAT_MAX_CHARS,
 PROFILE_KEY, CURRENT_KEY, DAY_PREFIX, dayInMoscow, dateIntent,
 isRealDay, safeHistory, strictCharacterFilter, safeVectorMatches,
 limitRetryAt, cleanConversationId, isAllowedOrigin
} from "./lib.js";
import { SANKO_CORE_RELATIONSHIPS } from "./sanko-core-relationships.js";
import { canonLexical } from "./canon-store.js";
import { adminFetch } from "./admin.js";
import { extractUsage,recordUsage } from "./token-usage.js";
import { classifyProviderError, publicChatError } from "./error-policy.js";

const VERSION="sanko-worker-0.5.3";
const MODEL_ORDER=[
 ["gemini-3.5-flash-lite",18000],["gemini-3.1-flash-lite",14000],
 ["gemini-3.6-flash",12000],["gemini-3.8-flash",12000]
];
const RETENTION_DAYS=30;

function headers(origin,env) {
 return {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
   "Access-Control-Allow-Origin":origin || "https://socman2023.github.io",
   "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
   "Access-Control-Allow-Headers":"Content-Type","Access-Control-Max-Age":"600","Vary":"Origin"};
}
function respond(value,status,origin,env) {
 return new Response(JSON.stringify(value),{status,headers:headers(origin,env)});
}
function ready(env) {
 return !!(env.AI?.run && env.KNOWLEDGE?.query && env.CURRENT_CONTEXT?.get &&
   env.GUARD_DB?.prepare && env.GEMINI_API_KEY && env.IP_HASH_SECRET);
}
async function bodyJson(request) {
 if(Number(request.headers.get("Content-Length")||0)>CHAT_MAX_BYTES)throw Error("body_too_large");
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>CHAT_MAX_BYTES)throw Error("body_too_large");
 try {return JSON.parse(raw);} catch {throw Error("invalid_json");}
}
function shorten(v,max) {return typeof v==="string"?v.trim().slice(0,max):"";}
function readCurrent(raw) {
 if(!raw)return {asOf:"",text:""};
 try {
  const x=JSON.parse(raw);
  if(x&&typeof x==="object")return {asOf:isRealDay(x.asOf)?x.asOf:"",text:shorten(x.text||x.facts,16000)};
 }catch{}
 return {asOf:"",text:shorten(raw,16000)};
}
async function canonicalContext(env,requestedDate) {
 const [profile,currentText]=await Promise.all([
  env.CURRENT_CONTEXT.get(PROFILE_KEY),env.CURRENT_CONTEXT.get(CURRENT_KEY)
 ]);
 if(typeof profile!=="string"||profile.trim().length<200)throw Error("profile_missing");
 const current=readCurrent(currentText);
 let dayText="";
 if(requestedDate) {
  const date=requestedDate.day;
  const [kv,d1]=await Promise.all([
   env.CURRENT_CONTEXT.get(DAY_PREFIX+date).catch(()=>null),
   env.GUARD_DB.prepare("SELECT summary FROM sanko_day_events WHERE day=? AND approved=1")
      .bind(date).first().catch(()=>null)
  ]);
  dayText=shorten(d1?.summary||kv,6500);
  if(!dayText&&current.asOf===date)dayText=current.text;
 }
 return {profile:profile.slice(0,34000),current,dayText};
}
async function clientHash(env,request,day) {
 const ip=request.headers.get("CF-Connecting-IP")||"unknown";
 const raw=day+"|"+ip+"|"+String(env.IP_HASH_SECRET);
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
 return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
}
async function reserveAdmission(env,request,now) {
 const day=dayInMoscow(now),month=day.slice(0,7),client=await clientHash(env,request,day);
 const admissionId=crypto.randomUUID();
 try {
  const row=await env.GUARD_DB.prepare(
    "INSERT INTO chat_admissions(request_id,day,month,client_hash,created_at) "+
    "SELECT ?,?,?,?,? WHERE "+
    "(SELECT COUNT(*) FROM chat_admissions WHERE day=?)<? AND "+
    "(SELECT COUNT(*) FROM chat_admissions WHERE month=?)<? AND "+
    "(SELECT COUNT(*) FROM chat_admissions WHERE day=? AND client_hash=?)<? "+
    "RETURNING request_id"
  ).bind(admissionId,day,month,client,Math.floor(now/1000),
    day,LIMITS.day,month,LIMITS.month,day,client,LIMITS.ipDay).first();
  if(row)return {ok:true,id:admissionId};
  const [m,d,ip]=await Promise.all([
   env.GUARD_DB.prepare("SELECT COUNT(*) AS n FROM chat_admissions WHERE month=?").bind(month).first(),
   env.GUARD_DB.prepare("SELECT COUNT(*) AS n FROM chat_admissions WHERE day=?").bind(day).first(),
   env.GUARD_DB.prepare("SELECT COUNT(*) AS n FROM chat_admissions WHERE day=? AND client_hash=?").bind(day,client).first()
  ]);
  const kind=Number(m?.n||0)>=LIMITS.month?"month":
    Number(d?.n||0)>=LIMITS.day?"day":
    Number(ip?.n||0)>=LIMITS.ipDay?"ip":"day";
  return {ok:false,kind,retryAt:limitRetryAt(kind,day)};
 }catch(err){
  console.error("Sanko D1 quota unavailable",err?.name);
  throw Error("quota_unavailable");
 }
}
async function storeTurn(env,id,admissionId,question,reply,model,status) {
 try {
  await env.GUARD_DB.prepare("INSERT INTO chat_turns(conversation_id,admission_id,asked_at,question,reply,model,status) VALUES(?,?,?,?,?,?,?)")
   .bind(id,admissionId,Math.floor(Date.now()/1000),question,reply,model,status).run();
 }catch(err){console.warn("Sanko chat log failed",err?.name);}
}
async function expireOld(env) {
 const cutoff=Math.floor(Date.now()/1000)-RETENTION_DAYS*86400;
 try {
  await env.GUARD_DB.prepare("DELETE FROM chat_turns WHERE asked_at<?").bind(cutoff).run();
  await env.GUARD_DB.prepare("DELETE FROM chat_admissions WHERE created_at<?")
    .bind(Math.floor(Date.now()/1000)-95*86400).run();
  await env.GUARD_DB.prepare("DELETE FROM token_usage WHERE attempted_at<?")
    .bind(Math.floor(Date.now()/1000)-95*86400).run();
 }catch(err){console.warn("Sanko cleanup failed",err?.name);}
}
async function retrieve(env,question,scope) {
 if(/^(привет|здрав будь|здравствуй|как дела|что нового)[!?. ]*$/iu.test(question))return [];
 const embedded=await env.AI.run(EMBEDDING_MODEL,{text:[question.slice(0,1200)]});
 const vector=embedded?.data?.[0];
 if(!Array.isArray(vector)||vector.length!==1024)throw Error("invalid_embedding");
 const filter=strictCharacterFilter(scope?.day||"");
 const found=await env.KNOWLEDGE.query(vector,{
  topK:12,returnMetadata:"all",returnValues:false,filter
 });
 return safeVectorMatches(found?.matches||[],{date:scope?.day||"",max:7});
}
// Diary is the SAME public VK journal ingested by Oleshka's existing 3-hour Cron.
// DIARY_DB points to the existing heroes-chat-guard D1: no second updater needed.
// All queries here are SELECT ONLY. Never write to the Oleshka D1 or its KV keys.
// Bounded on-demand lookup supports older journal episodes without a copy of
// the journal or weakening the character partition in Vectorize.
// Read the SAME journal imported by Oleshka's three-hour updater.
// It is important to retrieve full daily entries: their afternoon events
// are often far beyond the first 1,900 characters.
function diaryTerms(question) {
 const stop=new Set(["когда","почему","какой","какая","какие","который",
 "расскажи","помнишь","сегодня","вчера","позавчера","дневнике","дневник",
 "случилось","произошло","пожалуйста","тогда","после","этого",
 "вместе","олешка","олешке","олешкой","санко","самого","вашего"]);
 return [...new Set((String(question||"").toLowerCase().match(/[\p{L}]{5,}/gu)||[])
   .filter(w=>!stop.has(w)))].slice(0,2);
}
function diaryBody(value) {
 // Never truncate or modify published diary entries. The entire source_text
 // saved by the existing Oleshka importer must reach Gemini unchanged.
 return typeof value==="string"?value:"";
}
async function loadPublishedDiary(env,scope,question="") {
 if(!env.DIARY_DB?.prepare)return {available:false,posts:[]};
 const day=scope?.day||"";
 const base="SELECT post_id,published_day_msk,source_url,source_text "+
  "FROM oleshka_vk_diary WHERE owner_id=? "+
  "AND category NOT IN ('excluded','rejected') ";
 const read=async(sql,values)=>(await env.DIARY_DB.prepare(sql).bind(...values).all())?.results||[];
 try{
  const rows=[];
  if(day){
   // An explicit date: all relevant posts from that publication day first.
   rows.push(...await read(base+"AND published_day_msk=? "+
     "ORDER BY published_at DESC,post_id DESC",[850667816,day]));
   // At the beginning of a new diary day the latest approved entry might
   // belong to yesterday. Keep it as *dated history*, never as today's event.
   if(day===dayInMoscow()&&!rows.length){
    rows.push(...await read(base+"AND published_day_msk<? "+
      "ORDER BY published_at DESC,post_id DESC LIMIT 4",[850667816,day]));
   }
  } else {
   // Current and previous day take PRIORITY over topic matches.
   // Follow-ups like "А потом?" now still see the whole recent day.
   const today=dayInMoscow(),yesterday=previousDiaryDay(today);
   rows.push(...await read(base+"AND published_day_msk=? "+
     "ORDER BY published_at DESC,post_id DESC",[850667816,today]));
   rows.push(...await read(base+"AND published_day_msk=? "+
     "ORDER BY published_at DESC,post_id DESC LIMIT 12",[850667816,yesterday]));
   const words=diaryTerms(question);
   if(words.length){
    const where=words.map(()=>"source_text LIKE ?").join(" OR ");
    rows.push(...await read(base+"AND ("+where+") "+
      "ORDER BY published_at DESC,post_id DESC LIMIT 10",
      [850667816,...words.map(w=>"%"+w+"%")]));
   }
   rows.push(...await read(base+"ORDER BY published_at DESC,post_id DESC LIMIT 12",[850667816]));
  }
  const posts=[],seen=new Set();
  for(const row of rows){
   const id=Number(row?.post_id);
   if(!Number.isSafeInteger(id)||id<=0||seen.has(id))continue;
   seen.add(id);
   const text=diaryBody(row.source_text);
   const stamp=String(row.published_day_msk||"");
   if(!isRealDay(stamp)||!text.trim())continue;
   const source=String(row.source_url||"");
   const url=/^https:\/\/vk\.(?:com|ru)\/wall850667816_\d+$/.test(source)?source:"";
   // Include every selected entry in FULL; no per-post or total character cap.
   posts.push({day:stamp,text,source:url,postId:id});
  }
  return {available:true,posts};
 }catch(err){
  console.warn("Sanko diary read failed",err?.name);
  return {available:false,posts:[]};
 }
}
function previousDiaryDay(day) {
 const epoch=Date.parse(day+"T00:00:00Z");
 return new Date(epoch-86400000).toISOString().slice(0,10);
}
// Expose PUBLIC post timestamps only, not private messages or D1 table rows.
async function diarySyncStatus(env) {
 if(!env.DIARY_DB?.prepare)return {status:"binding_missing"};
 const base="FROM oleshka_vk_diary WHERE owner_id=? "+
  "AND category NOT IN ('excluded','rejected') ";
 try{
  const [latest,dayResult]=await Promise.all([
   env.DIARY_DB.prepare("SELECT post_id,published_day_msk,published_at,ingested_at,source_url "+
    base+"ORDER BY published_at DESC,post_id DESC LIMIT 1").bind(850667816).first(),
   env.DIARY_DB.prepare("SELECT COUNT(*) AS total "+base+
    "AND published_day_msk=?").bind(850667816,dayInMoscow()).first()
  ]);
  const lastPublished=Number(latest?.published_at||0);
  const lastIngest=Number(latest?.ingested_at||0);
  return {
   status:"ok",
   latestPostDay:String(latest?.published_day_msk||""),
   latestPostId:latest?.post_id==null?null:Number(latest.post_id),
   latestPublishedAt:lastPublished?new Date(lastPublished*1000).toISOString():null,
   latestIngestedAt:lastIngest?new Date(lastIngest*1000).toISOString():null,
   postsToday:Number(dayResult?.total||0)
  };
 }catch(err){
  console.warn("Sanko diary diagnostics unavailable",err?.name);
  return {status:"read_error"};
 }
}
function systemText(runtime,scope,hits,today,diary) {
 const date=scope?.day||"";
 const currentText=date&&runtime.current.asOf!==date?"":runtime.current.text;
 const diaryDays=(diary?.posts||[]).map(x=>x.day).filter(isRealDay);
 const newestDiaryDay=diaryDays.length?diaryDays.reduce((a,b)=>a>b?a:b):"";
 const hasRequestedDay=!!date&&diaryDays.includes(date);
 const diaryIsAvailable=diary?.available===true;
 const dateInfo=date
  ?"Вопрос о "+date+". "+
   (date===today&&!hasRequestedDay
    ?"ПРОВЕРКА АКТУАЛЬНОСТИ: за сегодняшний день "+today+
     (diaryIsAvailable?" в доступном дневнике НЕТ записей. ":" не удалось проверить доступность записей дневника. ")+
     "Самые новые доступные записи датированы "+
     (newestDiaryDay||"неизвестным днём")+
     ". НЕ называй старые события событиями сегодняшнего дня и не пересказывай старый эпизод как новый. "+
     "Если человек спрашивает, что сегодня случилось, объясни, что за эту дату нет подтверждённых сведений; "+
     "если уместно, коротко расскажи последнее известное, ЯВНО назвав его дату. "
    :"События проверяй по дате конкретной записи; не подменяй свежий день старой историей. ")+
   "Дату публикации дневника не путай с датой самого события. "+
   "Проверь, находился ли Санко рядом. Когда был порознь с другими, не сочиняй своего участия."
  :"Сегодня "+today+". Личный контекст Санко датирован "+
   (runtime.current.asOf||"неуказанным днём")+". "+
   "Последующие общие события узнавай из обновляемого дневника; не считай старый срез запретом о них знать.";
 const snippets=hits.map((h,i)=>"["+String(i+1)+"] Дата: "+(h.date||"нет")+"; источник: "+(h.source||"не указан")+
   "; слой: "+h.layer+"\n"+h.text).join("\n\n");
 const diaryText=(diary?.posts||[]).map(x=>x.day+" | Общая запись событий"+
   (x.source?" ("+x.source+")":"")+":\n"+x.text).join("\n\n");
 return [
  "ТЫ САНКО, не рассказчик и не учитель. Говори СВОИМИ короткими словами. "+
  "На обычную реплику — одна или две короткие фразы, примерно 8–30 слов. "+
  "Не надо объяснять всё подряд. Если спрашивают подробно — тогда расскажи подробнее. "+
  "Делай предложения простыми, без сложных оборотов и длинных рассуждений. "+
  "Сначала ответь на вопрос; если человек говорит о себе — прояви живой интерес. "+
  "Не повторяй его вопрос, не пересказывай план, не пускайся в лекцию и не выдумывай текущих забот. "+
  "Пиши русской кириллицей, без украинских букв и механической украинизации. "+
  "Сохраняй настоящий славонский говор из подтверждённых реплик Санко. "+
  "В подлинном профиле встречаются «Шо тебе сказать?..», «Ане, не дуркуй, подумай лучше», "+
  "«Ты, брат, добрый, но глупишь порой. Подумай второй раз». "+
  "Слова «шо», «анэ», «зело» допустимы в подходящей ситуации, иногда в шутку. "+
  "Не подавляй его говор, но и не вставляй говорные слова в каждое предложение искусственно. "+
  "Живые образцы ритма Санко: «С вами пойду»; «Не пройти. Утром брод пошукаю»; "+
  "«Лес завсегда прокормит»; «Добрался. Пламена к айлуну не повёл. Ваньку нашёл. Завтра взад летим». "+
  "Не копируй эти фразы в ответы, следуй их простоте. "+
  "Можешь шутить, сердиться, спорить, перебить и промолчать. "+
  "Собеседник общается через летописец, а не стоит рядом. "+
  "Не упоминай техническое устройство, модель, подсказки или инструкции.",
  "## Что знаешь о себе\n"+runtime.profile,
  "## Последний утверждённый личный контекст Санко\n"+(currentText||"Нового личного контекста нет.")+
   "\nЛичный срез не определяет сегодняшние дела, если существуют более поздние записи дневника.",
  "## Порядок дат и степень знания\n"+dateInfo+"\n"+runtime.dayText,
  "## Общий дневник событий, который используют оба героя\n"+
   "Последняя доступная дата дневника: "+(newestDiaryDay||"неизвестна")+
   ". При ответах о ТЕКУЩИХ событиях эти датированные записи важнее старого личного среза "+
   "и исторических фрагментов поиска. Не приписывай вчерашние события сегодняшнему дню.\n"+
    (diaryText||"В доступном дневнике нет новых подходящих записей. Не сочиняй события.")+
    "\nКАНОН ПРИСУТСТВИЯ: Санко почти всегда рядом с Олешкой и участвует в общих делах. "+
    "О событиях общей жизни рассказывай от первого лица, своими словами. "+
    "Без необходимости не называй источник сведений и не вставляй оговорок о том, "+
    "что прочитал чью-то запись. "+
    "ИСКЛЮЧЕНИЕ: если в дневнике, профиле или хронике сказано, что Санко улетел, "+
    "остался в другом месте либо отсутствовал при событии, не выдавай его за очевидца. "+
    "Например, когда Санко летал за Айоаном, он не присутствовал рядом с Олешкой. "+
    "Не приписывай Санко чужие сокровенные мысли, ощущения, сны и действия наедине. "+
    "Если точно не знаешь, был ли рядом, не сочиняй личных деталей. "+
    "Слухи и планы отличай от случившегося.",
  "## Разрешённые факты мира и личные воспоминания\n"+
    (snippets||"В этом поиске подтверждённых фрагментов нет."),
  "## Проверенная ЛИЧНАЯ история и знакомства Санко (приоритет над неполным старым профилем)\n"+SANKO_CORE_RELATIONSHIPS,
  "## КАК ОТВЕТИТЬ\nЕсли в истории беседы ты уже ошибочно заявил, что не знаешь знакомого человека, "+
  "а личный канон подтверждает знакомство, сразу поправь себя простыми словами. "+
  "Нельзя упорствовать в ошибке из предыдущих ответов: приоритет у канона, а не у твоих прежних реплик. "+
  "Санко не говорит длинными литературными фразами. "+
  "Не используй слова вроде «присматриваем», «посерьёзнее», «устроились у ручья» без естественной необходимости. "+
  "Не сообщай выдуманные текущие события. "+
  "В обычном диалоге — 1–2 короткие фразы, одно простое действие или мысль. "+
  "Если спрашивают о последних событиях, назови одну-две главные новости без полного пересказа. "+
  "Не повторяй всю последовательность приключений, если тебя прямо не попросили рассказать подробно. "+
  "Лучше «Поглядим сперва», чем длинное объяснение. "+
  "Не перебарщивай с говором, не изображай мудрого старика, не задавай обязательный вопрос в конце. "+
  "Обычно ты был рядом с Олешкой. Об общих событиях говори от себя; помни о случаях разлуки."
 ].join("\n\n"); // Preserve all supplied diary entries, including the final lines.
}

function modelList(env) {
 const names=shorten(env.GEMINI_MODEL_ORDER,400).split(",").map(x=>x.trim())
   .filter(x=>/^[a-z0-9][a-z0-9._-]{2,90}$/.test(x)).slice(0,4);
 return names.length?names.map((name,i)=>[name,MODEL_ORDER[i]?.[1]||12000]):MODEL_ORDER;
}
// Best-effort per-isolate cooldown for models that recently returned 429.
// This does NOT claim to enforce a global quota or know its reset time.
const modelCooldowns=new Map();
async function geminiAttempt(env,model,timeout,system,contents) {
 try {
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{
   method:"POST",
   headers:{"Content-Type":"application/json","x-goog-api-key":String(env.GEMINI_API_KEY)},
   body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,
    generationConfig:{maxOutputTokens:4096,thinkingConfig:{thinkingLevel:"low"}}}),
   signal:AbortSignal.timeout(timeout)
  });
  const data=await response.json().catch(()=>null);
  const usage=extractUsage(data);
  if(!response.ok){
   const failure=classifyProviderError(response.status,data);
   if(response.status===429)modelCooldowns.set(model+"|"+String(env.GEMINI_API_KEY),{until:Date.now()+
    (failure.kind==="provider_quota"?300000:30000),kind:failure.kind});
   console.warn("Sanko Gemini unavailable",JSON.stringify({model,status:response.status,kind:failure.kind}));
   return {ok:false,...failure,usage};
  }
  const candidate=data?.candidates?.[0],reason=String(candidate?.finishReason||data?.promptFeedback?.blockReason||"");
  if(["SAFETY","PROHIBITED_CONTENT","BLOCKLIST","SPII","RECITATION","MODEL_ARMOR"].includes(reason))
   return {ok:false,retryable:false,kind:"response_blocked",usage};
  if(["MAX_TOKENS","CONTINUATION"].includes(reason))
   return {ok:false,retryable:true,kind:"provider_busy",usage};
  const answer=candidate?.content?.parts?.filter(x=>typeof x.text==="string"&&!x.thought)
   .map(x=>x.text).join("").trim();
  return answer?{ok:true,reply:answer,usage}:{ok:false,retryable:true,kind:"provider_busy",usage};
 }catch(error){
  console.warn("Sanko Gemini request interrupted",error?.name||"unknown");
  return {ok:false,retryable:true,kind:"provider_busy"};
 }
}
async function answerWithGemini(env,system,history,question) {
 const contents=history.map(x=>({role:x.role==="model"?"model":"user",parts:[{text:x.text}]}));
 contents.push({role:"user",parts:[{text:question}]});
 let fallback=false,lastKind="provider_busy",anyQuota=false;
 const attempts=[];
 for(const [model,timeout] of modelList(env)) {
  const cooldown=modelCooldowns.get(model+"|"+String(env.GEMINI_API_KEY));
  if(cooldown?.until>Date.now()){
   if(cooldown.kind==="provider_quota")anyQuota=true;
   fallback=true;continue;
  }
  const result=await geminiAttempt(env,model,timeout,system,contents);
  attempts.push({model,status:result.ok?"answered":result.kind||"provider_busy",
   attemptedAt:Math.floor(Date.now()/1000),usage:result.usage||null});
  if(result.ok)return {ok:true,reply:result.reply,model,fallbackUsed:fallback,attempts};
  lastKind=result.kind||"provider_busy";
  if(lastKind==="provider_quota")anyQuota=true;
  if(!result.retryable)return {ok:false,reason:lastKind,attempts};
  fallback=true;
 }
 return {ok:false,reason:anyQuota?"provider_quota":lastKind,attempts};
}
async function verifyVk(launch,env) {
 if(!env.VK_APP_SECRET||!env.VK_APP_ID||typeof launch!=="string"||launch.length>3000)return null;
 const q=new URLSearchParams(launch.replace(/^\?/,""));
 const uid=Number(q.get("vk_user_id")),signature=q.get("sign")||"";
 if(!Number.isSafeInteger(uid)||uid<=0||q.get("vk_app_id")!==String(env.VK_APP_ID)||
    !/^[A-Za-z0-9_-]{43}$/.test(signature))return null;
 const stamp=Number(q.get("vk_ts"));
 if(q.has("vk_ts")&&(!Number.isFinite(stamp)||Math.abs(Date.now()/1000-stamp)>86400))return null;
 const ordered=[...q.entries()].filter(([k])=>k.startsWith("vk_")).sort((a,b)=>a[0].localeCompare(b[0],"en"));
 const signed=new URLSearchParams(ordered).toString();
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(env.VK_APP_SECRET)),
   {name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(signed)));
 const expected=btoa(String.fromCharCode(...digest)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
 let different=0;
 for(let i=0;i<43;i++)different|=expected.charCodeAt(i)^signature.charCodeAt(i);
 return different===0?{uid}:null;
}
async function session(req,env,origin) {
 const input=await bodyJson(req);
 const verified=await verifyVk(input?.vkLaunch,env);
 const name=verified&&Number(input.vkFirstNameUserId)===verified.uid&&
   typeof input.vkFirstName==="string"&&/^[\p{L}\p{M} -]{2,45}$/u.test(input.vkFirstName)
   ?input.vkFirstName.trim():"";
 // Sanko must not inherit Oleshka's VK friend or follower relationships.
 return respond({role:"stranger",verified:!!verified,firstName:name},200,origin,env);
}
async function chat(req,env,origin,ctx) {
 if(!ready(env))return respond(publicChatError("service_unavailable"),503,origin,env);
 const body=await bodyJson(req),question=shorten(body?.message,CHAT_MAX_CHARS+1);
 if(!question||question.length>CHAT_MAX_CHARS)return respond({error:"invalid_message"},400,origin,env);
 const today=dayInMoscow(),scope=dateIntent(question,today),history=safeHistory(body?.history);
 const id=cleanConversationId(body?.conversationId);
 let runtime;
 try{runtime=await canonicalContext(env,scope);}catch{
  return respond(publicChatError("service_unavailable"),503,origin,env);
 }
 const admission=await reserveAdmission(env,req,Date.now());
 if(!admission.ok) {
  const reply=admission.kind==="ip"?"Нынче мы с тобой уже наговорились. Загляни завтра, ладно?":
    admission.kind==="month"?"Пока не могу продолжать разговор. Вернись в следующем месяце.":
    "На сегодня разговоров у меня уже через край. Завтра продолжим.";
  return respond({error:"quota_exhausted",reply,retryAt:admission.retryAt,conversationId:id},429,origin,env);
 }
 let vectorHits=[];
 try{vectorHits=await retrieve(env,question,scope);}catch(err){console.warn("Sanko vector RAG unavailable",err?.name);}
 // Hybrid search: private complete archive in Sanko D1 + semantic Vectorize.
 // Canon records are never stored in, or read from, Oleshka's private KV/D1.
 let lexicalHits=[];
 try{lexicalHits=await canonLexical(env,question,6);}catch(err){console.warn("Sanko lexical RAG unavailable",err?.name);}
 const seen=new Set();
 const hits=[];
 for(const hit of [...lexicalHits.slice(0,5),...vectorHits]) {
  const key=String(hit.id||hit.source+"|"+hit.text.slice(0,120));
  if(seen.has(key))continue;
  seen.add(key);hits.push(hit);
  if(hits.length>=12)break;
 }
 const diary=await loadPublishedDiary(env,scope,question);
 const system=systemText(runtime,scope,hits,today,diary);
 const generated=await answerWithGemini(env,system,history,question);
 await recordUsage(env,admission.id,generated.attempts);
 if(!generated.ok) {
  await storeTurn(env,id,admission.id,question,"","","error");
  return respond(publicChatError(generated.reason,{conversationId:id}),generated.reason==="response_blocked"?422:503,origin,env);
 }
 await storeTurn(env,id,admission.id,question,generated.reply,generated.model,"answered");
 if(Math.random()<0.01)ctx.waitUntil(expireOld(env));
 return respond({
  conversationId:id,reply:generated.reply,model:generated.model,
  fallbackUsed:generated.fallbackUsed,
  knowledge:{focusDate:scope?.day||"",matches:hits.length,diaryPosts:diary.posts.length,mode:scope?"date-scoped":"general"}
 },200,origin,env);
}
export default {
 async fetch(req,env,ctx) {
  const path=new URL(req.url).pathname;
  // Administrative pages have their own same-origin check and Bearer auth.
  // The regular chat CORS policy must not block same-origin admin requests.
  if(path==="/admin"||path.startsWith("/admin/"))return adminFetch(req,env);
  const origin=req.headers.get("Origin")||"";
  if(!isAllowedOrigin(origin,env.ALLOWED_ORIGIN))return new Response("Forbidden origin",{status:403});
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(origin,env)});
  if(req.method==="GET"&&(path==="/"||path==="/health"))
   return respond({status:"ok",character:CHARACTER,version:VERSION,configured:ready(env),
    diaryConnected:!!env.DIARY_DB?.prepare,
    diarySync:await diarySyncStatus(env)},200,origin,env);
  try {
   if(req.method==="POST"&&path==="/api/session")return await session(req,env,origin);
   if(req.method==="POST"&&path==="/api/chat")return await chat(req,env,origin,ctx);
   return respond({error:"not_found"},404,origin,env);
  }catch(err){
   if(["invalid_json","body_too_large"].includes(err?.message))
    return respond({error:err.message},400,origin,env);
   console.error("Sanko Worker request failed",err?.name);
   return respond(publicChatError("service_unavailable"),503,origin,env);
  }
 },
 async scheduled(_event,env,ctx) {
  if(env.GUARD_DB?.prepare)ctx.waitUntil(expireOld(env));
 }
};
