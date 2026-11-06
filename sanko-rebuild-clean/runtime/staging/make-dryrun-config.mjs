/** Generate a compile-only Wrangler config with reserved, non-live IDs.
 * Never use it for deploy (without --dry-run). This helper does not use network.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url));
export const COMPILE_IDS=Object.freeze({
  guard:'00000000-0000-4000-8000-000000000001',
  diary:'00000000-0000-4000-8000-000000000002',
  kv:'00000000-0000-4000-8000-000000000003'
});
export function createCompileOnlyConfig({source=join(here,'wrangler.staging.example.toml'),
  output=join(here,'wrangler.compile-'+randomUUID()+'.toml')}={}){
  const template=readFileSync(source,'utf8');
  let content=template;
  for(const [marker,id] of [
    ['REPLACE_WITH_NEW_STAGING_D1_ID',COMPILE_IDS.guard],
    ['REPLACE_WITH_NEW_DIARY_MIRROR_D1_ID',COMPILE_IDS.diary],
    ['REPLACE_WITH_NEW_STAGING_KV_ID',COMPILE_IDS.kv]]){
    if(content.split(marker).length!==2)throw Error('compile_template_invalid:'+marker);
    content=content.replace(marker,id);
  }
  const header='# COMPILE-ONLY GENERATED CONFIG. NEVER DEPLOY.\n'+
    '# These IDs are fake and are never intended to exist in Cloudflare.\n';
  writeFileSync(output,header+content,{flag:'wx',mode:0o600});
  return resolve(output);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(createCompileOnlyConfig()+'\n');}
  catch(e){console.error(e.message);process.exitCode=1;}
}
