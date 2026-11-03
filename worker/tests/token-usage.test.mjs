import test from "node:test";
import assert from "node:assert/strict";
import { extractUsage,tokenStats } from "../src/token-usage.js";

test("metadata parser distinguishes unknown values and zero",()=>{
 assert.equal(extractUsage({}),null);
 assert.deepEqual(extractUsage({usageMetadata:{
  promptTokenCount:100,candidatesTokenCount:20,
  thoughtsTokenCount:5,cachedContentTokenCount:80,totalTokenCount:125
 }}),{promptTokens:100,candidateTokens:20,thoughtsTokens:5,cachedTokens:80,totalTokens:125});
 assert.equal(extractUsage({usageMetadata:{totalTokenCount:-1}}),null);
 assert.deepEqual(extractUsage({usageMetadata:{totalTokenCount:0}}),{
  promptTokens:null,candidateTokens:null,thoughtsTokens:null,cachedTokens:null,totalTokens:0
 });
});

test("statistics separately count known usage and unknown API attempts",async()=>{
 const db={prepare(sql){
  return {bind(){return this;},async all(){
   if(sql.includes("GROUP BY model"))return {results:[{
    model:"gemini-3.5-flash-lite",calls:2,meteredCalls:1,unknownCalls:1,
    total:100,prompt:80,candidate:15,thoughts:5,cached:20
   }]};
   return {results:[{day:"2026-11-04",calls:2,meteredCalls:1,unknownCalls:1,
    total:100,prompt:80,candidate:15,thoughts:5,cached:20}]};
  },async first(){return {
   calls:2,meteredCalls:1,unknownCalls:1,total:100,
   prompt:80,candidate:15,thoughts:5,cached:20
  };}};
 }};
 const result=await tokenStats(db,"2026-11-04");
 assert.equal(result.status,"ready");
 assert.equal(result.month.total,100);
 assert.equal(result.month.unknownCalls,1);
 assert.equal(result.averagePerMeteredCall,100);
 assert.equal(result.today.calls,2);
 assert.equal(result.daily.length,30);
 assert.equal(result.models[0].unknownCalls,1);
});

test("statistics expose unavailable state when D1 migration was not applied",async()=>{
 const db={prepare(){throw Error("no such table: token_usage");}};
 const result=await tokenStats(db,"2026-11-04");
 assert.equal(result.status,"unavailable");
 assert(!("month" in result),"Missing table must not masquerade as zero usage");
});
