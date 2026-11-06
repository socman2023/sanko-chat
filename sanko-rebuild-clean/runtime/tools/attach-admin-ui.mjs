/** Copies the exact approved *presentation-only* module into the clean Worker.
 * No legacy conversational modules or prompts are imported.
 * The source must match the audited Git blob at main HEAD ea2b373... .
 */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const APPROVED_ADMIN_UI_BLOB='f54996b76062c58edbba8fff5a306e77c704d547';
export const APPROVED_SOURCE_COMMIT='ea2b373c1b7b66ca90cc0c0e72d1a94731b24fc2';
const target=resolve(dirname(fileURLToPath(import.meta.url)),'../approved-admin-ui.mjs');

export function gitBlobSha1(contents){
  const b=Buffer.isBuffer(contents)?contents:Buffer.from(contents);
  return createHash('sha1').update(`blob ${b.byteLength}\0`).update(b).digest('hex');
}
export async function attachApprovedAdminUi({source,output=target,
  expectedBlob=APPROVED_ADMIN_UI_BLOB}={}){
  if(!source)throw Error('approved_ui_source_required');
  const bytes=await readFile(source);const sha=gitBlobSha1(bytes);
  if(sha!==expectedBlob)throw Error('approved_ui_blob_mismatch');
  const sourceText=bytes.toString('utf8');
  for(const name of ['ADMIN_HTML','ADMIN_CSS','ADMIN_SCRIPT']){
    if(!sourceText.includes(`export const ${name} =`))
      throw Error('approved_ui_export_missing:'+name);
  }
  // Exact pinned Git blob hash above is the content-integrity boundary.
  // Avoid token matching in HTML/CSS/JS literal strings (e.g. "!important"
  // or an "importing" status), which would reject the approved UI itself.
  await mkdir(dirname(output),{recursive:true});
  const temporary=output+'.tmp-'+process.pid;
  try{
    await writeFile(temporary,bytes,{flag:'wx'});
    await rename(temporary,output);
  }catch(e){
    const {rm}=await import('node:fs/promises');
    await rm(temporary,{force:true}).catch(()=>{});
    throw e;
  }
  const written=await readFile(output);
  if(!bytes.equals(written))throw Error('approved_ui_copy_mismatch');
  return {gitBlobSha1:sha,byteLength:bytes.length,output};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const path=process.argv[2];
  attachApprovedAdminUi({source:path}).then(result=>{
    process.stdout.write(JSON.stringify(result)+'\n');
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
