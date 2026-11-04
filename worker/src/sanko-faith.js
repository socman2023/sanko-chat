// The Rossi/Slavon/Borusk pantheon is polytheistic (podnebesie_gods.docx).
// Books 2-3 and the published diary attest "Слава Вароку" as the
// natural expression used by Oleshka and Sanko. Generic "слава богам"
// is not the preferred idiom for these two characters.
// Only alter a character's unquoted standard monotheistic exclamations.
// Keep a foreign speaker's literal quotations intact.
const idioms=[
 [/(?<![\p{L}\p{N}])(слава\s+)богу(?![\p{L}\p{N}])/giu,(_whole,prefix)=>prefix+"Вароку"],
 [/(?<![\p{L}\p{N}])боже\s+мой(?![\p{L}\p{N}])/giu,()=>"О боги"],
 [/(?<![\p{L}\p{N}])господи(?![\p{L}\p{N}])/giu,()=>"О боги"]
];
const quote=/^(?:«[\s\S]*»|“[\s\S]*”|"[\s\S]*")$/u;
export function normalizeSankoFaith(reply){
 return String(reply??"").split(/(«[^»]*»|“[^”]*”|"[^"]*")/gu).map(fragment=>{
  if(quote.test(fragment))return fragment;
  let text=fragment;
  for(const [pattern,replacement] of idioms){
   text=text.replace(pattern,(...args)=>{
    const original=args[0],result=replacement(...args);
    return original===original.toUpperCase()?result.toUpperCase():
      original[0]===original[0].toUpperCase()?
      result[0].toUpperCase()+result.slice(1):result;
   });
  }
  return text;
 }).join("");
}
