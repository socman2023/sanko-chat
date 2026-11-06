/** Fail-closed, dependency-free preflight for the *isolated* staging Worker.
 * This is not a Cloudflare resource inventory or proof of account ownership.
 * Syntax recognition is intentionally limited to the staging manifest's
 * approved TOML subset; unknown sections and duplicate keys are rejected.
 */
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const file=process.argv[2]||new URL('./wrangler.staging.example.toml',import.meta.url);
const source=readFileSync(file,'utf8');
const release=process.argv.includes('--release');
const compileOnly=process.argv.includes('--compile-only');
if(release&&compileOnly)throw Error('release_and_compile_modes_conflict');

function parseStagingToml(raw){
  const root={},vars={},d1=[],kv=[];
  let section=root;
  for(const [index,untrimmed] of raw.split(/\r?\n/u).entries()){
    const line=untrimmed.trim();
    if(!line||line.startsWith('#'))continue;
    if(line==='[vars]'){section=vars;continue;}
    if(line==='[[d1_databases]]'){section={};d1.push(section);continue;}
    if(line==='[[kv_namespaces]]'){section={};kv.push(section);continue;}
    const match=line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(?:"([^"\r\n]*)"|(true|false))\s*(?:#.*)?$/u);
    if(!match)throw Error('unsupported_or_unsafe_staging_toml_line:'+(index+1));
    const key=match[1],value=match[2]??match[3];
    if(Object.hasOwn(section,key))throw Error('duplicate_staging_key:'+key);
    section[key]=value;
  }
  return {root,vars,d1,kv};
}
const {root,vars,d1,kv}=parseStagingToml(source);
const expectedRoot={name:'sanko-chat-next-staging',main:'../../runtime/index.mjs',
  workers_dev:'true',keep_vars:'false'};
const expectedVars={ALLOWED_ORIGIN:'https://socman2023.github.io',
  STAGING_MODE:'true',ENABLE_REAL_MODEL:'false',
  ENABLE_ADMIN_MUTATIONS:'false',ENABLE_CHRONICLE_SYNC:'false',
  ENABLE_CHRONICLE_EXTRACTION:'false'};
for(const [key,value] of Object.entries(expectedRoot)){
  if(root[key]!==value)throw Error('missing_staging_safeguard:'+key);
}
for(const [key,value] of Object.entries(expectedVars)){
  if(vars[key]!==value)throw Error('missing_staging_safeguard:'+key);
}
const allowedRoot=new Set([...Object.keys(expectedRoot),'compatibility_date']);
const allowedVars=new Set([...Object.keys(expectedVars),
  'VK_APP_ID','VK_OWNER_USER_ID','GEMINI_MODEL']);
for(const key of Object.keys(root))if(!allowedRoot.has(key))throw Error('unapproved_root_key:'+key);
for(const key of Object.keys(vars))if(!allowedVars.has(key))throw Error('unapproved_variable:'+key);
if(d1.length!==2||kv.length!==1)throw Error('staging_bindings_not_isolated');
const db=new Map(d1.map(x=>[x.binding,x]));
if(db.size!==2||db.get('GUARD_DB')?.database_name!=='sanko-chat-next-test'||
  db.get('DIARY_DB')?.database_name!=='sanko-chat-next-diary-mirror'||
  db.get('GUARD_DB')?.migrations_dir!=='migrations')
  throw Error('staging_database_name_or_bindings_invalid');
if(kv[0]?.binding!=='CURRENT_CONTEXT')throw Error('staging_kv_binding_invalid');
for(const spec of d1){
  if(Object.keys(spec).some(key=>!['binding','database_name','database_id','migrations_dir'].includes(key)))
    throw Error('unapproved_d1_setting');
}
if(Object.keys(kv[0]).some(key=>!['binding','id'].includes(key)))
  throw Error('unapproved_kv_setting');
const bannedIds=new Set([
  'd566ac31-19ce-463f-80e5-6ed1b0d56b16', // Live Sanko D1
  '3d356f87-0894-4c03-8dac-a3b82ae2ed6c', // Oleshka D1
  '64705cefb4f54ff7bed3da7c5f0cb472' // Shared KV
]);
const ids=[...d1.map(x=>x.database_id),kv[0].id];
if(ids.some(x=>bannedIds.has(x)))throw Error('staging_config_reuses_production_resource');
const reservedCompileIds=[
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000003'];
if(release&&ids.some(x=>reservedCompileIds.includes(x)))
  throw Error('compile_only_ids_cannot_be_released');
if(compileOnly&&ids.some((x,i)=>x!==reservedCompileIds[i]))
  throw Error('compile_mode_requires_reserved_nonexistent_ids');
console.log('PASS: isolated staging-only manifest, no production bindings, routes or crons');

if(release){
  if(ids.some(x=>!/^\p{ASCII_Hex_Digit}{8}-\p{ASCII_Hex_Digit}{4}-\p{ASCII_Hex_Digit}{4}-\p{ASCII_Hex_Digit}{4}-\p{ASCII_Hex_Digit}{12}$/u.test(x)) ||
    new Set(ids.map(x=>x.toLowerCase())).size!==3)
    throw Error('staging_resources_not_concrete');
  const asset=new URL('../approved-admin-ui.mjs',import.meta.url);
  if(!existsSync(asset))throw Error('approved_admin_ui_not_attached');
  const bytes=readFileSync(asset);
  const hash=createHash('sha1').update('blob '+bytes.length).update(Buffer.from([0]))
    .update(bytes).digest('hex');
  if(hash!=='f54996b76062c58edbba8fff5a306e77c704d547')
    throw Error('approved_admin_ui_hash_mismatch');
  console.log('PASS: release-safe staging manifest and byte-identical approved admin UI');
}
