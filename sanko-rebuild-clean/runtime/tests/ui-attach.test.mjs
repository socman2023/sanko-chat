import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {gitBlobSha1,attachApprovedAdminUi,APPROVED_ADMIN_UI_BLOB}
  from '../tools/attach-admin-ui.mjs';
import {createAdminUiRoutes} from '../admin-ui-routes.mjs';

const payload=`export const ADMIN_HTML = '<main id="__PAGE__">Контроль</main>';\n`+
  `export const ADMIN_CSS = 'main{display:block}';\n`+
  `export const ADMIN_SCRIPT = 'console.log("test")';\n`;
const expectedBlob=gitBlobSha1(Buffer.from(payload));
test('approved source reference is fixed to existing Git blob',()=>{
  assert.equal(APPROVED_ADMIN_UI_BLOB,'f54996b76062c58edbba8fff5a306e77c704d547');
});
test('asset attachment copies approved presentation without any modification',async()=>{
  const d=await mkdtemp(join(tmpdir(),'sanko-ui-'));
  try{
    const src=join(d,'original.js'),dest=join(d,'copied.mjs');
    await writeFile(src,payload);
    const result=await attachApprovedAdminUi({source:src,output:dest,expectedBlob});
    assert.equal(result.gitBlobSha1,expectedBlob);
    assert.deepEqual(await readFile(dest),Buffer.from(payload));
    const module=await import('file://'+dest);
    assert.equal(module.ADMIN_HTML.includes('__PAGE__'),true);
  }finally{await rm(d,{recursive:true,force:true});}
});
test('asset attachment rejects even a one-character unauthorized change',async()=>{
  const d=await mkdtemp(join(tmpdir(),'sanko-ui-'));
  try{
    const src=join(d,'altered.js'),dest=join(d,'copy.mjs');
    await writeFile(src,payload+' ');
    await assert.rejects(attachApprovedAdminUi({source:src,output:dest,expectedBlob}),
      /approved_ui_blob_mismatch/);
    await assert.rejects(readFile(dest),/ENOENT/);
  }finally{await rm(d,{recursive:true,force:true});}
});
test('no source available: fail closed rather than generating replacement panel',async()=>{
  await assert.rejects(attachApprovedAdminUi({source:'/nonexistent/old-admin-ui.js'}),/ENOENT/);
});
test('the four original navigation pages render with the original structure',async()=>{
  const route=createAdminUiRoutes({html:'<main id="__PAGE__">OK</main>',
    css:'body{margin:0}',js:'console.log("ui")'});
  const paths=['stats','chats','knowledge','profile'];
  for(const page of paths){
    const res=route(new Request('https://sanko-preview.invalid/admin/'+page));
    assert.equal(res.status,200);assert.equal(await res.text(),`<main id="${page}">OK</main>`);
    assert.equal(res.headers.get('Content-Security-Policy').includes("connect-src 'self'"),true);
  }
});
test('original CSS and JS content are served verbatim with proper types',async()=>{
  const css=':root {--forest: #122916}',js='console.log("чистый интерфейс")';
  const route=createAdminUiRoutes({html:'__PAGE__',css,js});
  const rs=route(new Request('https://preview.invalid/admin/assets/style.css'));
  const rj=route(new Request('https://preview.invalid/admin/assets/app.js'));
  assert.equal(await rs.text(),css);assert.equal(await rj.text(),js);
  assert.match(rs.headers.get('Content-Type'),/text\/css/);
  assert.match(rj.headers.get('Content-Type'),/javascript/);
});
test('missing presentation module returns 503 instead of an improvised page',async()=>{
  const route=createAdminUiRoutes();
  const res=route(new Request('https://preview.invalid/admin/profile'));
  assert.equal(res.status,503);
});
test('public GET page is not equivalent to access to admin private JSON',async()=>{
  const route=createAdminUiRoutes({html:'__PAGE__',css:'',js:''});
  const r=route(new Request('https://preview.invalid/admin/stats/data'));
  assert.equal(r,null);
});
