import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fetchAndAttachApprovedAdminUi} from '../tools/fetch-approved-admin-ui.mjs';
import {gitBlobSha1} from '../tools/attach-admin-ui.mjs';
const synthetic='export const ADMIN_HTML = `A`;\nexport const ADMIN_CSS = `B`;\nexport const ADMIN_SCRIPT = `C`;\n';
const digest=gitBlobSha1(Buffer.from(synthetic));
test('pinned, integrity-checked UI fetch attaches only the approved-presentation shape',async()=>{
  const tmp=await mkdtemp(join(tmpdir(),'sanko-ui-fetch-'));
  try{
    const output=join(tmp,'approved-admin-ui.mjs');
    let path='';
    const result=await fetchAndAttachApprovedAdminUi({expectedBlob:digest,output,
      fetchImpl:async url=>{path=url;return new Response(synthetic,{status:200});}});
    assert.match(path,/ea2b373c1b7b66ca90cc0c0e72d1a94731b24fc2/);
    assert.equal(result.gitBlobSha1,digest);
    assert.equal((await readFile(output,'utf8')),synthetic);
  }finally{await rm(tmp,{recursive:true,force:true});}
});
test('mismatched blob cannot be fetched or installed as approved UI',async()=>{
  const tmp=await mkdtemp(join(tmpdir(),'sanko-ui-fetch-'));
  try{
    await assert.rejects(fetchAndAttachApprovedAdminUi({output:join(tmp,'approved-admin-ui.mjs'),
      fetchImpl:async()=>new Response(synthetic,{status:200})}),/sha_mismatch/);
  }finally{await rm(tmp,{recursive:true,force:true});}
});
test('unapproved source URL and oversized fetch rejected',async()=>{
  await assert.rejects(fetchAndAttachApprovedAdminUi({sourceUrl:'https://evil.invalid/x',
    fetchImpl:async()=>new Response('x')}),/unapproved_ui_download_url/);
  await assert.rejects(fetchAndAttachApprovedAdminUi({fetchImpl:async()=>new Response('X'.repeat(46000))}),
    /approved_ui_download_too_large/);
});
