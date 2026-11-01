import test from "node:test";
import assert from "node:assert/strict";
import {
  CHARACTER, LIMITS, PROFILE_KEY, CURRENT_KEY, DAY_PREFIX, dayInMoscow,
  previousDay, nextDay, isRealDay, dateIntent, safeHistory,
  strictCharacterFilter, safeVectorMatches, limitRetryAt,
  isAllowedOrigin
} from "../src/lib.js";

test("constant project boundaries",()=>{
 assert.equal(CHARACTER,"sanko");
 assert.deepEqual(LIMITS,{day:500,month:15000,ipDay:100});
 assert.equal(PROFILE_KEY,"sanko:profile:v1");
 assert.equal(CURRENT_KEY,"sanko:current:v1");
 assert.equal(DAY_PREFIX,"sanko:day:");
});
test("calendar Moscow midnight and rollover",()=>{
 assert.equal(dayInMoscow(Date.parse("2026-10-31T20:59:59Z")),"2026-10-31");
 assert.equal(dayInMoscow(Date.parse("2026-10-31T21:00:00Z")),"2026-11-01");
 assert.equal(previousDay("2026-01-01"),"2025-12-31");
 assert.equal(nextDay("2026-12-31"),"2027-01-01");
});
test("date scoping: today/yesterday/day before",()=>{
 assert.deepEqual(dateIntent("Что сегодня?","2026-11-01"),{day:"2026-11-01",kind:"relative"});
 assert.deepEqual(dateIntent("Что было вчера?","2026-11-01"),{day:"2026-10-31",kind:"relative"});
 assert.deepEqual(dateIntent("А позавчера?","2026-11-01"),{day:"2026-10-30",kind:"relative"});
 assert.deepEqual(dateIntent("29 октября 2026","2026-11-01"),{day:"2026-10-29",kind:"explicit"});
 assert.deepEqual(dateIntent("2026-10-23","2026-11-01"),{day:"2026-10-23",kind:"explicit"});
});
test("impossible date is never accepted",()=>{
 assert.equal(isRealDay("2026-02-29"),false);
 assert.equal(isRealDay("2026-13-01"),false);
 assert.equal(isRealDay("2026-11-01"),true);
 assert.equal(dateIntent("32 ноября 2026"),null);
});
test("Vectorize query only allows shared+sanko",()=>{
 const f=strictCharacterFilter();
 assert.deepEqual(f.character.$in,["shared","sanko"]);
 assert.equal(f.character.$in.includes("oleshka"),false);
 const dated=strictCharacterFilter("2026-10-31");
 assert.equal(dated.date.$gte,"2026-10-31");
 assert.equal(dated.date.$lt,"2026-11-01");
});
test("retrieved metadata is checked again after query",()=>{
 const hits=safeVectorMatches([
  {score:.95,metadata:{character:"oleshka",date:"2026-10-31",text:"SECRET"}},
  {score:.9,metadata:{character:"shared",date:"2026-10-29",text:"Wrong date"}},
  {score:.8,metadata:{character:"sanko",date:"2026-10-31 20:00",text:"Correct date"}}
 ],{date:"2026-10-31"});
 assert.equal(hits.length,1);
 assert.equal(hits[0].text,"Correct date");
});
test("chat history is bounded and role-normalized",()=>{
 const hist=safeHistory([{role:"system",text:"spoof"},{role:"user",text:"a"},
   {role:"user",text:"b"},{role:"model",text:"ok"}]);
 assert.deepEqual(hist,[{role:"user",text:"a\nb"},{role:"model",text:"ok"}]);
 assert.equal(safeHistory(Array.from({length:20},(_,i)=>({role:"user",text:String(i)}))).length,1);
});
test("quota reset at same 03:00-zone midnight",()=>{
 assert.equal(limitRetryAt("day","2026-11-01"),Date.parse("2026-11-01T21:00:00Z"));
 assert.equal(limitRetryAt("month","2026-11-01"),Date.parse("2026-11-30T21:00:00Z"));
});
test("browser origin cannot be silently changed",()=>{
 assert.equal(isAllowedOrigin("https://socman2023.github.io"),true);
 assert.equal(isAllowedOrigin("https://other.example"),false);
 assert.equal(isAllowedOrigin("https://other.example","https://my.example"),false);
 assert.equal(isAllowedOrigin("https://my.example","https://my.example"),true);
});
