import test from 'node:test';
import assert from 'node:assert/strict';
import {composePrompt} from '../context.mjs';
import {buildCurrentContext} from '../../chronicle/current-context.mjs';
import {normalizePost} from '../../chronicle/normalize.mjs';

const persona={approved:true,instructions:'Ты Санко. Говори от своего лица, по делу.'};
async function makePost(postId,date,text){
  return normalizePost({
    owner_id:850667816,post_id:postId,
    published_at:Math.floor(Date.parse(date+'T17:00:00Z')/1000),
    published_day_msk:date,
    source_url:'https://vk.ru/wall850667816_'+postId,
    source_text:text,category:'diary',ingested_at:1793990000
  });
}
const narrative=(
  'Ратша заметил на барже пленников: Махмуд, Руман и Элина оказались живы. '+
  'Элина узнала Ратшу и помахала ему — теперь она знает, что помощь рядом. '+
  'Мы обогнали баржу и отправились к переправе. Там проход был закрыт из-за вельможи с охраной. '+
  'Дело наше ещё не кончено. '
).repeat(8);
test('latest-day key rescue news survives older props and midnight roll-over',async()=>{
  const posts=[
    await makePost(32259,'2026-11-06',narrative),
    await makePost(32242,'2026-11-05','Повозки, снасти, баржа, доски. '.repeat(155)),
    await makePost(32210,'2026-11-04','Ехали по дороге. '.repeat(145))
  ];
  const ctx=buildCurrentContext({today:'2026-11-07',posts,
    maxSourcePosts:6,sourceReadComplete:true});
  const prompt=composePrompt({persona,context:ctx,
    message:'Какое главное событие сегодня произошло? Что нового?'});
  assert.equal(prompt.ok,true);
  assert.equal(prompt.recentNewsFocus,true);
  assert.equal(prompt.latestSourceDayIncluded,true);
  assert(prompt.includedSourcePostIds.includes(32259));
  assert(prompt.system.includes(narrative));
  assert.match(prompt.system,/"kind":"author_approved_source_backed_story_pivot"/);
  assert.match(prompt.system,/Элина узнала Ратшу и подала знак/);
  assert.match(prompt.system,/"focusDayMatchesToday":false/);
  assert.match(prompt.system,/Ищи, что изменилось для героев/);
});
test('correction followup keeps primary news instead of repeating old background props',async()=>{
  const p=await makePost(32259,'2026-11-06',narrative);
  const ctx=buildCurrentContext({today:'2026-11-07',posts:[p],
    maxSourcePosts:6,sourceReadComplete:true});
  const prompt=composePrompt({persona,context:ctx,
    message:'Какими повозками и снастями?',
    history:[
      {role:'user',text:'Что у тебя нового?'},
      {role:'model',text:'Да всё повозки и снасти.'}
    ]});
  assert(prompt.ok);
  assert.equal(prompt.recentNewsFocus,true);
  assert(prompt.includedSourcePostIds.includes(32259));
  assert.match(prompt.system,/перечитай факты и исправь смысл/);
});
test('latest-day news answer does not convert publication timestamp into eyewitness knowledge',async()=>{
  const p=await makePost(32259,'2026-11-06',narrative);
  const ctx=buildCurrentContext({today:'2026-11-07',posts:[p],
    maxSourcePosts:6,sourceReadComplete:true});
  const x=composePrompt({persona,context:ctx,message:'Что было за последние сутки?'});
  assert.equal(x.ok,true);
  assert.match(x.system,/не выдавай вчерашнюю запись за сегодняшнюю/);
  assert.match(x.system,/от первого лица свидетеля говори только если/);
});

test('author-approved 6 Nov headline never overrides later diary day',async()=>{
  const old=await makePost(32259,'2026-11-06',narrative);
  const fresh=await makePost(32500,'2026-11-07','Сегодня совсем новые события в городе; события подтверждены этой записью.'.repeat(12));
  const ctx=buildCurrentContext({today:'2026-11-07',posts:[old,fresh],
    maxSourcePosts:6,sourceReadComplete:true});
  const out=composePrompt({persona,context:ctx,message:'А что нового?'});
  assert(out.ok);
  assert(!out.system.includes('author_approved_source_backed_story_pivot'));
});
test('editorial plot cue is withheld unless specific source mentions all three people',async()=>{
  const fake=await makePost(32259,'2026-11-06','На дороге видели повозку, и больше ничего не произошло.'.repeat(15));
  const ctx=buildCurrentContext({today:'2026-11-07',posts:[fake],
    maxSourcePosts:6,sourceReadComplete:true});
  const out=composePrompt({persona,context:ctx,message:'Что нового?'});
  assert(out.ok);
  assert(!out.system.includes('author_approved_source_backed_story_pivot'));
});
