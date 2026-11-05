import test from "node:test";
import assert from "node:assert/strict";
import { classifyProviderError,publicChatError } from "../src/error-policy.js";

test("Gemini 400 explicitly unsupported location produces private region category",()=>{
 const examples=[
  {error:{code:400,status:"FAILED_PRECONDITION",
   message:"User location is not supported for the API use."}},
  {error:{code:400,status:"FAILED_PRECONDITION",
   message:"User location is NOT supported for the API use."}},
  {error:{code:400,status:"FAILED_PRECONDITION",message:"An arbitrary message",
   details:[{"@type":"type.googleapis.com/google.rpc.ErrorInfo",reason:"LOCATION_NOT_SUPPORTED"}]}}
 ];
 for(const payload of examples){
  assert.deepEqual(classifyProviderError(400,payload),
   {kind:"provider_region",retryable:false,httpStatus:400});
  const publicNotice=JSON.stringify(publicChatError("provider_region"));
  assert(!publicNotice.includes("location"),"Do not expose Google details to readers");
 }
});
test("Gemini 400 FAILED_PRECONDITION without explicit region signal stays generic precondition",()=>{
 const error={error:{code:400,status:"FAILED_PRECONDITION",
  message:"Billing is not enabled for the project."}};
 assert.deepEqual(classifyProviderError(400,error),
  {kind:"provider_precondition",retryable:false,httpStatus:400});
});
test("Malformed API request has its own private diagnostic and is not retried",()=>{
 const error={error:{code:400,status:"INVALID_ARGUMENT",
  message:"Invalid JSON payload received. Unknown name thinkingConfig."}};
 assert.deepEqual(classifyProviderError(400,error),
  {kind:"provider_invalid_request",retryable:false,httpStatus:400});
 assert.deepEqual(classifyProviderError(400,{error:{code:400}}),
  {kind:"service_unavailable",retryable:false,httpStatus:400});
});
test("provider 401/403 cannot be fixed with another model on the same key",()=>{
 for(const status of [401,403])
  assert.deepEqual(classifyProviderError(status,{error:{status:"PERMISSION_DENIED"}}),
   {kind:"provider_auth",retryable:false,httpStatus:status});
});
test("other Gemini failover behavior remains untouched",()=>{
 assert.equal(classifyProviderError(404,{error:{status:"NOT_FOUND"}}).retryable,true);
 assert.equal(classifyProviderError(503,{error:{status:"UNAVAILABLE"}}).retryable,true);
 assert.equal(classifyProviderError(429,{error:{status:"RESOURCE_EXHAUSTED"}}).retryable,true);
});
