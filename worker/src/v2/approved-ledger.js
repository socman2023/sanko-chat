// Sanko v2: typed, source-attributed facts. Not generative prose or inferred memories.
// Only brief author-confirmed claims; the private profile remains in KV.
import { isRealDay } from "../lib.js";
const BASE=Object.freeze([
 {id:"2026-11-05/boatman/lunzin",asOf:"2026-11-05",
  topic:"barge_route",subject:"лодочник",predicate:"сообщил_направление",
  object:"Лунцзин",source:"author-confirmed:2026-11-05",
  standpoint:"heard_by_group",certainty:"reported"},
 {id:"2026-11-05/checkpoint/shiqiao",asOf:"2026-11-05",
  topic:"barge_route",subject:"тицзюй",predicate:"сообщил_остановку",
  object:"Шицяо",source:"author-confirmed:2026-11-05",
  standpoint:"heard_by_group",certainty:"reported"},
 {id:"2026-11-05/checkpoint/disembark",asOf:"2026-11-05",
  topic:"barge_route",subject:"тицзюй",predicate:"сообщил_высадку",
  object:"часть невольников высадят в Шицяо и направят другими путями",
  source:"author-confirmed:2026-11-05",standpoint:"heard_by_group",certainty:"plan"},
 {id:"2026-11-05/barge/description",asOf:"2026-11-05",
  topic:"barge_description",subject:"тюремная баржа",
  predicate:"подтверждённые_приметы",
  object:"четыре мачты; высокие нос и корма; белый круг на борту",
  source:"author-final:2026-11-05",standpoint:"description",certainty:"known"}
]);
const valid=x=>x&&typeof x==="object"&&typeof x.id==="string"&&x.id.length<=100&&
 isRealDay(x.asOf)&&["barge_route","barge_description","personal","current"].includes(x.topic)&&
 ["heard_by_group","direct","description","third_party"].includes(x.standpoint)&&
 ["known","reported","plan","uncertain"].includes(x.certainty)&&
 ["subject","predicate","object","source"].every(k=>typeof x[k]==="string"&&x[k].length<=300)&&
 x.subject.length>0;
export function approvedFactsFromKV(raw){
 if(!raw)return [];
 try {
  const data=JSON.parse(raw);
  if(!Array.isArray(data)||data.length>100||!data.every(valid))return [];
  return data.map(x=>({id:x.id,asOf:x.asOf,topic:x.topic,
   subject:x.subject,predicate:x.predicate,object:x.object,
   source:x.source,standpoint:x.standpoint,certainty:x.certainty}));
 }catch{return [];}
}
export function resolveApprovedFacts(kvRaw,nowDay,questionDay=""){
 const entries=[...BASE,...approvedFactsFromKV(kvRaw)]
  .filter(x=>x.asOf<=nowDay&&(!questionDay||x.asOf<=questionDay));
 const byId=new Map();
 for(const x of entries)byId.set(x.id,x);
 const final=[...byId.values()];
 const byClaim=new Map(),conflicts=[];
 for(const x of final){
  const key=x.asOf+"|"+x.topic+"|"+x.subject+"|"+x.predicate;
  const prior=byClaim.get(key);
  if(prior&&prior.object!==x.object)conflicts.push({a:prior.id,b:x.id});
  byClaim.set(key,x);
 }
 return {facts:final,conflicts};
}
export function factText(entries,question){
 const q=String(question||"").toLowerCase();
 const barge=/барж|лунцзин|шицяо|лодочн|тицзюй|застав|невольник|высад|плыв|гон[яи]/iu.test(q);
 const items=entries.filter(x=>barge?x.topic.startsWith("barge_"):x.topic!=="barge_route");
 return items.map(x=>"["+x.id+"; "+x.asOf+"; "+x.source+"; "+
  x.standpoint+"; "+x.certainty+"] "+x.subject+": "+
  x.predicate.replaceAll("_"," ")+" → "+x.object).join("\n");
}
export function sourceMap(facts){
 const pairs={};
 for(const f of facts){
  if(f.predicate==="сообщил_направление"||f.predicate==="сообщил_остановку")
   pairs[f.subject.toLowerCase()]={place:f.object,asOf:f.asOf,source:f.source};
 }
 return pairs;
}
