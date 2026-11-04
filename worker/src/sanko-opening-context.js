// Only a recognized on-screen greeting can enter the language-model prompt.
// It never validates a visitor's VK identity or supplies facts about events.
const DEFAULT_OPENINGS=new Set([
 "Здрав будь! Шо хотел спросить?",
 "Здрав будь. Шо у тебя нового?",
 "Здрав будь. Ну, говори."
]);
const friends=/^О, [\p{L}\p{M} -]{2,45}! Здрав будь\. Шо у тебя нового\?$/u;
const followers=/^Здрав будь, [\p{L}\p{M} -]{2,45}! Шо тебе рассказать\?$/u;
const community=/^Здрав будь, [\p{L}\p{M} -]{2,45}! Шо спросить хотел\?$/u;

export function recognizedSankoOpening(opening,history=[]) {
 if(Array.isArray(history)&&history.length)return "";
 if(typeof opening!=="string"||opening.length>160)return "";
 if(DEFAULT_OPENINGS.has(opening))return opening;
 // The model never gets an unverified name supplied by the browser.
 if(friends.test(opening))return "Здрав будь. Шо у тебя нового?";
 if(followers.test(opening))return "Здрав будь. Шо тебе рассказать?";
 if(community.test(opening))return "Здрав будь. Шо спросить хотел?";
 return "";
}
export function openingConversationCue(opening,history) {
 const valid=recognizedSankoOpening(opening,history);
 if(!valid)return "";
 return "\n\n## НАЧАЛО ЭТОЙ БЕСЕДЫ (отображено в чате, не было в сохранённой истории)\n"+
  "Ты только что обратился к собеседнику так: «"+valid+"».\n"+
  "Сейчас собеседник может отвечать на ТВОЁ приветствие или встречный вопрос. "+
  "Учитывай этот контекст, отвечай по смыслу. Не выдумывай поручений, "+
  "походов, маршрутов и разговоров о деле, которых он не упоминал.";
}
