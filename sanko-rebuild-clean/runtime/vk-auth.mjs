/** Independent VK Mini App signed launch authentication. Never trust browser role/name.
 * The URL-encoded vk_* canonicalization follows VK Mini Apps launch signing.
 * No imports from the old conversation engine.
 */
const utf8=new TextEncoder();
const SIGN=/^[A-Za-z0-9_-]{43}$/u;
export async function verifyVkLaunch(launch,{appId,appSecret,now=Date.now(),maxAgeSeconds=86400}={}){
  if(typeof launch!=='string'||!launch||launch.length>3000||
    !appSecret||!appId)return null;
  try {
    const raw=launch.startsWith('?')?launch.slice(1):launch;
    const params=new URLSearchParams(raw);
    // Reject duplicates and ambiguous entries rather than trusting first occurrence.
    const seen=new Set();
    for(const [key] of params){if(seen.has(key))return null;seen.add(key);}
    const sign=params.get('sign')||'';
    if(!SIGN.test(sign)||params.get('vk_app_id')!==String(appId))return null;
    const uidRaw=params.get('vk_user_id'),tsRaw=params.get('vk_ts');
    if(!/^\d{1,15}$/u.test(uidRaw||'')||!/^\d{9,12}$/u.test(tsRaw||''))return null;
    const userId=Number(uidRaw),ts=Number(tsRaw),current=now/1000;
    if(!Number.isSafeInteger(userId)||userId<=0||!Number.isSafeInteger(ts)||
      Math.abs(current-ts)>maxAgeSeconds)return null;
    const ordered=[...params.entries()].filter(([key])=>key.startsWith('vk_'))
      .sort(([a],[b])=>a.localeCompare(b,'en'));
    const data=new URLSearchParams(ordered).toString();
    const key=await crypto.subtle.importKey('raw',utf8.encode(appSecret),
      {name:'HMAC',hash:'SHA-256'},false,['sign']);
    const hmac=new Uint8Array(await crypto.subtle.sign('HMAC',key,utf8.encode(data)));
    const expected=btoa(String.fromCharCode(...hmac)).replace(/\+/gu,'-')
      .replace(/\//gu,'_').replace(/=+$/gu,'');
    let mismatch=0;
    for(let i=0;i<43;i++)mismatch|=expected.charCodeAt(i)^sign.charCodeAt(i);
    return mismatch===0?{userId,appId:Number(appId),issuedAt:ts}:null;
  }catch{return null;}
}
export function validatedVkName(payload,verified) {
  if(!verified||Number(payload?.vkFirstNameUserId)!==verified.userId)return '';
  const value=payload?.vkFirstName;
  return typeof value==='string'&&/^[\p{L}\p{M} -]{2,45}$/u.test(value)?value.trim():'';
}
