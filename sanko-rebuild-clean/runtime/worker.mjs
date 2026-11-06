/** Standalone Cloudflare Worker prototype. Not wired into production.
 * No imports from /worker/src of existing repository. Admin migration will be
 * separate; this file deliberately has no /admin routes.
 */
import {buildCurrentContext} from '../chronicle/current-context.mjs';
import {readRecentD1} from '../chronicle/live-snapshot.mjs';
import {buildPersonaInstructions} from '../engine/persona.mjs';
import {answerAsSanko} from '../engine/conversation.mjs';
import {GeminiAdapter} from '../engine/gemini-adapter.mjs';
import {admit,storeTurn,storeTokenAttempt,QUOTAS} from './guard-store.mjs';
import {readCanonicalEvidence} from './knowledge-search.mjs';
import {createAdminApi} from './admin-api.mjs';
import {loadProductionPersona} from './production-persona.mjs';
import {createAdminUiRoutes} from './admin-ui-routes.mjs';
import {verifyVkLaunch,validatedVkName} from './vk-auth.mjs';
import {recognizeVkVisitor} from './vk-relationships.mjs';

const DEFAULT_ORIGIN='https://socman2023.github.io';
const PERSONA_KEY='sanko:vnext:approved-persona'; // New, opt-in KV key; not the old active profile
const APPROVED_CLAIMS_KEY='sanko:vnext:approved-claims';
const MAX_BODY_BYTES=35_000;
const OLESHKA_VK_ID=850667816;
const STAGING_QUOTAS=Object.freeze({day:20,month:100,ipDay:10});
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'};
const dayMsk=now=>new Date(now+3*3600_000).toISOString().slice(0,10);

function response(obj,status=200,origin='') {
  return new Response(JSON.stringify(obj),{status,headers:{...HEADERS,...(origin?{
    'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}});
}
function authorizedOrigin(request){
  const origin=request.headers.get('Origin');
  if(!origin)return true;
  // In addition to the published GitHub Pages UI, allow the Worker's own
  // origin for an isolated same-origin staging preview or local Wrangler dev.
  return origin===DEFAULT_ORIGIN||origin===new URL(request.url).origin;
}
async function readJsonBounded(request,maxBytes){
  const declared=request.headers.get('Content-Length');
  if(declared!==null && (!/^\d+$/u.test(declared) || Number(declared)>maxBytes))
    throw new TypeError('body_too_large');
  const reader=request.body?.getReader();
  if(!reader)throw new TypeError('invalid_json');
  const decoder=new TextDecoder();let text='',received=0;
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      received+=value.byteLength;
      if(received>maxBytes){await reader.cancel().catch(()=>{});
        throw new TypeError('body_too_large');}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  }finally{reader.releaseLock();}
  let data;
  try{data=JSON.parse(text);}catch{throw new TypeError('invalid_json');}
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw new TypeError('invalid_json');
  return data;
}
function conversationId(v){
  if(typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(v))return v;
  return crypto.randomUUID();
}
async function parseBody(request){
  const data=await readJsonBounded(request,MAX_BODY_BYTES);
  if(typeof data.message!=='string'||!data.message.trim()||
    data.message.length>4000||
    (data.history!==undefined&&!Array.isArray(data.history)))
    throw new TypeError('invalid_message');
  const history=(data.history||[]).slice(-12);
  if(history.some(h=>!h||!['user','model'].includes(h.role)||
    typeof h.text!=='string'||h.text.length>2500))
    throw new TypeError('invalid_history');
  return {message:data.message.trim(),history,conversationId:conversationId(data.conversationId),
    vkLaunch:typeof data.vkLaunch==='string'?data.vkLaunch:''};
}
/** Public metadata only; no diary body, private identity or secret is returned. */
async function diaryHealth(env,nowMs){
  if(!env?.DIARY_DB?.prepare)return {status:'binding_missing'};
  try{
    const base=' FROM oleshka_vk_diary WHERE owner_id=? '+
      "AND category NOT IN ('excluded','rejected') ";
    const today=dayMsk(nowMs);
    const [latest,count]=await Promise.all([
      env.DIARY_DB.prepare('SELECT post_id,published_day_msk,published_at,ingested_at '+
        base+' ORDER BY published_at DESC,post_id DESC LIMIT 1').bind(OLESHKA_VK_ID).first(),
      env.DIARY_DB.prepare('SELECT COUNT(*) AS n '+base+
        ' AND published_day_msk=?').bind(OLESHKA_VK_ID,today).first()
    ]);
    return {status:'ok',today,latestPostDay:latest?.published_day_msk||null,
      latestPostId:latest?.post_id??null,
      latestPublishedAt:latest?.published_at??null,
      latestIngestedAt:latest?.ingested_at??null,
      postsToday:Number(count?.n||0),sourceVkPollVerified:false};
  }catch{return {status:'read_error'};}
}
async function loadApprovedPersona(env){
  if(!env.CURRENT_CONTEXT?.get)return null;
  const raw=await env.CURRENT_CONTEXT.get(PERSONA_KEY);
  if(!raw)return null;
  let bundle;
  try{bundle=JSON.parse(raw);}catch{return null;}
  if(bundle?.status!=='approved'||bundle.character!=='sanko'||
    !bundle.profile||!bundle.voice)return null;
  return buildPersonaInstructions({profile:bundle.profile,voice:bundle.voice,
    quotes:bundle.quotes||[],approved:true});
}
async function loadContext(env,today){
  const snapshot=await readRecentD1({diaryDb:env.DIARY_DB,today,lookbackDays:3});
  if(!snapshot.ok)throw Error(snapshot.error);
  let claims=[];
  const raw=await env.CURRENT_CONTEXT?.get?.(APPROVED_CLAIMS_KEY);
  if(raw){
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed))throw Error('invalid_approved_claims');
    claims=parsed;
  }
  return buildCurrentContext({today,posts:snapshot.posts,approvedClaims:claims,
    sourceReadComplete:true});
}

/** Injectable dependencies are for offline testing only; production uses bindings. */
export function createSankoHandler({personaLoader=async env=>env?.STAGING_MODE==='true'?loadApprovedPersona(env):loadProductionPersona(env),
  contextLoader=loadContext,knowledgeLoader=async (env,question)=>
    readCanonicalEvidence({db:env.GUARD_DB,question}),modelFactory=env=>new GeminiAdapter({
    apiKey:env.GEMINI_API_KEY,model:env.GEMINI_MODEL}),
  quota=admit,saveTurn=storeTurn,saveUsage=storeTokenAttempt,
  now=()=>Date.now(),adminApi=createAdminApi(),adminUi=createAdminUiRoutes(),
  stagingMandatory=false,productionHealth=false,vkVerifier=verifyVkLaunch,
  vkRole=recognizeVkVisitor}={}){
  return {async fetch(request,env){
    const path=new URL(request.url).pathname,origin=request.headers.get('Origin')||'';
    // Runtime-level contract: the isolated entry must never silently run with
    // production quotas and no staging model gate if its env flag is missing.
    if(stagingMandatory&&env?.STAGING_MODE!=='true')
      return response({error:'staging_configuration_invalid'},503,origin);
    if(path==='/admin'||path.startsWith('/admin/')){
      const page=adminUi(request);if(page)return page;
      return adminApi(request,env);
    }
    if(!authorizedOrigin(request))return response({error:'forbidden_origin'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
      'Access-Control-Allow-Origin':origin||DEFAULT_ORIGIN,
      'Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,GET,OPTIONS',
      'Access-Control-Max-Age':'600'}});
    if(request.method==='GET'&&path==='/health')return response({status:productionHealth?'ok':'staging_only',
      character:'sanko',engine:productionHealth?'sanko-clean-3.0.0':'clean-not-deployed',
      requiresApprovedPersona:true,
      realGeminiEnabled:env?.ENABLE_REAL_MODEL==='true',
      quota:env?.STAGING_MODE==='true'?STAGING_QUOTAS:QUOTAS,
      diarySync:await diaryHealth(env,now())},200,origin);
    if(request.method==='POST'&&path==='/api/session'){
      let data;
      try{data=await readJsonBounded(request,5000);}
      catch(e){return response({error:e.message||'invalid_json'},400,origin);}
      const verified=await vkVerifier(data?.vkLaunch,{appId:env?.VK_APP_ID,
        appSecret:env?.VK_APP_SECRET,now:now()});
      const relation=verified?await vkRole({env,userId:verified.userId}):
        {role:'stranger',roleChecked:false};
      return response({verified:!!verified,role:relation.role,
        roleChecked:relation.roleChecked,
        identity:verified?.userId===OLESHKA_VK_ID?'oleshka':'reader',
        firstName:validatedVkName(data,verified)},200,origin);
    }
    if(request.method!=='POST'||path!=='/api/chat')return response({error:'not_found'},404,origin);
    let body;
    try {body=await parseBody(request);}catch(err){return response({error:err.message},400,origin);}
    if(!env?.GUARD_DB?.prepare||!env?.DIARY_DB?.prepare||!env?.CURRENT_CONTEXT?.get||
      !env?.GEMINI_API_KEY||!env?.GEMINI_MODEL||!env?.IP_HASH_SECRET)
      return response({error:'not_configured'},503,origin);
    // The staging Worker must not spend even one model call until the
    // owner explicitly enables the staging-only model switch.
    if(env.STAGING_MODE==='true'&&env.ENABLE_REAL_MODEL!=='true')
      return response({error:'staging_model_disabled'},503,origin);
    let persona,context,knowledge;
    const day=dayMsk(now());
    try {
      persona=await personaLoader(env);
      if(!persona?.approved)return response({error:'profile_not_approved'},503,origin);
      context=await contextLoader(env,day);
      knowledge=await knowledgeLoader(env,body.message);
    }catch{return response({error:'chronicle_unavailable'},503,origin);}
    const ip=request.headers.get('CF-Connecting-IP')||'unknown';
    let accepted;
    try {accepted=await quota({db:env.GUARD_DB,day,ip,secret:env.IP_HASH_SECRET,
      limits:env.STAGING_MODE==='true'?STAGING_QUOTAS:QUOTAS});}
    catch {return response({error:'quota_backend_unavailable'},503,origin);}
    if(!accepted.ok)return response({error:'quota_exhausted',
      quota:env.STAGING_MODE==='true'?STAGING_QUOTAS:QUOTAS},429,origin);
    const verified=await vkVerifier(body.vkLaunch,{appId:env.VK_APP_ID,
      appSecret:env.VK_APP_SECRET,now:now()});
    const result=await answerAsSanko({model:modelFactory(env),persona,context,knowledge,
      history:body.history,message:body.message,
      confirmedOleshka:verified?.userId===OLESHKA_VK_ID});
    try {
      if(result.providerCalls>0)await saveUsage({db:env.GUARD_DB,requestId:accepted.requestId,
        day,model:result.model||env.GEMINI_MODEL,
        usage:result.usage,result:result.ok?'answered':result.error});
      await saveTurn({db:env.GUARD_DB,requestId:accepted.requestId,
        conversationId:body.conversationId,message:body.message,
        reply:result.ok?result.reply:'',model:result.ok?result.model:'',
        status:result.ok?'answered':'error'});
    }catch{return response({error:'log_storage_failed'},503,origin);}
    if(!result.ok)return response({error:result.error,providerCode:result.diagnostic||null},
      result.error==='response_quality_failed'?422:503,origin);
    return response({conversationId:body.conversationId,reply:result.reply,
      model:result.model,knowledge:{latestPublicationDay:context.lastKnownPublicationDay,
        todayHasVerifiedPersonalFacts:context.hasVerifiedTodayEvents}},200,origin);
  }};
}
