import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const dir=dirname(fileURLToPath(import.meta.url));
const gate=resolve(dir,'../staging/verify-staging.mjs');
const example=resolve(dir,'../staging/wrangler.staging.example.toml');
const run=(...args)=>spawnSync(process.execPath,[gate,...args],{encoding:'utf8'});
test('example staging config is safe as a nondeployable template',()=>{
  const result=run(example);
  assert.equal(result.status,0,result.stderr);
});
test('release gate rejects missing concrete IDs without trying any Cloudflare calls',()=>{
  const result=run(example,'--release');
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/staging_resources_not_concrete/);
});
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
function checkModified(fn){
  const folder=mkdtempSync(join(tmpdir(),'sanko-gate-'));
  const file=join(folder,'wrangler.toml');
  try{
    writeFileSync(file,fn(readFileSync(example,'utf8')));
    return run(file);
  } finally{rmSync(folder,{recursive:true,force:true});}
}
test('preflight rejects production D1 even when named staging',()=>{
  const x=checkModified(text=>text.replace('REPLACE_WITH_NEW_STAGING_D1_ID',
    'd566ac31-19ce-463f-80e5-6ed1b0d56b16'));
  assert.notEqual(x.status,0);
  assert.match(x.stderr,/staging_config_reuses_production_resource/);
});
test('preflight rejects accidental real model or admin mutations before staging review',()=>{
  for(const [search,replace] of [
    ['ENABLE_REAL_MODEL = "false"','ENABLE_REAL_MODEL = "true"'],
    ['ENABLE_ADMIN_MUTATIONS = "false"','ENABLE_ADMIN_MUTATIONS = "true"'],
    ['STAGING_MODE = "true"','STAGING_MODE = "false"']]){
    const x=checkModified(text=>text.replace(search,replace));
    assert.notEqual(x.status,0,search);
    assert.match(x.stderr,/missing_staging_safeguard/);
  }
});
