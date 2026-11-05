// Safe diagnostic metadata for a single Worker request.
// Never log question, answer, prompt, HTTP headers, IP, API key or VK identity.
// The request id is the existing random admission UUID, not a personal ID.
const now=()=>Date.now();
const length=value=>String(value??"").length;
const positive=value=>Math.max(0,Math.round(Number(value)||0));
const safeCountry=x=>/^[A-Z]{2}$/.test(String(x||""))?String(x):"unknown";
const safeColo=x=>/^[A-Z]{3}$/.test(String(x||""))?String(x):"unknown";
const safeCode=x=>String(x||"").replace(/[^a-zA-Z0-9._:-]/g,"").slice(0,60);
export function newChatTrace(req,version) {
 return {version:String(version||"unknown").slice(0,50),
  startedAt:now(),country:safeCountry(req?.cf?.country),
  ingressColo:safeColo(req?.cf?.colo),requestId:"",stages:{}};
}
export function markChatStage(trace,name,elapsedMs) {
 if(!trace)return;
 if(["canon","admission","retrieve","lexical","diary","generation","store"].includes(name))
  trace.stages[name]=positive(elapsedMs);
}
export function getPromptBreakdown(runtime,hits,diary,system,history,question){
 const posts=Array.isArray(diary?.posts)?diary.posts:[];
 const snippets=Array.isArray(hits)?hits:[];
 const turns=Array.isArray(history)?history:[];
 const newer=posts.reduce((max,p)=>String(p.day||"")>max?String(p.day||""):max,"");
 const focus=posts.filter(p=>p.day===newer).slice(0,4);
 return {
  systemChars:length(system),
  profileChars:length(runtime?.profile),
  personalContextChars:length(runtime?.current?.text),
  chronologyChars:length(runtime?.dayText),
  diaryChars:posts.reduce((sum,p)=>sum+length(p.text),0),
  focusRepeatChars:0, // Duplicate `recentFocus` removed in experimental builder.
  retrievedChars:snippets.reduce((sum,p)=>sum+length(p.text),0),
  historyChars:turns.reduce((sum,p)=>sum+length(p.text),0),
  questionChars:length(question),diaryPosts:posts.length,retrievedHits:snippets.length,
  historyTurns:turns.length
 };
}
function emit(event,fields) {
 // Only our own fixed shape of allowlisted metadata may reach Cloudflare logs.
 console.info(JSON.stringify({event,...fields}));
}
export function logGeminiAttempt(trace,{model,result,httpStatus,latencyMs,usage}={}) {
 if(!trace)return;
 emit("sanko_gemini_attempt",{
  version:trace.version,requestId:trace.requestId,country:trace.country,
  ingressColo:trace.ingressColo,
  model:safeCode(model),result:safeCode(result),
  httpStatus:positive(httpStatus),latencyMs:positive(latencyMs),
  inputTokens:usage?.promptTokens==null?null:positive(usage.promptTokens),
  outputTokens:usage?.candidateTokens==null?null:positive(usage.candidateTokens),
  thinkingTokens:usage?.thoughtsTokens==null?null:positive(usage.thoughtsTokens),
  totalTokens:usage?.totalTokens==null?null:positive(usage.totalTokens)
 });
}
export function logChatFinished(trace,{outcome,status,attempts=0,prompt=null,mode=""}={}) {
 if(!trace)return;
 emit("sanko_chat_request",{
  version:trace.version,requestId:trace.requestId,country:trace.country,
  ingressColo:trace.ingressColo,at:new Date(trace.startedAt).toISOString(),
  durationMs:positive(now()-trace.startedAt),httpStatus:positive(status),
  outcome:safeCode(outcome),attempts:positive(attempts),mode:safeCode(mode),
  stages:trace.stages,
  ...(prompt?{prompt}: {})
 });
}
