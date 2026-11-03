import test from "node:test";
import assert from "node:assert/strict";
import { containsForbiddenCalendarOrBookkeeping,guardSankoReply } from "../src/reply-guard.js";

test("absolute calendar dates must not appear in Sanko speech",()=>{
 for(const line of [
  "За энту дату нема вестей.",
  "Нынче 4 ноября.",
  "В 2026 году было худо.",
  "На дворе 2026-11-04.",
  "Дело было 04.11.2026.",
  "В ноябре пойдём обратно.",
  "В понедельник поглядим.",
  "По доступным записям ничего не произошло.",
  "В доступном летописце записей нет."
 ]){
  assert(containsForbiddenCalendarOrBookkeeping(line),line);
  const out=guardSankoReply(line);
  assert.equal(out.blocked,true);
  assert(!containsForbiddenCalendarOrBookkeeping(out.reply));
  assert(!out.reply.includes(line));
 }
});
test("natural relative references and colloquial dialect remain untouched",()=>{
 for(const line of [
  "Шо нынче нового? Покуда ничего не слыхал.",
  "Вчера мы от стражников ушли, еле ноги унесли.",
  "Ежли шо узнаю, скажу.",
  "Завтра ещё поглядим."
 ]){
  assert(!containsForbiddenCalendarOrBookkeeping(line),line);
  assert.deepEqual(guardSankoReply(line),{reply:line,blocked:false});
 }
});
