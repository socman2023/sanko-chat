/** Provider-independent token aggregation with the existing admin JSON contract.
 * Input D1 columns are preserved (legacy schema), with nullable usage.
 */
const ZERO=()=>({calls:0,meteredCalls:0,promptMeteredCalls:0,overPromptTargetCalls:0,unknownCalls:0,total:0,prompt:0,
  candidate:0,thoughts:0,cached:0});
const n=x=>Number(x||0);
const FIELDS=`COUNT(*) calls,COUNT(total_tokens) meteredCalls,COUNT(prompt_tokens) promptMeteredCalls,
 SUM(CASE WHEN prompt_tokens>8000 THEN 1 ELSE 0 END) overPromptTargetCalls,
 SUM(CASE WHEN total_tokens IS NULL THEN 1 ELSE 0 END) unknownCalls,
 COALESCE(SUM(total_tokens),0) total,COALESCE(SUM(prompt_tokens),0) prompt,
 COALESCE(SUM(candidate_tokens),0) candidate,
 COALESCE(SUM(thoughts_tokens),0) thoughts,COALESCE(SUM(cached_tokens),0) cached`;
function parse(row){
  const out=ZERO();
  for(const k of Object.keys(out))out[k]=n(row?.[k]);
  return out;
}
function shift(day,offset){return new Date(Date.parse(day+'T00:00:00Z')+
  offset*86400000).toISOString().slice(0,10);}
export async function readTokenReport(db,today){
  const begin=shift(today,-29),monthBegin=today.slice(0,7)+'-01';
  try{
    const [days,month,models]=await Promise.all([
      db.prepare(`SELECT day,${FIELDS} FROM token_usage WHERE day>=? AND day<=? GROUP BY day ORDER BY day`)
        .bind(begin,today).all(),
      db.prepare(`SELECT ${FIELDS} FROM token_usage WHERE day>=? AND day<=?`)
        .bind(monthBegin,today).first(),
      db.prepare(`SELECT model,${FIELDS} FROM token_usage WHERE day>=? AND day<=?
        GROUP BY model ORDER BY total DESC LIMIT 8`).bind(begin,today).all()
    ]);
    const byDay=new Map((days.results||[]).map(x=>[x.day,parse(x)]));
    const daily=Array.from({length:30},(_,i)=>({day:shift(today,i-29),
      ...(byDay.get(shift(today,i-29))||ZERO())}));
    const sum=items=>items.reduce((a,item)=>{
      for(const k of Object.keys(a))a[k]+=item[k];
      return a;
    },ZERO());
    const total=parse(month);
    return {status:'ready',today:daily[29],week:sum(daily.slice(-7)),
      month:total,averagePerMeteredCall:total.meteredCalls?
        Math.round(total.total/total.meteredCalls):null,
      averagePromptPerMeteredCall:total.promptMeteredCalls?
        Math.round(total.prompt/total.promptMeteredCalls):null,
      promptTokensTargetMax:8000,
      daily,models:(models.results||[]).map(x=>({model:String(x.model||'unknown'),...parse(x)})),
      note:'Unknown usage is not zero. Cached input is already part of prompt tokens.'};
  }catch {return {status:'unavailable',note:'Token usage table unavailable'};}
}
