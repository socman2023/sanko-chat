import test from "node:test";
import assert from "node:assert/strict";
import { SANKO_SPEECH_EXAMPLES,buildSankoConversation } from "../src/sanko-dialogue-examples.js";

test("attested Sanko quotations remain available without synthetic dialogue",()=>{
 const replies=SANKO_SPEECH_EXAMPLES.map(x=>x.reply);
 assert(replies.includes("Ты шо, дырку протереть хошь?"));
 assert(replies.includes("Охолонись, брат. По порядку: хто приплыл, куды приехал?"));
 assert(replies.includes("Ты энто… тута помедленней"));
 assert(replies.includes("Надо посмотреть."));
 const c=buildSankoConversation([],"Ну и шо?");
 assert.deepEqual(c,[{role:"user",parts:[{text:"Ну и шо?"}]}]);
 assert(!JSON.stringify(c).includes("Только образец манеры речи"));
});
test("only original user/model turns stay intact and in order over long dialogue",()=>{
 const history=[];
 for(let i=0;i<12;i++){
  history.push({role:"user",text:"Настоящий вопрос "+i});
  history.push({role:"model",text:"Настоящий ответ "+i});
 }
 const before=JSON.stringify(history);
 const c=buildSankoConversation(history,"Чего? Не понял.");
 assert.equal(c.length,history.length+1);
 assert.deepEqual(c.map(x=>x.parts[0].text),[
  ...history.map(x=>x.text),"Чего? Не понял."
 ]);
 assert.equal(JSON.stringify(history),before,"No mutation or staged speech examples");
 assert(!JSON.stringify(c).includes("Только образец"));
});
test("first response and follow-up have no preloaded fictional turns",()=>{
 assert.deepEqual(buildSankoConversation([],"А у тебя?"),
  [{role:"user",parts:[{text:"А у тебя?"}]}]);
 const history=[{role:"user",text:"Узнал?"},{role:"model",text:"Узнал."}];
 assert.deepEqual(buildSankoConversation(history,"И шо?"),[
  {role:"user",parts:[{text:"Узнал?"}]},
  {role:"model",parts:[{text:"Узнал."}]},
  {role:"user",parts:[{text:"И шо?"}]}
 ]);
});
