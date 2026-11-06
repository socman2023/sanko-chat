import {readTokenReport} from './token-report.mjs';
/** Data-only, READ-ONLY compatibility adapter for the EXISTING admin UI.
 * The old UI remains untouched. Routes/authentication to be added separately
 * after all API shapes are accepted; NEVER expose these functions publicly.
 */
import {ipHash,QUOTAS} from './guard-store.mjs';
import {sha256Hex} from '../chronicle/normalize.mjs';
const dayMsk=t=>new Date(t+3*3600000).toISOString().slice(0,10);
const isoShift=(day,delta)=>new Date(Date.parse(day+'T00:00:00Z')+delta*86400000).toISOString().slice(0,10);
const count=v=>Number(v||0);
const cutoffMs=now=>Math.floor(now/1000)-30*86400;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function requireDb(db){if(!db?.prepare)throw TypeError('admin_db_unavailable');return db;}
async function one(db,sql,...params){return db.prepare(sql).bind(...params).first();}
async function rows(db,sql,...params){return (await db.prepare(sql).bind(...params).all()).results||[];}
function searchPattern(query){return '%'+String(query||'').slice(0,40).replace(/[\\%_]/gu,'\\$&')+'%';}

export async function readAdminStats({db,now=Date.now(),ip,ipHashSecret}={}) {
  requireDb(db);
  const today=dayMsk(now),month=today.slice(0,7),begin=isoShift(today,-29),
    hash=await ipHash({day:today,ip,secret:ipHashSecret});
  const [monthly,visitor,days,models,states,threads,tokenUsage]=await Promise.all([
    one(db,'SELECT COUNT(*) n FROM chat_admissions WHERE month=?',month),
    one(db,'SELECT COUNT(*) n FROM chat_admissions WHERE day=? AND client_hash=?',today,hash),
    rows(db,'SELECT day,COUNT(*) n,COUNT(DISTINCT client_hash) ips FROM chat_admissions WHERE day>=? AND day<=? GROUP BY day',begin,today),
    rows(db,"SELECT model,COUNT(*) n FROM chat_turns WHERE asked_at>=? AND status='answered' GROUP BY model ORDER BY n DESC LIMIT 8",cutoffMs(now)),
    rows(db,'SELECT status,COUNT(*) n FROM chat_turns WHERE asked_at>=? GROUP BY status',cutoffMs(now)),
    one(db,'SELECT COUNT(DISTINCT conversation_id) n FROM chat_turns WHERE asked_at>=?',cutoffMs(now)),
    readTokenReport(db,today)
  ]);
  const byDay=new Map(days.map(x=>[x.day,x]));
  const daily=Array.from({length:30},(_,i)=>{
    const day=isoShift(today,i-29),x=byDay.get(day);
    return {day,admitted:count(x?.n),uniqueIps:count(x?.ips)};
  });
  return {
    ok:true,character:'sanko',generatedAt:new Date(now).toISOString(),
    limits:{daily:QUOTAS.day,monthly:QUOTAS.month,ipDaily:QUOTAS.ipDay},
    today:{admitted:daily[29].admitted,uniqueIps:daily[29].uniqueIps,
      fromThisIp:count(visitor?.n),remaining:Math.max(0,QUOTAS.day-daily[29].admitted),
      ipRemaining:Math.max(0,QUOTAS.ipDay-count(visitor?.n))},
    yesterday:{admitted:daily[28].admitted},
    week:daily.slice(-7).reduce((n,x)=>n+x.admitted,0),
    month:{admitted:count(monthly?.n),remaining:Math.max(0,QUOTAS.month-count(monthly?.n))},
    conversations30d:count(threads?.n),
    models:models.map(x=>({model:x.model||'нет данных',count:count(x.n)})),
    statuses:states.map(x=>({status:x.status||'неизвестно',count:count(x.n)})),
    daily,tokenUsage
  };
}

export async function readAdminConversationList({db,now=Date.now(),query='',limit=20,offset=0}={}){
  requireDb(db);
  if(typeof query!=='string'||query.length>250||!Number.isInteger(limit)||limit<1||limit>50||
    !Number.isInteger(offset)||offset<0||offset>5000)throw TypeError('invalid_conversation_search');
  const since=cutoffMs(now),q=query.trim().slice(0,40),pattern=searchPattern(q);
  const where=`FROM chat_turns t WHERE t.asked_at>=? AND (?='' OR EXISTS (
    SELECT 1 FROM chat_turns s WHERE s.conversation_id=t.conversation_id
      AND s.asked_at>=? AND (s.question LIKE ? ESCAPE '\\' OR s.reply LIKE ? ESCAPE '\\')))`;
  const args=[since,q,since,pattern,pattern];
  const [n,found]=await Promise.all([
    one(db,`SELECT COUNT(DISTINCT t.conversation_id) n ${where}`,...args),
    rows(db,`SELECT t.conversation_id conversationId,MIN(t.asked_at) firstAt,
      MAX(t.asked_at) lastAt,COUNT(*) turns,
      (SELECT SUBSTR(z.question,1,140) FROM chat_turns z
       WHERE z.conversation_id=t.conversation_id ORDER BY z.id DESC LIMIT 1) preview
      ${where} GROUP BY t.conversation_id ORDER BY lastAt DESC LIMIT ? OFFSET ?`,...args,limit,offset)
  ]);
  return {ok:true,total:count(n?.n),limit,offset,
    threads:found.map(x=>({conversationId:x.conversationId,firstAt:count(x.firstAt),
      lastAt:count(x.lastAt),turns:count(x.turns),preview:String(x.preview||'')}))};
}

export async function readAdminConversation({db,now=Date.now(),conversationId}={}) {
  requireDb(db);
  if(typeof conversationId!=='string'||!UUID.test(conversationId))
    throw TypeError('invalid_conversation_id');
  const since=cutoffMs(now);
  const [turns,attempts]=await Promise.all([
    rows(db,`SELECT id,admission_id admissionId,asked_at askedAt,question,reply,model,status
      FROM chat_turns WHERE conversation_id=? AND asked_at>=? ORDER BY id ASC LIMIT 1000`,conversationId,since),
    rows(db,`SELECT u.admission_id admissionId,u.attempted_at attemptedAt,
      u.model,u.result,u.total_tokens totalTokens
      FROM token_usage u JOIN chat_turns t ON t.admission_id=u.admission_id
      WHERE t.conversation_id=? AND t.asked_at>=? ORDER BY u.attempted_at ASC LIMIT 1000`,conversationId,since)
  ]);
  const byAdmission=new Map();
  for(const a of attempts){
    if(!byAdmission.has(a.admissionId))byAdmission.set(a.admissionId,[]);
    byAdmission.get(a.admissionId).push({attemptedAt:count(a.attemptedAt),
      model:String(a.model||'неизвестна'),result:String(a.result||''),
      totalTokens:a.totalTokens==null?null:count(a.totalTokens)});
  }
  return {ok:true,conversationId,attemptsAvailable:true,
    turns:turns.map(x=>({id:count(x.id),askedAt:count(x.askedAt),
      question:String(x.question||''),reply:String(x.reply||''),
      model:String(x.model||''),status:String(x.status||''),
      attempts:byAdmission.get(x.admissionId)||[]}))};
}

export async function readAdminKnowledgeStatus({db}={}) {
  requireDb(db);
  const [aggregate,sources]=await Promise.all([
    one(db,'SELECT COUNT(*) n, COALESCE(SUM(indexed),0) indexedCount FROM sanko_canon_chunks'),
    rows(db,'SELECT source,COUNT(*) n FROM sanko_canon_chunks GROUP BY source ORDER BY source')
  ]);
  return {ok:true,stored:count(aggregate?.n),indexed:count(aggregate?.indexedCount),sources};
}

export async function readAdminProfileStatus({kv}={}){
  if(!kv?.get)throw TypeError('admin_kv_unavailable');
  const [active,backupName,newVersion]=await Promise.all([
    kv.get('sanko:profile:v1'),kv.get('sanko:profile:lastBackup'),
    kv.get('sanko:vnext:approved-persona')
  ]);
  const exists=typeof active==='string'&&active.length>0;
  let vnextStatus='not_present';
  if(newVersion){try {const data=JSON.parse(newVersion);vnextStatus=data?.status||'invalid';}
    catch{vnextStatus='invalid';}}
  return {ok:true,present:exists,chars:exists?active.length:0,
    sha256:exists?await sha256Hex(active):'',
    version:exists?active.split('\n')[0].slice(0,110):'',
    hasBackup:typeof backupName==='string'&&backupName.startsWith('sanko:profile:backup:'),
    vnextStatus};
}
