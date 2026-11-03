// Calendar dates and system bookkeeping belong to retrieval, never to spoken dialogue.
const calendar=/(?<![\p{L}\p{N}])(?:(?:19|20)\d{2}(?:[-/.]\d{1,2}[-/.]\d{1,2})?|\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?|январ[яьеюём]|феврал[яьеюём]|март[аеуом]?|апрел[яьеюём]|ма[йяюе]|июн[яьеюём]|июл[яьеюём]|август[аеуом]?|сентябр[яьеюём]|октябр[яьеюём]|ноябр[яьеюём]|декабр[яьеюём]|понедельник[аеуом]?|вторник[аеуом]?|сред[аеуыой]?|четверг[аеуом]?|пятниц[аыеуой]?|суббот[аыеуой]?|воскресень[яеюем]?)(?![\p{L}\p{N}])/iu;
const administrative=[
 /(?<!\p{L})дат(?:а|у|ы|е|ой|ами|ах|ам)(?!\p{L})/iu,
 /доступн\p{L}*\s+(?:запис\p{L}*|дневник\p{L}*|летопис\p{L}*)/iu,
 /записей\s+(?:нет|не\s+было)/iu
];
const fallback="Покуда ничего толком не слыхал. Ежли шо узнаю — расскажу.";
export function containsForbiddenCalendarOrBookkeeping(value) {
 const text=String(value||"");
 return calendar.test(text)||administrative.some(re=>re.test(text));
}
export function guardSankoReply(value) {
 const reply=typeof value==="string"?value.trim():"";
 return !reply||containsForbiddenCalendarOrBookkeeping(reply)
  ? {reply:fallback,blocked:true}
  : {reply,blocked:false};
}
