// Offline comparison between approved production and independent Sanko v2.
// Same private-profile dimensions, same full diary texts, same seven user
// prompts. Deterministic model answers cannot establish artistic quality.
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {dayInMoscow} from "../worker/src/lib.js";
const [oldPath,newPath]=process.argv.slice(2);
if(!oldPath||!newPath)throw Error("usage: node v2-compare.mjs <old-worker> <v2-worker>");
const old=(await import(pathToFileURL(resolve(oldPath)).href)).default;
const rebuilt=(await import(pathToFileURL(resolve(newPath)).href)).default;
const today=dayInMoscow();
const fixtureText="Лодочник говорил о Лунцзине, а Тицзюй на заставе — о Шицяо. "+
 "Часть невольников должны высадить в Шицяо. ";
const diary=Array.from({length:8},(_,i)=>({
 post_id:6000+i,owner_id:850667816,published_day_msk:today,
 published_at:2000000-i,source_url:"https://vk.ru/wall850667816_"+(6000+i),
 source_text:fixtureText.repeat(35)+"КОНЕЦ_ОРИГИНАЛЬНОЙ_ЗАПИСИ_"+i
}));
function mockD1(stat){
 return {prepare(sql){return {sql,params:[],bind(...p){this.params=p;return this;},
  async first(){
   if(sql.startsWith("INSERT INTO chat_admissions"))return {request_id:"ok"};
   if(sql.includes("SELECT COUNT"))return {n:0};
   return null;
  },async all(){
   if(!sql.includes("FROM oleshka_vk_diary"))return {results:[]};
   stat.diaryReads++;
   let list=diary.slice();
   if(sql.includes("published_day_msk=?"))
    list=list.filter(p=>p.published_day_msk===this.params[1]);
   if(sql.includes("source_text LIKE")){
    const words=this.params.slice(1).filter(x=>typeof x==="string")
     .map(x=>x.replace(/[%\\]/gu,"").toLowerCase());
    list=list.filter(p=>words.some(w=>p.source_text.toLowerCase().includes(w)));
   }
   const limit=/\bLIMIT\s+(\d+)/iu.exec(sql);
   if(limit)list=list.slice(0,Number(limit[1]));
   return {results:list};
  },async run(){return {success:true}}};}};
}
function env(stat){
 const db=mockD1(stat);
 return {GEMINI_API_KEY:"DUMMY",IP_HASH_SECRET:"DUMMY",
  GUARD_DB:db,DIARY_DB:db,
  CURRENT_CONTEXT:{get:async k=>{
   if(k==="sanko:profile:v1")return "AUTHORED_PROFILE_TEST_".repeat(1455);
   if(k==="sanko:current:v1")return JSON.stringify({asOf:today,
    text:"Текущая погоня на джонке; последние подтверждённые сведения от лодочника и Тицзюя."});
   return null;
  }},
  AI:{run:async()=>({data:[Array(1024).fill(.0001)]})},
  KNOWLEDGE:{query:async()=>({matches:[]})}
 };
}
async function run(worker,question,history){
 const stat={diaryReads:0},context={waitUntil(p){p?.catch(()=>{});}};
 let system="",lastAnswer="";
 const prior=globalThis.fetch,priorLog=console.info;
 globalThis.fetch=async(_url,opts)=>{
  system=JSON.parse(opts.body).systemInstruction.parts[0].text;
  const answer=question==="Разве лодочник то говорил?"?
   "Лодочник говорил про Шицяо. Тицзюй рассказал про Лунцзин.":
   "Плывем по реке на джонке, баржу ищем.";
  return new Response(JSON.stringify({candidates:[{finishReason:"STOP",
   content:{parts:[{text:answer}]}}],
   usageMetadata:{promptTokenCount:11000,candidatesTokenCount:25,totalTokenCount:11025}}),
   {status:200});
 };
 console.info=()=>{};
 try{
  const req=new Request("https://sanko-chat-api.example/api/chat",{
   method:"POST",headers:{"Origin":"https://socman2023.github.io",
    "Content-Type":"application/json"},
   body:JSON.stringify({message:question,history,conversationId:crypto.randomUUID()})
  });
  const response=await worker.fetch(req,env(stat),context);
  if(response.status!==200)throw Error("HTTP "+response.status+" on "+question+" "+JSON.stringify(await response.json()));
  const body=await response.json();lastAnswer=body.reply;
  return {system,reply:lastAnswer,mode:body.knowledge?.mode||"",stat};
 }finally{globalThis.fetch=prior;console.info=priorLog;}
}
const turns=[
 ["Что нового у тебя?","Плывем за баржей."],
 ["Уже видали эту баржу?","Покуда нет, ищем."],
 ["Разве лодочник то говорил?","Оговорился я."],
 ["Лодочник про Лунцзин, Тицзюй про Шицяо — правильно?","Правильно."],
 ["Так может, их там высадят?","Может, поглядим."],
 ["Чаешь, успеете?","Надеюсь."],
 ["А кто вам про заставу рассказывал?","Слышал от служащего."]
];
let before=0,after=0;
const history=[],results=[];
for(const [question,fakeReply] of turns){
 const oldOut=await run(old,question,history),newOut=await run(rebuilt,question,history);
 if(!newOut.system.includes("ОБЯЗАТЕЛЬНО ДЛЯ СОБСТВЕННОЙ РЕЧИ"))
  throw Error("Sanko voice not preserved");
 if(!newOut.system.includes("КОНЕЦ_ОРИГИНАЛЬНОЙ_ЗАПИСИ_0"))
  throw Error("Full diary ending missing for "+question);
 if(!newOut.system.includes("Лунцзин")||!newOut.system.includes("Шицяо"))
  throw Error("Approved places lost");
 if(question==="Разве лодочник то говорил?"){
  if(!newOut.reply.includes("Лунцзин")||!newOut.reply.includes("Тицзюй"))
   throw Error("Wrong-source reply escaped canonical guard");
  if(newOut.reply.includes("Лодочник говорил про Шицяо"))
   throw Error("Wrong-source falsehood was published");
 }
 before+=oldOut.system.length;after+=newOut.system.length;
 results.push({question,baselineChars:oldOut.system.length,
  rebuiltChars:newOut.system.length,mode:newOut.mode});
 history.push({role:"user",text:question},{role:"model",text:fakeReply});
}
const savings=(100*(1-after/before)).toFixed(1);
console.log(JSON.stringify({baselineChars:before,v2Chars:after,savedPct:savings,results},null,2));
if(after>=before*.95)throw Error("Insufficient reduction in comparable source-backed conversation");
