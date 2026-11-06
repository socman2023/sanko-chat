/** Optional user/CI CLI; can access only the existing PUBLIC GET /health. */
import {checkPublicHealth} from './health-check.mjs';
try {
  const result = await checkPublicHealth();
  console.log(JSON.stringify(result,null,2));
  process.exitCode = result.liveDatabaseRead === true ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({status:'unverified',
    reason: String(error?.message||'unknown_error').slice(0,140)}));
  process.exitCode=1;
}
