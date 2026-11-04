// Public messages are authorable character lines, never Gemini diagnostics.
// Internal error codes may be logged or used to decide UI behavior.
export const SANKO_NOTICES=Object.freeze({
 provider_quota:"Не выходит нынче поговорить. Ты чуть погодя загляни, ладно?",
 provider_busy:"Не выходит поговорить. Ты загляни погодя, ладно?",
 model_unavailable:"Не выходит поговорить. Ты загляни погодя, ладно?",
 service_unavailable:"Связь не ладится. Ты загляни погодя, ладно?",
 response_blocked:"Не стану говорить. Давай лучше о другом?",
});
export function classifyProviderError(status,data){
 const code=String(data?.error?.status||"").toUpperCase();
 const details=Array.isArray(data?.error?.details)?data.error.details:[];
 const quotaSignal=details.some(d=>/QuotaFailure/i.test(String(d?.["@type"]||"")));
 // 429 is either rate limiting or a persistent provider quota. Inspect structured
 // status/details only, never surface upstream error text to a visitor.
 if(status===429)return {
   kind:code==="RESOURCE_EXHAUSTED"||quotaSignal?"provider_quota":"provider_busy",
   retryable:true
 };
 // A missing/unsupported model can be recovered by the next configured
 // model. Google's Gemini API explicitly recommends model fallback on 404.
 // Never blindly retry 400/401/403: malformed requests, invalid keys,
 // account/billing restrictions and permissions are not transient overloads.
 if(status===404)return {kind:"model_unavailable",retryable:true,httpStatus:status};
 if(status===501)return {kind:"model_unavailable",retryable:true,httpStatus:status};
 if([408,409,425,500,502,503,504].includes(status)||status>=500)
   return {kind:"provider_busy",retryable:true,httpStatus:status};
 return {kind:"service_unavailable",retryable:false,httpStatus:status};
}
export function notice(kind){return SANKO_NOTICES[kind]||SANKO_NOTICES.service_unavailable;}
export function publicChatError(kind,{retryAt=null,conversationId=null}={}){
 return {error:kind,reply:notice(kind),
   ...(retryAt?{retryAt}:{}),...(conversationId?{conversationId}:{})};
}
