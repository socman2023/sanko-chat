import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readTokenReport} from '../token-report.mjs';
const dbBridge=db=>({prepare(sql){return {bind(...args){return {
  all:async()=>({results:db.prepare(sql).all(...args)}),
  first:async()=>db.prepare(sql).get(...args)??null};}};}});
test('input token cost is measured separately from output and unknown usage',async()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`CREATE TABLE token_usage(id INTEGER PRIMARY KEY,admission_id TEXT,
      attempted_at INT,day TEXT,model TEXT,result TEXT,prompt_tokens INT,
      candidate_tokens INT,thoughts_tokens INT,cached_tokens INT,total_tokens INT)`);
    const insert=db.prepare(`INSERT INTO token_usage(admission_id,attempted_at,day,model,result,
      prompt_tokens,candidate_tokens,thoughts_tokens,cached_tokens,total_tokens)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    insert.run('r1',1,'2026-11-06','gemini-3.5-flash-lite','answered',6200,30,2,0,6232);
    insert.run('r2',2,'2026-11-06','gemini-3.5-flash-lite','answered',9300,40,1,0,9341);
    insert.run('r3',3,'2026-11-06','gemini-3.5-flash-lite','provider_busy',null,null,null,null,null);
    const report=await readTokenReport(dbBridge(db),'2026-11-06');
    assert.equal(report.status,'ready');
    assert.equal(report.month.calls,3);
    assert.equal(report.month.meteredCalls,2);
    assert.equal(report.month.promptMeteredCalls,2);
    assert.equal(report.month.unknownCalls,1);
    assert.equal(report.month.overPromptTargetCalls,1);
    assert.equal(report.averagePromptPerMeteredCall,7750);
    assert.equal(report.promptTokensTargetMax,8000);
    assert.equal(report.month.prompt,15500);
    assert(report.averagePerMeteredCall>report.averagePromptPerMeteredCall);
  }finally{db.close();}
});
