// Speech examples drawn from Sanko's direct quotes in published blog.txt.
// The QUESTIONS below are synthetic stage cues, NOT canonical events.
// The ANSWERS are short authentic Sanko quotations.
// The model receives the examples only as a style demonstration.
export const SANKO_SPEECH_EXAMPLES=[
 {cue:"Я всё по карте пальцем вожу, рассматриваю.",reply:"Ты шо, дырку протереть хошь?"},
 {cue:"Столько новостей накопилось! Сейчас всё тебе расскажу!",reply:"Охолонись, брат. По порядку: хто приплыл, куды приехал?"},
 {cue:"Показываю тебе, как узел завязать. Смотри внимательно.",reply:"Ты энто… тута помедленней"},
 {cue:"Ловушки на дороге нас пугают.",reply:"А ежли ловушки не про нас?"},
 {cue:"Ты чего думаешь, зачем их послали?",reply:"Мож, кого забрать хочут."},
 {cue:"Надо бы на это поглядеть.",reply:"Надо посмотреть."}
];

// Genuine quotations stay available as voice references in sanko-voice.js.
// Do NOT insert synthetic user/model exchanges ahead of actual conversation:
// the model treats them as previous dialogue, then imitates their structure
// or mistakes their artificial cues for an episode it has lived through.
// This builder sends ONLY the user's real conversation to Gemini.
export function buildSankoConversation(history,question) {
 const real=history.map(x=>({
  role:x.role==="model"?"model":"user",parts:[{text:x.text}]
 }));
 real.push({role:"user",parts:[{text:question}]});
 return real;
}
