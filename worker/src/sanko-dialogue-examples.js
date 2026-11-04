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

// The sample turns are prepended before true chat history, and MUST NEVER
// be saved as messages or passed to the user's conversation history.
export function primeWithSankoExamples(history,question) {
 const examples=SANKO_SPEECH_EXAMPLES.flatMap(x=>[
  {role:"user",parts:[{text:"[Только образец манеры речи, не настоящее событие] "+x.cue}]},
  {role:"model",parts:[{text:x.reply}]}
 ]);
 const real=history.map(x=>({role:x.role==="model"?"model":"user",parts:[{text:x.text}]}));
 real.push({role:"user",parts:[{text:question}]});
 return [...examples,...real];
}
