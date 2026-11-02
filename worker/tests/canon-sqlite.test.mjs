// Actual SQLite regression tests: mocked D1 previously missed invalid SQL.
// Node 22 provides the real SQLite engine through node:sqlite.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { canonSetup, canonStats, canonImport, canonLexical } from "../src/canon-store.js";

function sqliteD1(){
 const sqlite=new DatabaseSync(":memory:");
 const sql=[];
 const db={
  prepare(query){
   sql.push(query);
   const native=sqlite.prepare(query);
   let params=[];
   return {
    bind(...args){params=args;return this;},
    async run(){return native.run(...params);},
    async first(){return native.get(...params)||null;},
    async all(){return {results:native.all(...params)};}
   };
  },
  async batch(stmts){return Promise.all(stmts.map(stmt=>stmt.run()));}
 };
 return {db,sql,close:()=>sqlite.close()};
}
const example={
 id:"sk26-"+"c".repeat(30),
 source:"heroes.docx",scope:"characters",priority:3,date:"",
 title:"Ясмин и Санко",
 text:"Ясмин (Луна) знакома Санко по цирку Брома. У Санко к ней чувства."
};
test("Sanko corpus statistics must run against actual SQLite, including empty table",async()=>{
 const {db,sql,close}=sqliteD1();
 try{
  const first=await canonStats({GUARD_DB:db});
  assert.equal(first.status,200);
  assert.deepEqual(await first.json(),{ok:true,stored:0,indexed:0,sources:[]});
  assert(sql.some(x=>x.includes("COALESCE(SUM(indexed),0) AS indexedCount")));
 }finally{close();}
});
test("import, indexed counters and Cyrillic exact name lookup work on actual SQLite",async()=>{
 const {db,close}=sqliteD1();
 const vectors=[];
 const env={GUARD_DB:db,AI:{run:async(_model,{text})=>({
   data:text.map(()=>Array(1024).fill(0.01))
 })},KNOWLEDGE:{upsert:async entries=>{vectors.push(...entries);}}};
 try{
  await canonSetup(db);
  const r=await canonImport(env,{records:[example]});
  assert.equal(r.status,200,await r.text());
  const status=await canonStats(env);
  assert.equal(status.status,200);
  const data=await status.json();
  assert.equal(data.stored,1);
  assert.equal(data.indexed,1);
  assert.equal(data.sources[0].source,"heroes.docx");
  assert.equal(vectors.length,1);
  assert.equal(vectors[0].metadata.character,"sanko");
  const hits=await canonLexical(env,"А кто такая Ясмин?");
  assert.equal(hits.length,1,"Cyrillic proper names must be searchable");
  assert.match(hits[0].text,/Санко/);
  const r2=await canonImport(env,{records:[example]});
  assert.equal(r2.status,200,"Repeated import should be idempotent");
  const after=await (await canonStats(env)).json();
  assert.equal(after.stored,1);
 }finally{close();}
});
