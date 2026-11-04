import { MANDATORY_SANKO_FORMS } from "./sanko-mandatory-forms.js";
import { smoothSankoSpeech } from "./sanko-natural-phrases.js";

// A literal dictionary gloss ("опосля" means "после") is NOT Sanko's
// own word choice. Protect it so mandatory dialectisation cannot turn
// "опосля значит после" into "опосля значит опосля".
const meaningQuestion=/(?:чего|что|шо|почему|зачем|значит|означает|объясни|поясни)/iu;
const word=s=>new RegExp("(?<![\\p{L}\\p{N}])"+s+"(?![\\p{L}\\p{N}])","iu");
export function repairSankoLexicalClarification(reply,question,history=[]) {
 let text=String(reply||"");
 const request=String(question||"");
 if(!meaningQuestion.test(request))return text;

 // In a past answer "Плывём опосля по реке", the time word was
 // extraneous. Correct the old sentence, don't invent another story.
 if(word("опосля").test(request)&&Array.isArray(history)){
  const previous=[...history].reverse().find(x=>x?.role==="model")?.text||"";
  const first=String(previous).split(/[.!?]/u)[0].trim();
  if(/(?<![\p{L}\p{N}])плыв(?:ём|ем|у|ут)\s+опосля\s+по\s+реке(?![\p{L}\p{N}])/iu.test(first) &&
     first.length>0 && first.length<=140){
   const cleaned=smoothSankoSpeech(first);
   return "Лишнее слово вставил. "+cleaned.replace(/[.!?]+$/u,"")+".";
  }
 }

 // Only protect a literary meaning in a *definition* of the requested
 // dialect word, not ordinary first-person vocabulary elsewhere.
 for(const [standard,dialect] of MANDATORY_SANKO_FORMS){
  if(!word(dialect).test(request))continue;
  const gloss=new RegExp("((?:значит|означает|то\\s+есть)\\s+)("+standard+")(?![\\p{L}\\p{N}])","giu");
  text=text.replace(gloss,(_match,intro,meaning)=>intro+"«"+meaning+"»");
  // Also fix a tautological definition directly authored by Gemini.
  const circle=new RegExp(
   "((?:значит|означает|то\\s+есть)\\s+)("+dialect+")(?=[.?!,;:]|$)","giu");
  text=text.replace(circle,(_match,intro)=>intro+"«"+standard+"»");
 }
 return text;
}

// A conversational repair is a request to clarify the previous answer,
// NOT permission to invent another explanation or overwrite canonical facts.
// The cue is only included when the reader actually challenges Sanko's speech.
const clarification=/(?:не\s+понял[ао]?|не\s+понимаю|непонятн\p{L}*|чего\s+ты\s+нес[её]шь|что\s+ты\s+нес[её]шь|шо\s+ты\s+нес[её]шь|язык\s+заплетается|говори\s+(?:понятнее|нормально|проще|внятнее)|скажи\s+(?:нормально|проще|понятнее|внятно|нормальными\s+словами)|объясни\s+(?:нормально|проще|понятнее)|выразись\s+понятнее|сказанул\s+непонятно|перемудрил\p{L}*|чего\s+["«]?\p{L}+["»]?\s*\?|что\s+ты\s+хотел\s+сказать|что\s+значит)/iu;
export function sankoClarificationCue(question,history=[]) {
 if(!Array.isArray(history)||!history.some(x=>x?.role==="model"))return "";
 if(!clarification.test(String(question||"")))return "";
 return "\n\n## Собеседник НЕ ПОНЯЛ твою прошлую реплику\n"+
  "Он просит ясности, а не новой истории. В ОДНОЙ-ДВУХ простых фразах "+
  "объясни смысл предыдущего ответа обычным связным русским синтаксисом. "+
  "Сохраняй лишь те славонские формы, значения которых действительно нужны. "+
  "Не повторяй странные выражения и не придумывай новых событий, мест, "+
  "действий или разговоров ради объяснения. "+
  "Проверяй факты по утверждённому канону, а не по своим прошлым словам. "+
  "Если прежний факт не подтверждён, признай, что ошибся, и не развивай его. "+
  "Если спрашивают о значении необычного слова, не повторяй это же слово в качестве объяснения. "+
  "Можно назвать общеупотребительный русский эквивалент в кавычках: это пояснение термина, а не твоя речь. "+
  "Если словечко было вставлено зря, просто скажи, что оговорился, и повтори мысль без него.";
}
