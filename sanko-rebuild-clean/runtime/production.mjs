/** Production entry for the NEW Sanko engine, replacing legacy dialogue code.
 * Uses the already-bound Sanko D1, shared READ-ONLY diary D1, and KV.
 * Source of admin UI is copied byte-for-byte from the approved original.
 */
import {createSankoHandler} from './worker.mjs';
import {createAdminUiRoutes} from './admin-ui-routes.mjs';
import {ADMIN_HTML,ADMIN_CSS,ADMIN_SCRIPT} from './approved-admin-ui.mjs';

const app=createSankoHandler({
  stagingMandatory:false,
  adminUi:createAdminUiRoutes({html:ADMIN_HTML,css:ADMIN_CSS,js:ADMIN_SCRIPT})
});
export default {
  fetch:(request,env,ctx)=>app.fetch(request,env,ctx),
  async scheduled(_event,env,ctx) {
    // Production housekeeping preserves the previous retention policy.
    if(!env?.GUARD_DB?.prepare)return;
    const task=(async()=>{
      const now=Math.floor(Date.now()/1000);
      const retention=now-30*86400;
      const accounting=now-95*86400;
      try {
        await env.GUARD_DB.prepare('DELETE FROM chat_turns WHERE asked_at<?').bind(retention).run();
        await env.GUARD_DB.prepare('DELETE FROM chat_admissions WHERE created_at<?').bind(accounting).run();
        await env.GUARD_DB.prepare('DELETE FROM token_usage WHERE attempted_at<?').bind(accounting).run();
      }catch(e){console.warn('Sanko housekeeping unavailable',e?.name||'unknown');}
    })();
    if(ctx?.waitUntil)ctx.waitUntil(task);
    else await task;
  }
};
