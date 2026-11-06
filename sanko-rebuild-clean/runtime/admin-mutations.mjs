/** Owner-approved administrative mutations. Feature-gated, isolated from the dialogue.
 * Never write to Oleshka's D1 or KV keys. No writes unless explicitly enabled.
 */
import {sha256Hex} from '../chronicle/normalize.mjs';
const ACTIVE='sanko:profile:v1';
const LAST='sanko:profile:lastBackup';
const BACKUP='sanko:profile:backup:';
const PREFIX='САНКО — ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ v0.4.';
const CRITICAL=['ОЛЕШКА','ВЛАСТОЯР','ЯСМИН / ЛУНА','БРОМ','ХАСИМ',
  'СИЛЬВАРИЯ','РАТША','ЯРКО','РУМАН','ЭЛИНА','АЙОАН',
  'КЛАСС АРБОРИСА','КЛАСС СИМЕОНА','КЛАСС БРИНА','Поднебесья','источников'];
export function validateLegacyProfile(value){
  if(typeof value!=='string')return 'profile_not_text';
  if(value.length<7500||value.length>33000)return 'profile_length_out_of_range';
  if(!value.startsWith(PREFIX))return 'unapproved_profile_version';
  if(value.includes('ДЛЯ УТВЕРЖДЕНИЯ')||value.includes('НЕ ЗАПИСАН')||
    value.includes('черновик для критического'))return 'draft_profile_not_publishable';
  if(CRITICAL.some(w=>!value.includes(w)))return 'profile_missing_required_canon';
  return value.includes('\u0000')?'invalid_profile_text':'';
}
async function backup(kv,value){
  if(!value)return null;
  const name=BACKUP+Date.now()+'-'+crypto.randomUUID();
  await kv.put(name,value);
  return name;
}
export async function activateLegacyProfile({kv,profile}={}){
  const error=validateLegacyProfile(profile);
  if(error)return {httpStatus:400,data:{error}};
  if(!kv?.get||!kv?.put)throw Error('kv_unavailable');
  const current=await kv.get(ACTIVE);
  const sig=await sha256Hex(profile);
  if(current===profile)return {data:{ok:true,unchanged:true,chars:profile.length,sha256:sig}};
  const saved=await backup(kv,current);
  // Never risk overwriting old active profile without an existing backup.
  if(current&&!saved)throw Error('backup_required');
  // Publish the recovery pointer before changing the active value.
  if(saved)await kv.put(LAST,saved);
  await kv.put(ACTIVE,profile);
  return {data:{ok:true,chars:profile.length,sha256:sig,
    backupCreated:!!saved,version:profile.split('\n')[0].slice(0,110)}};
}
export async function restoreLegacyProfile({kv}={}){
  if(!kv?.get||!kv?.put)throw Error('kv_unavailable');
  const name=await kv.get(LAST);
  if(typeof name!=='string'||!name.startsWith(BACKUP))
    return {httpStatus:404,data:{error:'no_profile_backup'}};
  const restored=await kv.get(name);
  if(typeof restored!=='string'||restored.length<200)
    return {httpStatus:503,data:{error:'backup_unavailable'}};
  const current=await kv.get(ACTIVE);
  const undo=await backup(kv,current);
  if(current&&!undo)throw Error('backup_required');
  if(undo)await kv.put(LAST,undo);
  await kv.put(ACTIVE,restored);
  return {data:{ok:true,restored:true,chars:restored.length,sha256:await sha256Hex(restored)}};
}
const ALLOWED=new Set(['heroes_main.docx','heroes.docx','academy_first_semester_2026.docx',
 'academy_plan.docx','book1.docx','book2.docx','book3.docx','podnebesie_calendars.docx',
 'podnebesie_gods.docx','podnebesie_peoples.docx','blog.txt']);
const SCOPES=new Set(['characters','academy','books','world','diary']);
function validRecord(x){return x&&typeof x==='object'&&/^sk26-[a-f0-9]{30}$/u.test(x.id||'')&&
  ALLOWED.has(x.source)&&SCOPES.has(x.scope)&&typeof x.text==='string'&&x.text.length>0&&
  x.text.length<=2600&&typeof x.title==='string'&&x.title.length<=160&&
  Number.isInteger(x.priority)&&x.priority>=1&&x.priority<=9&&
  typeof x.date==='string'&&(x.date===''||/^20\d\d-\d\d-\d\d$/u.test(x.date));}
export async function importCanonBatch({db,ai,vector,records}={}){
  if(!Array.isArray(records)||records.length<1||records.length>8||
    !records.every(validRecord)||new Set(records.map(x=>x.id)).size!==records.length)
    return {httpStatus:400,data:{error:'invalid_corpus_batch',batchMax:8}};
  if(!db?.prepare||!ai?.run||!vector?.upsert)throw Error('canon_bindings_missing');
  const insert=`INSERT INTO sanko_canon_chunks
    (id,source,scope,priority,published_day,title,content,search_text,indexed)
    VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET
    source=excluded.source,scope=excluded.scope,priority=excluded.priority,
    published_day=excluded.published_day,title=excluded.title,content=excluded.content,
    search_text=excluded.search_text,indexed=0`;
  const statements=records.map(x=>db.prepare(insert).bind(x.id,x.source,x.scope,x.priority,
    x.date,x.title,x.text,(x.title+'\n'+x.text).toLocaleLowerCase('ru-RU')));
  if(db.batch)await db.batch(statements);
  else for(const s of statements)await s.run();
  const e=await ai.run('@cf/qwen/qwen3-embedding-0.6b',{text:records.map(x=>x.title+'\n'+x.text)});
  if(!Array.isArray(e?.data)||e.data.length!==records.length||
    e.data.some(vec=>!Array.isArray(vec)||vec.length!==1024||!vec.every(Number.isFinite)))
    return {httpStatus:503,data:{error:'embedding_unavailable',stored:records.length,indexed:0}};
  await vector.upsert(records.map((x,i)=>({id:x.id,values:e.data[i],metadata:{
    character:'sanko',source:x.source,layer:x.scope,priority:x.priority,
    date:x.date,title:x.title,text:x.text}})));
  const done=records.map(x=>db.prepare('UPDATE sanko_canon_chunks SET indexed=1 WHERE id=?').bind(x.id));
  if(db.batch)await db.batch(done);else for(const d of done)await d.run();
  return {data:{ok:true,stored:records.length,indexed:records.length}};
}
