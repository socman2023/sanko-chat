/**
 * The COMPLETE approved Sanko v0.4 profile stays unmodified in Cloudflare KV.
 * This module indexes it in memory on each request and selects only relevant
 * source passages. Never publish a shortened replacement to KV and NEVER send
 * the entire 8–33k profile to Gemini on every turn.
 */
const PREFIX='САНКО — ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ v0.4.';
const STOP=new Set(['что','шо','как','як','это','энто','этот','пока','меня','тебя','тебе',
  'расскажи','скажи','поговорим','пожалуйста','почему','какое','какой','какая',
  'такое','мене','сегодня','сейчас','вчера','нового','были','было','была',
  'быть','теперь','вообще','тебя','только','опять','откуда','знаешь','помнишь']);
const ALIASES=[
  [/(?:^|[^\p{L}])(пап|отец|отц|бат|родител)/u,['власто','отц','пап','родител']],
  [/(?:^|[^\p{L}])(мам|мать|матер)/u,['матер','мать','мам']],
  [/(?:^|[^\p{L}])(люб|девушк|возлюб)/u,['ясмин','лун','люб','чувств']],
  [/(?:^|[^\p{L}])(врач|леч|знахар|трав)/u,['леч','знахар','трав','целител']],
  [/(?:^|[^\p{L}])(сирот|семь|родствен)/u,['семь','род','сирот','власто']],
  [/(?:^|[^\p{L}])(умени|навык|маг|способност)/u,['уме','маг','способ','лес','лук']]
];
const fold=s=>String(s||'').toLocaleLowerCase('ru-RU').replace(/ё/gu,'е');
const stems=text=>[...new Set((fold(text).match(/[\p{L}]{4,}/gu)||[])
  .filter(w=>!STOP.has(w)).map(w=>w.length>=6?w.slice(0,5):w))];
function queryTerms(message,history=[]){
  let q=String(message||'');
  if(/^(?:а |а он|а она|почему|зачем|как же|что с)/iu.test(q) && Array.isArray(history)){
    const prev=[...history].reverse().find(x=>x?.role==='user'&&typeof x.text==='string');
    if(prev)q+=' '+prev.text.slice(0,250);
  }
  const terms=stems(q);
  for(const [pattern,related] of ALIASES)if(pattern.test(fold(q)))terms.push(...related);
  return [...new Set(terms)].slice(0,16);
}
function splitLong(text,limit=900){
  if(text.length<=limit)return [text];
  const sentences=text.match(/[^.!?\n]+[.!?]+(?:\s+|$)|[^.!?\n]+(?:\n|$)/gu)||[text];
  const out=[];let buf='';
  for(let s of sentences){
    while(s.length>limit){
      if(buf){out.push(buf.trim());buf='';}
      let idx=s.lastIndexOf(' ',limit);
      if(idx<limit/2)idx=limit;
      out.push(s.slice(0,idx).trim());s=s.slice(idx).trimStart();
    }
    if(buf.length+s.length>limit&&buf){out.push(buf.trim());buf='';}
    buf+=s;
  }
  if(buf.trim())out.push(buf.trim());
  return out;
}
export function indexFullApprovedProfile(raw){
  if(typeof raw!=='string'||raw.length<7500||raw.length>34000||!raw.startsWith(PREFIX))
    throw new TypeError('approved_profile_v04_missing_or_invalid');
  if(/ДЛЯ УТВЕРЖДЕНИЯ|черновик для критического/iu.test(raw))
    throw new TypeError('unapproved_profile_draft');
  const blocks=[];let heading='Общие сведения',parts=[],chars=0;
  const flush=()=>{
    if(!parts.length)return;
    for(const fragment of splitLong(parts.join('\n'),900)){
      if(fragment.trim())blocks.push({heading,text:fragment.trim(),ordinal:blocks.length});
    }
    parts=[];chars=0;
  };
  for(const line of raw.replace(/\r\n/gu,'\n').split('\n')){
    const row=line.trim();
    if(!row){if(chars>340)flush();continue;}
    const isHeading=row.length<92&&(
      /^#{1,4}\s/gu.test(row)||
      /^[А-ЯЁ0-9 /—–:.,()\-]{5,}$/u.test(row)||
      /^(?:[IVX]+|\d+)[.)]\s+[А-ЯЁ]/u.test(row)
    );
    if(isHeading){flush();heading=row.replace(/^#{1,4}\s+/u,'');}
    else {parts.push(row);chars+=row.length+1;if(chars>800)flush();}
  }
  flush();
  if(blocks.length<6)throw new TypeError('approved_profile_index_too_small');
  return {fullLength:raw.length,blocks,source:'sanko:profile:v1',version:'v0.4'};
}
export function selectApprovedProfile(raw,{message='',history=[],maxChars=2500}={}){
  if(!Number.isInteger(maxChars)||maxChars<0||maxChars>5000)
    throw new TypeError('invalid_profile_budget');
  const index=indexFullApprovedProfile(raw);
  const q=fold(message),terms=queryTerms(message,history);
  // Greetings and latest diary news need identity/voice, not full biography.
  const isNews=/(?:нового|новост|сегодня|вчера|нынче|произош|главн.*событ)/iu.test(q);
  const isGreeting=/^(?:здрав\s*будь|привет|здорово|как дела|как поживаешь)[!?.,\s]*$/iu.test(q);
  if(isGreeting||isNews||maxChars===0)
    return {passages:[],selectedChars:0,fullChars:index.fullLength,
      totalBlocks:index.blocks.length,source:index.source,version:index.version};
  const genericSelf=/(?:кто ты|о себе|своем прошлом|расскажи о себе|твоя жизнь)/iu.test(q);
  const scored=index.blocks.map(b=>{
    const h=fold(b.heading),t=fold(b.text);
    let score=0;
    for(const term of terms){
      if(h.includes(term))score+=12;
      if(t.includes(term))score+=4+Math.min(3,(t.split(term).length-1));
    }
    if(genericSelf&&/(?:характер|детств|происхож|личност|умени|сирот|семь)/iu.test(h+' '+t))score+=8;
    return {...b,score};
  }).filter(b=>b.score>0).sort((a,b)=>b.score-a.score||a.ordinal-b.ordinal);
  const passages=[];let used=0;
  for(const b of scored){
    if(passages.length>=5)break;
    const value='['+b.heading+'] '+b.text;
    if(used+value.length>maxChars)continue;
    passages.push({text:value,ordinal:b.ordinal,source:index.source});
    used+=value.length;
  }
  return {passages,selectedChars:used,fullChars:index.fullLength,
    totalBlocks:index.blocks.length,source:index.source,version:index.version};
}
