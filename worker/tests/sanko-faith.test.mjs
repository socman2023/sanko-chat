import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSankoFaith } from "../src/sanko-faith.js";
import { SANKO_VOICE_RULES } from "../src/sanko-voice.js";

test("the exact user-reported Christian idiom becomes canonical plural",()=>{
 assert.equal(normalizeSankoFaith("Живы, слава Богу!"),"Живы, слава богам!");
 assert.equal(normalizeSankoFaith("Слава Богу, добрались."),"Слава богам, добрались.");
 assert.equal(normalizeSankoFaith("О, боги!"),"О, боги!");
 assert.equal(normalizeSankoFaith("Живы, и ладно."),"Живы, и ладно.");
});
test("do not rewrite outsiders' direct faith quotations or names",()=>{
 const raw='Купец сказал: «Слава Богу!». А мы, слава Богу, выжили.';
 assert.equal(normalizeSankoFaith(raw),
  'Купец сказал: «Слава Богу!». А мы, слава богам, выжили.');
 assert.equal(normalizeSankoFaith('“Боже мой” — сказала чужестранка.'),
  '“Боже мой” — сказала чужестранка.');
 assert.equal(normalizeSankoFaith('Господин Арборис говорит о Роде-Батюшке.'),
  'Господин Арборис говорит о Роде-Батюшке.');
});
test("no stereotypical Christian exclamations in Sanko's own unquoted words",()=>{
 assert.equal(normalizeSankoFaith("Боже мой! Господи!"),"О боги! О боги!");
 for(const text of ["Живы, слава Богу!","Господи, мы спаслись!","Боже мой!"]){
  const normalized=normalizeSankoFaith(text);
  assert(!/(?:слава\s+богу|господи|боже\s+мой)/iu.test(normalized),normalized);
  assert.equal(normalizeSankoFaith(normalized),normalized);
 }
});
test("belief contract follows named canonical Slavic pantheon without mandatory invocation",()=>{
 for(const name of ["Род-Батюшко","Варок","Дарбог","Стрый","Варун","Яр","Влёс","Мокуша","Морёна","Чернобог"])
  assert(SANKO_VOICE_RULES.includes(name),name);
 assert.match(SANKO_VOICE_RULES,/Ты НЕ православный и не христианин/u);
 assert.match(SANKO_VOICE_RULES,/не вставляй без причины/u);
});
