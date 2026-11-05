import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { dayInMoscow } from "../src/lib.js";

const URL="https://sanko-chat-api.example/api/chat";
function envStub(opts={}) {
 const observed={queries:[],gemini:[],insertions:[],kv:[],usageInserts:[]};
 const env={
  GEMINI_API_KEY:"FAKE_TEST_KEY_NOT_REAL_"+crypto.randomUUID(),
  IP_HASH_SECRET:"FAKE_PEPPER_NOT_REAL",
  AI:{run:async(_model,_body)=>({data:[Array(1024).fill(.001)]})},
  KNOWLEDGE:{query:async(_vector,opts)=>{
    observed.queries.push(opts);
    return {matches:[
      {score:.99,metadata:{character:"oleshka",date:"2026-10-31",text:"Oleshka private"}},
      {score:.88,metadata:{character:"sanko",date:"2026-10-31",text:"Sanko witnessed"}},
    ]};
  }},
  CURRENT_CONTEXT:{get:async(key)=>{
    observed.kv.push(key);
    if(opts.noProfile && key==="sanko:profile:v1")return null;
    if(key==="sanko:profile:v1")return "Approved personal profile of Sanko. ".repeat(12);
    if(key==="sanko:current:v1")return JSON.stringify({asOf:"2026-10-31",text:"Approved snapshot."});
    return null;
  }},
  GUARD_DB:{prepare:(sql)=>({
    bind(...params){this.params=params;return this;},
    async first(){
      if(sql.includes("INSERT INTO chat_admissions")){
        observed.insertions.push(this.params);
        return opts.quotaExhausted?null:{request_id:"quota-approved"};
      }
      if(sql.includes("SELECT COUNT(*)")){
        if(sql.includes("month=?"))return {n:opts.quotaExhausted?15000:0};
        return {n:0};
      }
      return null;
    },
    async run(){if(sql.includes("INSERT INTO token_usage"))observed.usageInserts.push({sql,values:this.params});return {success:true};}
  })}
 };
 if(opts.diary) {
  env.DIARY_DB={prepare:(sql)=>{
    observed.diarySql=sql;
    return {bind(...params){observed.diaryParams=params;return this;},
      async all(){return {results:opts.diaryPosts||[{
        post_id:12345,owner_id:850667816,published_day_msk:"2026-10-31",
        source_url:"https://vk.com/wall850667816_12345",
        source_text:"Олешка написал в дневнике: перелетели Стену."
      }]};}};
  }};
 }
 return {env,observed};
}
function req(message,extraHeaders={}) {
 return new Request(URL,{method:"POST",headers:{
  Origin:"https://socman2023.github.io","Content-Type":"application/json",
  "CF-Connecting-IP":"198.51.100.10",...extraHeaders
 },body:JSON.stringify({message,history:[],conversationId:"123e4567-e89b-42d3-a456-426614174000"})});
}
const ctx={waitUntil(p){p.catch(()=>{});}};
test("GET health identifies Sanko and not Oleshka",async()=>{
 const r=await worker.fetch(new Request("https://sanko-chat-api.example/"),{},ctx);
 const data=await r.json();assert.equal(r.status,200);assert.equal(data.character,"sanko");
 assert.match(data.version,/sanko-worker/);
});
test("untrusted website origin is forbidden before API work",async()=>{
 const {env}=envStub();
 const r=await worker.fetch(req("Привет",{Origin:"https://evil.example"}),env,ctx);
 assert.equal(r.status,403);
});
test("missing approved profile returns 503 without charging quota",async()=>{
 const {env,observed}=envStub({noProfile:true});
 const r=await worker.fetch(req("Привет"),env,ctx);
 assert.equal(r.status,503);assert.equal(observed.insertions.length,0);
});
test("successful reply isolates profile, Vectorize and date",async()=>{
 const {env,observed}=envStub();
 const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{observed.gemini.push({
   url,
   system:JSON.parse(init.body).systemInstruction.parts[0].text
  });return new Response(JSON.stringify({
  candidates:[{finishReason:"STOP",content:{parts:[{text:"Про то я тебе и расскажу."}]}}]
 }),{status:200,headers:{"Content-Type":"application/json"}});};
 try{
  const r=await worker.fetch(req("Что было 31 октября 2026?"),env,ctx);
  assert.equal(r.status,200);
  const response=await r.json();
  assert.equal(response.reply,"Про то я тебе и расскажу.");
  assert.equal(response.knowledge.matches,1);
  assert.equal(response.knowledge.focusDate,"2026-10-31");
  assert.deepEqual(observed.queries[0].filter.character.$in,["shared","sanko"]);
  assert.equal(observed.queries[0].filter.date.$gte,"2026-10-31");
  assert.equal(observed.insertions.length,1);
  assert(observed.kv.includes("sanko:profile:v1"));
  assert(!observed.kv.some(x=>x.startsWith("oleshka:")));
  const instructions=observed.gemini[0].system;
  assert.match(instructions,/одна или две короткие фразы/);
  assert.match(instructions,/примерно 8–30 слов/);
  assert.match(instructions,/Говор у тебя свой, привычный с детства/);
  assert.match(instructions,/ОБЯЗАТЕЛЬНО ДЛЯ СОБСТВЕННОЙ РЕЧИ/);
  for(const word of ["шо","як","якой","токмо","тока","энто","энтот","ежли","тута","хто","куды"])
   assert(instructions.toLowerCase().includes(word),"Missing canon/author-approved form: "+word);
  assert.match(instructions,/Ты шо, дырку протереть хошь/);
  assert.match(instructions,/Про Тариба-то писать будете\? Як живет, шо творит/);
  assert(!instructions.includes("Слова «шо», «анэ», «зело» допустимы в подходящей ситуации, иногда в шутку"));
  assert(!instructions.includes("Не перебарщивай с говором"));
  assert.match(instructions,/Как разговаривает Санко/);
  assert.match(instructions,/Обычно ты был рядом с Олешкой/);
  assert.match(instructions,/Не сообщай выдуманные текущие события/);
  assert(!instructions.includes("Олешка написал в дневнике: перелетели Стену."));

 }finally{globalThis.fetch=original;}
});
test("monthly quota returns 429 without calling Gemini",async()=>{
 const {env}=envStub({quotaExhausted:true});
 const r=await worker.fetch(req("Расскажи про лес"),env,ctx);
 assert.equal(r.status,429);
 const data=await r.json();
 assert.equal(data.error,"quota_exhausted");
 assert(Number.isFinite(data.retryAt));
});

test("Sanko can read Oleshka's published diary read-only, without changing his D1",async()=>{
 const {env,observed}=envStub({diary:true});
 const nativeFetch=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
   observed.gemini.push({system:JSON.parse(init.body).systemInstruction.parts[0].text});
   return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
     content:{parts:[{text:"Олешка написал, что Стену перелетели. Я тоже там был."}]}}]}),
     {status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
   const r=await worker.fetch(req("А про 31 октября Олешка что написал?"),env,ctx);
   assert.equal(r.status,200);
   assert.match(observed.diarySql,/FROM oleshka_vk_diary/);
   assert.match(observed.diarySql,/^SELECT/);
   assert(!/\b(UPDATE|DELETE|INSERT)\b/i.test(observed.diarySql));
   assert.deepEqual(observed.diaryParams,[850667816,"2026-10-31"]);
   assert.match(observed.gemini[0].system,/Олешка написал в дневнике: перелетели Стену/);
   assert.match(observed.gemini[0].system,/Санко почти всегда рядом с Олешкой/);
   assert.match(observed.gemini[0].system,/улетел/);
   assert.match(observed.gemini[0].system,/Без необходимости не называй источник сведений/);
   assert.equal(observed.insertions.length,1);
 }finally{globalThis.fetch=nativeFetch;}
});

test("Undated query consults older published diary entries by topic and latest posts",async()=>{
 const {env,observed}=envStub({diary:true});
 const requests=[];
 const base=env.DIARY_DB.prepare;
 env.DIARY_DB.prepare=(sql)=>{
   const stmt=base(sql);
   const bind=stmt.bind;
   stmt.bind=function(...values){
     requests.push({sql,values});
     return bind.apply(this,values);
   };
   return stmt;
 };
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
   observed.gemini.push({system:JSON.parse(init.body).systemInstruction.parts[0].text});
   return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"Помню. Разберёмся."}]}}]}),
     {status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
  const r=await worker.fetch(req("А что там было с Мстиславом?"),env,ctx);
  assert.equal(r.status,200);
  assert.equal(requests.length,2,"Latest diary plus topic only: no bulk yesterday loading");
  assert(requests.every(x=>x.sql.startsWith("SELECT ")));
  assert(requests.every(x=>!/\b(?:UPDATE|DELETE|INSERT)\b/i.test(x.sql)));
  assert.match(requests[0].sql,/LIMIT 2/);
  assert.deepEqual(requests[0].values,[850667816]);
  assert.match(requests[1].sql,/source_text LIKE/);
  assert.deepEqual(requests[1].values,[850667816,"%мстиславом%"]);
  assert.equal((await r.json()).knowledge.diaryPosts,1);
 }finally{globalThis.fetch=oldFetch;}
});

test("Today diary includes morning plus afternoon, including text beyond 1900 chars",async()=>{
 const today=dayInMoscow();
 const afternoon="ПОСЛЕ ОБЕДА КНЯЖИЧ ВЕРНУЛСЯ ОТ КУПЦА, И ВЫЯСНИЛОСЬ НОВОЕ.";
 const {env,observed}=envStub({diary:true,diaryPosts:[
  {post_id:2002,owner_id:850667816,published_day_msk:today,
   source_url:"https://vk.com/wall850667816_2002",source_text:"А после обеда: "+afternoon},
  {post_id:2001,owner_id:850667816,published_day_msk:today,
   source_url:"https://vk.com/wall850667816_2001",source_text:"Утро. "+"Переговоры длились. ".repeat(130)+afternoon}
 ]});
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  observed.gemini.push({system:JSON.parse(init.body).systemInstruction.parts[0].text});
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
    content:{parts:[{text:"Вернулся княжич от купца. Теперь решаем, что дальше."}]}}]}),
    {status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
  const r=await worker.fetch(req("А потом?"),env,ctx);
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.knowledge.diaryPosts,2);
  const prompt=observed.gemini[0].system;
  assert(prompt.includes(afternoon));
  assert(prompt.includes("Переговоры длились."));
  assert(prompt.includes("wall850667816_2002"));
  assert(prompt.includes("wall850667816_2001"));
 }finally{globalThis.fetch=original;}
});

test("Entire published posts reach Gemini: 6k, 15k, >16k and >62k total",async()=>{
 const today=dayInMoscow();
 const makePost=(id,prefix,len,tail)=>({
   post_id:id, owner_id:850667816, published_day_msk:today,
   source_url:"https://vk.com/wall850667816_"+id,
   source_text:prefix+"X".repeat(len-prefix.length-tail.length)+tail
 });
 // The Olleshka importer's usual posts are 5–6k; these longer fixtures
 // prevent any future arbitrary source or aggregate cut at 16k/30k/62k.
 const p1=makePost(3001,"Утром: ",6000,"КОНЕЦ_УТРА_3001");
 const p2=makePost(3002,"После обеда: ",15500,"КОНЕЦ_ДНЯ_3002");
 const p3=makePost(3003,"Вечером: ",21000,"КОНЕЦ_ВЕЧЕРА_3003");
 const p4=makePost(3004,"Поздно вечером: ",24000,"КОНЕЦ_ПОЗДНО_3004");
 const all=[p4,p3,p2,p1];
 const {env,observed}=envStub({diary:true,diaryPosts:all});
 const priorFetch=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
   observed.gemini.push({system:JSON.parse(init.body).systemInstruction.parts[0].text});
   return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
     content:{parts:[{text:"Княжич вернулся. Дела сделали."}]}}]}),
     {status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
   const r=await worker.fetch(req("А потом?"),env,ctx);
   assert.equal(r.status,200);
   const data=await r.json();
   assert.equal(data.knowledge.diaryPosts,4);
   const prompt=observed.gemini[0].system;
   for(const post of all) {
     assert(prompt.includes(post.source_text), "Post "+post.post_id+" must survive verbatim");
     assert(prompt.includes("wall850667816_"+post.post_id));
   }
   assert(prompt.length>62000,"All diary content must survive old 62k prompt ceiling");
   assert(!prompt.includes("Средняя часть длинной публикации пропущена"));
 }finally{globalThis.fetch=priorFetch;}
});


test("model fallback after 429: primary overloaded, first reserve succeeds",async()=>{
 const {env,observed}=envStub();
 env.GEMINI_MODEL_ORDER="gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3.8-flash";
 const calls=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{
  const model=String(url).split("/models/")[1].split(":")[0];
  calls.push({model,body:JSON.parse(init.body)});
  if(calls.length===1)return new Response(JSON.stringify({error:{code:429,status:"RESOURCE_EXHAUSTED"}}),
   {status:429,headers:{"Content-Type":"application/json"}});
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"Я тут. Скажи, чего хотел?"}]}}]}),
   {status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
  const response=await worker.fetch(req("Здрав будь, Санко."),env,ctx);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.model,"gemini-3.1-flash-lite");
  assert.equal(data.fallbackUsed,true);
  assert.equal(data.reply,"Я тута. Скажи, чего хотел?");
  assert.deepEqual(calls.map(x=>x.model),["gemini-3.5-flash-lite","gemini-3.1-flash-lite"]);
  assert.deepEqual(calls[0].body.systemInstruction,calls[1].body.systemInstruction);
  assert.deepEqual(calls[0].body.contents,calls[1].body.contents);
  assert.equal(observed.insertions.length,1,"Fallback must consume one Sanko admission");
 }finally{globalThis.fetch=original;}
});

test("Gemini model-not-found (HTTP 404) falls back to the next configured model",async()=>{
 const {env,observed}=envStub(),calls=[];
 const previous=globalThis.fetch;
 globalThis.fetch=async url=>{
  const model=String(url).split("/models/")[1].split(":")[0];
  calls.push(model);
  if(calls.length===1)return new Response(JSON.stringify({error:{status:"NOT_FOUND"}}),{status:404});
  return new Response(JSON.stringify({candidates:[{
   finishReason:"STOP",content:{parts:[{text:"Здрав будь!"}]}
  }]}),{status:200});
 };
 try{
  const response=await worker.fetch(req("Привет, Санко"),env,ctx);
  assert.equal(response.status,200);
  const answer=await response.json();
  assert.equal(answer.model,"gemini-3.1-flash-lite");
  assert.equal(answer.fallbackUsed,true);
  assert.deepEqual(calls,["gemini-3.5-flash-lite","gemini-3.1-flash-lite"]);
  assert.equal(observed.usageInserts[0].values[4],"model_unavailable:404");
  assert.equal(observed.usageInserts[1].values[4],"answered");
  assert.equal(observed.insertions.length,1,"One message must use one admission");
 }finally{globalThis.fetch=previous;}
});
test("Gemini invalid payload and access denial do not spend fallback calls",async()=>{
 for(const httpStatus of [400,401,403]){
  const {env,observed}=envStub();
  let calls=0;
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>{
   calls++;
   return new Response(JSON.stringify({error:{status:httpStatus===400?"INVALID_ARGUMENT":"PERMISSION_DENIED"}}),{status:httpStatus});
  };
  try{
   const response=await worker.fetch(req("Здрав будь, Санко"),env,ctx);
   assert.equal(response.status,503);
   const expected=httpStatus===400?"provider_invalid_request":"provider_auth";
   assert.equal((await response.json()).error,expected);
   assert.equal(calls,1,"Non-retryable HTTP "+httpStatus+" must not cascade");
   assert.equal(observed.usageInserts[0].values[4],expected+":"+httpStatus);
  }finally{globalThis.fetch=previous;}
 }
});

test("fallback steps through transient error, empty and truncated replies to fourth model",async()=>{
 const {env,observed}=envStub();
 env.GEMINI_MODEL_ORDER="gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3.8-flash";
 const calls=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(url)=>{
  const model=String(url).split("/models/")[1].split(":")[0];
  calls.push(model);
  if(calls.length===1)return new Response(JSON.stringify({error:{code:503}}),{status:503});
  if(calls.length===2)return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[]}}]}),{status:200});
  if(calls.length===3)return new Response(JSON.stringify({candidates:[{finishReason:"MAX_TOKENS",content:{parts:[{text:"Only start"}]}}]}),{status:200});
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:"Ага. Разберёмся."}]}}]}),{status:200});
 };
 try{
  const response=await worker.fetch(req("Как дела?"),env,ctx);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.model,"gemini-3.8-flash");
  assert.equal(data.fallbackUsed,true);
  assert.deepEqual(calls,["gemini-3.5-flash-lite","gemini-3.1-flash-lite",
   "gemini-3.6-flash","gemini-3.8-flash"]);
  assert.equal(observed.insertions.length,1);
 }finally{globalThis.fetch=original;}
});

test("safety-blocked reply is not bypassed via fallback",async()=>{
 const {env}=envStub();
 env.GEMINI_MODEL_ORDER="gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3.8-flash";
 const calls=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(url)=>{
  calls.push(String(url));
  return new Response(JSON.stringify({candidates:[{finishReason:"SAFETY",content:{parts:[]}}]}),{status:200});
 };
 try{
  const response=await worker.fetch(req("Как поживаешь?"),env,ctx);
  assert.equal(response.status,422);
  assert.equal((await response.json()).error,"response_blocked");
  assert.equal(calls.length,1,"Do not hop models to bypass a safety block");
 }finally{globalThis.fetch=original;}
});

test("sanko personal relationships appear even without archive search",async()=>{
 const {env,observed}=envStub();
 env.KNOWLEDGE.query=async()=>({matches:[]});
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  observed.gemini.push({system:JSON.parse(init.body).systemInstruction.parts[0].text});
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"Помню Луну."}]}}]}),{status:200});
 };
 try{
  const response=await worker.fetch(req("А Ясмин?"),env,ctx);
  assert.equal(response.status,200);
  const prompt=observed.gemini[0].system;
  for(const name of ["ЯСМИН = ЛУНА","БРОМ","ХАСИМ","СИЛЬВАРИЯ",
    "РАДКО И РАМЕН","РАДА","СИНЕОКА","АНАСТАСИЙ","ТРОШКА",
    "ВЛАСТОЯР","ОЛЕШКА","РАТША","ЯРКО","АЙОАН","РУМАН","ЭЛИНА"])
   assert(prompt.includes(name),"Missing Sanko's relation: "+name);
  assert(prompt.includes("01.08.2026"));
  assert(prompt.includes("wall850667816_25792"));
 }finally{globalThis.fetch=original;}
});

test("late diary context preserves historical Sanko memory",async()=>{
 const {env,observed}=envStub({diary:true,diaryPosts:[{
  post_id:4001,published_day_msk:dayInMoscow(),
  source_url:"https://vk.com/wall850667816_4001",
  source_text:"Начало. "+"Большая запись. ".repeat(4500)+"КОНЕЦ ЗАПИСИ."
 }]});
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  observed.gemini.push(JSON.parse(init.body).systemInstruction.parts[0].text);
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"Помню."}]}}]}),{status:200});
 };
 try{
  const response=await worker.fetch(req("Кто такая Луна?"),env,ctx);
  assert.equal(response.status,200);
  assert(observed.gemini[0].includes("КОНЕЦ ЗАПИСИ."));
  assert(observed.gemini[0].includes("ЯСМИН = ЛУНА"));
 }finally{globalThis.fetch=original;}
});

test("provider quota is explained in Sanko's own words, never with Gemini details",async()=>{
 const {env}=envStub();
 const attempted=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(url)=>{
  attempted.push(String(url));
  return new Response(JSON.stringify({error:{code:429,status:"RESOURCE_EXHAUSTED",
   message:"QUOTA_EXCEEDED: API key limits",
   details:[{"@type":"type.googleapis.com/google.rpc.QuotaFailure",violations:[{subject:"per_day"}]}]
  }}),{status:429,headers:{"Content-Type":"application/json"}});
 };
 try{
  const response=await worker.fetch(req("Расскажи про родных"),env,ctx);
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.error,"provider_quota");
  assert.equal(typeof body.reply,"string");
  assert(body.reply.includes("загляни"));
  assert(!/quota|Gemini|API|RESOURCE|HTTP|429/i.test(body.reply));
  assert.equal(attempted.length,4,"Backup models attempted only once each");
  assert.equal(body.retryAt,undefined,"No invented provider reset time");
 }finally{globalThis.fetch=original;}
});

test("non-JSON upstream Gemini outage never leaks technical information to visitor",async()=>{
 const {env}=envStub();
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response("<html>Cloudflare 503 origin error</html>",
  {status:503,headers:{"Content-Type":"text/html"}});
 try{
  const result=await worker.fetch(req("Как там дела?"),env,ctx);
  assert.equal(result.status,503);
  const body=await result.json();
  assert.equal(body.error,"provider_busy");
  assert(body.reply.includes("загляни"));
  assert(!body.reply.includes("Cloudflare"));
 }finally{globalThis.fetch=original;}
});

test("model-specific quota cooldown avoids immediate repeated Gemini calls",async()=>{
 const {env}=envStub();
 let calls=0;
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{
  calls++;
  return new Response(JSON.stringify({error:{status:"RESOURCE_EXHAUSTED"}}),{status:429});
 };
 try{
  let response=await worker.fetch(req("Расскажи про богов"),env,ctx);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,"provider_quota");
  assert.equal(calls,4);
  response=await worker.fetch(req("Расскажи про других богов"),env,ctx);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,"provider_quota");
  assert.equal(calls,4,"Do not contact any model during short local cooldown");
 }finally{globalThis.fetch=original;}
});


test("Gemini usageMetadata is recorded for each actual attempt including fallback",async()=>{
 const {env,observed}=envStub();
 const original=globalThis.fetch,models=[];
 globalThis.fetch=async url=>{
  models.push(String(url).split("/models/")[1].split(":")[0]);
  if(models.length===1)return new Response(JSON.stringify({
   error:{status:"RESOURCE_EXHAUSTED",message:"test"}}),{status:429});
  return new Response(JSON.stringify({
   candidates:[{finishReason:"STOP",content:{parts:[{text:"Здрав будь!"}]}}],
   usageMetadata:{promptTokenCount:4500,candidatesTokenCount:22,thoughtsTokenCount:3,
    cachedContentTokenCount:200,totalTokenCount:4525}
  }),{status:200});
 };
 try{
  const r=await worker.fetch(req("Расскажи о себе"),env,ctx);
  assert.equal(r.status,200);
  assert.equal(observed.usageInserts.length,2);
  assert.deepEqual(models,["gemini-3.5-flash-lite","gemini-3.1-flash-lite"]);
  const a=observed.usageInserts[0].values,b=observed.usageInserts[1].values;
  assert.equal(a[3],"gemini-3.5-flash-lite");
  assert.equal(a[4],"provider_quota");
  assert.equal(a[9],null,"Missing metadata must not be counted as zero");
  assert.equal(b[3],"gemini-3.1-flash-lite");
  assert.equal(b[4],"answered");
  assert.deepEqual(b.slice(5),[4500,22,3,200,4525]);
  assert(!JSON.stringify(observed.usageInserts).includes("Расскажи о себе"),
   "Usage log stores no conversation texts");
 }finally{globalThis.fetch=original;}
});

test("Gemini safety-blocked attempt accounts for available usage",async()=>{
 const {env,observed}=envStub();
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({
  candidates:[{finishReason:"SAFETY",content:{parts:[]}}],
  usageMetadata:{promptTokenCount:11,totalTokenCount:11}
 }),{status:200});
 try{
  const r=await worker.fetch(req("Вопрос"),env,ctx);
  assert.equal(r.status,422);
  assert.equal(observed.usageInserts.length,1);
  assert.equal(observed.usageInserts[0].values[4],"response_blocked");
  assert.equal(observed.usageInserts[0].values[9],11);
 }finally{globalThis.fetch=original;}
});

test("missing token_usage table does not break character chat",async()=>{
 const {env}=envStub();
 const old=env.GUARD_DB.prepare,original=globalThis.fetch;
 env.GUARD_DB.prepare=sql=>{
  if(sql.includes("INSERT INTO token_usage"))throw Error("no such table");
  return old(sql);
 };
 globalThis.fetch=async()=>new Response(JSON.stringify({
  candidates:[{finishReason:"STOP",content:{parts:[{text:"Здрав будь!"}]}}],
  usageMetadata:{promptTokenCount:9,totalTokenCount:12}
 }),{status:200});
 try{
  const r=await worker.fetch(req("Привет"),env,ctx);
  assert.equal(r.status,200);
  assert.equal((await r.json()).reply,"Здрав будь!");
 }finally{globalThis.fetch=original;}
});


test("Sanko never presents the previous diary day as events of today after midnight",async()=>{
 const {env,observed}=envStub();
 const today=dayInMoscow();
 const yesterday=new Date(Date.parse(today+"T00:00:00Z")-86400000).toISOString().slice(0,10);
 const entries=[];
 env.DIARY_DB={prepare(sql){return {
   bind(...params){this.params=params;return this;},
   async all(){
    entries.push({sql,params:this.params});
    if(sql.includes("published_day_msk=?"))return {results:[]};
    if(sql.includes("published_day_msk<?"))return {results:[{
     post_id:52024,published_day_msk:yesterday,published_at:Date.now()/1000-20000,
     source_url:"https://vk.ru/wall850667816_52024",
     source_text:"Вчера произошло новое событие: повозка уехала в город."
    }]};
    return {results:[]};
   }
 };}};
 const old=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  observed.gemini.push(JSON.parse(init.body).systemInstruction.parts[0].text);
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"За нынешний день ещё ничего нового не слыхал."}]}}]}),{status:200});
 };
 try{
  const result=await worker.fetch(req("Расскажи, что сегодня случилось?"),env,ctx);
  assert.equal(result.status,200);
  assert(entries.some(x=>x.sql.includes("published_day_msk<?")),
   "When today's diary is empty, retrieve the latest dated entry");
  const prompt=observed.gemini[0];
  assert(prompt.includes("ВНУТРЕННИЙ ОРИЕНТИР"));
  assert(prompt.includes("Последние подтверждённые события относятся к "+yesterday));
  assert(prompt.includes("Не приписывай их нынешнему дню"));
  assert(prompt.includes("Вчера произошло новое событие"));
  assert(!prompt.includes("ЯВНО назвав его дату"));
 }finally{globalThis.fetch=old;}
});

test("a verified current-day diary entry remains first priority",async()=>{
 const {env,observed}=envStub();
 const today=dayInMoscow();
 env.DIARY_DB={prepare(sql){return {
   bind(){return this;},
   async all(){
    if(sql.includes("published_day_msk=?"))return {results:[{
     post_id:62024,published_day_msk:today,source_url:"https://vk.ru/wall850667816_62024",
     source_text:"Сегодня утром нашли письмо для Румана."
    }]};
    if(sql.includes("published_day_msk<?"))throw Error("Yesterday fallback must not run with fresh diary");
    return {results:[]};
   }
 };}};
 const old=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  observed.gemini.push(JSON.parse(init.body).systemInstruction.parts[0].text);
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"Письмо нынче нашли."}]}}]}),{status:200});
 };
 try{
  const result=await worker.fetch(req("Что сегодня было?"),env,ctx);
  assert.equal(result.status,200);
  const prompt=observed.gemini[0];
  assert(prompt.includes("Сегодня утром нашли письмо для Румана."));
  assert(!prompt.includes("За нынешний день свежих записей пока нет"));
 }finally{globalThis.fetch=old;}
});

test("Sanko uses short default replies while retaining dialect and detailed-on-request option",async()=>{
 const {env,observed}=envStub();
 const old=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  observed.gemini.push(JSON.parse(init.body).systemInstruction.parts[0].text);
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"Здрав будь!"}]}}]}),{status:200});
 };
 try{
  const result=await worker.fetch(req("Ты как?"),env,ctx);
  assert.equal(result.status,200);
  const system=observed.gemini[0];
  assert(system.includes("8–30 слов"));
  assert(system.includes("1–2 короткие фразы"));
  assert(system.includes("Если спрашивают подробно — тогда расскажи подробнее"));
  assert(system.includes("Не повторяй всю последовательность приключений"));
  assert(system.includes("Как разговаривает Санко"));
  assert(system.includes("Ты Санко, славонский мальчишка"));
  assert(system.includes("СНАЧАЛА скажи понятную мысль"));
  assert(system.includes("Если нужное значение есть в авторском перечне"));
  assert(!system.includes("не вставляй «шо» и «як» нарочно"));
 }finally{globalThis.fetch=old;}
});

test("dates or admin phrases returned by Gemini never reach Sanko visitor",async()=>{
 const {env}=envStub();
 const before=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({
  candidates:[{finishReason:"STOP",content:{parts:[{
   text:"За энту дату нема новостей. Последние события 4 ноября 2026."
  }]}}]
 }),{status:200});
 try {
  const result=await worker.fetch(req("Что сегодня было?"),env,ctx);
  assert.equal(result.status,200);
  const data=await result.json();
  assert(!data.reply.includes("дату"));
  assert(!data.reply.includes("ноября"));
  assert(!data.reply.includes("2026"));
  assert.match(data.reply,/Покуда/);
 } finally {globalThis.fetch=before;}
});


test("a naturally short Sanko reply causes no extra token-consuming rewrite",async()=>{
 const {env,observed}=envStub();
 const prev=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{
  calls++;
  return new Response(JSON.stringify({
   candidates:[{finishReason:"STOP",content:{parts:[{text:"Надо посмотреть."}]}}],
   usageMetadata:{promptTokenCount:21,candidatesTokenCount:4,totalTokenCount:25}
  }),{status:200});
 };
 try {
  const r=await worker.fetch(req("Санко, шо там?"),env,ctx);
  assert.equal(r.status,200);
  assert.equal((await r.json()).reply,"Надо посмотреть.");
  assert.equal(calls,1);
  assert.equal(observed.usageInserts.length,1);
 }finally{globalThis.fetch=prev;}
});


test("Sanko sends ONLY real conversation turns; canonical quotes stay in the system voice profile",async()=>{
 const {env,observed}=envStub();
 const old=globalThis.fetch,requests=[];
 globalThis.fetch=async(_,init)=>{
  requests.push(JSON.parse(init.body));
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{
   parts:[{text:"Здрав будь, брат."}]
  }}],usageMetadata:{promptTokenCount:250,candidatesTokenCount:5,totalTokenCount:255}}),{status:200});
 };
 try{
  const r=await worker.fetch(req("Ну расскажи шо-нибудь."),env,ctx);
  assert.equal(r.status,200);
  assert.equal(requests.length,1,"No extra editorial Gemini calls");
  const contents=requests[0].contents;
  assert.equal(contents.length,1,"Do not send synthetic exchanges to Gemini");
  assert.deepEqual(contents[0],{role:"user",parts:[{text:"Ну расскажи шо-нибудь."}]});
  assert(!JSON.stringify(contents).includes("Только образец манеры речи"));
  assert.match(requests[0].systemInstruction.parts[0].text,/Ты шо, дырку протереть хошь/);
  assert.equal(requests[0].generationConfig.temperature,0.4);
  assert.equal(observed.usageInserts.length,1);
 }finally{globalThis.fetch=old;}
});


test("live chat normalizes all approved Sanko words before reply and storage",async()=>{
 const {env,observed}=envStub();
 const before=globalThis.fetch;let calls=0;
 const raw="Что это? Какой выбор? Только если кто там. Куда и как? Этот тут, а меня здесь нет. Мне этих людей каждый день видеть? Хочешь?";
 const expected="Шо энто? Якой выбор? Тока ежли хто тама. Куды и як? Энтот тута, а мя тута нема. Мене энтих людей кажный день видеть? Хошь?";
 globalThis.fetch=async()=>{
  calls++;
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:raw}]}}],
   usageMetadata:{promptTokenCount:100,candidatesTokenCount:48,totalTokenCount:148}}),{status:200});
 };
 try{
  const r=await worker.fetch(req("Санко, чего скажешь?"),env,ctx);
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.reply,expected);
  assert.equal(calls,1,"No additional calls, Free Tier preserved");
  assert.equal(observed.usageInserts.length,1);
  assert.equal(observed.usageInserts[0].values[9],148);
 }finally{globalThis.fetch=before;}
});

test("a single next-turn reply must not regress to literary pronouns",async()=>{
 const {env}=envStub(),original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[
  {text:"Ну, здрав будь. Как у тебя дела? Это я только спросить хотел."}
 ]}}]}),{status:200});
 try{
  const r=await worker.fetch(req("Привет, Санко!"),env,ctx);
  assert.equal(r.status,200);
  assert.equal((await r.json()).reply,"Ну, здрав будь. Як у тебя дела? Энто я тока спросить хотел.");
 }finally{globalThis.fetch=original;}
});

test("real Sanko chat corrects screenshot redundancy and new mandatory time forms",async()=>{
 const {env,observed}=envStub(),original=globalThis.fetch;
 let requests=0;
 globalThis.fetch=async()=>{
  requests++;
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{
   text:"Энто воры туташние нас ночлегом приютили. Сидим в складе у реки, ноги до сих пор дрожат после погони."
  }]}}],usageMetadata:{promptTokenCount:170,candidatesTokenCount:29,totalTokenCount:199}}),{status:200});
 };
 try{
  const response=await worker.fetch(req("А шо у вас было?"),env,ctx);
  assert.equal(response.status,200);
  const answer=(await response.json()).reply;
  assert.equal(answer,"Воры туташние нас приютили. Сидим в складе у реки, ноги досель дрожат опосля погони.");
  assert.equal(requests,1,"No extra Free Tier API call");
  assert.equal(observed.usageInserts.length,1,"Token usage still recorded once");
 }finally{globalThis.fetch=original;}
});
test("real Sanko chat does not append decorative тута after a flight",async()=>{
 const {env}=envStub(),original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({
  candidates:[{finishReason:"STOP",content:{parts:[{text:"Еле удрали тута!"}]}}]
 }),{status:200});
 try{
  const r=await worker.fetch(req("Как вы убежали?"),env,ctx);
  assert.equal(r.status,200);
  assert.equal((await r.json()).reply,"Еле удрали!");
 }finally{globalThis.fetch=original;}
});

test("live conversation contract removes invented official and mistaken person ending",async()=>{
 const {env}=envStub(),original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({
  candidates:[{finishReason:"STOP",content:{parts:[
   {text:"Купчик на нас донес, будто мы его обмануть хошь. Чинуша со стражей заявился, ну мы и дали деру."}
  ]}}]
 }),{status:200});
 try{
  const r=await worker.fetch(req("А почему за вами погнались?"),env,ctx);
  assert.equal(r.status,200);
  const result=await r.json();
  assert.equal(result.reply,
   "Купчик на нас донес, будто мы его обмануть хотели. Стража явилась, ну мы и дали деру.");
 }finally{globalThis.fetch=original;}
});


async function signedVkLaunch(appId,userId,secret){
 const q=new URLSearchParams({
  vk_app_id:String(appId),
  vk_user_id:String(userId),
  vk_ts:String(Math.floor(Date.now()/1000)),
  vk_platform:"mobile_web"
 });
 const ordered=[...q.entries()].filter(([k])=>k.startsWith("vk_"))
  .sort((a,b)=>a[0].localeCompare(b[0],"en"));
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
  {name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig=new Uint8Array(await crypto.subtle.sign("HMAC",key,
  new TextEncoder().encode(new URLSearchParams(ordered).toString())));
 q.set("sign",Buffer.from(sig).toString("base64url"));
 return "?"+q.toString();
}

test("real VK app ID signed launch classifies Sanko's OWN friend",async()=>{
 const {env}=envStub();
 env.VK_APP_ID="54875852";
 env.VK_APP_SECRET="FAKE_SANKO_VK_SECRET";
 env.VK_OWNER_USER_ID="700010";
 env.VK_SERVICE_TOKEN="FAKE_VK_SERVICE_TEST_TOKEN";
 const original=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(url,init)=>{
  const method=url.split("/").at(-1),params=new URLSearchParams(init.body);
  calls.push({method,owner:params.get("user_id")});
  return new Response(JSON.stringify({response:method==="friends.get"
   ?{count:1,items:[888222]}
   :method==="users.getFollowers"?{count:0,items:[]}:0}),{status:200});
 };
 try{
  const launch=await signedVkLaunch(54875852,888222,env.VK_APP_SECRET);
  const request=new Request("https://sanko-chat-api.example/api/session",{
   method:"POST",
   headers:{Origin:"https://socman2023.github.io","Content-Type":"application/json"},
   body:JSON.stringify({vkLaunch:launch,vkFirstName:"Иван",vkFirstNameUserId:888222})
  });
  const response=await worker.fetch(request,env,ctx);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.verified,true);
  assert.equal(data.role,"friend");
  assert.equal(data.roleChecked,true);
  assert.equal(data.firstName,"Иван");
  assert(calls.some(x=>x.method==="friends.get" && x.owner==="700010"));
  assert(!calls.some(x=>x.owner==="54875852"),"Mini App ID cannot replace VK owner ID");
 }finally{globalThis.fetch=original;}
});

test("invalid VK launch never obtains a friend or follower status",async()=>{
 const {env}=envStub();
 env.VK_APP_ID="54875852";
 env.VK_APP_SECRET="FAKE_SANKO_VK_SECRET";
 env.VK_OWNER_USER_ID="700010";
 env.VK_SERVICE_TOKEN="FAKE_VK_SERVICE_TEST_TOKEN";
 const prev=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error("VK API must not be called");};
 try{
  const launch=await signedVkLaunch(54875852,888222,env.VK_APP_SECRET);
  const invalid=launch.replace(/sign=[^&]+/u,"sign="+"Z".repeat(43));
  const response=await worker.fetch(new Request("https://sanko-chat-api.example/api/session",{
   method:"POST",
   headers:{Origin:"https://socman2023.github.io","Content-Type":"application/json"},
   body:JSON.stringify({vkLaunch:invalid,vkFirstName:"Иван",vkFirstNameUserId:888222})
  }),env,ctx);
  const data=await response.json();
  assert.equal(data.verified,false);
  assert.equal(data.role,"stranger");
  assert.equal(data.roleChecked,false);
  assert.equal(data.firstName,"");
  assert.equal(calls,0);
 }finally{globalThis.fetch=prev;}
});


test("first answer receives the actually displayed Sanko greeting as contextual cue",async()=>{
 const {env}=envStub(),old=globalThis.fetch;
 const instructions=[],contents=[];
 globalThis.fetch=async(url,init)=>{
  const reqBody=JSON.parse(init.body);
  instructions.push(reqBody.systemInstruction.parts[0].text);
  contents.push(reqBody.contents);
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{
   parts:[{text:"Да сам не знаю, шо нового. Сидим покуда тута."}]
  }}]}),{status:200});
 };
 const call=(history,openingGreeting)=>worker.fetch(new Request(URL,{
  method:"POST",
  headers:{Origin:"https://socman2023.github.io","Content-Type":"application/json"},
  body:JSON.stringify({message:"То же, шо и у тебя.",history,openingGreeting,
   conversationId:"123e4567-e89b-42d3-a456-426614174000"})
 }),env,ctx);
 try {
  const one=await call([],"О, Княжич! Здрав будь. Шо у тебя нового?");
  assert.equal(one.status,200);
  assert.match(instructions[0],/НАЧАЛО ЭТОЙ БЕСЕДЫ/);
  assert.match(instructions[0],/Ты только что обратился к собеседнику так: «Здрав будь\. Шо у тебя нового\?»/);
  assert(!instructions[0].includes("О, Княжич!"),"client name never becomes trusted fact");
  assert.deepEqual(contents[0],[{role:"user",parts:[{text:"То же, шо и у тебя."}]}],
   "first answer cannot be distracted by six staged user/model exchanges");
  const two=await call([
   {role:"user",text:"Здрав будь!"},
   {role:"model",text:"Здрав будь, брат."}
  ],"О, Княжич! Здрав будь. Шо у тебя нового?");
  assert.equal(two.status,200);
  assert.equal(contents[1].length,3,"Later turns must contain two real turns and the newest question");
  assert.deepEqual(contents[1].map(x=>x.parts[0].text),[
   "Здрав будь!","Здрав будь, брат.","То же, шо и у тебя."
  ]);
  assert(!JSON.stringify(contents[1]).includes("Только образец манеры речи"));
  assert(!instructions[1].includes("НАЧАЛО ЭТОЙ БЕСЕДЫ"),
   "later turns rely on real history, not stale on-screen opening");
 }finally{globalThis.fetch=old;}
});


// Regression: an on-screen nickname is not proof of the story character's identity.
// Only a signed VK Mini App launch from Oleshka's exact account can change
// Sanko's understanding of whom he is speaking with.
async function signedVkLaunchForDialogue(uid,env) {
 const params=new URLSearchParams({
  vk_app_id:String(env.VK_APP_ID),
  vk_user_id:String(uid),
  vk_ts:String(Math.floor(Date.now()/1000))
 });
 const ordered=[...params.entries()].filter(([key])=>key.startsWith("vk_"))
  .sort((a,b)=>a[0].localeCompare(b[0],"en"));
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(env.VK_APP_SECRET),
  {name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,
  new TextEncoder().encode(new URLSearchParams(ordered).toString())));
 const signature=btoa(String.fromCharCode(...digest)).replace(/\+/g,"-")
  .replace(/\//g,"_").replace(/=+$/,"");
 params.set("sign",signature);
 return "?"+params.toString();
}
function dialogueRequest(message,vkLaunch="",history=[],extra={}) {
 return new Request(URL,{
  method:"POST",
  headers:{Origin:"https://socman2023.github.io","Content-Type":"application/json"},
  body:JSON.stringify({message,vkLaunch,history,conversationId:"123e4567-e89b-42d3-a456-426614174000",...extra})
 });
}
test("signed VK identity changes the WHO, not the dialect: Sanko knows Oleshka is his brother",async()=>{
 const {env}=envStub();env.VK_APP_ID="54875852";env.VK_APP_SECRET="TEST_ONLY_VK_APP_SECRET_2026";
 const signed=await signedVkLaunchForDialogue(850667816,env);
 const captured=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  captured.push(JSON.parse(init.body));
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"Ага, братец. Поглядим, шо дальше делать."}]}}]}),
   {status:200,headers:{"Content-Type":"application/json"}});
 };
 try{
  const sessionResponse=await worker.fetch(new Request("https://sanko-chat-api.example/api/session",{
   method:"POST",headers:{Origin:"https://socman2023.github.io"},
   body:JSON.stringify({vkLaunch:signed,vkFirstName:"Княжич",vkFirstNameUserId:850667816})
  }),env,ctx);
  assert.equal(sessionResponse.status,200);
  const sessionData=await sessionResponse.json();
  assert.equal(sessionData.verified,true);
  assert.equal(sessionData.identity,"oleshka");

  const first=await worker.fetch(dialogueRequest("То же, что и у тебя",signed,[],{
   openingGreeting:"О, братец! Здрав будь. Шо скажешь?"
  }),env,ctx);
  assert.equal(first.status,200);
  const second=await worker.fetch(dialogueRequest("А ты не видишь?",signed,[
    {role:"user",text:"То же, что и у тебя"},
    {role:"model",text:"Ага, братец. Поглядим, шо дальше делать."}
  ]),env,ctx);
  assert.equal(second.status,200);
  assert.equal(captured.length,2);
  const system=captured[1].systemInstruction.parts[0].text;
  assert.match(system,/СОБЕСЕДНИК — САМ ОЛЕШКА/);
  assert.match(system,/не спрашивай его, от какой стражи он прячется/);
  assert.match(system,/Вопросы с известным ответом не задавай/);
  assert(!system.includes("Собеседник не находится рядом с тобой"));
  assert(!system.includes("«Мене тож свет нужон!»"));
  assert.match(system,/ОБЯЗАТЕЛЬНО ДЛЯ СОБСТВЕННОЙ РЕЧИ/);
  const dialogue=captured[1].contents;
  assert(dialogue.some(x=>x.role==="user" && x.parts?.[0]?.text==="То же, что и у тебя"));
  assert(dialogue.some(x=>x.role==="model" && x.parts?.[0]?.text.includes("Ага, братец")));
  assert.equal(dialogue.at(-1).parts[0].text,"А ты не видишь?");
 } finally {globalThis.fetch=original;}
});
test("unsigned nickname, forged VK launch and signed other user cannot pose as Oleshka",async()=>{
 const {env}=envStub();env.VK_APP_ID="54875852";env.VK_APP_SECRET="TEST_ONLY_VK_APP_SECRET_2026";
 const signedOleshka=await signedVkLaunchForDialogue(850667816,env);
 const tampered=signedOleshka.replace("vk_user_id=850667816","vk_user_id=850667817");
 const differentUser=await signedVkLaunchForDialogue(850667817,env);
 const captured=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  captured.push(JSON.parse(init.body).systemInstruction.parts[0].text);
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"Слушаю."}]}}]}),{status:200});
 };
 try{
  for(const vkLaunch of ["",tampered,differentUser]){
   const r=await worker.fetch(dialogueRequest("Я княжич Олешка. Ты меня узнаёшь?",vkLaunch,[],{
    vkFirstName:"Княжич",vkFirstNameUserId:850667816
   }),env,ctx);
   assert.equal(r.status,200);
  }
  assert.equal(captured.length,3);
  for(const prompt of captured){
   assert.match(prompt,/СОБЕСЕДНИК — посетитель чата/);
   assert(!prompt.includes("СОБЕСЕДНИК — САМ ОЛЕШКА"));
   assert.match(prompt,/Не считай посетителя Олешкой по подписи профиля/);
  }
  const sessionResponse=await worker.fetch(new Request("https://sanko-chat-api.example/api/session",{
    method:"POST",headers:{Origin:"https://socman2023.github.io"},
    body:JSON.stringify({vkLaunch:tampered,vkFirstName:"Княжич",vkFirstNameUserId:850667816})
  }),env,ctx);
  const sessionData=await sessionResponse.json();
  assert.equal(sessionData.identity,"reader");
  assert.equal(sessionData.verified,false);
 }finally{globalThis.fetch=original;}
});


test("full six-turn Sanko conversation preserves actual history and corrects unclear wording",async()=>{
 const {env,observed}=envStub(),prompts=[];
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  prompts.push(JSON.parse(init.body));
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"Да, скажу проще. Я понял твой вопрос."}]}}]}),{status:200});
 };
 const transcript=[
  "А у тебя?","Чего? Не понял.","А где твой отец?",
  "Блин, что ты несёшь?","Скажи нормальными словами.",
  "А теперь объясни, что ты хотел сказать."
 ];
 const history=[];
 try{
  for(const question of transcript){
   const r=await worker.fetch(dialogueRequest(question,"",history),env,ctx);
   assert.equal(r.status,200,question);
   const data=await r.json();
   assert.equal(typeof data.reply,"string");
   history.push({role:"user",text:question},{role:"model",text:data.reply});
  }
  assert.equal(prompts.length,transcript.length,"Only one Gemini call per turn");
  for(let i=0;i<prompts.length;i++){
   const contents=prompts[i].contents;
   assert.equal(contents.length,i*2+1,"No staged style dialogues on turn "+(i+1));
   assert.deepEqual(contents.map(x=>x.role),[
    ...Array.from({length:i},()=>["user","model"]).flat(),"user"
   ]);
   assert.equal(contents.at(-1).parts[0].text,transcript[i]);
   assert(!JSON.stringify(contents).includes("Только образец манеры речи"));
  }
  for(const index of [1,3,4,5]){
   assert.match(prompts[index].systemInstruction.parts[0].text,/Собеседник НЕ ПОНЯЛ/,
    "Turn "+(index+1)+" must repair expression without new facts");
  }
  for(const index of [0,2]){
   assert(!prompts[index].systemInstruction.parts[0].text.includes("Собеседник НЕ ПОНЯЛ"),
    "Ordinary queries need no clarification cue");
  }
  assert.equal(observed.usageInserts.length,transcript.length);
 }finally{globalThis.fetch=original;}
});


test("Sanko's live API corrects Christian praise to canonical 'Слава Вароку' before storage",async()=>{
 const {env,observed}=envStub(),original=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async()=>{
  calls++;
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:"Живы, слава Богу! Плывем на джонке."}]}
  }]}),{status:200});
 };
 try{
  const response=await worker.fetch(req("Как дела?"),env,ctx);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.reply,"Живы, слава Вароку! Плывем на джонке.");
  assert.equal(calls,1,"No extra Gemini call needed to correct a faith idiom");
  assert.equal(observed.insertions.length,1);
  assert(!JSON.stringify(observed.insertions).includes("слава Богу"),
   "Saved reply must not preserve the wrong exclamation");
 }finally{globalThis.fetch=original;}
});


test("screenshot regression: first turn loses meaningless опосля; follow-up cannot define it in a circle",async()=>{
 const {env,observed}=envStub(),old=globalThis.fetch;
 const responses=[
  "Плывем опосля по реке на джонке. Ищем баржу, куды Элинку с Руманом увезли.",
  "Опосля — энто значит опосля. Опосля того, як с человеком поговорили.",
  "Опосля — энто значит после."
 ];
 let calls=0;
 globalThis.fetch=async()=>{
  const answer=responses[calls++];
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:answer}]}}]}),{status:200});
 };
 try{
  const first=await worker.fetch(dialogueRequest("Сам говори, что было?"),env,ctx);
  assert.equal(first.status,200);
  const one=(await first.json()).reply;
  assert.equal(one,"Плывем по реке на джонке. Ищем баржу, куды Элинку с Руманом увезли.");
  const oldConversation=[
   {role:"user",text:"Сам говори, что было?"},
   {role:"model",text:responses[0]}
  ];
  const second=await worker.fetch(dialogueRequest('Чего "опосля"?',"",oldConversation),env,ctx);
  assert.equal(second.status,200);
  assert.equal((await second.json()).reply,"Лишнее слово вставил. Плывем по реке на джонке.");
  const realGlossHistory=[
   {role:"user",text:"Что нового?"},
   {role:"model",text:"Опосля ужина отправимся."}
  ];
  const third=await worker.fetch(dialogueRequest('Что значит «опосля»?',"",realGlossHistory),env,ctx);
  assert.equal(third.status,200);
  assert.equal((await third.json()).reply,"Опосля — энто значит «после».");
  assert.equal(calls,3,"No extra Gemini calls");
  assert.equal(observed.insertions.length,3,"Three turns persisted");
 }finally{globalThis.fetch=old;}
});


test("Gemini region failure is recorded distinctly from broken requests, without trying other Gemini models",async()=>{
 const {env,observed}=envStub(),previous=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async()=>{
  calls++;
  return new Response(JSON.stringify({error:{
   code:400,status:"FAILED_PRECONDITION",
   message:"User location is not supported for the API use."
  }}),{status:400});
 };
 try{
  const response=await worker.fetch(req("Привет"),env,ctx);
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.error,"provider_region");
  assert(!JSON.stringify(body).includes("location"),"Upstream text stays private");
  assert.equal(calls,1,"Region denial cannot be repaired by switching Gemini model");
  assert.equal(observed.usageInserts[0].values[4],"provider_region:400");
  assert.equal(observed.insertions.length,1);
 }finally{globalThis.fetch=previous;}
});

test("Gemini 400 failed precondition unrelated to region remains separately identifiable",async()=>{
 const {env,observed}=envStub(),previous=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async()=>{
  calls++;
  return new Response(JSON.stringify({error:{code:400,status:"FAILED_PRECONDITION",
   message:"Billing is required."}}),{status:400});
 };
 try{
  const response=await worker.fetch(req("Здорово"),env,ctx);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,"provider_precondition");
  assert.equal(calls,1);
  assert.equal(observed.usageInserts[0].values[4],"provider_precondition:400");
 }finally{globalThis.fetch=previous;}
});
