/** Fail-closed quality gate: does not rewrite Sanko's words or facts. */
const calendar=/(?<![\p{L}\p{N}])(?:19\d\d|20\d\d|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|январ\p{L}*|феврал\p{L}*|март\p{L}*|апрел\p{L}*|ма[йяюе]|июн\p{L}*|июл\p{L}*|август\p{L}*|сентябр\p{L}*|октябр\p{L}*|ноябр\p{L}*|декабр\p{L}*|понедельник\p{L}*|вторник\p{L}*|четверг\p{L}*|пятниц\p{L}*|суббот\p{L}*|воскресень\p{L}*)/iu;
const forbiddenMeta=/(?<![\p{L}\p{N}])(?:я\s+(?:чат[- ]?бот|языковая\s+модель|искусственный\s+интеллект)|как\s+ИИ|по\s+доступным\s+записям|за\s+энту\s+дату)(?![\p{L}\p{N}])/iu;
const unnatural=/(?<![\p{L}\p{N}])(?:далебени|чинота|чинуша)(?![\p{L}\p{N}])/iu;
const knownForms=new Map([
 ['что','шо'],['как','як'],['какой','якой'],['только','тока/токмо'],
 ['это','энто'],['этот','энтот'],['если','ежли'],['здесь','тута'],
 ['тут','тута'],['там','тама'],['кто','хто'],['куда','куды'],
 ['хочешь','хошь'],['мне','мене'],['меня','мя'],['этих','энтих'],
 ['каждый','кажный'],['после','опосля'],['сюда','сюды'],['туда','туды'], ['нет','нема'],['до сих пор','досель'],['дотуда','дотуль'],['до туда','дотуль']
]);
export function checkSankoResponse(text,{maxChars=3200}={}) {
  if(typeof text!=='string'||!text.trim())return {ok:false,reasons:['empty_response']};
  const reasons=[];
  if(text.length>maxChars)reasons.push('overlength');
  if(calendar.test(text))reasons.push('calendar_date');
  if(forbiddenMeta.test(text))reasons.push('meta_explanation');
  if(unnatural.test(text))reasons.push('unattested_invented_dialect');
  for(const [wrong,expected] of knownForms) {
    if(new RegExp(`(?<![\\p{L}\\p{N}])${wrong}(?![\\p{L}\\p{N}])`,'iu').test(text))
      reasons.push(`noncanonical_form:${wrong}:${expected}`);
  }
  // Do not mutate reply even if it fails. Semantic fidelity is a separate test.
  return {ok:reasons.length===0,reasons};
}
