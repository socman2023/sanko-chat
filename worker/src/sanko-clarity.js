// A conversational repair is a request to clarify the previous answer,
// NOT permission to invent another explanation or overwrite canonical facts.
// The cue is only included when the reader actually challenges Sanko's speech.
const clarification=/(?:не\s+понял[ао]?|не\s+понимаю|непонятн\p{L}*|чего\s+ты\s+нес[её]шь|что\s+ты\s+нес[её]шь|шо\s+ты\s+нес[её]шь|язык\s+заплетается|говори\s+(?:понятнее|нормально|проще|внятнее)|объясни\s+(?:нормально|проще|понятнее)|выразись\s+понятнее|сказанул\s+непонятно|перемудрил\p{L}*|чего\s+["«]?\p{L}+["»]?\s*\?|что\s+значит)/iu;
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
  "Если прежний факт не подтверждён, признай, что ошибся, и не развивай его.";
}
