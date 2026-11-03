// Sanko Gemini accounting: no prompts, responses, IPs or API keys are persisted.
// Missing usage metadata is not silently counted as zero.
import { dayInMoscow } from "./lib.js";

export function extractUsage(data) {
 const meta=data?.usageMetadata;
 if(!meta||typeof meta!=="object")return null;
 const n=k=>{
  const v=meta[k];
  return typeof v==="number"&&Number.isSafeInteger(v)&&v>=0?v:null;
 };
 const usage={
  promptTokens:n("promptTokenCount"),
  candidateTokens:n("candidatesTokenCount"),
  thoughtsTokens:n("thoughtsTokenCount"),
  cachedTokens:n("cachedContentTokenCount"),
  totalTokens:n("totalTokenCount")
 };
 return Object.values(usage).some(x=>x!==null)?usage:null;
}

// An accounting outage must never interrupt a conversation.
export async function recordUsage(env,admissionId,attempts=[]) {
 if(!attempts.length)return;
 try{
  for(const a of attempts){
   const at=Number.isSafeInteger(a.attemptedAt)?a.attemptedAt:Math.floor(Date.now()/1000);
   const u=a.usage||{};
   await env.GUARD_DB.prepare(
    "INSERT INTO token_usage(admission_id,attempted_at,day,model,result,"+
    "prompt_tokens,candidate_tokens,thoughts_tokens,cached_tokens,total_tokens) "+
    "VALUES(?,?,?,?,?,?,?,?,?,?)"
   ).bind(admissionId,at,dayInMoscow(at*1000),String(a.model||"").slice(0,90),
    String(a.status||"unknown").slice(0,40),u.promptTokens??null,u.candidateTokens??null,
    u.thoughtsTokens??null,u.cachedTokens??null,u.totalTokens??null).run();
  }
 }catch(e){console.warn("Sanko token accounting unavailable",e?.name||"unknown");}
}

const count=x=>Number.isFinite(Number(x))?Number(x):0;
const empty=()=>({calls:0,meteredCalls:0,unknownCalls:0,total:0,prompt:0,
 candidate:0,thoughts:0,cached:0});
function normalize(x){
 return {calls:count(x?.calls),meteredCalls:count(x?.meteredCalls),
  unknownCalls:count(x?.unknownCalls),total:count(x?.total),
  prompt:count(x?.prompt),candidate:count(x?.candidate),
  thoughts:count(x?.thoughts),cached:count(x?.cached)};
}
const fields=[
 "COUNT(*) AS calls",
 "COUNT(total_tokens) AS meteredCalls",
 "SUM(CASE WHEN total_tokens IS NULL THEN 1 ELSE 0 END) AS unknownCalls",
 "COALESCE(SUM(total_tokens),0) AS total",
 "COALESCE(SUM(prompt_tokens),0) AS prompt",
 "COALESCE(SUM(candidate_tokens),0) AS candidate",
 "COALESCE(SUM(thoughts_tokens),0) AS thoughts",
 "COALESCE(SUM(cached_tokens),0) AS cached"
].join(",");

export async function tokenStats(db,today) {
 const utc=Date.parse(today+"T00:00:00Z");
 const begin=new Date(utc-29*86400000).toISOString().slice(0,10);
 const monthBegin=today.slice(0,7)+"-01";
 try{
  const [dailyRows,monthlyRow,modelRows]=await Promise.all([
   db.prepare("SELECT day,"+fields+" FROM token_usage WHERE day>=? AND day<=? GROUP BY day ORDER BY day")
    .bind(begin,today).all(),
   db.prepare("SELECT "+fields+" FROM token_usage WHERE day>=? AND day<=?")
    .bind(monthBegin,today).first(),
   db.prepare("SELECT model,"+fields+" FROM token_usage WHERE day>=? AND day<=? "+
    "GROUP BY model ORDER BY total DESC LIMIT 8").bind(begin,today).all()
  ]);
  const byDay=new Map((dailyRows?.results||[]).map(x=>[x.day,normalize(x)]));
  const daily=Array.from({length:30},(_,i)=>{
   const day=new Date(utc-(29-i)*86400000).toISOString().slice(0,10);
   return {day,...(byDay.get(day)||empty())};
  });
  const aggregate=entries=>entries.reduce((a,x)=>{
   for(const k of Object.keys(a))a[k]+=x[k]||0;
   return a;
  },empty());
  const month=normalize(monthlyRow);
  return {status:"ready",today:daily[29],week:aggregate(daily.slice(-7)),month,
   averagePerMeteredCall:month.meteredCalls?Math.round(month.total/month.meteredCalls):null,
   daily,models:(modelRows?.results||[]).map(x=>({model:String(x.model||"unknown"),...normalize(x)})),
   note:"Учёт начинается после публикации Worker. Неизвестный расход не считается нулевым."};
 }catch(e){
  console.warn("Sanko token stats unavailable",e?.name||"unknown");
  return {status:"unavailable",note:"Проверьте наличие таблицы token_usage (D1 migration 0002)."};
 }
}
