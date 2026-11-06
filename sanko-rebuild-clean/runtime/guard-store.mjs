/** Fresh D1 admission and telemetry logic compatible with existing Sanko tables.
 * Not deployed. It has zero imports from existing legacy conversation code.
 */
export const QUOTAS=Object.freeze({day:500,month:15000,ipDay:100});

function validateDay(day){if(!/^\d{4}-\d\d-\d\d$/u.test(day))throw TypeError('invalid_day');}
export async function ipHash({day,ip,secret}){
  validateDay(day);
  if(!secret||typeof secret!=='string'||secret.length<20)throw TypeError('missing_hash_secret');
  if(!ip||typeof ip!=='string')throw TypeError('invalid_ip');
  const bytes=new TextEncoder().encode(day+'|'+ip+'|'+secret);
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}

export async function admit({db,day,ip,secret,clock=Date.now(),limits=QUOTAS}={}){
  if(!db?.prepare)throw TypeError('missing_guard_db');
  const client=await ipHash({day,ip,secret});
  const month=day.slice(0,7),requestId=crypto.randomUUID();
  const sql=`INSERT INTO chat_admissions(request_id,day,month,client_hash,created_at)
    SELECT ?,?,?,?,? WHERE
    (SELECT COUNT(*) FROM chat_admissions WHERE day=?)<? AND
    (SELECT COUNT(*) FROM chat_admissions WHERE month=?)<? AND
    (SELECT COUNT(*) FROM chat_admissions WHERE day=? AND client_hash=?)<?
    RETURNING request_id`;
  const result=await db.prepare(sql).bind(requestId,day,month,client,
    Math.floor(clock/1000),day,limits.day,month,limits.month,day,client,limits.ipDay).first();
  return result?.request_id===requestId?
    {ok:true,requestId}:{ok:false,reason:'quota_exhausted'};
}
export async function storeTurn({db,conversationId,requestId,message,
  reply='',model='',status='answered',at=Date.now()}={}){
  if(!db?.prepare||typeof conversationId!=='string'||!requestId)throw TypeError('invalid_store_turn');
  await db.prepare(`INSERT INTO chat_turns(conversation_id,admission_id,asked_at,
    question,reply,model,status) VALUES(?,?,?,?,?,?,?)`).bind(
      conversationId,requestId,Math.floor(at/1000),message,reply,model,status).run();
}
export async function storeTokenAttempt({db,requestId,day,model,usage,result='answered',at=Date.now()}={}){
  if(!db?.prepare||!requestId||!model)throw TypeError('invalid_usage_store');
  validateDay(day);
  const numberOrNull=x=>Number.isSafeInteger(x)&&x>=0?x:null;
  const totals={
    prompt:numberOrNull(usage?.promptTokenCount),
    candidate:numberOrNull(usage?.candidatesTokenCount),
    thoughts:numberOrNull(usage?.thoughtsTokenCount),
    cached:numberOrNull(usage?.cachedContentTokenCount),
    total:numberOrNull(usage?.totalTokenCount)
  };
  await db.prepare(`INSERT INTO token_usage(admission_id,attempted_at,day,model,result,
    prompt_tokens,candidate_tokens,thoughts_tokens,cached_tokens,total_tokens)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(requestId,Math.floor(at/1000),day,model,result,
      totals.prompt,totals.candidate,totals.thoughts,totals.cached,totals.total).run();
}
