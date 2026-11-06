import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyVkLaunch,validatedVkName} from '../vk-auth.mjs';
import {recognizeVkVisitor} from '../vk-relationships.mjs';
import {authorizeAdmin,createAdminApi} from '../admin-api.mjs';
import {activateLegacyProfile,restoreLegacyProfile,importCanonBatch,validateLegacyProfile}
  from '../admin-mutations.mjs';
import {createSankoHandler} from '../worker.mjs';
import {buildCurrentContext} from '../../chronicle/current-context.mjs';

const now=Date.parse('2026-11-06T16:00:00Z');
const timestamp=Math.floor(now/1000);
const APP='54875852',SECRET='unit-test-only-secret-vk-not-real',TOKEN='a'.repeat(40);
const HOME='https://test.invalid',ORIGIN='https://socman2023.github.io';
const rawEnv={GUARD_DB:{prepare(){return{}}},CURRENT_CONTEXT:{get:async()=>null},
  IP_HASH_SECRET:'long-secret-string-of-30-characters-for-tests',ADMIN_UPDATE_TOKEN:TOKEN};
function adminReq(path,body={},token=TOKEN,origin=HOME){
  return new Request(HOME+path,{method:'POST',headers:{Authorization:'Bearer '+token,
    'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
}
function adminStub(override={}){
  const hits={stats:0,list:0,thread:0,knowledge:0,profile:0,mutations:0};
  const fixture={
    readStats:async()=>{hits.stats++;return{ok:true,today:{admitted:8}};},
    readList:async()=>{hits.list++;return{ok:true,threads:[]};},
    readThread:async()=>{hits.thread++;return{ok:true,turns:[]};},
    readKnowledge:async()=>{hits.knowledge++;return{ok:true,stored:123};},
    readProfile:async()=>{hits.profile++;return{ok:true,present:true};},
    writeProfile:async()=>{hits.mutations++;return{data:{ok:true}};},
    restoreProfile:async()=>{hits.mutations++;return{data:{ok:true}};},
    writeCanon:async()=>{hits.mutations++;return{data:{ok:true}};},
    now:()=>now,...override};
  return {api:createAdminApi(fixture),hits};
}
async function signedLaunch({uid=850667816,app=APP,ts=timestamp,secret=SECRET,
  extra=[],signatureOverride}={}){
  const pairs=[['vk_app_id',String(app)],['vk_user_id',String(uid)],['vk_ts',String(ts)],...extra];
  const sorted=[...pairs].filter(([k])=>k.startsWith('vk_')).sort(([a],[b])=>a.localeCompare(b,'en'));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,
    new TextEncoder().encode(new URLSearchParams(sorted).toString())));
  const hash=btoa(String.fromCharCode(...signature)).replace(/\+/gu,'-')
    .replace(/\//gu,'_').replace(/=+$/gu,'');
  return '?'+new URLSearchParams([...pairs,['sign',signatureOverride??hash]]).toString();
}

// Signed VK protocol — independent from frontend and legacy code.
test('valid VK signature verifies exact app, ID and timestamp',async()=>{
  const launch=await signedLaunch();
  const v=await verifyVkLaunch(launch,{appId:APP,appSecret:SECRET,now});
  assert.equal(v.userId,850667816);assert.equal(v.issuedAt,timestamp);
});
test('VK signature with changed user ID is rejected',async()=>{
  const launch=(await signedLaunch()).replace('850667816','12345');
  assert.equal(await verifyVkLaunch(launch,{appId:APP,appSecret:SECRET,now}),null);
});
test('VK signed launch cannot be used for another app',async()=>{
  const launch=await signedLaunch();
  assert.equal(await verifyVkLaunch(launch,{appId:'1',appSecret:SECRET,now}),null);
});
test('VK signature with wrong secret is rejected',async()=>{
  const launch=await signedLaunch({secret:'wrong-secret'});
  assert.equal(await verifyVkLaunch(launch,{appId:APP,appSecret:SECRET,now}),null);
});
test('VK signed launch expired beyond one day is rejected',async()=>{
  const launch=await signedLaunch({ts:timestamp-86401});
  assert.equal(await verifyVkLaunch(launch,{appId:APP,appSecret:SECRET,now}),null);
});
test('VK signed launch with future timestamp beyond one day is rejected',async()=>{
  const launch=await signedLaunch({ts:timestamp+86401});
  assert.equal(await verifyVkLaunch(launch,{appId:APP,appSecret:SECRET,now}),null);
});
test('VK signed launch missing timestamp is rejected',async()=>{
  const launch=(await signedLaunch()).replace(/vk_ts=\d+&/u,'');
  assert.equal(await verifyVkLaunch(launch,{appId:APP,appSecret:SECRET,now}),null);
});
test('VK duplicate signature parameters fail closed',async()=>{
  const launch=await signedLaunch({extra:[['vk_user_id','123']]});
  assert.equal(await verifyVkLaunch(launch,{appId:APP,appSecret:SECRET,now}),null);
});
test('VK malformed signature and oversized signed payload fail',async()=>{
  assert.equal(await verifyVkLaunch('?'+'x'.repeat(4000),{appId:APP,appSecret:SECRET,now}),null);
  const launch=await signedLaunch({signatureOverride:'A'.repeat(43)});
  assert.equal(await verifyVkLaunch(launch,{appId:APP,appSecret:SECRET,now}),null);
});
test('VK name is accepted only when paired with signed user ID',async()=>{
  const verified={userId:850667816};
  assert.equal(validatedVkName({vkFirstName:'Олешка',vkFirstNameUserId:850667816},verified),'Олешка');
  assert.equal(validatedVkName({vkFirstName:'Олешка',vkFirstNameUserId:12},verified),'');
  assert.equal(validatedVkName({vkFirstName:'Олешка',vkFirstNameUserId:850667816},null),'');
  assert.equal(validatedVkName({vkFirstName:'<script>',vkFirstNameUserId:850667816},verified),'');
});
test('VK relations without service token are neutral and unverified',async()=>{
  const r=await recognizeVkVisitor({env:{VK_OWNER_USER_ID:'1029851985'},userId:123});
  assert.deepEqual(r,{role:'stranger',roleChecked:false});
});
test('VK relation lookup recognizes only own character owner list, no names',async()=>{
  let requests=[];
  const fetchFn=async (url,opts)=>{const p=new URLSearchParams(opts.body);requests.push(p);
    return {ok:true,json:async()=>({response:{count:1,items:[123]}})};};
  const env={VK_OWNER_USER_ID:'1029851985',VK_SERVICE_TOKEN:'1234567890123456',
    CURRENT_CONTEXT:{get:async()=>null,put:async()=>{}}};
  const r=await recognizeVkVisitor({env,userId:123,fetchFn,now});
  assert.equal(r.role,'friend');assert.equal(r.roleChecked,true);
  assert(requests.every(x=>x.get('user_id')==='1029851985'));
});
test('VK relation service errors never assert true stranger classification',async()=>{
  const env={VK_OWNER_USER_ID:'1029851985',VK_SERVICE_TOKEN:'1234567890123456'};
  const result=await recognizeVkVisitor({env,userId:123,
    fetchFn:async()=>({ok:false}),now});
  assert.deepEqual(result,{role:'stranger',roleChecked:false});
});

// Admin access boundary.
test('owner API refuses missing, wrong and too-short Bearer tokens',async()=>{
  const {api,hits}=adminStub();
  for(const token of ['', 'x'.repeat(40),TOKEN.slice(0,10)]){
    const r=await api(adminReq('/admin/stats/data',{},token),rawEnv);
    assert.equal(r.status,401);
  }
  assert.equal(hits.stats,0);
});
test('owner API accepts correct secret and preserves stats response shape',async()=>{
  const {api,hits}=adminStub();
  const r=await api(adminReq('/admin/stats/data'),rawEnv);
  assert.equal(r.status,200);assert.equal((await r.json()).today.admitted,8);
  assert.equal(hits.stats,1);
  assert.equal(r.headers.get('Cache-Control').includes('no-store'),true);
});
test('owner API denies foreign browser Origin before any database access',async()=>{
  const {api,hits}=adminStub();
  const r=await api(adminReq('/admin/chats/list',{},TOKEN,'https://evil.example'),rawEnv);
  assert.equal(r.status,403);assert.equal(hits.list,0);
});
test('owner API rejects unrecognised routes and GET data requests',async()=>{
  const {api}=adminStub();
  assert.equal((await api(adminReq('/admin/root'),rawEnv)).status,404);
  const r=await api(new Request(HOME+'/admin/chats/thread'),rawEnv);
  assert.equal(r.status,405);
});
test('owner API refuses absent D1 bindings, no secondary source fallback',async()=>{
  const {api,hits}=adminStub();
  const r=await api(adminReq('/admin/stats/data'),{ADMIN_UPDATE_TOKEN:TOKEN});
  assert.equal(r.status,503);assert.equal(hits.stats,0);
});
test('owner API preserves admin list, thread, knowledge and profile endpoints',async()=>{
  const {api,hits}=adminStub();
  for(const path of ['/admin/chats/list','/admin/chats/thread','/admin/knowledge/status',
    '/admin/profile/status'])assert.equal((await api(adminReq(path),rawEnv)).status,200);
  assert.equal(hits.list,1);assert.equal(hits.thread,1);
  assert.equal(hits.knowledge,1);assert.equal(hits.profile,1);
});
test('owner API mutations are disabled without explicit opt in',async()=>{
  const {api,hits}=adminStub();
  for(const path of ['/admin/profile/activate','/admin/profile/restore',
    '/admin/knowledge/import']){
    const r=await api(adminReq(path),rawEnv);
    assert.equal(r.status,403);assert.equal((await r.json()).error,'mutation_disabled');
  }
  assert.equal(hits.mutations,0);
});
test('owner API explicitly enabled mutations invoke isolated paths',async()=>{
  const {api,hits}=adminStub();
  const env={...rawEnv,ENABLE_ADMIN_MUTATIONS:'true'};
  for(const path of ['/admin/profile/activate','/admin/profile/restore',
    '/admin/knowledge/import'])assert.equal((await api(adminReq(path),env)).status,200);
  assert.equal(hits.mutations,3);
});
test('owner API rejects too-large requests without touching stores',async()=>{
  const {api,hits}=adminStub();
  const r=await api(adminReq('/admin/stats/data',{p:'x'.repeat(4000)}),rawEnv);
  assert.equal(r.status,400);assert.equal((await r.json()).error,'body_too_large');
  assert.equal(hits.stats,0);
});
test('owner API reports invalid JSON and malformed request shapes',async()=>{
  const {api}=adminStub();
  const req=new Request(HOME+'/admin/stats/data',{method:'POST',headers:{
    Authorization:'Bearer '+TOKEN,Origin:HOME},body:'{not json'});
  assert.equal((await api(req,rawEnv)).status,400);
});
test('constant-time admin token verification never authorizes prefixes',async()=>{
  assert.equal(await authorizeAdmin(adminReq('/admin/stats/data',{},TOKEN),TOKEN),true);
  assert.equal(await authorizeAdmin(adminReq('/admin/stats/data',{},TOKEN+'x'),TOKEN),false);
});

// Owner approval data mutators are stage-only and don't write until permitted.
const profile=()=>{
  const header='САНКО — ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ v0.4.\n';
  const words=['ОЛЕШКА','ВЛАСТОЯР','ЯСМИН / ЛУНА','БРОМ','ХАСИМ',
    'СИЛЬВАРИЯ','РАТША','ЯРКО','РУМАН','ЭЛИНА','АЙОАН','КЛАСС АРБОРИСА',
    'КЛАСС СИМЕОНА','КЛАСС БРИНА','Поднебесья','источников'];
  return header+words.join(' ; ')+'\n'+'подтверждённый текст\n'.repeat(450);
};
function kvFixture(initial=''){
  const data=new Map(initial?[['sanko:profile:v1',initial]]:[]);let writes=0;
  return {data,get writes(){return writes;},kv:{
    get:async key=>data.get(key)||null,
    put:async(k,v)=>{writes++;data.set(k,v)}
  }};
}
test('legacy profile validation rejects drafts and partial persona',()=>{
  assert.equal(validateLegacyProfile('short'),'profile_length_out_of_range');
  assert.equal(validateLegacyProfile(profile()),'');
});
test('old profile preserved as KV backup before activation',async()=>{
  const prior=profile(),replacement=profile().replace('подтверждённый','согласованный');
  const {kv,data}=kvFixture(prior);
  const r=await activateLegacyProfile({kv,profile:replacement});
  assert.equal(r.data.ok,true);assert.equal(r.data.backupCreated,true);
  assert.equal(data.get('sanko:profile:v1'),replacement);
  const backKey=data.get('sanko:profile:lastBackup');
  assert.equal(data.get(backKey),prior);
});
test('profile activation fails closed if writing backup throws',async()=>{
  const prior=profile(),replacement=profile().replace('подтверждённый','согласованный');
  let active=prior;
  const kv={get:async()=>active,put:async()=>{throw Error('cannot_backup')}};
  await assert.rejects(()=>activateLegacyProfile({kv,profile:replacement}));
  assert.equal(active,prior);
});
test('profile restore maintains reverse backup',async()=>{
  const before=profile(),after=profile().replace('подтверждённый','согласованный');
  const {kv,data}=kvFixture(before);
  await activateLegacyProfile({kv,profile:after});
  const restored=await restoreLegacyProfile({kv});
  assert.equal(restored.data.restored,true);
  assert.equal(data.get('sanko:profile:v1'),before);
  assert.equal(data.get(data.get('sanko:profile:lastBackup')),after);
});
test('canon importer rejects unapproved or malformed corpus records',async()=>{
  const r=await importCanonBatch({records:[{source:'АКАДЕМИЯ.docx',id:'xx'}]});
  assert.equal(r.httpStatus,400);assert.equal(r.data.error,'invalid_corpus_batch');
});
test('canon importer writes D1 then vector and updates indexed state',async()=>{
  const dbCalls=[],vectors=[];
  const db={prepare(sql){return {bind(...args){return {
    async run(){dbCalls.push({sql,args})}
  }}}}};
  const rec={id:'sk26-'+'a'.repeat(30),source:'book1.docx',scope:'books',
    priority:4,date:'',title:'Знакомство',text:'Канонический текст'};
  const r=await importCanonBatch({db,records:[rec],ai:{run:async(name,arg)=>{
    assert.equal(name,'@cf/qwen/qwen3-embedding-0.6b');
    assert.equal(arg.text.length,1);return {data:[Array(1024).fill(0.01)]};}},
    vector:{upsert:async a=>{vectors.push(...a)}}});
  assert.equal(r.data.indexed,1);assert.equal(dbCalls.length,2);
  assert.equal(vectors[0].metadata.character,'sanko');
});
test('canon importer cannot claim indexed if embedding is unavailable',async()=>{
  const dbCalls=[];
  const db={prepare(sql){return{bind(...args){return{async run(){dbCalls.push({sql,args})}}}}}};
  const rec={id:'sk26-'+'a'.repeat(30),source:'book1.docx',scope:'books',
    priority:4,date:'',title:'Знакомство',text:'Канонический текст'};
  const r=await importCanonBatch({db,records:[rec],ai:{run:async()=>({data:[]})},
    vector:{upsert:async()=>{throw Error('should not be called')}}});
  assert.equal(r.httpStatus,503);assert.equal(r.data.indexed,0);
  assert.equal(dbCalls.length,1);
});

// End-to-end session identity is verified AGAIN for chat, not inferred from prior call.
test('/api/session reports verified Sanko VK launch and friend classification',async()=>{
  const handler=createSankoHandler({now:()=>now,
    vkRole:async()=>({role:'friend',roleChecked:true})});
  const launch=await signedLaunch();
  const r=await handler.fetch(new Request(HOME+'/api/session',{method:'POST',headers:{Origin:ORIGIN},
    body:JSON.stringify({vkLaunch:launch,vkFirstName:'Олешка',vkFirstNameUserId:850667816})}),
    {...rawEnv,VK_APP_ID:APP,VK_APP_SECRET:SECRET});
  const data=await r.json();
  assert.equal(r.status,200);assert.equal(data.verified,true);assert.equal(data.identity,'oleshka');
  assert.equal(data.role,'friend');assert.equal(data.firstName,'Олешка');
});
test('/api/session does not treat an unsigned visitor as Oleshka',async()=>{
  const handler=createSankoHandler({now:()=>now});
  const r=await handler.fetch(new Request(HOME+'/api/session',{method:'POST',headers:{Origin:ORIGIN},
    body:JSON.stringify({vkLaunch:'?vk_user_id=850667816',vkFirstName:'Олешка'})}),rawEnv);
  const data=await r.json();
  assert.equal(data.verified,false);assert.equal(data.identity,'reader');
  assert.equal(data.roleChecked,false);assert.equal(data.firstName,'');
});
test('verified signed Olleshka launch updates chat identity context only after HMAC validation',async()=>{
  const context=buildCurrentContext({today:'2026-11-06',posts:[],approvedClaims:[],sourceReadComplete:true});
  const seen=[];
  const handler=createSankoHandler({now:()=>now,
    personaLoader:async()=>({approved:true,instructions:'Ты Санко. 8–30 слов.'}),
    contextLoader:async()=>context,
    knowledgeLoader:async()=>({status:'ok',hits:[]}),
    quota:async()=>({ok:true,requestId:'R'}),saveTurn:async()=>{},saveUsage:async()=>{},
    modelFactory:()=>({generate:async({system})=>{
      seen.push(system);return{text:'Нынче нового не слыхал.',model:'mock',usage:{}};}})});
  const signed=await signedLaunch();
  const env={...rawEnv,DIARY_DB:{prepare:()=>({})},
    GEMINI_API_KEY:'test-only',GEMINI_MODEL:'gemini-test',
    VK_APP_ID:APP,VK_APP_SECRET:SECRET};
  for(const launch of ['?vk_user_id=850667816',signed]){
    const r=await handler.fetch(new Request(HOME+'/api/chat',{method:'POST',headers:{Origin:ORIGIN},
      body:JSON.stringify({message:'Як дела?',vkLaunch:launch})}),env);
    assert.equal(r.status,200);
  }
  assert.equal(seen.length,2);
  assert.equal(seen[0].includes('Собеседник удостоверенно Олешка'),false);
  assert.equal(seen[1].includes('Собеседник удостоверенно Олешка'),true);
});

test('admin pages return 503 unless approved original UI assets are actually present',async()=>{
  const handler=createSankoHandler();
  const r=await handler.fetch(new Request(HOME+'/admin/stats'),rawEnv);
  assert.equal(r.status,503);
  assert.equal(r.headers.get('Content-Security-Policy')?.includes("frame-ancestors 'none'"),true);
});
test('presentation-only admin pages preserve original routes without sharing dialogue code',async()=>{
  const {createAdminUiRoutes}=await import('../admin-ui-routes.mjs');
  const adminUi=createAdminUiRoutes({html:'<body data-page="__PAGE__">',css:'body{}',js:'console.log(1)'});
  const handler=createSankoHandler({adminUi});
  for(const path of ['/admin/stats','/admin/chats','/admin/knowledge','/admin/profile']){
    const r=await handler.fetch(new Request(HOME+path),rawEnv);
    assert.equal(r.status,200);
    const html=await r.text();assert(html.includes(path.split('/').at(-1)));
    assert.equal(r.headers.get('Content-Type'),'text/html; charset=utf-8');
  }
  const css=await handler.fetch(new Request(HOME+'/admin/assets/style.css'),rawEnv);
  assert.equal(css.status,200);
  const js=await handler.fetch(new Request(HOME+'/admin/assets/app.js'),rawEnv);
  assert.equal(js.status,200);
});

test('production identifiers are excluded from isolated staging configuration',async()=>{
  const {readFileSync}=await import('node:fs');
  const file=new URL('../staging/wrangler.staging.example.toml',import.meta.url);
  const value=readFileSync(file,'utf8');
  for(const id of ['d566ac31-19ce-463f-80e5-6ed1b0d56b16',
    '3d356f87-0894-4c03-8dac-a3b82ae2ed6c',
    '64705cefb4f54ff7bed3da7c5f0cb472'])assert(!value.includes(id));
  assert(value.includes('sanko-chat-next-staging'));
  assert(value.includes('ENABLE_ADMIN_MUTATIONS = "false"'));
});
test('staging migration creates same D1 tables as existing admin without production access',async()=>{
  const {DatabaseSync}=await import('node:sqlite');
  const {readFileSync}=await import('node:fs');
  const db=new DatabaseSync(':memory:');
  try{
    const sql=readFileSync(new URL('../staging/migrations/0001_clean_staging.sql',import.meta.url),'utf8');
    db.exec(sql);
    const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
    for(const t of ['chat_admissions','chat_turns','token_usage','sanko_canon_chunks'])
      assert(names.includes(t));
  }finally{db.close();}
});
test('diary mirror schema is compatible with D1 reader and separate from live tables',async()=>{
  const {DatabaseSync}=await import('node:sqlite');
  const {readFileSync}=await import('node:fs');
  const {inspectDiarySchema}=await import('../../chronicle/d1-source.mjs');
  const db=new DatabaseSync(':memory:');
  const schema=readFileSync(new URL('../staging/migrations/0001_diary_mirror.sql',import.meta.url),'utf8');
  try{
    db.exec(schema);
    const adapter={prepare(sql){return{all:async()=>({results:db.prepare(sql).all()})}}};
    const status=await inspectDiarySchema(adapter);
    assert.equal(status.compatible,true,JSON.stringify(status));
  }finally{db.close();}
});
test('scheduled updater stays disabled unless explicitly enabled on staging',async()=>{
  const {default:worker}=await import('../index.mjs');
  await worker.scheduled({},{ENABLE_CHRONICLE_SYNC:'false'},{});
});

test('end-to-end protected admin JSON: actual SQLite historic turn and token report',async()=>{
  const {DatabaseSync}=await import('node:sqlite');
  const {readFileSync}=await import('node:fs');
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(readFileSync(new URL('../staging/migrations/0001_clean_staging.sql',import.meta.url),'utf8'));
    const CID='a1c7aa27-32dc-420a-9442-976b42e8b2ad',TIME=Math.floor(now/1000);
    db.prepare('INSERT INTO chat_admissions VALUES(?,?,?,?,?)').run('adm-1','2026-11-06',
      '2026-11','owner-hash-placeholder',TIME);
    db.prepare('INSERT INTO chat_turns(conversation_id,admission_id,asked_at,question,reply,model,status) VALUES(?,?,?,?,?,?,?)')
      .run(CID,'adm-1',TIME,'Привет','Здрав будь!','gemini-test','answered');
    db.prepare('INSERT INTO token_usage(admission_id,attempted_at,day,model,result,prompt_tokens,candidate_tokens,thoughts_tokens,cached_tokens,total_tokens) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run('adm-1',TIME,'2026-11-06','gemini-test','answered',3300,20,5,100,3325);
    db.prepare('INSERT INTO sanko_canon_chunks VALUES(?,?,?,?,?,?,?,?,?)')
      .run('v1','book1.docx','books',5,'','Санко','Сведения о Санко','санко сведения',1);
    const adapter={prepare(sql){return{bind(...p){return{
      first:async()=>db.prepare(sql).get(...p)||null,
      all:async()=>({results:db.prepare(sql).all(...p)})};}}}};
    const current='САНКО — ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ v0.4.\n'+('приватно '.repeat(900));
    const env={...rawEnv,GUARD_DB:adapter,CURRENT_CONTEXT:{get:async key=>
      key==='sanko:profile:v1'?current:null}};
    const admin=createAdminApi({now:()=>now});
    const stats=await admin(adminReq('/admin/stats/data'),env);
    assert.equal(stats.status,200);
    const stat=await stats.json();
    assert.equal(stat.today.admitted,1);
    assert.equal(stat.tokenUsage.today.prompt,3300);
    const threads=await (await admin(adminReq('/admin/chats/list'),env)).json();
    assert.equal(threads.total,1);assert.equal(threads.threads[0].conversationId,CID);
    const conversation=await (await admin(adminReq('/admin/chats/thread',{conversationId:CID}),env)).json();
    assert.equal(conversation.turns[0].question,'Привет');
    assert.equal(conversation.turns[0].attempts[0].totalTokens,3325);
    const knowledge=await (await admin(adminReq('/admin/knowledge/status'),env)).json();
    assert.equal(knowledge.stored,1);
    const profileStatus=await (await admin(adminReq('/admin/profile/status'),env)).json();
    assert.equal(profileStatus.present,true);assert.equal(profileStatus.sha256.length,64);
    assert.equal(JSON.stringify(profileStatus).includes('приватно'),false);
  }finally{db.close();}
});
