// Verify whether a SIGNED VK Mini App visitor is known to Sanko.
// This module has NO knowledge of Oleshka's personal friend/follower lists.
// No role is inferred from unverified browser parameters or other user chats.
//
// Required, private Cloudflare configuration for full recognition:
// VK_OWNER_USER_ID = Sanko's personal VK numeric account ID (not the App ID)
// VK_SERVICE_TOKEN = token authorized for readable friends / followers lists
// Optional: VK_COMMUNITY_ID = Sanko's community ID, if it is separately approved
//
// Expensive VK API list reads are cached for six hours in Sanko-prefixed KV keys.
// A failed or incomplete VK read never produces a falsely confirmed stranger.
const VK_API_VERSION = "5.199";
const TTL_SECONDS = 6 * 3600;
const MAX_IDS = 30000;
const validId = x => Number.isSafeInteger(Number(x)) && Number(x)>0;

function tokenConfig(env) {
 const owner=Number(env.VK_OWNER_USER_ID);
 const token=env.VK_SERVICE_TOKEN;
 return validId(owner) && typeof token==="string" && token.length>=12
  ? {owner,token} : null;
}
async function vkMethod(method,params,token,fetchFn=fetch) {
 const body=new URLSearchParams({...params,v:VK_API_VERSION,access_token:token});
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),3500);
 try {
  const response=await fetchFn("https://api.vk.com/method/"+method,{
   method:"POST",
   headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},
   body:body.toString(),
   signal:controller.signal
  });
  if(!response.ok)throw new Error("vk_api_http_"+response.status);
  const result=await response.json();
  if(result?.error||result?.response==null)throw new Error("vk_api_failed");
  return result.response;
 } finally {clearTimeout(timer);}
}
async function cachedIds(env,type,owner,token,fetchFn) {
 const key="sanko:vk:members:"+type+":"+owner;
 try {
  const record=await env.CURRENT_CONTEXT?.get?.(key,"json");
  if(record && Array.isArray(record.ids) && record.ids.every(validId) &&
     Number.isFinite(record.fetchedAt) && Date.now()-record.fetchedAt<TTL_SECONDS*1000)
   return {ok:true,ids:new Set(record.ids.map(Number))};
 }catch{}
 const method=type==="friends"?"friends.get":"users.getFollowers";
 const pageSize=type==="friends"?5000:1000;
 const ids=[];
 for(let offset=0;offset<MAX_IDS;offset+=pageSize) {
  let data;
  try {
   data=await vkMethod(method,{user_id:owner,offset,count:pageSize},token,fetchFn);
  }catch{return {ok:false,ids:null};}
  if(!Array.isArray(data.items)||!data.items.every(validId))return {ok:false,ids:null};
  ids.push(...data.items.map(Number));
  if(ids.length>MAX_IDS)return {ok:false,ids:null};
  const total=Number(data.count);
  if(!Number.isSafeInteger(total)||total<0)return {ok:false,ids:null};
  if(offset+data.items.length>=total)break;
  if(data.items.length===0)return {ok:false,ids:null};
  // Do not claim a complete list if the page limit is reached.
  if(offset+pageSize>=MAX_IDS)return {ok:false,ids:null};
 }
 try {
  await env.CURRENT_CONTEXT?.put?.(key,
   JSON.stringify({ids,fetchedAt:Date.now()}),{expirationTtl:TTL_SECONDS});
 } catch {}
 return {ok:true,ids:new Set(ids)};
}
async function memberOfCommunity(env,uid,token,fetchFn) {
 const groupId=Number(env.VK_COMMUNITY_ID);
 if(!validId(groupId))return {configured:false,isMember:false,ok:true};
 try {
  const result=await vkMethod("groups.isMember",{group_id:groupId,user_id:uid},token,fetchFn);
  return {configured:true,isMember:result===1 || result?.member===1,ok:true};
 }catch {return {configured:true,isMember:false,ok:false};}
}
export async function classifySankoVkVisitor(verifiedUserId,env,{fetchFn=fetch}={}) {
 if(!validId(verifiedUserId))return {role:"stranger",roleChecked:false};
 const cfg=tokenConfig(env);
 if(!cfg)return {role:"stranger",roleChecked:false};

 // Run independent VK calls concurrently so session initialization stays
 // within the 6.5-second client timeout. Keep ranking after all settle.
 const [friends,followers,community]=await Promise.all([
  cachedIds(env,"friends",cfg.owner,cfg.token,fetchFn),
  cachedIds(env,"followers",cfg.owner,cfg.token,fetchFn),
  memberOfCommunity(env,Number(verifiedUserId),cfg.token,fetchFn)
 ]);
 if(friends.ok&&friends.ids.has(Number(verifiedUserId)))
  return {role:"friend",roleChecked:true};
 if(followers.ok&&followers.ids.has(Number(verifiedUserId)))
  return {role:"follower",roleChecked:true};
 if(community.ok&&community.isMember)
  return {role:"community",roleChecked:true};

 // Only make a definitive "stranger" classification if ALL configured
 // relationship checks succeeded; otherwise return an unclassified stranger
 // (the client shows its ordinary neutral greeting).
 return {role:"stranger",
  roleChecked:friends.ok&&followers.ok&&community.ok};
}
