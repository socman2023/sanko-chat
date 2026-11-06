/** Reproducibly fetch the public, immutable admin presentation only.
 * Never downloads or imports the legacy conversation engine.
 * A cryptographic Git blob check prevents branch changes or substitution.
 */
import {writeFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {attachApprovedAdminUi,APPROVED_ADMIN_UI_BLOB,
  APPROVED_SOURCE_COMMIT,gitBlobSha1} from './attach-admin-ui.mjs';
const PINNED_URL='https://raw.githubusercontent.com/socman2023/sanko-chat/'+
  APPROVED_SOURCE_COMMIT+'/worker/src/admin-ui.js';
export async function fetchAndAttachApprovedAdminUi({fetchImpl=fetch,
  expectedBlob=APPROVED_ADMIN_UI_BLOB,output,sourceUrl=PINNED_URL}={}){
  // Reject any other URL in the real build. Tests may inject a mock fetch.
  if(sourceUrl!==PINNED_URL)throw Error('unapproved_ui_download_url');
  const response=await fetchImpl(PINNED_URL,{method:'GET',redirect:'error',
    signal:AbortSignal.timeout(12_000),headers:{Accept:'text/plain'}});
  if(!response.ok)throw Error('approved_ui_download_failed:'+response.status);
  const claimed=Number(response.headers.get('Content-Length')||0);
  if(claimed>45_000)throw Error('approved_ui_download_too_large');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>45_000)throw Error('approved_ui_download_too_large');
  const sha=gitBlobSha1(bytes);
  if(sha!==expectedBlob)throw Error('approved_ui_download_sha_mismatch');
  const tmp=await mkdtemp(join(tmpdir(),'sanko-approved-ui-'));
  try{
    const file=join(tmp,'admin-ui.js');
    await writeFile(file,bytes,{flag:'wx'});
    return await attachApprovedAdminUi({source:file,output,expectedBlob});
  }finally{await rm(tmp,{recursive:true,force:true});}
}
if(process.argv[1]&&process.argv[1].endsWith('/fetch-approved-admin-ui.mjs')){
  fetchAndAttachApprovedAdminUi().then(x=>console.log(JSON.stringify(x)))
    .catch(e=>{console.error(e.message);process.exitCode=1;});
}
