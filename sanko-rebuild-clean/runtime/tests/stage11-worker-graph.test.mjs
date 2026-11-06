import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const script=resolve(dirname(fileURLToPath(import.meta.url)),'../tools/check-worker-graph.mjs');
test('entrypoint and all reachable relative imports resolve without old conversation engine',()=>{
  const r=spawnSync(process.execPath,[script],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const result=JSON.parse(r.stdout);
  assert(result.modules>=10);
  assert(result.edges>=10);
  assert.equal(result.verifiedManifestMain,true);
  assert.equal(result.noLegacyEngineDependency,true);
  assert.equal(result.notActualWranglerCompilation,true);
  assert(result.allowedMissing.length<=1);
});
