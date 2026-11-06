/** New one-pass Sanko conversation. No dependency on legacy Worker. */
import {composePrompt} from './context.mjs';
import {checkSankoResponse} from './response-check.mjs';

export async function answerAsSanko({model,persona,context,knowledge=null,history=[],message,
  confirmedOleshka=false,allowUnapprovedForTest=false,
  sourceCharBudget=20_000,maxInputChars=24_000}={}) {
  if(!model || typeof model.generate!=='function')throw new TypeError('missing_model_adapter');
  if(!persona?.approved && !allowUnapprovedForTest)
    return {ok:false,error:'persona_not_approved',providerCalls:0};
  const prompt=composePrompt({persona,context,knowledge,history,message,
    confirmedOleshka,sourceCharBudget,maxInputChars});
  if(!prompt.ok)return {ok:false,error:prompt.reason,providerCalls:0,
    ...{approxInputChars:prompt.approxInputChars}};
  let result;
  try {result=await model.generate({system:prompt.system,history:prompt.messages,
      message:prompt.message,maxOutputTokens:768});}
  catch(err){return {ok:false,error:'provider_unavailable',providerCalls:1,
    diagnostic:String(err?.code||err?.name||'error'),usage:err?.usage||null};}
  const reply=typeof result?.text==='string'?result.text.trim():'';
  const check=checkSankoResponse(reply);
  if(!check.ok)return {ok:false,error:'response_quality_failed',providerCalls:1,
    qualityReasons:check.reasons,usage:result?.usage||null};
  return {ok:true,reply,providerCalls:1,model:result?.model||'unknown',
    usage:result?.usage||null,
    approxInputChars:prompt.approxInputChars,
    contextPostCount:prompt.system.match(/"sourceUrl"/gu)?.length||0,
    qualityCheck:'mechanical_checks_only_not_semantic_qa'};
}
