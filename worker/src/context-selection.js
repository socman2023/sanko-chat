// EXPERIMENT: choose canonical source sets; never truncate an included post.
const greeting=/^(?:привет(?:ик)?|здрав(?:ствуй(?:те)?| будь)|зд[оа]рово|доброе утро|добрый (?:день|вечер)|салют)[\s!?.…]*$/iu;
const social=/^(?:как дела(?: у тебя)?|как поживаешь|как ты|как сам|ты как|а у тебя|шо у тебя|чем занят|что делаешь|как настроение)[\s!?.,…]*$/iu;
const current=/^(?:что(?: у вас)? нового|шо(?: у вас)? нового|какие новости|что сегодня было|что сегодня случилось|как идут дела|что у вас происходит|сам говори,? что было)[\s!?.,…]*$/iu;
const gloss=/^(?:(?:чего|что|шо)\s+[«"'“]?\s*(?:опосля|покуда|дотуль|досель)\s*[»"'”]?\s*\??|что значит\s+[«"'“]?\s*(?:опосля|покуда|дотуль|досель)\s*[»"'”]?\s*\??)$/iu;
const followup=/^(?:а потом|а дальше|и потом|и дальше|а почему|а где он|а где она|а что с ним|а что с ней|и что|и шо|почему|чего|что дальше)[\s!?.,…]*$/iu;
const deep=/(?:подробн|во всех подробностях|по порядку|с самого начала|расскажи целиком|вспомни всё)/iu;
const narrow=q=>String(q||"").trim();
function previousTopic(history){
 if(!Array.isArray(history))return "";
 for(let i=history.length-1;i>=0;i--){
  const h=history[i];
  if(h?.role!=="user")continue;
  const text=narrow(h.text).slice(0,450);
  if(!text||greeting.test(text)||social.test(text)||current.test(text)||
     gloss.test(text)||followup.test(text))continue;
  return text;
 }
 return "";
}
export function selectSankoContext(question,history=[],dateScope=null){
 const q=narrow(question);
 if(dateScope?.day)return {kind:"dated",profile:"full",diary:"date",
  recentPosts:0,topicPosts:0,useRetrieval:true,searchQuestion:q};
 if(greeting.test(q))return {kind:"greeting",profile:"compact",diary:"none",
  recentPosts:0,topicPosts:0,useRetrieval:false,searchQuestion:q};
 if(gloss.test(q)&&Array.isArray(history)&&history.some(h=>h?.role==="model"))
  return {kind:"gloss",profile:"compact",diary:"none",
   recentPosts:0,topicPosts:0,useRetrieval:false,searchQuestion:q};
 const oldTopic=previousTopic(history);
 if(social.test(q)&&!oldTopic)return {kind:"social",profile:"compact",diary:"recent",
  recentPosts:1,topicPosts:0,useRetrieval:false,searchQuestion:q};
 if(current.test(q))return {kind:"current",profile:"compact",diary:"recent",
  recentPosts:2,topicPosts:0,useRetrieval:false,searchQuestion:q};
 const searchQuestion=followup.test(q)&&oldTopic?(oldTopic+" "+q).slice(0,700):q;
 // Ambiguous continuations must retain the current-day sequence in full:
 // a relevant fact may be in the final paragraph of a long diary post.
 if(followup.test(q))return {kind:"continuation",profile:"full",diary:"continuation",
  recentPosts:0,topicPosts:5,useRetrieval:true,searchQuestion};
 if(deep.test(q))return {kind:"detailed",profile:"full",diary:"topical",
  recentPosts:3,topicPosts:10,useRetrieval:true,searchQuestion};
 return {kind:"knowledge",profile:"full",diary:"topical",
  recentPosts:2,topicPosts:5,useRetrieval:true,searchQuestion};
}
export const SANKO_COMPACT_IDENTITY =
 "Санко — славон, ученик класса Арбориса в Академии Светозара. "+
 "Олешка — твой близкий друг и названный брат. "+
 "Ты живёшь в Поднебесье и говоришь от первого лица. "+
 "Различай то, что видел сам, и то, что узнал от других. "+
 "Не выдумывай события, чужие слова и свои воспоминания. "+
 "Вопросы о конкретном человеке или приключении требуют подтверждённых источников.";
