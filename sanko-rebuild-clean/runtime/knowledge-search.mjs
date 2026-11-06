/** Read-only lookup of the EXISTING Sanko canonical D1 corpus.
 * Different from the old Sanko retrieval code; new implementation uses the
 * source-backed records already present, without rebuilding/rewriting them.
 */
const COMMON=new Set([
  'скажи','расскажи','расскажешь','говори','пожалуйста','когда',
  'почему','зачем','тебе','тебя','твой','твои','твоём','твоем','какой',
  'что','шо','как','як','кто','хто','где','куда','куды','сегодня','вчера',
  'завтра','такой','такая','такие','нового','дела','были','было','была','будет','будут',
  'сейчас','ныне','помнишь','слышал','слышала','свой','друзья',
  'меня','мне','мене','мя','ты','оно','там','тама','тута','сюда','туды'
]);
const DEFAULT_MAX_HITS=5;
const MAX_CHARS=8000;
const GREETING=/^(?:привет(?:ик)?|здрав\s+будь|здравствуй|здорово|добрый\s+(?:вечер|день))[!?.… ]*$/iu;
const SHORT_CURRENT=/^(?:(?:а|ну)[ ,]+)*(?:(?:шо|что)\s+нового(?:\s+у\s+тебя)?|(?:шо|что)\s+было\s+сегодня|(?:шо|что)\s+(?:было|произошло)\s+вчера)[!?.… ]*$/iu;

export function searchTerms(question) {
  if(typeof question!=='string'||question.length>4000)throw new TypeError('invalid_search_question');
  const clean=question.toLocaleLowerCase('ru-RU').replace(/ё/gu,'е');
  if(GREETING.test(clean)||SHORT_CURRENT.test(clean))return [];
  const words=clean.match(/[\p{L}]{3,}/gu)||[];
  const unique=[];
  for(const w of words){
    if(COMMON.has(w))continue;
    // A conservative lookup stem is ONLY a search hint, never a fabricated fact.
    const stem=w.length>=6?w.replace(/(?:иями|ями|ами|ого|его|ому|ему|ости|ах|ях|ом|ем|ой|ый|ий|ов|ев|а|я|ы|и|у|е)$/u,''):w;
    if(stem.length<3||unique.includes(stem))continue;
    unique.push(stem);
    if(unique.length>=4)break;
  }
  return unique;
}

function safeChunk(x){
  if(!x||typeof x.content!=='string'||!x.content.trim()||
     typeof x.id!=='string'||typeof x.source!=='string'||
     !Number.isInteger(Number(x.priority)))return null;
  return {id:x.id,source:x.source,scope:String(x.scope||''),
    priority:Number(x.priority),publishedDay:String(x.published_day||''),
    title:String(x.title||''),text:x.content};
}

export async function readCanonicalEvidence({db,question,maxHits=DEFAULT_MAX_HITS,
  maxCharacters=MAX_CHARS}={}) {
  if(!db?.prepare||!Number.isInteger(maxHits)||maxHits<1||maxHits>12||
    !Number.isInteger(maxCharacters)||maxCharacters<100||maxCharacters>30000)
    throw new TypeError('invalid_canon_lookup');
  const terms=searchTerms(question);
  if(!terms.length)return {status:'not_needed',terms:[],hits:[],truncated:false};
  // search_text is explicitly populated in lower case by Sanko's corpus importer.
  const where=terms.map(()=>"search_text LIKE ?").join(' OR ');
  const sql=`SELECT id,source,scope,priority,published_day,title,content
    FROM sanko_canon_chunks WHERE (${where})
    ORDER BY priority ASC, published_day DESC, id ASC LIMIT 100`;
  let rows;
  try {
    const out=await db.prepare(sql).bind(...terms.map(x=>'%'+x+'%')).all();
    if(!Array.isArray(out?.results))throw new Error('invalid_query_result');
    rows=out.results;
  }catch {return {status:'unavailable',terms,hits:[],truncated:false};}
  const scored=rows.map(safeChunk).filter(Boolean).map(hit=>{
    const searchable=(hit.title+' '+hit.text).toLocaleLowerCase('ru-RU').replace(/ё/gu,'е');
    const matched=terms.filter(t=>searchable.includes(t)).length;
    return {...hit,matched};
  }).filter(x=>x.matched>0)
    .sort((a,b)=>b.matched-a.matched||a.priority-b.priority||
      b.publishedDay.localeCompare(a.publishedDay)||a.id.localeCompare(b.id));
  const hits=[];let chars=0;
  for(const hit of scored){
    if(hits.length>=maxHits)break;
    if(chars+hit.text.length>maxCharacters)continue; // whole fragment or omit
    chars+=hit.text.length;
    const {matched,...source}=hit;
    hits.push(source);
  }
  return {status:scored.length?'found':'no_match',terms,hits,
    truncated:rows.length===100||scored.length>hits.length,
    totalCandidates:scored.length,selectedCharacters:chars};
}
