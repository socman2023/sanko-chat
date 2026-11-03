// Private owner-controlled publication of Sanko's character profile.
// The public chat reads ONLY sanko:profile:v1, never this staging/backup key.
const ACTIVE="sanko:profile:v1";
const LAST_BACKUP="sanko:profile:lastBackup";
const BACKUP_PREFIX="sanko:profile:backup:";
const PREFIX="САНКО — ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ v0.4.";
const CRITICAL=["ОЛЕШКА","ВЛАСТОЯР","ЯСМИН / ЛУНА","БРОМ","ХАСИМ",
 "СИЛЬВАРИЯ","РАТША","ЯРКО","РУМАН","ЭЛИНА","АЙОАН","КЛАСС АРБОРИСА",
 "КЛАСС СИМЕОНА","КЛАСС БРИНА","Поднебесья","источников"];
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{
 "Content-Type":"application/json; charset=utf-8",
 "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
 "Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'"
}});
async function signature(s){
 const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
 return Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
}
function validate(value){
 if(typeof value!=="string")return "profile_not_text";
 if(value.length<7500||value.length>33000)return "profile_length_out_of_range";
 if(!value.startsWith(PREFIX))return "unapproved_profile_version";
 if(value.includes("ДЛЯ УТВЕРЖДЕНИЯ")||value.includes("НЕ ЗАПИСАН")||value.includes("черновик для критического"))return "draft_profile_not_publishable";
 if(CRITICAL.some(word=>!value.includes(word)))return "profile_missing_required_canon";
 if(value.includes("\u0000"))return "invalid_profile_text";
 return "";
}
function hasKv(env){return !!(env.CURRENT_CONTEXT?.get&&env.CURRENT_CONTEXT?.put);}
export async function profileStatus(env) {
 if(!hasKv(env))return json({error:"profile_store_unavailable"},503);
 try{
  const [active,backupName]=await Promise.all([
   env.CURRENT_CONTEXT.get(ACTIVE),env.CURRENT_CONTEXT.get(LAST_BACKUP)]);
  const exists=typeof active==="string"&&active.length>0;
  return json({ok:true,present:exists,chars:exists?active.length:0,
   sha256:exists?await signature(active):"",
   version:exists?active.split("\n")[0].slice(0,110):"",
   hasBackup:typeof backupName==="string"&&backupName.startsWith(BACKUP_PREFIX)});
 }catch(err){console.warn("Sanko private profile status failed",err?.name);return json({error:"profile_status_unavailable"},503);}
}
async function backupCurrent(kv,oldValue){
 if(typeof oldValue!=="string"||oldValue.length===0)return "";
 const name=BACKUP_PREFIX+String(Date.now())+"-"+crypto.randomUUID();
 await kv.put(name,oldValue);
 return name;
}
export async function activateProfile(env,payload) {
 if(!hasKv(env))return json({error:"profile_store_unavailable"},503);
 const profile=payload?.profile;
 const invalid=validate(profile);
 if(invalid)return json({error:invalid},400);
 try{
  const active=await env.CURRENT_CONTEXT.get(ACTIVE);
  if(active===profile)return json({ok:true,unchanged:true,chars:profile.length,sha256:await signature(profile)});
  const previousBackup=await backupCurrent(env.CURRENT_CONTEXT,active);
  await env.CURRENT_CONTEXT.put(ACTIVE,profile);
  if(previousBackup)await env.CURRENT_CONTEXT.put(LAST_BACKUP,previousBackup);
  // Do not pretend KV read-after-write consistency from another edge location.
  return json({ok:true,chars:profile.length,sha256:await signature(profile),
   backupCreated:!!previousBackup,version:profile.split("\n")[0].slice(0,110)});
 }catch(err){console.warn("Sanko profile activation failure",err?.name);
  return json({error:"profile_write_unavailable"},503);}
}
export async function restoreProfile(env) {
 if(!hasKv(env))return json({error:"profile_store_unavailable"},503);
 try{
  const name=await env.CURRENT_CONTEXT.get(LAST_BACKUP);
  if(typeof name!=="string"||!name.startsWith(BACKUP_PREFIX))
   return json({error:"no_profile_backup"},404);
  const restored=await env.CURRENT_CONTEXT.get(name);
  if(typeof restored!=="string"||restored.length<200)return json({error:"backup_unavailable"},503);
  const current=await env.CURRENT_CONTEXT.get(ACTIVE);
  const undo=await backupCurrent(env.CURRENT_CONTEXT,current);
  await env.CURRENT_CONTEXT.put(ACTIVE,restored);
  if(undo)await env.CURRENT_CONTEXT.put(LAST_BACKUP,undo);
  return json({ok:true,restored:true,chars:restored.length,sha256:await signature(restored)});
 }catch(err){console.warn("Sanko private profile restore failure",err?.name);
  return json({error:"profile_restore_unavailable"},503);}
}
