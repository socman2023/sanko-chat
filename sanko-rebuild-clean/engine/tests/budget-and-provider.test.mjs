import test from 'node:test';
import assert from 'node:assert/strict';
import {composePrompt} from '../context.mjs';
import {answerAsSanko} from '../conversation.mjs';
import {GeminiAdapter} from '../gemini-adapter.mjs';
import {buildCurrentContext} from '../../chronicle/current-context.mjs';
import {normalizePost} from '../../chronicle/normalize.mjs';

const persona={approved:true,instructions:'Ты Санко. Говори от первого лица, коротко, по делу. Шо вместо что.'};
const day='2026-11-06';
const post=async(id,dayText,text)=>normalizePost({
  owner_id:850667816,post_id:id,source_url:`https://vk.com/wall850667816_${id}`,
  published_day_msk:dayText,
  published_at:Math.floor(Date.parse(dayText+'T17:00:00Z')/1000)+id,
  source_text:text,category:'diary',ingested_at:Math.floor(Date.now()/1000)
});
const base=(posts)=>buildCurrentContext({today:day,posts,sourceReadComplete:true,maxSourcePosts:5});

test('long original diary posts fit by whole-post selection, not failure or clipping',async()=>{
  const first=await post(5201,day,'Сегодня на берегу '+ 'КОРАБЛЬ '.repeat(1100));
  const second=await post(5200,'2026-11-05','Вчера у переправы '+ 'КАМЕНЬ '.repeat(1100));
  const result=composePrompt({persona,context:base([first,second]),message:'Сегодня корабль?',
    sourceCharBudget:20000,maxInputChars:13300});
  assert.equal(result.ok,true);
  assert.equal(result.includedSourceCount,1);
  assert.equal(result.omittedSourceCount,1);
  assert(result.system.includes(JSON.stringify(first.fullText)));
  assert(!result.system.includes(second.fullText));
  assert.equal(result.moreSourcesAvailable,true);
  assert(result.approxInputChars<=13300);
});
test('topical material is selected as a whole above unrelated newer post',async()=>{
  const first=await post(5220,day,'Давно ищем приют. '+ 'ПРИЮТ '.repeat(1500));
  const second=await post(5210,'2026-11-05','Властояр проверил коня. '+ 'ВЛАСТОЯР '.repeat(1150));
  const result=composePrompt({persona,context:base([first,second]),message:'Где Властояр?',
    sourceCharBudget:20000,maxInputChars:16000});
  assert(result.ok);
  assert(result.system.includes(second.fullText));
  assert(!result.system.includes(first.fullText));
});
test('fully oversized single source is omitted, and selection incompleteness remains explicit',async()=>{
  const only=await post(5331,day,'Вечер '+ 'СТРОКА '.repeat(3900));
  const result=composePrompt({persona,context:base([only]),message:'А сегодня?',
    sourceCharBudget:20000,maxInputChars:15000});
  assert.equal(result.ok,true);
  assert.equal(result.includedSourceCount,0);
  assert.equal(result.moreSourcesAvailable,true);
  assert.match(result.system,/"availableSourceSelectionComplete":false/);
  assert(!result.system.includes('СТРОКА '.repeat(300)));
});
test('whole canonical chunks are similarly omitted instead of causing context overflow',()=>{
  const ctx=base([]);
  const hits=Array.from({length:8},(_,i)=>({source:'book1',text:'ЛЕС '.repeat(650)+i,priority:i}));
  const x=composePrompt({persona,context:ctx,message:'Расскажи про лес',
    knowledge:{status:'ready',hits},maxInputChars:12500});
  assert(x.ok);
  assert(x.includedCanonCount>0 && x.includedCanonCount<8);
  assert(x.omittedCanonCount>0);
  assert.match(x.system,/"availableCanonSelectionComplete":false/);
});
test('unsafely oversized baseline still fails closed without calling the provider',async()=>{
  const model={generate:async()=>{throw Error('should not call');}};
  const out=await answerAsSanko({model,persona:{approved:true,instructions:'И'.repeat(6000)},
    context:base([]),message:'Привет',maxInputChars:5500});
  assert.equal(out.error,'input_context_over_budget');
  assert.equal(out.providerCalls,0);
});
test('Gemini response with MAX_TOKENS exposes real usage on failure',async()=>{
  const gemini=new GeminiAdapter({apiKey:'DUMMY_KEY_ONLY',model:'gemini-3.5-flash-lite',
    fetchImpl:async()=>({ok:true,json:async()=>({candidates:[{finishReason:'MAX_TOKENS'}],
      usageMetadata:{promptTokenCount:3456,thoughtsTokenCount:50,totalTokenCount:4010}})})});
  await assert.rejects(()=>gemini.generate({system:'S',message:'Шо?'}),e=>{
    assert.equal(e.code,'model_response_unusable');
    assert.equal(e.usage.promptTokenCount,3456);return true;
  });
  const bad=await answerAsSanko({model:gemini,persona,context:base([]),message:'Шо нового?'});
  assert.equal(bad.ok,false);
  assert.equal(bad.providerCalls,1);
  assert.equal(bad.usage.totalTokenCount,4010);
});
test('Gemini request does not override default sampling temperature',async()=>{
  let config=null;
  const gemini=new GeminiAdapter({apiKey:'DUMMY_KEY_ONLY',model:'gemini-3.5-flash-lite',
    fetchImpl:async(_url,opts)=>{config=JSON.parse(opts.body).generationConfig;
      return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'Тута.'}]}}]})};}});
  await gemini.generate({system:'S',message:'Шо?'});
  assert.equal(config.temperature,undefined);
  assert(config.maxOutputTokens>384);
});
