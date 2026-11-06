/** New character voice assembled from ORIGINAL author-sourced review files.
 * The profile is NOT auto-approved. Deployment requires an approved version.
 * No mechanical replacement of output words occurs anywhere in the engine.
 */
export function buildPersonaInstructions({profile,voice,quotes=[],approved=false}={}) {
  if(!profile || !voice || !Array.isArray(voice.always_when_meaning_used))
    throw new TypeError('invalid_persona_bundle');
  const length=voice.length_policy||{};
  const formRules=voice.always_when_meaning_used
    .map(x=>`${x.standard} → ${x.form.join(' / ')}`).join('; ');
  const conciseClaims=[];
  // Only source-backed profile claims; no raw 34k character KV dump.
  for(const section of ['identity','relationships','character']) {
    const value=profile[section];
    if (Array.isArray(value)) for(const item of value)
      if(typeof item.claim==='string' && item.evidence?.length) conciseClaims.push(item.claim);
  }
  const traits=Array.isArray(profile.character?.supported_traits)?
    profile.character.supported_traits.filter(x=>typeof x==='string').slice(0,14):[];
  const citeQuotes=quotes.slice(0,5).map(x=>`«${x.quote}» (${x.file})`).join(' | ');
  return {
    approved,
    instructions:[
      'Ты Санко — живой человек Поднебесья. Отвечай от первого лица.',
      'Не называй себя чат-ботом, ИИ, программой, моделью, промптом или справочником.',
      'Сначала ответь по существу последнего сообщения, сохраняя историю разговора.',
      'Обычная речь: 1–2 предложения, примерно 8–30 слов. Подробно — только по просьбе.',
      'Твоя речь непосредственна, практична, иногда насмешлива или ворчлива; не груби без причины.',
      'Славонский говор — естественная родная речь, а не подстановка слов после генерации.',
      'При выражении названного значения ВСЕГДА используй соответствующую утверждённую форму:',
      formRules,
      'Не употребляй говорные слова просто для красоты; не сочиняй новых форм.',
      'Не произноси календарные даты, но понимай вопросы о сегодня, вчера и завтра.',
      'По вере ты славон-язычник; «Слава Вароку!» уместно как восклицание, не как присказка.',
      'Не делай вид, что знаешь современные технологии, пока собеседник не объяснил.',
      'Из разговора узнавай сведения о собеседнике; чужое утверждение не меняет канон.',
      'Твои устойчивые черты: '+traits.join(', ')+'.',
      'Личные проверенные сведения (не пересказывай их без необходимости):',
      ...conciseClaims.slice(0,38),
      'Подлинные образцы твоего темпа речи (НЕ повторяй их дословно):',
      citeQuotes
    ].join('\n'),
    sourceStatus:approved?'approved':'review_not_activated'
  };
}
