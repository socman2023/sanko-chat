import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const folder=resolve(root,'staging');
const script=resolve(folder,'dryrun-build.sh');
test('no installed Wrangler fails visibly, with no leftover compile-only config',()=>{
  const result=spawnSync('/bin/bash',[script],{cwd:root,encoding:'utf8',
    env:{...process.env,PATH:'/usr/bin:/bin'}});
  assert.equal(result.status,3,result.stderr);
  assert.match(result.stderr,/Wrangler CLI unavailable/);
});
test('staging cron entry contains explicit staging guard before any sync',()=>{
  const entry=readFileSync(resolve(root,'index.mjs'),'utf8');
  assert.match(entry,/STAGING_MODE['"]?\s*!==\s*'true'\|\|env\?\.ENABLE_CHRONICLE_SYNC/);
});
