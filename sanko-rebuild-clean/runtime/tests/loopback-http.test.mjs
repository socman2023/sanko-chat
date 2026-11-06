import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {once} from 'node:events';
import {createSankoHandler} from '../worker.mjs';
import {buildCurrentContext} from '../../chronicle/current-context.mjs';

/** Node HTTP bridge test: genuine localhost fetch, not a Cloudflare deployment. */
test('loopback HTTP: chat, conversation history, CORS and admin denial',async t=>{
  const captured=[],history=[];
  const context=buildCurrentContext({today:'2026-11-06',posts:[],sourceReadComplete:true});
  const fakeDb={prepare:()=>({})};
  const env={GUARD_DB:fakeDb,DIARY_DB:fakeDb,
    CURRENT_CONTEXT:{get:async()=>null},GEMINI_API_KEY:'test-only',
    GEMINI_MODEL:'gemini-test',IP_HASH_SECRET:'fake-testing-secret-with-min-20-chars',
    ADMIN_UPDATE_TOKEN:'fake-but-long-admin-xxxxxxxxxxxxxxxxxxxx'};
  let calls=0;
  const worker=createSankoHandler({now:()=>Date.parse('2026-11-06T17:00:00Z'),
    personaLoader:async()=>({approved:true,instructions:'Ты Санко, славон. Отвечай кратко.'}),
    contextLoader:async()=>context,knowledgeLoader:async()=>({hits:[]}),
    quota:async()=>({ok:true,requestId:'fake-req'}),saveTurn:async()=>{},saveUsage:async()=>{},
    modelFactory:()=>({generate:async input=>{calls++;captured.push(input);
      return {text:'Здрав будь!',model:'fixture-model',usage:{promptTokenCount:4800}};}})
  });
  const server=createServer(async(req,res)=>{
    try{
      const url=`http://127.0.0.1:${server.address().port}${req.url}`;
      const request=new Request(url,{method:req.method,headers:req.headers,
        ...(req.method==='GET'||req.method==='HEAD'?{}:
          {body:Readable.toWeb(req),duplex:'half'})});
      const result=await worker.fetch(request,env);
      res.writeHead(result.status,Object.fromEntries(result.headers));
      if(result.body)Readable.fromWeb(result.body).pipe(res);else res.end();
    }catch(e){res.writeHead(500);res.end('internal');}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>server.close());
  const address=`http://127.0.0.1:${server.address().port}`;
  const headers={'Content-Type':'application/json',Origin:address};
  const h=await fetch(address+'/health',{headers:{Origin:address}});
  assert.equal(h.status,200);
  assert.equal((await h.json()).diarySync.status,'read_error');
  let conversationId;
  for(const msg of ['Здрав будь!','А у тебя шо нового?','А сегодня?']){
    const r=await fetch(address+'/api/chat',{method:'POST',headers,
      body:JSON.stringify({message:msg,history,conversationId})});
    assert.equal(r.status,200,await r.clone().text());
    const v=await r.json();
    assert.equal(v.reply,'Здрав будь!');
    conversationId=v.conversationId;
    history.push({role:'user',text:msg},{role:'model',text:v.reply});
  }
  assert.equal(calls,3);
  assert.equal(captured[2].history.length,4);
  const forbidden=await fetch(address+'/admin/chats/list',{method:'POST',
    headers:{...headers,Origin:'https://evil.example'},
    body:'{}'});
  assert.equal(forbidden.status,403);
  // Admin origin must equal URL origin; same-origin request gets 401 instead.
  const self=await fetch(address+'/admin/chats/list',{method:'POST',headers,
    body:'{}'});
  assert.equal(self.status,401); // Same-origin data access requires owner token.
});
