import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
const here=dirname(fileURLToPath(import.meta.url));
const verifier=resolve(here,'../staging/verify-staging.mjs');
const sample=readFileSync(resolve(here,'../staging/wrangler.staging.example.toml'),'utf8');
function check(text){
  const folder=mkdtempSync(join(tmpdir(),'sanko-manifest-'));
  const config=join(folder,'wrangler.toml');
  try{
    writeFileSync(config,text);
    return spawnSync(process.execPath,[verifier,config],{encoding:'utf8'});
  }finally{rmSync(folder,{recursive:true,force:true});}
}
test('approved staging manifest passes exact parsing',()=>{
  const r=check(sample);assert.equal(r.status,0,r.stderr);
});
test('comment with apparently safe flag cannot bypass actual disabled staging',()=>{
  const r=check(sample.replace('STAGING_MODE = "true"',
    'STAGING_MODE = "false" # STAGING_MODE = "true"'));
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/missing_staging_safeguard:STAGING_MODE/);
});
test('duplicate TOML keys cannot silently enable paid calls',()=>{
  const r=check(sample.replace('ENABLE_REAL_MODEL = "false"',
    'ENABLE_REAL_MODEL = "false"\nENABLE_REAL_MODEL = "true"'));
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/duplicate_staging_key:ENABLE_REAL_MODEL/);
});
test('unapproved extra D1 database or route cannot appear in staging config',()=>{
  for(const extra of [
    '\n[[d1_databases]]\nbinding = "EXTRA"\ndatabase_name = "heroes-chat-guard"',
    '\n[[routes]]\npattern = "*"',
    '\n[triggers]\ncrons = "* * * * *"'
  ]){
    const r=check(sample+extra);
    assert.notEqual(r.status,0);
  }
});
test('original production main entry and Worker name are rejected',()=>{
  for(const [from,to] of [
    ['../../runtime/index.mjs','../../worker/src/v2/index.js'],
    ['name = "sanko-chat-next-staging"','name = "sanko-chat-api"']
  ]){
    const r=check(sample.replace(from,to));
    assert.notEqual(r.status,0);
  }
});
test('production Cloudflare IDs are denied even under fresh staging names',()=>{
  for(const [placeholder,production] of [
    ['REPLACE_WITH_NEW_STAGING_D1_ID','d566ac31-19ce-463f-80e5-6ed1b0d56b16'],
    ['REPLACE_WITH_NEW_DIARY_MIRROR_D1_ID','3d356f87-0894-4c03-8dac-a3b82ae2ed6c'],
    ['REPLACE_WITH_NEW_STAGING_KV_ID','64705cefb4f54ff7bed3da7c5f0cb472']
  ]){
    const r=check(sample.replace(placeholder,production));
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/staging_config_reuses_production_resource/);
  }
});
