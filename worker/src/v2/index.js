// Sanko v2: new canonical conversation pipeline; old admin/session stay stable
// and are delegated to the existing tested transport until separately migrated.
import legacy from "../index.js";
import {dayInMoscow,isAllowedOrigin} from "../lib.js";
import {newChatTrace,markChatStage,logChatFinished} from "../request-telemetry.js";
import {recordUsage} from "../token-usage.js";
import {publicChatError} from "../error-policy.js";
import {guardSankoReply} from "../reply-guard.js";
import {normalizeSankoFaith} from "../sanko-faith.js";
import {enforceMandatorySankoForms} from "../sanko-mandatory-forms.js";
import {smoothSankoSpeech} from "../sanko-natural-phrases.js";
import {sankoClarificationCue,repairSankoLexicalClarification} from "../sanko-clarity.js";
import {openingConversationCue} from "../sanko-opening-context.js";
import {planDialogue} from "./dialogue-plan.js";
import {resolveApprovedFacts} from "./approved-ledger.js";
import {auditReplyAgainstFacts} from "./attribution-audit.js";
import {loadDiaryEvidence,loadCanonEvidence} from "./source-retrieval.js";
import {composeSankoContext,readCurrentSnapshot,safePromptMetrics} from "./context.js";
import {generateWithEvidence} from "./gemini.js";
import {VERSION_V2,jsonResponse,parseChatBody,configured,reserveChat,
 storeChat,verifiedVkUid,admissionNotice,cors} from "./security.js";
const OLESHKA_VK_USER_ID=850667816;
const PROFILE_KEY="sanko:profile:v1",CURRENT_KEY="sanko:current:v1";
const FACTS_KEY="sanko:canon:approved-relations:v2";
const coreConfigured=env=>configured(env);
async function loadPrivateContext(env){
 const [profileRaw,currentRaw,factsRaw]=await Promise.all([
  env.CURRENT_CONTEXT.get(PROFILE_KEY),
  env.CURRENT_CONTEXT.get(CURRENT_KEY),
  env.CURRENT_CONTEXT.get(FACTS_KEY).catch(()=>null)
 ]);
 const profile=typeof profileRaw==="string"?profileRaw:"";
 if(profile.trim().length<200)throw Error("private_profile_missing");
 const current=readCurrentSnapshot(currentRaw);
 return {profile:profile.slice(0,34000),current,factsRaw};
}
async function runChat(req,env,origin,ctx){
 const trace=newChatTrace(req,VERSION_V2);
 if(!coreConfigured(env)){
  logChatFinished(trace,{outcome:"not_configured",status:503});
  return jsonResponse(publicChatError("service_unavailable"),503,origin,env);
 }
 const body=await parseChatBody(req);
 const {question,history,conversationId}=body;
 const today=dayInMoscow(),plan=planDialogue(question,history,today);
 const startCanonical=Date.now();
 let privateData;
 try{privateData=await loadPrivateContext(env);}
 catch{
  markChatStage(trace,"canon",Date.now()-startCanonical);
  logChatFinished(trace,{outcome:"canon_unavailable",status:503});
  return jsonResponse(publicChatError("service_unavailable"),503,origin,env);
 }
 markChatStage(trace,"canon",Date.now()-startCanonical);
 const verified=await verifiedVkUid(body.vkLaunch,env);
 const isOleshka=verified===OLESHKA_VK_USER_ID;
 const startAdmission=Date.now();
 const admission=await reserveChat(env,req);
 markChatStage(trace,"admission",Date.now()-startAdmission);
 trace.requestId=String(admission.id||"");
 if(!admission.ok){
  logChatFinished(trace,{outcome:"quota_exhausted",status:429});
  return jsonResponse({error:"quota_exhausted",reply:admissionNotice(admission.kind),
   retryAt:admission.retryAt,conversationId},429,origin,env);
 }
 const approved=resolveApprovedFacts(privateData.factsRaw,today,plan.date);
 const startRead=Date.now();
 const [diary,canon]=await Promise.all([
  loadDiaryEvidence(env.DIARY_DB,plan,today),
  loadCanonEvidence(env,plan)
 ]);
 markChatStage(trace,"diary",Date.now()-startRead);
 const system=composeSankoContext({plan,
  profile:privateData.profile,current:privateData.current,
  diary,canon,approved,question,history,isOleshka,dayToday:today})+
  "\n\n"+openingConversationCue(null,history)+
  "\n\n"+sankoClarificationCue(question,history);
 const prompt=safePromptMetrics({system,plan,
  profile:privateData.profile,current:privateData.current,
  diary,canon,approved,history,question});
 const startGeneration=Date.now();
 const result=await generateWithEvidence(env,{system,history,question,trace});
 markChatStage(trace,"generation",Date.now()-startGeneration);
 await recordUsage(env,admission.id,result.attempts);
 if(!result.ok){
  await storeChat(env,{id:conversationId,admissionId:admission.id,
   question,status:"error"});
  logChatFinished(trace,{outcome:result.reason,status:result.reason==="response_blocked"?422:503,
   attempts:result.attempts.length,prompt,mode:plan.kind});
  return jsonResponse(publicChatError(result.reason,{conversationId}),
   result.reason==="response_blocked"?422:503,origin,env);
 }
 // Independent factual audit BEFORE stylistic editing. Only author-approved
 // source relations may determine a correction, never the model's own history.
 const audited=auditReplyAgainstFacts(result.reply,approved,question,history);
 const normalized=repairSankoLexicalClarification(
  normalizeSankoFaith(audited.reply),question,history);
 const spoken=enforceMandatorySankoForms(smoothSankoSpeech(normalized));
 const guarded=guardSankoReply(spoken);
 await storeChat(env,{id:conversationId,admissionId:admission.id,
  question,reply:guarded.reply,model:result.model,status:"answered"});
 prompt.factAudit=audited.action;
 logChatFinished(trace,{outcome:"answered",status:200,
  attempts:result.attempts.length,prompt,mode:plan.kind});
 return jsonResponse({conversationId,reply:guarded.reply,
  model:result.model,fallbackUsed:result.fallbackUsed,
  knowledge:{focusDate:plan.date||"",matches:canon.hits.length,
   diaryPosts:diary.posts.length,mode:plan.kind}},200,origin,env);
}
export default {
 async fetch(req,env,ctx){
  const url=new URL(req.url),path=url.pathname;
  // Preserve existing authenticated admin UI and signed VK /api/session.
  // No new public administrative endpoints or data migrations.
  if(path==="/admin"||path.startsWith("/admin/")||
   (path==="/api/session"&&req.method==="POST"))
   return legacy.fetch(req,env,ctx);
  const origin=req.headers.get("Origin")||"";
  if(!isAllowedOrigin(origin,env.ALLOWED_ORIGIN))
   return new Response("Forbidden origin",{status:403});
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin,env)});
  if(req.method==="GET"&&(path==="/"||path==="/health")){
   // Keep the old detailed diary-sync health contract.
   const old=await legacy.fetch(req,env,ctx);
   const body=await old.json();
   return jsonResponse({...body,version:VERSION_V2,
    engine:"canon-first-v2",configured:coreConfigured(env)},old.status,origin,env);
  }
  if(req.method!=="POST"||path!=="/api/chat")
   return jsonResponse({error:"not_found"},404,origin,env);
  try{return await runChat(req,env,origin,ctx);}
  catch(err){
   if(["invalid_json","invalid_message","body_too_large"].includes(err?.message))
    return jsonResponse({error:err.message},400,origin,env);
   console.error("Sanko v2 request failed",err?.name||"error");
   return jsonResponse(publicChatError("service_unavailable"),503,origin,env);
  }
 },
 scheduled(event,env,ctx){return legacy.scheduled(event,env,ctx);}
};
