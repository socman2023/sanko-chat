// HTTP and authorization belong outside the character engine.
// The new engine preserves Sanko's existing limits, VK identity and D1 tables.
import {LIMITS,CHAT_MAX_BYTES,CHAT_MAX_CHARS,dayInMoscow,
 limitRetryAt,cleanConversationId,safeHistory} from "../lib.js";
const PAGE_ORIGIN="https://socman2023.github.io";
export const VERSION_V2="sanko-worker-2.0.0-canon-first";
export function cors(origin,env){
 return {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
  "Access-Control-Allow-Origin":origin||PAGE_ORIGIN,
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type",
  "Access-Control-Max-Age":"600","Vary":"Origin"};
}
export function jsonResponse(data,status,origin,env){
 return new Response(JSON.stringify(data),{status,headers:cors(origin,env)});
}
export async function parseChatBody(req){
 const given=Number(req.headers.get("Content-Length")||0);
 if(given>CHAT_MAX_BYTES)throw Error("body_too_large");
 const raw=await req.text();
 if(new TextEncoder().encode(raw).length>CHAT_MAX_BYTES)throw Error("body_too_large");
 let body;
 try{body=JSON.parse(raw);}catch{throw Error("invalid_json");}
 if(!body||typeof body!=="object")throw Error("invalid_json");
 const message=typeof body.message==="string"?body.message.trim():"";
 if(!message||message.length>CHAT_MAX_CHARS)throw Error("invalid_message");
 return {question:message,history:safeHistory(body.history),
  conversationId:cleanConversationId(body.conversationId),
  vkLaunch:typeof body.vkLaunch==="string"?body.vkLaunch:""};
}
export function configured(env){
 return !!(env.CURRENT_CONTEXT?.get&&env.GUARD_DB?.prepare&&
   env.DIARY_DB?.prepare&&env.GEMINI_API_KEY&&env.IP_HASH_SECRET);
}
async function signHash(text){
 const arr=new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(text)));
 return [...arr].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export async function reserveChat(env,req,nowMs=Date.now()){
 const day=dayInMoscow(nowMs),month=day.slice(0,7),admissionId=crypto.randomUUID();
 const ip=req.headers.get("CF-Connecting-IP")||"unknown";
 const client=await signHash(day+"|"+ip+"|"+String(env.IP_HASH_SECRET));
 const sql="INSERT INTO chat_admissions(request_id,day,month,client_hash,created_at) "+
  "SELECT ?,?,?,?,? WHERE "+
  "(SELECT COUNT(*) FROM chat_admissions WHERE day=?)<? AND "+
  "(SELECT COUNT(*) FROM chat_admissions WHERE month=?)<? AND "+
  "(SELECT COUNT(*) FROM chat_admissions WHERE day=? AND client_hash=?)<? "+
  "RETURNING request_id";
 try{
  const accepted=await env.GUARD_DB.prepare(sql).bind(admissionId,day,month,client,
   Math.floor(nowMs/1000),day,LIMITS.day,month,LIMITS.month,
   day,client,LIMITS.ipDay).first();
  if(accepted)return {ok:true,id:admissionId};
  const [d,m,c]=await Promise.all([
   env.GUARD_DB.prepare("SELECT COUNT(*) AS n FROM chat_admissions WHERE day=?").bind(day).first(),
   env.GUARD_DB.prepare("SELECT COUNT(*) AS n FROM chat_admissions WHERE month=?").bind(month).first(),
   env.GUARD_DB.prepare("SELECT COUNT(*) AS n FROM chat_admissions WHERE day=? AND client_hash=?")
    .bind(day,client).first()
  ]);
  const kind=Number(m?.n)>=LIMITS.month?"month":
   Number(d?.n)>=LIMITS.day?"day":Number(c?.n)>=LIMITS.ipDay?"ip":"day";
  return {ok:false,kind,retryAt:limitRetryAt(kind,day)};
 }catch(err){
  console.warn("Sanko v2 D1 admission failed",err?.name||"error");
  throw Error("quota_unavailable");
 }
}
export async function storeChat(env,{id,admissionId,question,reply="",model="",status}){
 try{
  await env.GUARD_DB.prepare("INSERT INTO chat_turns(conversation_id,admission_id,"+
   "asked_at,question,reply,model,status) VALUES(?,?,?,?,?,?,?)")
   .bind(id,admissionId,Math.floor(Date.now()/1000),question,reply,model,status).run();
 }catch(err){console.warn("Sanko v2 turn storage unavailable",err?.name||"error");}
}
export async function verifiedVkUid(launch,env){
 if(!env.VK_APP_ID||!env.VK_APP_SECRET||typeof launch!=="string"||
  !launch||launch.length>3000)return 0;
 try{
  const q=new URLSearchParams(launch.replace(/^\?/u,""));
  const uid=Number(q.get("vk_user_id")),signature=q.get("sign")||"";
  if(!Number.isSafeInteger(uid)||uid<=0||
   q.get("vk_app_id")!==String(env.VK_APP_ID)||
   !/^[A-Za-z0-9_-]{43}$/u.test(signature))return 0;
  if(q.has("vk_ts")){
   const n=Number(q.get("vk_ts"));
   if(!Number.isFinite(n)||Math.abs(Date.now()/1000-n)>86400)return 0;
  }
  const entries=[...q.entries()].filter(([k])=>k.startsWith("vk_"))
   .sort((a,b)=>a[0].localeCompare(b[0],"en"));
  const key=await crypto.subtle.importKey("raw",
   new TextEncoder().encode(env.VK_APP_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,
   new TextEncoder().encode(new URLSearchParams(entries).toString())));
  const expected=btoa(String.fromCharCode(...bytes))
   .replace(/\+/gu,"-").replace(/\//gu,"_").replace(/=+$/gu,"");
  let mismatch=0;
  for(let i=0;i<43;i++)mismatch|=expected.charCodeAt(i)^signature.charCodeAt(i);
  return mismatch===0?uid:0;
 }catch{return 0;}
}
export function admissionNotice(kind){
 if(kind==="month")return "Нынче наговорились. Погоди, коли новый месяц придёт.";
 if(kind==="ip")return "На сегодня уж наговорились. Завтра загляни, ладно?";
 return "Нынче разговоров через край, завтра продолжим.";
}
