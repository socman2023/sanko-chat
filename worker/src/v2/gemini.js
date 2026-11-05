// Gemini transport and fallback, independent of factual reasoning and voice.
// Usage is recorded for ALL attempted models whenever Google provides it.
import {classifyProviderError} from "../error-policy.js";
import {extractUsage} from "../token-usage.js";
import {logGeminiAttempt} from "../request-telemetry.js";
const DEFAULT=[
 ["gemini-3.5-flash-lite",18000],
 ["gemini-3.1-flash-lite",14000],
 ["gemini-3.6-flash",12000],
 ["gemini-3.8-flash",12000]
];
const cooldowns=new Map();
function models(env){
 const src=String(env.GEMINI_MODEL_ORDER||"");
 const names=src.split(",").map(x=>x.trim())
  .filter(x=>/^[a-z0-9][a-z0-9._-]{2,90}$/.test(x)).slice(0,4);
 return names.length?names.map((x,i)=>[x,DEFAULT[i]?.[1]||12000]):DEFAULT;
}
export function trueConversation(history,question){
 // No fabricated user/model exchanges or pasted unrelated "few-shot" story.
 return [...history.map(h=>({role:h.role==="model"?"model":"user",
  parts:[{text:h.text}]})),{role:"user",parts:[{text:question}]}];
}
export async function generateWithEvidence(env,{system,history,question,trace}){
 const contents=trueConversation(history,question);
 const attempts=[];let failure="provider_busy",quota=false,fallback=false;
 for(const [model,timeout] of models(env)){
  const key=model+"|"+String(env.GEMINI_API_KEY||"");
  const cooldown=cooldowns.get(key);
  if(cooldown?.until>Date.now()){
   if(cooldown.kind==="provider_quota")quota=true;
   fallback=true;continue;
  }
  const start=Date.now();let result,usage=null,httpStatus=0;
  try{
   const response=await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{
     method:"POST",
     headers:{"Content-Type":"application/json","x-goog-api-key":String(env.GEMINI_API_KEY)},
     body:JSON.stringify({
      systemInstruction:{parts:[{text:system}]},contents,
      generationConfig:{maxOutputTokens:3072,
       thinkingConfig:{thinkingLevel:"low"},temperature:0.36}
     }),
     signal:AbortSignal.timeout(timeout)
    });
   httpStatus=response.status;
   const data=await response.json().catch(()=>null);
   usage=extractUsage(data);
   if(!response.ok){
    result={ok:false,...classifyProviderError(response.status,data)};
    if(response.status===429)cooldowns.set(key,{until:Date.now()+
     (result.kind==="provider_quota"?300000:30000),kind:result.kind});
   }else{
    const candidate=data?.candidates?.[0],reason=String(
     candidate?.finishReason||data?.promptFeedback?.blockReason||"");
    if(["SAFETY","PROHIBITED_CONTENT","BLOCKLIST","SPII","RECITATION","MODEL_ARMOR"].includes(reason))
     result={ok:false,kind:"response_blocked",retryable:false};
    else if(["MAX_TOKENS","CONTINUATION"].includes(reason))
     result={ok:false,kind:"provider_busy",retryable:true};
    else{
     const answer=candidate?.content?.parts?.filter(p=>typeof p.text==="string"&&!p.thought)
      .map(p=>p.text).join("").trim();
     result=answer?{ok:true,reply:answer}:
      {ok:false,kind:"provider_busy",retryable:true};
    }
   }
  }catch(err){
   console.warn("Sanko v2 Gemini interrupted",err?.name||"error");
   result={ok:false,kind:"provider_busy",retryable:true};
  }
  const status=result.ok?"answered":result.kind+":"+(httpStatus||0);
  const meta={model,status,attemptedAt:Math.floor(Date.now()/1000),usage};
  attempts.push(meta);
  logGeminiAttempt(trace,{model,result:status,httpStatus,
   latencyMs:Date.now()-start,usage});
  if(result.ok)return {ok:true,reply:result.reply,model,attempts,fallbackUsed:fallback};
  failure=result.kind||"provider_busy";
  if(failure==="provider_quota")quota=true;
  if(!result.retryable)break;
  fallback=true;
 }
 return {ok:false,reason:quota?"provider_quota":failure,attempts};
}
