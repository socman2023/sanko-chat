import test from "node:test";
import assert from "node:assert/strict";
import {
 newChatTrace,markChatStage,getPromptBreakdown,logGeminiAttempt,logChatFinished
} from "../src/request-telemetry.js";

function capture(run){
 const original=console.info,events=[];
 console.info=(...parts)=>events.push(JSON.parse(parts.join(" ")));
 try{run();}finally{console.info=original;}
 return events;
}

test("logs requested country and Cloudflare ingress colo, not visitor IP or conversation text",()=>{
 const trace=newChatTrace({cf:{country:"RU",colo:"WAW",city:"Moscow"},
  headers:new Headers({"CF-Connecting-IP":"198.51.100.55","Authorization":"Secret"})},
 "sanko-worker-test");
 trace.requestId="non-personal-request-uuid";
 const events=capture(()=>{
  markChatStage(trace,"diary",23.6);
  logGeminiAttempt(trace,{model:"gemini-test",result:"provider_invalid_request:400",
   httpStatus:400,latencyMs:125,usage:{promptTokens:35091,candidateTokens:9}});
  logChatFinished(trace,{outcome:"provider_invalid_request",status:503,attempts:1});
 });
 assert.equal(events.length,2);
 assert.equal(events[0].country,"RU");
 assert.equal(events[0].ingressColo,"WAW");
 assert.equal(events[0].latencyMs,125);
 assert.equal(events[0].httpStatus,400);
 assert.equal(events[1].stages.diary,24);
 assert.equal(events[1].requestId,trace.requestId);
 const combined=JSON.stringify(events);
 for(const secret of ["198.51.100.55","Secret","Moscow","CF-Connecting-IP"])
  assert(!combined.includes(secret),secret);
});

test("missing cf and invalid runtime cf values produce no guessed location",()=>{
 const trace=newChatTrace({cf:{country:"N/A",colo:"locationunknown"}},"0.6.x");
 assert.equal(trace.country,"unknown");
 assert.equal(trace.ingressColo,"unknown");
 const local=newChatTrace({},"0.6.x");
 assert.equal(local.country,"unknown");
 assert.equal(local.ingressColo,"unknown");
});

test("prompt breakdown measures each source independently without emitting its content",()=>{
 const sources={
  profile:"PROFILE PRIVATE",current:{text:"PERSONAL STATE"},dayText:"DAY PLAN"
 };
 const posts=[
  {day:"2026-11-04",text:"published yesterday"},
  {day:"2026-11-05",text:"today diary private"}
 ];
 const snippets=[{text:"sensitive canon excerpt"}];
 const history=[{text:"private question"},{text:"private answer"}];
 const b=getPromptBreakdown(sources,snippets,{posts},"SYSTEM TEXT",history,"Hello private");
 assert.equal(b.profileChars,sources.profile.length);
 assert.equal(b.personalContextChars,sources.current.text.length);
 assert.equal(b.diaryChars,posts.map(x=>x.text.length).reduce((a,x)=>a+x,0));
 assert.equal(b.focusRepeatChars,0,"No duplicated latest diary in optimized prompt");
 assert.equal(b.historyChars,history[0].text.length+history[1].text.length);
 assert.equal(b.diaryPosts,2);
 assert.equal(b.retrievedHits,1);
 assert.equal(b.systemChars,11);
 const events=capture(()=>{
  logChatFinished(newChatTrace({}, "test"),{outcome:"answered",status:200,prompt:b});
 });
 const logged=JSON.stringify(events);
 for(const secret of ["PROFILE PRIVATE","PERSONAL STATE","sensitive canon","private question",
  "today diary private","Hello private"])assert(!logged.includes(secret));
});
