import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {searchTerms,readCanonicalEvidence} from '../knowledge-search.mjs';
const bind=db=>({prepare(sql){return {bind(...params){return {all:async()=>({results:db.prepare(sql).all(...params)})};}};}});
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sanko_canon_chunks (
   id TEXT PRIMARY KEY,source TEXT NOT NULL,scope TEXT NOT NULL,
   priority INTEGER NOT NULL,published_day TEXT NOT NULL,title TEXT NOT NULL,
   content TEXT NOT NULL,search_text TEXT NOT NULL DEFAULT '',indexed INTEGER NOT NULL DEFAULT 0)`);
  const insert=(id,source,scope,priority,day,title,content)=>db.prepare(
    'INSERT INTO sanko_canon_chunks (id,source,scope,priority,published_day,title,content,search_text,indexed) VALUES (?,?,?,?,?,?,?,?,1)'
  ).run(id,source,scope,priority,day,title,content,(title+'\n'+content).toLocaleLowerCase('ru-RU'));
  return {db,adapter:bind(db),insert};
}
test('only relevant historical knowledge selected, keeping source and original text',async t=>{
  const f=fixture();t.after(()=>f.db.close());
  f.insert('one','blog.txt','diary',1,'2026-10-30','Властояр',
    'Властояр — родной отец Санко и учитель боевых искусств.');
  f.insert('two','book2.docx','books',5,'','Другие ученики',
    'В Академии учится Арсенио, он помогает другим.');
  const x=await readCanonicalEvidence({db:f.adapter,question:'А кто такой Властояр?'});
  assert.equal(x.status,'found');assert.equal(x.hits.length,1);
  assert.equal(x.hits[0].id,'one');assert.equal(x.hits[0].source,'blog.txt');
  assert.equal(x.hits[0].text,'Властояр — родной отец Санко и учитель боевых искусств.');
});
test('short social chatter avoids canonical DB query',async()=>{
  let calls=0;
  const fake={prepare(){calls++;throw Error('no query expected');}};
  for(const question of ['Здрав будь!','Привет','Что было сегодня?','Что нового у тебя?']){
    const x=await readCanonicalEvidence({db:fake,question});
    assert.equal(x.status,'not_needed');
  }
  assert.equal(calls,0);
});
test('SQL injection characters are inert; query is parameterized',async t=>{
  const f=fixture();t.after(()=>f.db.close());
  f.insert('safe','book1.docx','books',5,'','Властояр','Властояр учит бою.');
  const x=await readCanonicalEvidence({db:f.adapter,question:"Властояр'); DROP TABLE sanko_canon_chunks;--"});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sanko_canon_chunks').get().n,1);
  assert.equal(x.status,'found');
});
test('never cuts partial canonical excerpt to fit char budget',async t=>{
  const f=fixture();t.after(()=>f.db.close());
  f.insert('long','heroes_main.docx','characters',1,'','Лаврент',
    'Лаврент ' + 'много сведений '.repeat(220));
  f.insert('short','heroes.docx','characters',1,'','Лаврент','Лаврент был здесь.');
  const x=await readCanonicalEvidence({db:f.adapter,question:'Лаврент',maxCharacters:250});
  assert.equal(x.hits.length,1);assert.equal(x.hits[0].id,'short');
  assert.equal(x.truncated,true);
});
test('unsupported D1 knowledge schema reports unavailable, never guessed hits',async()=>{
  const x=await readCanonicalEvidence({db:{prepare(){throw Error('no such table');}},question:'Расскажи про Властояра'});
  assert.equal(x.status,'unavailable');assert.deepEqual(x.hits,[]);
});
test('lexical terms use user message rather than previous untrusted model replies',()=>{
  assert.deepEqual(searchTerms('А кто такой Властояр?'),['властояр']);
  assert.deepEqual(searchTerms('Здрав будь!'),[]);
});
