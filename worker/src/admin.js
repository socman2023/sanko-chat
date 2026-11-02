// Private read-only administration for the independent Sanko Worker.
// Public HTML contains no secret or user data. API requires Sanko's own
// ADMIN_UPDATE_TOKEN secret. Never access DIARY_DB or Oleshka's chat logs.
import { dayInMoscow, LIMITS } from "./lib.js";
import { ADMIN_HTML, ADMIN_CSS, ADMIN_SCRIPT } from "./admin-ui.js";
import { canonStats,canonImport } from "./canon-store.js";

const cutoff = () => Math.floor(Date.now()/1000)-30*86400;
const securityHeaders = {
 "Cache-Control":"no-store, no-cache, must-revalidate",
 "Pragma":"no-cache",
 "X-Content-Type-Options":"nosniff",
 "X-Frame-Options":"DENY",
 "Referrer-Policy":"no-referrer",
 "Cross-Origin-Resource-Policy":"same-origin"
};
function reply(data,status=200) {
 return new Response(JSON.stringify(data),{status,headers:{
  ...securityHeaders,"Content-Type":"application/json; charset=utf-8",
  "Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'"
 }});
}
function page(content,type="text/html; charset=utf-8") {
 return new Response(content,{headers:{...securityHeaders,"Content-Type":type,
  "Content-Security-Policy":"default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"
 }});
}
async function adminAuthorized(req,env) {
 const expected=String(env.ADMIN_UPDATE_TOKEN||"");
 const provided=req.headers.get("Authorization")||"";
 if(expected.length<32||expected.length>4096||!provided.startsWith("Bearer "))return false;
 const token=provided.slice(7);
 if(token.length<32||token.length>4096)return false;
 // Compare SHA-256 digests in fixed time to avoid leaking prefixes/lengths.
 const enc=new TextEncoder();
 const [one,two]=await Promise.all([
  crypto.subtle.digest("SHA-256",enc.encode(expected)),
  crypto.subtle.digest("SHA-256",enc.encode(token))
 ]);
 const a=new Uint8Array(one),b=new Uint8Array(two);
 let different=0;for(let i=0;i<a.length;i++)different|=a[i]^b[i];
 return different===0;
}
async function jsonBody(req,maxBytes=3000) {
 const raw=await req.text();
 if(new TextEncoder().encode(raw).byteLength>maxBytes)throw Error("body_too_large");
 try{return JSON.parse(raw||"{}");}catch{throw Error("invalid_json");}
}
async function hashedIP(req,env,day) {
 const src=day+"|"+(req.headers.get("CF-Connecting-IP")||"unknown")+"|"+String(env.IP_HASH_SECRET);
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(src));
 return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");
}
const count=n=>Number(n||0);
async function stats(req,env) {
 const today=dayInMoscow(),month=today.slice(0,7),start=Date.parse(today+"T00:00:00Z");
 const begin=new Date(start-29*86400000).toISOString().slice(0,10);
 const ip=await hashedIP(req,env,today);
 const db=env.GUARD_DB;
 const [admissions,visitor,byDay,models,turnStatus,threads]=await Promise.all([
  db.prepare("SELECT COUNT(*) AS n FROM chat_admissions WHERE month=?").bind(month).first(),
  db.prepare("SELECT COUNT(*) AS n FROM chat_admissions WHERE day=? AND client_hash=?").bind(today,ip).first(),
  db.prepare("SELECT day,COUNT(*) AS n,COUNT(DISTINCT client_hash) AS ips FROM chat_admissions WHERE day>=? AND day<=? GROUP BY day ORDER BY day ASC")
    .bind(begin,today).all(),
  db.prepare("SELECT model,COUNT(*) AS n FROM chat_turns WHERE asked_at>=? AND status='answered' GROUP BY model ORDER BY n DESC LIMIT 8")
    .bind(cutoff()).all(),
  db.prepare("SELECT status,COUNT(*) AS n FROM chat_turns WHERE asked_at>=? GROUP BY status").bind(cutoff()).all(),
  db.prepare("SELECT COUNT(DISTINCT conversation_id) AS n FROM chat_turns WHERE asked_at>=?").bind(cutoff()).first()
 ]);
 const map=new Map((byDay?.results||[]).map(row=>[row.day,row]));
 const daily=Array.from({length:30},(_,i)=>{
  const day=new Date(start-(29-i)*86400000).toISOString().slice(0,10);
  const row=map.get(day);
  return {day,admitted:count(row?.n),uniqueIps:count(row?.ips)};
 });
 const t=daily[29],y=daily[28],monthTotal=count(admissions?.n),ipTotal=count(visitor?.n);
 return reply({ok:true,character:"sanko",generatedAt:new Date().toISOString(),
  limits:{daily:LIMITS.day,monthly:LIMITS.month,ipDaily:LIMITS.ipDay},
  today:{admitted:t.admitted,uniqueIps:t.uniqueIps,fromThisIp:ipTotal,
   remaining:Math.max(0,LIMITS.day-t.admitted),ipRemaining:Math.max(0,LIMITS.ipDay-ipTotal)},
  yesterday:{admitted:y.admitted},
  week:daily.slice(-7).reduce((a,x)=>a+x.admitted,0),
  month:{admitted:monthTotal,remaining:Math.max(0,LIMITS.month-monthTotal)},
  conversations30d:count(threads?.n),
  models:(models?.results||[]).map(x=>({model:String(x.model||"нет данных"),count:count(x.n)})),
  statuses:(turnStatus?.results||[]).map(x=>({status:String(x.status||"неизвестно"),count:count(x.n)})),
  daily});
}
function validUUID(s) {
 return typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
function searchPattern(s) {
 const chars=[...String(s||"").trim().slice(0,40)];
 const esc=v=>v.replace(/[\\%_]/g,"\\$&");
 while(chars.length&&new TextEncoder().encode("%"+esc(chars.join(""))+"%").length>46)chars.pop();
 return "%"+esc(chars.join(""))+"%";
}
async function conversations(req,env,body) {
 const query=typeof body.query==="string"?body.query.trim().slice(0,40):"";
 const pattern=searchPattern(query);
 const limit=Number.isInteger(body.limit)?Math.min(50,Math.max(1,body.limit)):20;
 const offset=Number.isInteger(body.offset)?Math.min(5000,Math.max(0,body.offset)):0;
 const where="FROM chat_turns t WHERE t.asked_at>=? AND (?='' OR EXISTS ("+
   "SELECT 1 FROM chat_turns s WHERE s.conversation_id=t.conversation_id "+
   "AND s.asked_at>=? AND (s.question LIKE ? ESCAPE '\\' OR s.reply LIKE ? ESCAPE '\\')))";
 const params=[cutoff(),query,cutoff(),pattern,pattern];
 const db=env.GUARD_DB;
 const [total,rows]=await Promise.all([
  db.prepare("SELECT COUNT(DISTINCT t.conversation_id) AS n "+where).bind(...params).first(),
  db.prepare("SELECT t.conversation_id AS conversationId, "+
   "MIN(t.asked_at) AS firstAt,MAX(t.asked_at) AS lastAt,COUNT(*) AS turns, "+
   "(SELECT SUBSTR(z.question,1,140) FROM chat_turns z WHERE z.conversation_id=t.conversation_id "+
   "ORDER BY z.id DESC LIMIT 1) AS preview "+
   where+" GROUP BY t.conversation_id ORDER BY lastAt DESC LIMIT ? OFFSET ?")
    .bind(...params,limit,offset).all()
 ]);
 return reply({ok:true,total:count(total?.n),limit,offset,
  threads:(rows?.results||[]).map(x=>({
   conversationId:x.conversationId,firstAt:count(x.firstAt),lastAt:count(x.lastAt),
   turns:count(x.turns),preview:String(x.preview||"")
  }))});
}
async function thread(env,body) {
 if(!validUUID(body?.conversationId))return reply({error:"invalid_conversation_id"},400);
 const rows=await env.GUARD_DB.prepare(
  "SELECT id,asked_at AS askedAt,question,reply,model,status "+
  "FROM chat_turns WHERE conversation_id=? AND asked_at>=? ORDER BY id ASC LIMIT 1000"
 ).bind(body.conversationId,cutoff()).all();
 return reply({ok:true,conversationId:body.conversationId,
  turns:(rows?.results||[]).map(x=>({
   id:count(x.id),askedAt:count(x.askedAt),
   question:String(x.question||""),reply:String(x.reply||""),
   model:String(x.model||""),status:String(x.status||"")
  }))});
}
// GET pages are public, but expose no data. POST data requires auth.
export async function adminFetch(req,env) {
 const pathname=new URL(req.url).pathname;
 if(req.method==="GET") {
  if(pathname==="/admin")return Response.redirect(new URL("/admin/stats",req.url),302);
  if(pathname==="/admin/stats"||pathname==="/admin/chats"||pathname==="/admin/knowledge")
    return page(ADMIN_HTML.replace("__PAGE__",pathname==="/admin/stats"?"stats":pathname==="/admin/chats"?"chats":"knowledge"));
  if(pathname==="/admin/assets/style.css")return page(ADMIN_CSS,"text/css; charset=utf-8");
  if(pathname==="/admin/assets/app.js")return page(ADMIN_SCRIPT,"application/javascript; charset=utf-8");
  return reply({error:"not_found"},404);
 }
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 // Do not accept cross-origin administrative requests even with a guessed token.
 const origin=req.headers.get("Origin");
 if(origin&&origin!==new URL(req.url).origin)return reply({error:"forbidden_origin"},403);
 if(!await adminAuthorized(req,env))return reply({error:"unauthorized"},401);
 if(!env.GUARD_DB?.prepare||!env.IP_HASH_SECRET)return reply({error:"database_unavailable"},503);
 let body={};
 try{body=await jsonBody(req,pathname==="/admin/knowledge/import"?175000:3000);}catch(err){return reply({error:err.message||"bad_request"},400);}
 try{
  if(pathname==="/admin/stats/data")return await stats(req,env);
  if(pathname==="/admin/chats/list")return await conversations(req,env,body);
  if(pathname==="/admin/chats/thread")return await thread(env,body);
  if(pathname==="/admin/knowledge/status")return await canonStats(env);
  if(pathname==="/admin/knowledge/import")return await canonImport(env,body);
  return reply({error:"not_found"},404);
 }catch(err){
  console.warn("Sanko admin query failed",err?.name||"unknown");
  return reply({error:"temporarily_unavailable"},503);
 }
}
