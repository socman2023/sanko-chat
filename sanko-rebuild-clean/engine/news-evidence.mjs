/** Generic, zero-API-call salience hints from the actual diary text.
 * Quotes are copied verbatim from the supplied source; this module NEVER
 * approves a new canonical claim, invents an event, or hardcodes post IDs.
 */
const signal=[
 [/нашл[иао]|отыскал|обнаружил|разыскал|настигл|увидел|повстречал/iu,28],
 [/плен|пропавш|похищ|спас|вызвол|освобод|жив[ыаое]|найден/iu,24],
 [/догнал|нагнал|встретил|узнал|заметил|помахал|подал[аи]? знак/iu,12],
 [/погиб|ранен|потеря|пропал|опасност|решил|уда[лс]ось/iu,15],
 [/погод|снаст|повоз|поклаж|завтрак|корм|оснащен|доски|веревк/iu,-14]
];
const unnamed=new Set(['Утром','Вечером','Ночью','Сегодня','Вчера','Потом','Когда',
 'Наконец','Вот','Тогда','Мы','Все','Тут','Там','Однажды','Так','Еще','Только']);
function rank(text){
  let n=0;
  for(const [rx,weight] of signal)if(rx.test(text))n+=weight;
  const names=[...text.matchAll(/(?:^|[^\p{L}])([А-ЯЁ][а-яё]{2,})/gu)]
    .map(x=>x[1]).filter(x=>!unnamed.has(x));
  const unique=new Set(names);
  n+=Math.min(unique.size,5)*8;
  if(unique.size>=3 && /нашл|обнаруж|отыск|увид|жив|плен/iu.test(text))n+=25;
  if(/нашл|обнаруж|отыск|спас|вызвол/iu.test(text) &&
    /плен|пропав|жив|друз|дет|товарищ/iu.test(text))n+=30;
  return n;
}
function candidates(source){
  const full=String(source||'');
  const sentences=full.split(/(?<=[.!?…])\s+(?=[А-ЯЁ«—])/u)
    .flatMap(x=>x.split(/\n{2,}/u)).map(x=>x.trim())
    .filter(x=>x.length>=30);
  const result=[];
  for(let i=0;i<sentences.length;i++){
    const sentence=sentences[i];
    if(sentence.length<=600)result.push(sentence);
    // Neighboring sentences often contain the discovery and its consequence;
    // pair them when they fit, but never fabricate a combined quote.
    if(i+1<sentences.length && sentence.length+sentences[i+1].length+1<=630)
      result.push(sentence+' '+sentences[i+1]);
  }
  return result;
}
export function newsEvidenceFromPosts(posts,{maxQuotes=3,maxChars=1200}={}){
  if(!Array.isArray(posts)||!Number.isInteger(maxQuotes)||maxQuotes<1||maxQuotes>6||
     !Number.isInteger(maxChars)||maxChars<100||maxChars>5000)
    throw TypeError('invalid_news_evidence_input');
  const day=posts.map(p=>p?.publicationDay||p?.publishedDay).filter(Boolean).sort().at(-1);
  const scored=[];
  for(const post of posts.filter(p=>(p.publicationDay||p.publishedDay)===day)){
    const full=post.text||post.fullSourceText;
    if(typeof full!=='string')continue;
    for(const text of candidates(full)){
      if(!full.includes(text))continue;
      const score=rank(text);
      if(score>0)scored.push({text,score,postId:post.postId,
        publicationDay:day,sourceUrl:post.sourceUrl,verifiedLiteral:true});
    }
  }
  scored.sort((a,b)=>b.score-a.score||a.text.length-b.text.length);
  let used=0;const selected=[];
  for(const candidate of scored){
    if(selected.length>=maxQuotes)break;
    if(selected.some(p=>p.text.includes(candidate.text)||candidate.text.includes(p.text)))continue;
    if(used+candidate.text.length>maxChars)continue;
    selected.push(candidate);used+=candidate.text.length;
  }
  const mentionedPeople=[...new Set(selected.flatMap(x=>
    [...x.text.matchAll(/(?:^|[^\p{L}])([А-ЯЁ][а-яё]{2,})/gu)]
      .map(m=>m[1]).filter(name=>!unnamed.has(name))))].slice(0,10);
  return {sourceDay:day||null,quotes:selected,mentionedPeople,
    selectedChars:used,sourceStatus:'verbatim_excerpt_not_authored_event_or_sanko_memory'};
}
