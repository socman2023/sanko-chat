import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
const PROD="https://sanko-chat-api.boysinger2008.workers.dev";
const PREVIEW="https://context-test-sanko-chat-api.boysinger2008.workers.dev";
const wait={waitUntil(p){p?.catch(()=>{});}};
function get(url){return new Request(url);}
function post(url,auth=""){
 return new Request(url,{method:"POST",headers:{
  "Origin":new URL(url).origin,"Content-Type":"application/json",
  ...(auth?{"X-Preview-Token":auth}:{})
 },body:JSON.stringify({message:"Привет",history:[],conversationId:crypto.randomUUID()})});
}
test("a Preview-only chat page is NEVER served on production hostname",async()=>{
 const normal=await worker.fetch(get(PROD+"/__preview__/chat"),{},wait);
 assert.equal(normal.status,404);
 const normalJs=await worker.fetch(get(PROD+"/__preview__/app.js"),{},wait);
 assert.equal(normalJs.status,404);
});
test("test chat serves self-contained HTML on proper Preview hostname with noindex and CSP",async()=>{
 const response=await worker.fetch(get(PREVIEW+"/__preview__/chat"),{},wait);
 assert.equal(response.status,200);
 assert.match(response.headers.get("Content-Type"),/text\/html/);
 assert.match(response.headers.get("X-Robots-Tag"),/noindex/);
 assert.match(response.headers.get("Content-Security-Policy"),/script-src 'self'/);
 const html=await response.text();
 assert.match(html,/Санко · тест оптимизации/);
 assert.match(html,/Администраторский токен Санко/);
 assert(!html.includes("GEMINI_API_KEY"));
 const js=await worker.fetch(get(PREVIEW+"/__preview__/app.js"),{},wait);
 assert.equal(js.status,200);
 const body=await js.text();
 assert.match(body,/X-Preview-Token/);
 assert(!body.includes("localStorage"));
 assert(!body.includes("vkLaunch"),"Reader identity should not be faked");
});
test("reject Preview chat before model or D1 without a real long admin token",async()=>{
 const cases=[
  {key:"",secret:"A".repeat(48)},
  {key:"wrong",secret:"A".repeat(48)},
  {key:"A".repeat(48),secret:""},
  {key:"B".repeat(48),secret:"A".repeat(48)}
 ];
 for(const {key,secret} of cases){
  const response=await worker.fetch(post(PREVIEW+"/api/chat",key),{
   ADMIN_UPDATE_TOKEN:secret
  },wait);
  assert.equal(response.status,401);
  assert.equal((await response.json()).error,"preview_authorization_required");
 }
});
test("normal production-origin policy not widened by Preview host exception",async()=>{
 const response=await worker.fetch(
  new Request(PROD+"/api/chat",{method:"POST",headers:{"Origin":PREVIEW,
   "Content-Type":"application/json"},body:JSON.stringify({message:"Привет"})}),
  {},wait);
 assert.equal(response.status,403);
});
test("a valid preview gate reaches chat handler (but not configured LLM) without leaking key",async()=>{
 const secret="K".repeat(48);
 const response=await worker.fetch(post(PREVIEW+"/api/chat",secret),{
  ADMIN_UPDATE_TOKEN:secret
 },wait);
 assert.equal(response.status,503);
 const data=await response.json();
 assert(!JSON.stringify(data).includes(secret));
 assert.equal(data.error,"service_unavailable");
});
