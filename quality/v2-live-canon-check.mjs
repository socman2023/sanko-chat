// Minimal production fidelity gate. Real Gemini calls may consume quota.
// Never prints chat transcript, IP, API tokens or private source texts.
import {lintSankoReply} from "./sanko/check_reply.mjs";
import {incorrectSourceAttributions} from "../worker/src/v2/attribution-audit.js";
import {resolveApprovedFacts} from "../worker/src/v2/approved-ledger.js";
const base="https://sanko-chat-api.boysinger2008.workers.dev";
const version="sanko-worker-2.0.0-canon-first";
const sleep=n=>new Promise(r=>setTimeout(r,n));
let health=null;
for(let i=0;i<20;i++){
 try{
  const r=await fetch(base+"/health");
  const d=await r.json();
  if(r.ok&&d.version===version&&d.configured&&d.diaryConnected){
   health=d;break;
  }
 }catch{}
 await sleep(3000);
}
if(!health)throw Error("v2 health not ready; do not claim production deployment");
console.log("Verified live v2 health, diary binding and configuration");
async function chat(message,history=[]){
 for(let i=0;i<2;i++){
  const r=await fetch(base+"/api/chat",{method:"POST",headers:{
   "Content-Type":"application/json","Origin":"https://socman2023.github.io"},
   body:JSON.stringify({message,history,conversationId:crypto.randomUUID()})
  });
  const body=await r.json();
  if(r.ok)return body;
  if(r.status!==503||i===1)
   throw Error("v2 live API unavailable: HTTP "+r.status+" "+String(body.error||""));
  await sleep(2500);
 }
 throw Error("unexpected empty result");
}
const news=await chat("Что нового у тебя?");
if(news.knowledge?.mode!=="current")
 throw Error("Current-news intent misclassified in production");
if(news.knowledge?.diaryPosts<1)
 throw Error("Current diary not loaded");
if(lintSankoReply(news.reply).length)
 throw Error("Canonical spoken dialect or date violated on news turn");
console.log("Current-news verified: diary, short reply, voice");
const history=[{role:"user",text:"Лодочник говорил о Лунцзине?"},
 {role:"model",text:"Похоже, так."}];
const corrected=await chat("Разве лодочник сообщил о Шицяо?",history);
if(!corrected.reply.includes("Лунцзин")||!corrected.reply.includes("Шицяо"))
 throw Error("Speaker-to-place relation not preserved");
if(incorrectSourceAttributions(corrected.reply,resolveApprovedFacts(null,"2026-11-06")).length)
 throw Error("Wrong route attributed to boatman in live reply");
if(lintSankoReply(corrected.reply).length)
 throw Error("Canonical spoken dialect or date violated in source correction");
console.log("Approved boatman vs checkpoint attribution preserved");
