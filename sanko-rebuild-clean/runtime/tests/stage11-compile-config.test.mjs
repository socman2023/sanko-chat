import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,rmSync} from 'node:fs';
import {createCompileOnlyConfig,COMPILE_IDS} from '../staging/make-dryrun-config.mjs';
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const gate=resolve(root,'staging/verify-staging.mjs');
function verify(path,...flags){return spawnSync(process.execPath,[gate,path,...flags],{encoding:'utf8'});}
test('compile-only config has exactly three reserved non-live UUIDs and keeps all safety flags',()=>{
  const file=createCompileOnlyConfig();
  try{
    const text=readFileSync(file,'utf8');
    assert.match(text,/COMPILE-ONLY GENERATED CONFIG/);
    assert(text.includes(COMPILE_IDS.guard));
    assert(text.includes(COMPILE_IDS.diary));
    assert(text.includes(COMPILE_IDS.kv));
    assert(!text.includes('REPLACE_WITH_NEW_'));
    assert.match(text,/ENABLE_REAL_MODEL = "false"/);
    assert.match(text,/ENABLE_ADMIN_MUTATIONS = "false"/);
    assert.match(text,/ENABLE_CHRONICLE_SYNC = "false"/);
    assert.equal(verify(file,'--compile-only').status,0);
    const dangerous=verify(file,'--release');
    assert.notEqual(dangerous.status,0);
    assert.match(dangerous.stderr,/compile_only_ids_cannot_be_released/);
    assert.notEqual(verify(file,'--release','--compile-only').status,0);
  }finally{rmSync(file,{force:true});}
});
test('template cannot masquerade as compile-only configuration',()=>{
  const source=resolve(root,'staging/wrangler.staging.example.toml');
  const r=verify(source,'--compile-only');
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/compile_mode_requires_reserved_nonexistent_ids/);
});
test('original dryrun script never contains a plain deploy command',()=>{
  const text=readFileSync(resolve(root,'staging/dryrun-build.sh'),'utf8');
  const lines=text.split('\n').map(x=>x.trim()).filter(x=>x.includes(' deploy --config '));
  assert(lines.length===1);
  for(const line of lines)assert.match(line,/--dry-run/);
  assert.match(text,/trap cleanup EXIT/);
});
