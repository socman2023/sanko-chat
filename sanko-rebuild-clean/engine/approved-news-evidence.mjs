/**
 * Author-approved story pivots. These are editorial annotations linked to a
 * SPECIFIC public diary post, not inferred eyewitness memories or free-form
 * KV claims. They activate only while that publication is latest and its full
 * source still contains the referenced characters. New diary days supersede it.
 */
const PIVOTS=[
  {
    postId:32259,
    publicationDay:'2026-11-06',
    sourceUrl:'https://vk.ru/wall850667816_32259',
    required:[/элин/iu,/ратш/iu,/руман/iu],
    plot:[
      'Ратша обнаружил на барже Махмуда, Румана и Элину: все трое живы.',
      'Элина узнала Ратшу и подала знак, что заметила его. Это ключевой поворот поисков: пленники уже знают, что спасатели близко.',
      'После этого товарищи обогнали баржу, но переправа оказалась закрыта из-за ожидаемого вельможи.'
    ],
    source:'Утверждённый автором план и итог дневниковой записи за 6 ноября; подтверждать только по оригинальной публикации'
  }
];
export function approvedStoryPivot(latestDay,selectedPosts){
  if(!Array.isArray(selectedPosts))return null;
  const item=PIVOTS.find(p=>p.publicationDay===latestDay);
  if(!item)return null;
  const post=selectedPosts.find(p=>p.postId===item.postId &&
    p.publicationDay===item.publicationDay &&
    /^https:\/\/vk\.(?:ru|com)\/wall850667816_32259$/u.test(p.sourceUrl||''));
  if(!post||typeof post.text!=='string'||
    !item.required.every(rx=>rx.test(post.text)))return null;
  return {publicationDay:item.publicationDay,postId:item.postId,
    sourceUrl:post.sourceUrl,kind:'author_approved_source_backed_story_pivot',
    // These notes are not canonical personal memories or permission to claim
    // that Sanko witnessed an action absent from original text.
    keyPlotPoints:item.plot,
    characterIdentity:'Элина — девочка (дочь Махмуда, сестра Румана); Ратша — другой человек, он принял облик воронёнка. Никогда не называй Элину птицей.',
    epistemicRule:'Tell as story news; claim personal sight only when explicitly source-backed'};
}
