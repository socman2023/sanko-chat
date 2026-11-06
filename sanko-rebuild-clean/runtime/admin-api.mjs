/** Standalone owner admin HTTP API. No legacy worker imports.
 * Existing admin UI is an independently preserved presentation asset;
 * data endpoints keep original request/response shape.
 */
import {readAdminStats,readAdminConversationList,readAdminConversation,
  readAdminKnowledgeStatus,readAdminProfileStatus} from './admin-readonly.mjs';
import {activateLegacyProfile,restoreLegacyProfile,importCanonBatch} from './admin-mutations.mjs';
const API_PATHS=new Set(['/admin/stats/data','/admin/chats/list',
  '/admin/chats/thread','/admin/knowledge/status','/admin/knowledge/import',
  '/admin/profile/status','/admin/profile/activate','/admin/profile/restore']);
const HEADERS=Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
  'Referrer-Policy':'no-referrer',
  'Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"
});
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:HEADERS});}
export async function authorizeAdmin(request,token){
  if(typeof token!=='string'||token.length<32||token.length>4096)return false;
  const header=request.headers.get('Authorization')||'';
  if(!header.startsWith('Bearer '))return false;
  const supplied=header.slice(7);
  if(supplied.length<32||supplied.length>4096)return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(token)),
    crypto.subtle.digest('SHA-256',enc.encode(supplied))]);
  let mismatch=0;const left=new Uint8Array(a),right=new Uint8Array(b);
  for(let i=0;i<left.length;i++)mismatch|=left[i]^right[i];
  return mismatch===0;
}
function maxBody(path){return path==='/admin/knowledge/import'?175000:
  path==='/admin/profile/activate'?120000:3000;}
async function parseBody(request,max){
  // Stream-reading with a hard cap, not Request.text() before checking size.
  const declared=Number(request.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>max)throw TypeError('body_too_large');
  let content='';const decoder=new TextDecoder();
  if(request.body){
    const reader=request.body.getReader();let size=0;
    try{
      while(true){const {value,done}=await reader.read();if(done)break;
        size+=value.byteLength;
        if(size>max)throw TypeError('body_too_large');
        content+=decoder.decode(value,{stream:true});
      }
      content+=decoder.decode();
    }finally{reader.releaseLock();}
  }
  try {const o=JSON.parse(content||'{}');
    if(!o||typeof o!=='object'||Array.isArray(o))throw Error();return o;
  }catch{throw TypeError('invalid_json');}
}
export function createAdminApi({readStats=readAdminStats,readList=readAdminConversationList,
  readThread=readAdminConversation,readKnowledge=readAdminKnowledgeStatus,
  readProfile=readAdminProfileStatus,writeProfile=activateLegacyProfile,
  restoreProfile=restoreLegacyProfile,writeCanon=importCanonBatch,
  now=()=>Date.now()}={}){
  return async function adminFetch(request,env){
    const path=new URL(request.url).pathname;
    if(!API_PATHS.has(path))return json({error:'not_found'},404);
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    const origin=request.headers.get('Origin');
    if(origin&&origin!==new URL(request.url).origin)return json({error:'forbidden_origin'},403);
    if(!await authorizeAdmin(request,env?.ADMIN_UPDATE_TOKEN))return json({error:'unauthorized'},401);
    if(!env?.GUARD_DB?.prepare||!env?.IP_HASH_SECRET)return json({error:'database_unavailable'},503);
    let body;
    try{body=await parseBody(request,maxBody(path));}
    catch(e){return json({error:e.message||'bad_request'},400);}
    try{
      const db=env.GUARD_DB;
      let result;
      switch(path){
        case '/admin/stats/data':result=await readStats({db,now:now(),
          ip:request.headers.get('CF-Connecting-IP')||'unknown',
          ipHashSecret:env.IP_HASH_SECRET});break;
        case '/admin/chats/list':result=await readList({db,now:now(),
          query:body.query??'',limit:body.limit??20,offset:body.offset??0});break;
        case '/admin/chats/thread':result=await readThread({db,now:now(),
          conversationId:body.conversationId});break;
        case '/admin/knowledge/status':result=await readKnowledge({db});break;
        case '/admin/profile/status':result=await readProfile({kv:env.CURRENT_CONTEXT});break;
        case '/admin/profile/activate':
        case '/admin/profile/restore':
        case '/admin/knowledge/import':{
          if(env.ENABLE_ADMIN_MUTATIONS!=='true')return json({error:'mutation_disabled'},403);
          if(path==='/admin/profile/activate')result=await writeProfile({
            kv:env.CURRENT_CONTEXT,profile:body.profile});
          else if(path==='/admin/profile/restore')result=await restoreProfile({kv:env.CURRENT_CONTEXT});
          else result=await writeCanon({db,ai:env.AI,vector:env.KNOWLEDGE,records:body.records});
          return json(result.data,result.httpStatus||200);
        }
        default:return json({error:'not_found'},404);
      }
      return json(result);
    }catch(e){
      if(e instanceof TypeError&&/^invalid_/.test(e.message))
        return json({error:e.message},400);
      return json({error:'temporarily_unavailable'},503);
    }
  };
}
