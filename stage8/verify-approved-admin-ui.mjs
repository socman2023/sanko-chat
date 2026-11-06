import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ADMIN_HTML,ADMIN_CSS,ADMIN_SCRIPT} from '../worker/src/admin-ui.js';
const file=readFileSync(new URL('../worker/src/admin-ui.js',import.meta.url));
const sha=createHash('sha1').update('blob '+file.length).update(Buffer.from([0])).update(file).digest('hex');
assert.equal(sha,'f54996b76062c58edbba8fff5a306e77c704d547',
  'The approved admin UI may not be silently modified');
for(const name of ['stats','chats','knowledge','profile']){
  assert(ADMIN_HTML.includes('/admin/'+name),'Missing admin section '+name);
}
assert(ADMIN_HTML.includes('__PAGE__'),'Missing page marker');
assert(ADMIN_HTML.includes('/admin/assets/style.css'));
assert(ADMIN_HTML.includes('/admin/assets/app.js'));
for(const endpoint of ['/admin/stats/data','/admin/chats/list',
  '/admin/chats/thread','/admin/knowledge/status','/admin/profile/status',
  '/admin/profile/activate','/admin/profile/restore','/admin/knowledge/import']){
  assert(ADMIN_SCRIPT.includes(endpoint),'Missing approved UI endpoint '+endpoint);
}
assert(ADMIN_SCRIPT.includes('Bearer '),'UI no longer submits owner token');
assert(ADMIN_SCRIPT.includes('POST'),'UI admin calls must use POST');
assert(ADMIN_CSS.length>4000&&ADMIN_SCRIPT.length>10000,
  'Presentation module appears incomplete');
console.log('APPROVED UI VERIFIED',JSON.stringify({
  gitBlobSha1:sha,bytes:file.length,
  sections:4,apiRoutes:8,jsLength:ADMIN_SCRIPT.length,
  cssLength:ADMIN_CSS.length,
  note:'This checks the approved UI only; no clean-worker deployment is performed.'
}));
