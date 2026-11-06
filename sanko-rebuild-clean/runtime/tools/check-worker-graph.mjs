/** Static dependency and manifest-path inspection for the clean Worker.
 * This is NOT a substitute for an actual Wrangler/esbuild compilation.
 */
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const entry=resolve(root,'runtime/index.mjs');
const staging=resolve(root,'runtime/staging/wrangler.staging.example.toml');
const template=readFileSync(staging,'utf8');
const actualEntry=template.match(/^main\s*=\s*"([^"]+)"/m)?.[1];
if(!actualEntry||resolve(dirname(staging),actualEntry)!==entry)
  throw Error('worker_manifest_main_mismatch');
const imports=[];const seen=new Set();const missing=[];
const approvedAsset=resolve(root,'runtime/approved-admin-ui.mjs');
function scan(filepath){
  if(seen.has(filepath))return;
  if(!existsSync(filepath)){
    if(filepath===approvedAsset){missing.push('approved-admin-ui.mjs (must be attached from pinned source)');return;}
    throw Error('missing_worker_dependency:'+filepath);
  }
  seen.add(filepath);
  const src=readFileSync(filepath,'utf8');
  if(src.includes('worker/src/')||src.includes('legacy.fetch('))
    throw Error('legacy_conversation_dependency:'+filepath);
  const re=/\b(?:import\s+(?:[^;'"\n]+?\s+from\s+)?|export\s+[^;'"\n]+?\s+from\s+)['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for(const match of src.matchAll(re)){
    const specifier=match[1]||match[2];
    const child=resolve(dirname(filepath),specifier);
    imports.push([filepath,child]);
    scan(child);
  }
}
scan(entry);
if(!imports.some(([a,b])=>b===approvedAsset))throw Error('approved_ui_attachment_not_required');
for(const file of seen){
  if(!file.startsWith(root+'/'))throw Error('dependency_leaves_package:'+file);
  if(extname(file)!=='.mjs')throw Error('unexpected_worker_module_extension:'+file);
}
if(!existsSync(resolve(root,'runtime/staging/migrations/0001_clean_staging.sql'))||
  !existsSync(resolve(root,'runtime/staging/migrations/0001_diary_mirror.sql')))
  throw Error('staging_migrations_missing');
const output={ok:true,entry:'runtime/index.mjs',modules:seen.size,edges:imports.length,
  allowedMissing:missing,
  noLegacyEngineDependency:true,
  verifiedManifestMain:true,
  notActualWranglerCompilation:true};
console.log(JSON.stringify(output,null,2));
export {scan};
