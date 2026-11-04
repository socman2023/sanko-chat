import test from "node:test";
import assert from "node:assert/strict";
import { classifySankoVkVisitor } from "../src/vk-relationships.js";

const makeKV=()=>{
 const data=new Map(),counts={get:0,put:0};
 return {counts,
  async get(key){counts.get++;const raw=data.get(key);return raw?JSON.parse(raw):null;},
  async put(key,val){counts.put++;data.set(key,val);},
  data
 };
};
function apiMock({friendIds=[],followerIds=[],members=[],failure=""}={}) {
 const calls=[];
 const fetchFn=async(url,options)=>{
  assert.equal(options.method,"POST");
  assert(url.startsWith("https://api.vk.com/method/"));
  assert(!url.includes("access_token"),"Token must not appear in URL");
  const method=url.split("/").at(-1),params=new URLSearchParams(options.body);
  assert.equal(params.get("access_token"),"VK_TEST_TOKEN_DO_NOT_DEPLOY");
  calls.push({method,params});
  if(method===failure)return new Response(JSON.stringify({error:{error_code:15}}),{status:200});
  let response;
  if(method==="friends.get"||method==="users.getFollowers"){
   const items=(method==="friends.get"?friendIds:followerIds);
   const offset=Number(params.get("offset")),count=Number(params.get("count"));
   response={count:items.length,items:items.slice(offset,offset+count)};
  }else if(method==="groups.isMember"){
   response=members.includes(Number(params.get("user_id")))?1:0;
  }else throw Error("Unknown VK method "+method);
  return new Response(JSON.stringify({response}),{status:200});
 };
 return {fetchFn,calls};
}
const env=(kv,extra={})=>({
 CURRENT_CONTEXT:kv,
 VK_APP_ID:"54875852",
 VK_OWNER_USER_ID:"700010",
 VK_SERVICE_TOKEN:"VK_TEST_TOKEN_DO_NOT_DEPLOY",
 ...extra
});

test("VK app id alone never authorizes relationship recognition",async()=>{
 const kv=makeKV(),api=apiMock({friendIds:[45]});
 const r=await classifySankoVkVisitor(45,{
  CURRENT_CONTEXT:kv,VK_APP_ID:"54875852"
 },{fetchFn:api.fetchFn});
 assert.deepEqual(r,{role:"stranger",roleChecked:false});
 assert.equal(api.calls.length,0);
});

test("friends take priority over followers and group memberships",async()=>{
 const kv=makeKV(),api=apiMock({friendIds:[12,45],followerIds:[45],members:[45]});
 const r=await classifySankoVkVisitor(45,env(kv,{VK_COMMUNITY_ID:"777"}),{fetchFn:api.fetchFn});
 assert.deepEqual(r,{role:"friend",roleChecked:true});
 assert(api.calls.some(x=>x.method==="friends.get" && x.params.get("user_id")==="700010"));
 assert(api.calls.some(x=>x.method==="users.getFollowers" && x.params.get("user_id")==="700010"));
 assert(api.calls.some(x=>x.method==="groups.isMember" && x.params.get("group_id")==="777"));
 assert(!api.calls.some(x=>x.params.get("user_id")==="54875852"&&x.method==="friends.get"),
  "App ID is NOT Sanko's profile ID");
});

test("followers are recognized when not in friends, community is third",async()=>{
 const kv=makeKV(),api=apiMock({friendIds:[3],followerIds:[56],members:[56,78]});
 assert.deepEqual(await classifySankoVkVisitor(56,env(kv,{VK_COMMUNITY_ID:"777"}),{fetchFn:api.fetchFn}),
  {role:"follower",roleChecked:true});
 assert.deepEqual(await classifySankoVkVisitor(78,env(kv,{VK_COMMUNITY_ID:"777"}),{fetchFn:api.fetchFn}),
  {role:"community",roleChecked:true});
});

test("readable complete lists prove an unrelated visitor is a stranger",async()=>{
 const kv=makeKV(),api=apiMock({friendIds:[3],followerIds:[5]});
 assert.deepEqual(await classifySankoVkVisitor(95,env(kv),{fetchFn:api.fetchFn}),
  {role:"stranger",roleChecked:true});
});

test("unavailable friend or follower lists cannot classify unknown person",async()=>{
 const kv=makeKV(),api=apiMock({failure:"users.getFollowers"});
 const r=await classifySankoVkVisitor(95,env(kv),{fetchFn:api.fetchFn});
 assert.deepEqual(r,{role:"stranger",roleChecked:false});
 assert.equal(kv.counts.put,1,"only the successfully fetched list may be cached");
});

test("six-hour KV cache is isolated to Sanko and prevents repeated list API requests",async()=>{
 const kv=makeKV(),api=apiMock({friendIds:[11],followerIds:[22]});
 assert.deepEqual(await classifySankoVkVisitor(22,env(kv),{fetchFn:api.fetchFn}),
  {role:"follower",roleChecked:true});
 const before=api.calls.length;
 assert.deepEqual(await classifySankoVkVisitor(11,env(kv),{fetchFn:api.fetchFn}),
  {role:"friend",roleChecked:true});
 assert.equal(api.calls.length,before,"Both lists must be read from 6h KV cache");
 assert([...kv.data.keys()].every(x=>x.startsWith("sanko:vk:members:")));
});

test("user ID zero, malformed IDs and absent access token never hit VK API",async()=>{
 const kv=makeKV(),api=apiMock();
 assert.deepEqual(await classifySankoVkVisitor(0,env(kv),{fetchFn:api.fetchFn}),
  {role:"stranger",roleChecked:false});
 assert.deepEqual(await classifySankoVkVisitor("not-id",env(kv),{fetchFn:api.fetchFn}),
  {role:"stranger",roleChecked:false});
 assert.deepEqual(await classifySankoVkVisitor(1,env(kv,{VK_SERVICE_TOKEN:""}),{fetchFn:api.fetchFn}),
  {role:"stranger",roleChecked:false});
 assert.equal(api.calls.length,0);
});

test("large follower lists are paginated and contain older members",async()=>{
 const kv=makeKV(),followers=Array.from({length:1120},(_,i)=>i+10000);
 const api=apiMock({friendIds:[],followerIds:followers});
 const r=await classifySankoVkVisitor(11119,env(kv),{fetchFn:api.fetchFn});
 assert.deepEqual(r,{role:"follower",roleChecked:true});
 assert.equal(api.calls.filter(x=>x.method==="users.getFollowers").length,2);
});

test("failed VK responses are not cached as valid empty friend lists",async()=>{
 const kv=makeKV(),api=apiMock({failure:"friends.get"});
 await classifySankoVkVisitor(87,env(kv),{fetchFn:api.fetchFn});
 assert(![...kv.data.keys()].some(x=>x.includes(":friends:")));
});
