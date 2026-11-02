import { EMBEDDING_MODEL } from "./lib.js";
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
export async function canonSetup(db){
 await db.prepare("CREATE TABLE IF NOT EXISTS sanko_canon_chunks (id TEXT PRIMARY KEY, source TEXT NOT NULL, scope TEXT NOT NULL, priority INTEGER NOT NULL, published_day TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, search_text TEXT NOT NULL DEFAULT '', indexed INTEGER NOT NULL DEFAULT 0)").run();
 const cols=await db.prepare("PRAGMA table_info(sanko_canon_chunks)").all();
 if(cols?.results?.length&&!cols.results.some(x=>x.name==="search_text"))
  await db.prepare("ALTER TABLE sanko_canon_chunks ADD COLUMN search_text TEXT NOT NULL DEFAULT ''").run();
}
export async function canonStats(env){
 try{
  await canonSetup(env.GUARD_DB);
  const a=await env.GUARD_DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(indexed),0) AS indexedCount FROM sanko_canon_chunks").first();
  const b=await env.GUARD_DB.prepare("SELECT source,COUNT(*) n FROM sanko_canon_chunks GROUP BY source ORDER BY source").all();
  return json({ok:true,stored:Number(a?.n||0),indexed:Number(a?.indexedCount||0),sources:b?.results||[]});
 }catch{return json({error:"corpus_storage_unavailable"},503);}
}

const ALLOWED=new Set(["heroes_main.docx","heroes.docx","academy_first_semester_2026.docx",
"academy_plan.docx","book1.docx","book2.docx","book3.docx","podnebesie_calendars.docx",
"podnebesie_gods.docx","podnebesie_peoples.docx","blog.txt"]);
const SCOPES=new Set(["characters","academy","books","world","diary"]);
function valid(e) {
 return e&&typeof e==="object"&&/^sk26-[a-f0-9]{30}$/.test(e.id||"")&&
 ALLOWED.has(e.source)&&SCOPES.has(e.scope)&&typeof e.text==="string"&&
 e.text.length>0&&e.text.length<=2600&&typeof e.title==="string"&&e.title.length<=160&&
 Number.isInteger(e.priority)&&e.priority>=1&&e.priority<=9&&
 typeof e.date==="string"&&(e.date===""||/^20\d\d-\d\d-\d\d$/.test(e.date));
}
export async function canonImport(env,body) {
 const records=body?.records;
 if(!Array.isArray(records)||records.length<1||records.length>8||!records.every(valid))
  return json({error:"invalid_corpus_batch",batchMax:8},400);
 if(new Set(records.map(e=>e.id)).size!==records.length)return json({error:"duplicate_ids"},400);
 if(!env.GUARD_DB?.prepare||!env.AI?.run||!env.KNOWLEDGE?.upsert)
  return json({error:"missing_corpus_bindings"},503);
 try{await canonSetup(env.GUARD_DB);}catch{return json({error:"d1_schema_failed"},503);}
 const stmt="INSERT INTO sanko_canon_chunks "+
 "(id,source,scope,priority,published_day,title,content,search_text,indexed) "+
 "VALUES (?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET "+
 "source=excluded.source,scope=excluded.scope,priority=excluded.priority,"+
 "published_day=excluded.published_day,title=excluded.title,content=excluded.content,"+
 "search_text=excluded.search_text,indexed=0";
 try{
  const inserts=records.map(e=>env.GUARD_DB.prepare(stmt).bind(e.id,e.source,e.scope,
    e.priority,e.date,e.title,e.text,(e.title+"\n"+e.text).toLocaleLowerCase("ru-RU")));
  if(env.GUARD_DB.batch)await env.GUARD_DB.batch(inserts);
  else for(const insert of inserts)await insert.run();
 }catch(err){console.warn("Sanko canon D1 failure",err?.name);return json({error:"d1_import_failed"},503);}
 try{
  const vectors=await env.AI.run(EMBEDDING_MODEL,{text:records.map(e=>e.title+"\n"+e.text)});
  if(!Array.isArray(vectors?.data)||vectors.data.length!==records.length)
    throw Error("embedding_count");
  const chunks=records.map((e,i)=>{
   const values=vectors.data[i];
   if(!Array.isArray(values)||values.length!==1024||!values.every(Number.isFinite))
     throw Error("embedding_shape");
   return {id:e.id,values,metadata:{character:"sanko",source:e.source,
      layer:e.scope,priority:e.priority,date:e.date,title:e.title,text:e.text}};
  });
  await env.KNOWLEDGE.upsert(chunks);
 }catch(err){console.warn("Sanko canon embedding failure",err?.name);
  return json({error:"vector_import_failed",stored:records.length,indexed:0},503);}
 try{
  const done=records.map(e=>env.GUARD_DB.prepare(
    "UPDATE sanko_canon_chunks SET indexed=1 WHERE id=?").bind(e.id));
  if(env.GUARD_DB.batch)await env.GUARD_DB.batch(done);
  else for(const item of done)await item.run();
 }catch(err){console.warn("Sanko canon status failure",err?.name);
  return json({error:"status_write_failed",stored:records.length,indexed:records.length},503);}
 return json({ok:true,stored:records.length,indexed:records.length});
}

export async function canonLexical(env,question,max=6) {
 if(!env.GUARD_DB?.prepare)return [];
 const stop=new Set(["когда","почему","какая","какие","такое","вообще",
 "расскажи","какой","который","помнишь","знаешь","дневнике",
 "сегодня","вчера","потом","тогда","олешка","санко",
 "поднебесье","поднебесья","поднебесье","скажешь","скажешь"]);
 const tokens=(String(question||"").toLocaleLowerCase("ru-RU").match(/[\p{L}]{4,}/gu)||[])
  .filter(x=>!stop.has(x));
 const terms=[...new Set(tokens.map(w=>{
  const stem=w.length>=6?w.replace(/(иями|ями|ами|ого|его|ому|ему|ыми|ими|остью|остью|ами|ями|ьям|ьей|иях|иях|ией|ого|ого|ов|ев|ой|ий|ые|ия|ью|ом|ем|а|я|ы|и|у|е)$/u,""):w;
  return stem.length>=4?stem:w;
 }))].slice(0,3);
 if(!terms.length)return [];
 const query=String(question||"").toLocaleLowerCase("ru-RU");
 const target=/бог|бож|пантеон|народ|стран|календар|празд|географ|карту|города|местност|царств/u.test(query)?"world":
  /академ|урок|предмет|учител|курс|школ|экзамен/u.test(query)?"academy":
  /кто|кому|чей|знаком|люб|родствен|семь|друг/u.test(query)?"characters":"diary";
 try{
  const sql="SELECT id,source,scope,priority,published_day,content FROM sanko_canon_chunks "+
   "WHERE "+terms.map(()=>"search_text LIKE ? ESCAPE '\\'").join(" OR ")+
   " ORDER BY CASE WHEN scope=? THEN 0 ELSE 1 END, priority ASC,published_day DESC LIMIT ?";
  const args=terms.map(w=>"%"+w.replace(/[%_\\]/g,"\\$&")+"%");
  const r=await env.GUARD_DB.prepare(sql).bind(...args,target,max).all();
  return (r?.results||[]).map(x=>({id:x.id,text:String(x.content),
   source:String(x.source),layer:String(x.scope),date:String(x.published_day||""),
   priority:Number(x.priority||9),score:1}));
 }catch{return [];}
}
