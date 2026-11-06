/** Independent signed-user lookup in SAN KO's own VK page. Uses only character-scoped cache.
 * A failed VK lookup is unknown, never a confirmed outsider.
 */
const API='https://api.vk.com/method/';
const VERSION='5.199';
const TTL=6*3600;
const isId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
async function vkCall(method,params,token,fetchFn){
  const ctl=new AbortController();
  const timeout=setTimeout(()=>ctl.abort(),3500);
  try {
    const body=new URLSearchParams({...params,v:VERSION,access_token:token});
    const r=await fetchFn(API+method,{method:'POST',headers:{'Content-Type':
      'application/x-www-form-urlencoded;charset=UTF-8'},body:body.toString(),signal:ctl.signal});
    if(!r.ok)throw Error('vk_http');
    const json=await r.json();
    if(json?.error||json?.response==null)throw Error('vk_rejected');
    return json.response;
  }finally{clearTimeout(timeout);}
}
async function memberIds({env,method,type,owner,token,fetchFn,now}){
  const cacheKey=`sanko:vnext:vk:${type}:${owner}`;
  try {
    const cached=await env.CURRENT_CONTEXT?.get?.(cacheKey,'json');
    if(cached&&Number.isSafeInteger(cached.at)&&now-cached.at<TTL*1000&&
      Array.isArray(cached.ids)&&cached.ids.every(isId))
      return new Set(cached.ids.map(Number));
  }catch{}
  const pageSize=method==='friends.get'?5000:1000;
  const ids=[];
  let total=null;
  for(let offset=0;offset<30000;offset+=pageSize){
    let response;
    try {response=await vkCall(method,{user_id:owner,offset,count:pageSize},token,fetchFn);}
    catch{return null;}
    if(!Array.isArray(response?.items)||!response.items.every(isId)||
      !Number.isSafeInteger(Number(response.count)))return null;
    total=Number(response.count);
    if(total<0||total>30000||response.items.length>pageSize)return null;
    ids.push(...response.items.map(Number));
    if(ids.length>=total)break;
    if(!response.items.length||offset+pageSize>=30000)return null;
  }
  if(total===null||ids.length<total||ids.length>30000)return null;
  try {await env.CURRENT_CONTEXT?.put?.(cacheKey,JSON.stringify({at:now,ids}),
    {expirationTtl:TTL});}catch{}
  return new Set(ids);
}
export async function recognizeVkVisitor({env,userId,fetchFn=fetch,now=Date.now()}={}){
  const owner=Number(env?.VK_OWNER_USER_ID),token=env?.VK_SERVICE_TOKEN;
  if(!isId(userId)||!isId(owner)||typeof token!=='string'||token.length<12)
    return {role:'stranger',roleChecked:false};
  const tasks=[
    memberIds({env,method:'friends.get',type:'friends',owner,token,fetchFn,now}),
    memberIds({env,method:'users.getFollowers',type:'followers',owner,token,fetchFn,now})
  ];
  const group=Number(env?.VK_COMMUNITY_ID);
  const communityConfigured=isId(group);
  if(communityConfigured)tasks.push(vkCall('groups.isMember',
    {group_id:group,user_id:userId},token,fetchFn).catch(()=>null));
  const [friends,followers,community]=await Promise.all(tasks);
  if(friends?.has(Number(userId)))return {role:'friend',roleChecked:true};
  if(followers?.has(Number(userId)))return {role:'follower',roleChecked:true};
  if(communityConfigured&&(community===1||community?.member===1))
    return {role:'community',roleChecked:true};
  return {role:'stranger',roleChecked:friends!==null&&followers!==null&&
    (!communityConfigured||community!==null)};
}
