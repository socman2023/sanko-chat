import test from "node:test";
import assert from "node:assert/strict";
import {canonImport,canonStats,canonLexical} from "../src/canon-store.js";
import worker from "../src/index.js";
const secret="TEST-ONLY-ADMIN-TOKEN-1234567890-abcdefghijklmnopqrstuvwxyz";
const BASE="https://sanko-chat-api.boysinger2008.workers.dev";
function fake(){
 const calls={sql:[],embedded:[],vectors:[]};
 const db={prepare(sql){
  const stmt={sql,params:[],bind(...args){this.params=args;return this;},
   async run(){calls.sql.push({sql:this.sql,args:this.params});return {success:true};},
   async first(){calls.sql.push({sql:this.sql,args:this.params});return {n:1,indexedCount:1};},
   async all(){calls.sql.push({sql:this.sql,args:this.params});
    if(sql.includes("GROUP BY source"))return {results:[{source:"heroes.docx",n:1}]};
    return {results:[]};}
  };
  return stmt;
 }};
 const env={GUARD_DB:db,ADMIN_UPDATE_TOKEN:secret,IP_HASH_SECRET:"pepper-only-tests",
  AI:{run:async(_model,opts)=>{calls.embedded.push(opts);return {data:opts.text.map(()=>Array(1024).fill(0.01))};}},
  KNOWLEDGE:{upsert:async(v)=>{calls.vectors.push(...v);return {count:v.length};}}};
 return {env,calls};
}
const rec=(id="a".repeat(30),text="Санко знает Олешку и весь мир Поднебесья.")=>({
 id:"sk26-"+id,source:"heroes.docx",scope:"characters",priority:3,date:"",
 title:"heroes",text
});
test("private canon importer stores exact text, creates Sanko-only vectors",async()=>{
 const {env,calls}=fake();
 const text="Ясмин — знакомая Санко. "+"Первые годы и прошлые походы. ".repeat(40);
 const r=await canonImport(env,{records:[rec("a".repeat(30),text)]});
 assert.equal(r.status,200);
 assert.equal((await r.json()).indexed,1);
 assert.equal(calls.vectors.length,1);
 assert.equal(calls.vectors[0].metadata.character,"sanko");
 assert.equal(calls.vectors[0].metadata.text,text);
 assert.equal(calls.embedded.length,1);
 assert(calls.sql.some(x=>x.sql.includes("CREATE TABLE IF NOT EXISTS sanko_canon_chunks")));
 assert(calls.sql.some(x=>x.sql.includes("INSERT INTO sanko_canon_chunks")));
 assert(calls.sql.some(x=>x.sql.includes("SET indexed=1")));
 assert(!calls.sql.some(x=>x.sql.includes("oleshka_vk_diary")));
});
test("invalid import is rejected without database or AI side effects",async()=>{
 const {env,calls}=fake();
 for(const entry of [{...rec(),source:"private-secrets.txt"},{...rec(),text:"x".repeat(2601)}]){
  const r=await canonImport(env,{records:[entry]});
  assert.equal(r.status,400);
 }
 assert.equal(calls.sql.length,0);assert.equal(calls.embedded.length,0);
});
test("source-specific database statistics are separate from Oleshka",async()=>{
 const {env}=fake();
 const r=await canonStats(env);assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.stored,1);assert.equal(body.indexed,1);
 assert.equal(body.sources[0].source,"heroes.docx");
});
test("admin import is unavailable without authenticated secret",async()=>{
 const {env,calls}=fake();
 const r=await worker.fetch(new Request(BASE+"/admin/knowledge/import",{
  method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({records:[rec()]})
 }),env,{waitUntil(){}});
 assert.equal(r.status,401);
 assert.equal(calls.embedded.length,0);
});
test("knowledge page never exposes source books or admin token",async()=>{
 const {env}=fake();
 const r=await worker.fetch(new Request(BASE+"/admin/knowledge"),env,{waitUntil(){}});
 assert.equal(r.status,200);
 const html=await r.text();
 assert(html.includes("Полная база знаний Санко"));
 assert(!html.includes(secret));
 assert(!html.includes("Ясмин — знакомая Санко"));
});
test("lexical corpus lookup handles uninstalled D1 corpus",async()=>{
 const r=await canonLexical({GUARD_DB:{prepare(){throw Error("no such table");}}},"Ясмин");
 assert.deepEqual(r,[]);
});
