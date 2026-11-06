/** Isolated Worker entry: routes plus an opt-in cron for the *staging* KV only. */
import {createSankoHandler} from './worker.mjs';
import {createAdminUiRoutes} from './admin-ui-routes.mjs';
// The approved presentation is attached verbatim at build time. A local
// source-only test without that file must fail closed for all admin pages.
const approvedPresentation=await import('./approved-admin-ui.mjs').catch(error=>{
  if(error?.code==='ERR_MODULE_NOT_FOUND' &&
     String(error.message).includes('approved-admin-ui.mjs'))return null;
  throw error;
});
import {syncPersonalChronicle} from './chronicle-sync.mjs';
import {GeminiAdapter} from '../engine/gemini-adapter.mjs';
const chat=createSankoHandler({stagingMandatory:true,adminUi:createAdminUiRoutes(approvedPresentation?{
  html:approvedPresentation.ADMIN_HTML,
  css:approvedPresentation.ADMIN_CSS,
  js:approvedPresentation.ADMIN_SCRIPT
}:{})});
const dayMsk=ms=>new Date(ms+3*3600_000).toISOString().slice(0,10);
export default {
  fetch:(req,env,ctx)=>chat.fetch(req,env,ctx),
  scheduled:async (_event,env,ctx)=>{
    // Even a mistakenly scheduled trigger must not write outside staging.
    if(env?.STAGING_MODE!=='true'||env?.ENABLE_CHRONICLE_SYNC!=='true')return;
    const extraction=env?.ENABLE_CHRONICLE_EXTRACTION==='true';
    const model=extraction?new GeminiAdapter({apiKey:env.GEMINI_API_KEY,
      model:env.GEMINI_MODEL}):null;
    const task=syncPersonalChronicle({env,today:dayMsk(Date.now()),model,
      readOnly:false,maxNewExtractions:2});
    if(ctx?.waitUntil)ctx.waitUntil(task);else await task;
  }
};
