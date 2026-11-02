import { EMBEDDING_MODEL } from "./lib.js";
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
export async function canonSetup(db){
 await db.prepare("CREATE TABLE IF NOT EXISTS sanko_canon_chunks (id TEXT PRIMARY KEY, source TEXT NOT NULL, scope TEXT NOT NULL, priority INTEGER NOT NULL, published_day TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, indexed INTEGER NOT NULL DEFAULT 0)").run();
}
export async function canonStats(env){
 try{
  await canonSetup(env.GUARD_DB);
  const a=await env.GUARD_DB.prepare("SELECT COUNT(*) n,SUM(indexed) indexed FROM sanko_canon_chunks").first();
  const b=await env.GUARD_DB.prepare("SELECT source,COUNT(*) n FROM sanko_canon_chunks GROUP BY source ORDER BY source").all();
  return json({ok:true,stored:Number(a?.n||0),indexed:Number(a?.indexed||0),sources:b?.results||[]});
 }catch{return json({error:"corpus_storage_unavailable"},503);}
}
