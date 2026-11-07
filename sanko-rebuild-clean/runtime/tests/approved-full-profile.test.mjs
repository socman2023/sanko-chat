import test from 'node:test';
import assert from 'node:assert/strict';
import {indexFullApprovedProfile,selectApprovedProfile} from '../approved-profile-selector.mjs';
import {loadProductionPersona} from '../production-persona.mjs';

const relation=(name,body)=>name+'\n'+body+'\n\n';
const profile='САНКО — ПЕРСОНАЛЬНЫЙ ПРОФИЛЬ v0.4.\n\n'+
  relation('САНКО','Славон, четырнадцать лет. Любит лес и друзей. '.repeat(35))+
  relation('ОЛЕШКА','Двоюродный брат Санко и лучший друг. '.repeat(35))+
  relation('ВЛАСТОЯР','Родной отец Санко; жив, воссоединились после долгой разлуки. '.repeat(35))+
  relation('ЯСМИН / ЛУНА','Акробатка из Куштии, дорога Санко. Он зовёт её Ясмин или Луной. '.repeat(35))+
  relation('РАТША','Мальчик, превращающийся в воронёнка. '.repeat(35))+
  relation('ЭЛИНА','Девочка, сестра Румана. '.repeat(35))+
  relation('ХАСИМ','Циркач, Санко его лечил. '.repeat(35))+
  relation('ХАРАКТЕР','Упрямый, наблюдательный, мягкий к животным. '.repeat(40))+
  relation('УМЕНИЯ','Лес, растения, охота, лук, знахарство и разные травы. '.repeat(30));
test('complete approved original is preserved and indexed without substitution',()=>{
  assert(profile.length>7500&&profile.length<34000);
  const index=indexFullApprovedProfile(profile);
  assert.equal(index.fullLength,profile.length);
  assert(index.blocks.length>6);
  assert.equal(index.source,'sanko:profile:v1');
});
test('topic retrieve pulls Yasmin facts without transmitting entire stored profile',()=>{
  const found=selectApprovedProfile(profile,{message:'Что тебе известно про Ясмин?',
    maxChars:1600});
  assert(found.selectedChars>50&&found.selectedChars<=1600);
  assert(found.selectedChars<found.fullChars/4);
  assert(found.passages.some(p=>/Ясмин|Лун/iu.test(p.text)));
  assert(!found.passages.some(p=>/ХАСИМ/.test(p.text)));
});
test('relation query searches full published profile for father, without orphan fiction',()=>{
  const found=selectApprovedProfile(profile,{message:'Расскажи про отца Властояра',
    maxChars:1800});
  assert(found.passages.some(p=>/Властояр|Родной отец/iu.test(p.text)));
  assert(found.selectedChars<=1800);
});
test('hello and latest news do not drag private biography into model input',()=>{
  for(const message of ['Привет!','Что у вас нового?','Расскажи, что сегодня было.']){
    const found=selectApprovedProfile(profile,{message,maxChars:2200});
    assert.equal(found.selectedChars,0,message);
    assert.equal(found.fullChars,profile.length);
  }
});
test('production loader reads full original but passes at most 3100 topical chars',async()=>{
  const reads=[];
  const env={CURRENT_CONTEXT:{get:async key=>{reads.push(key);return profile;}}};
  const normal=await loadProductionPersona(env,'Что у тебя с Ясмин?');
  assert.equal(normal.approved,true);
  assert.deepEqual(reads,['sanko:profile:v1']);
  assert.equal(normal.profileSelection.fullChars,profile.length);
  assert(normal.profileSelection.selectedChars<=2100);
  assert(normal.instructions.includes('Ясмин'));
  assert(!normal.instructions.includes(profile));
  const more=await loadProductionPersona(env,'Расскажи подробно о Властояре');
  assert(more.profileSelection.selectedChars<=3100);
  assert(more.instructions.length<7000);
});
test('unapproved, incomplete and missing profile fails closed',async()=>{
  assert.throws(()=>selectApprovedProfile('Санко',{message:'Кто ты?'}),/invalid/);
  await assert.rejects(()=>loadProductionPersona({CURRENT_CONTEXT:{get:async()=>null}},'Ясмин'));
});
