import test from "node:test";
import assert from "node:assert/strict";
import { SANKO_SPEECH_EXAMPLES,primeWithSankoExamples } from "../src/sanko-dialogue-examples.js";

test("style replies are attested Sanko quotes; scenario cues are marked noncanon",()=>{
 const replies=SANKO_SPEECH_EXAMPLES.map(x=>x.reply);
 assert(replies.includes("Ты шо, дырку протереть хошь?"));
 assert(replies.includes("Охолонись, брат. По порядку: хто приплыл, куды приехал?"));
 assert(replies.includes("Ты энто… тута помедленней"));
 assert(replies.includes("Надо посмотреть."));
 const c=primeWithSankoExamples([],"Ну и шо?");
 assert.equal(c.length,SANKO_SPEECH_EXAMPLES.length*2+1);
 for(let i=0;i<SANKO_SPEECH_EXAMPLES.length;i++){
  assert.equal(c[i*2].role,"user");
  assert(c[i*2].parts[0].text.startsWith("[Только образец манеры речи, не настоящее событие]"));
  assert.equal(c[i*2+1].role,"model");
  assert.equal(c[i*2+1].parts[0].text,SANKO_SPEECH_EXAMPLES[i].reply);
 }
});
test("real conversation stays intact and in order after exemplars",()=>{
 const history=[{role:"user",text:"Слыхал про то?"},{role:"model",text:"Надо посмотреть."}];
 const c=primeWithSankoExamples(history,"А что теперь?");
 assert.deepEqual(c.slice(-3),[
  {role:"user",parts:[{text:"Слыхал про то?"}]},
  {role:"model",parts:[{text:"Надо посмотреть."}]},
  {role:"user",parts:[{text:"А что теперь?"}]}
 ]);
 assert.equal(history.length,2,"Never mutate actual user history");
});


test("first reply to an actual on-screen greeting is not preceded by fictional examples",()=>{
 const first=primeWithSankoExamples([],"То же, шо и у тебя.",{skipExamples:true});
 assert.deepEqual(first,[{role:"user",parts:[{text:"То же, шо и у тебя."}]}]);
 const history=[{role:"user",text:"Узнал?"},{role:"model",text:"Узнал."}];
 const followup=primeWithSankoExamples(history,"И шо?",{skipExamples:true});
 assert.deepEqual(followup,[
  {role:"user",parts:[{text:"Узнал?"}]},
  {role:"model",parts:[{text:"Узнал."}]},
  {role:"user",parts:[{text:"И шо?"}]}
 ]);
});
