/** Optional provider-neutral automatic event candidate extraction. */
export function makeModelExtractor(model) {
  if(!model||typeof model.generate!=='function')throw new TypeError('missing_extraction_model');
  return async ({system,user,sourcePostId,sourceContentHash})=>{
    const response=await model.generate({system,history:[],message:user,maxOutputTokens:1600});
    const text=String(response?.text||'').trim();
    if(!text||text.length>150_000)throw new Error('empty_or_excessive_extraction_reply');
    // Do not strip markdown fences: untrusted response must satisfy strict JSON.
    let data;
    try {data=JSON.parse(text);}catch{throw new Error('extraction_invalid_json');}
    if(data.sourcePostId && data.sourcePostId!==sourcePostId)
      throw new Error('extraction_wrong_source_id');
    if(data.sourceContentHash && data.sourceContentHash!==sourceContentHash)
      throw new Error('extraction_wrong_source_version');
    return data;
  };
}
