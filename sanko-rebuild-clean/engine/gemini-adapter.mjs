/** Gemini network transport: provider-swappable and independent of prompt logic. */
export class GeminiAdapter {
  constructor({apiKey,model,fetchImpl=fetch,
    timeoutMs=18000}={}) {
    if(!apiKey||typeof apiKey!=='string'||!fetchImpl||timeoutMs<1000)
      throw new TypeError('invalid_gemini_config');
    if(!/^[a-z0-9][a-z0-9._-]{2,80}$/u.test(model))throw new TypeError('invalid_model_name');
    this.apiKey=apiKey;this.model=model;this.fetchImpl=fetchImpl;this.timeoutMs=timeoutMs;
  }
  async generate({system,history=[],message,maxOutputTokens=768}) {
    const contents=[...history.map(h=>({role:h.role==='model'?'model':'user',
      parts:[{text:h.text}]})),{role:'user',parts:[{text:message}]}];
    const response=await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-goog-api-key':this.apiKey},
        body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,
          generationConfig:{maxOutputTokens}}),
        signal:AbortSignal.timeout(this.timeoutMs)
      });
    if(!response.ok) {
      const e=new Error('model_http_'+response.status);
      e.code='provider_http_'+response.status;throw e;
    }
    const json=await response.json();
    const result=json?.candidates?.[0];
    if(!result||result.finishReason!=='STOP'){
      const e=new Error('model_response_unusable');e.code='model_response_unusable';
      e.usage=json?.usageMetadata||null;throw e;
    }
    const text=result.content?.parts?.filter(p=>p && typeof p.text==='string' && !p.thought)
      .map(p=>p.text).join('').trim()||'';
    return {text,model:this.model,usage:json.usageMetadata||null};
  }
}
