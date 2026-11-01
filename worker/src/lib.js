// Pure helpers for Sanko's independent Cloudflare Worker.
// Reusable in tests; no character profile or secrets in public source.
export const CHARACTER = "sanko";
export const EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
export const LIMITS = Object.freeze({ day: 500, month: 15000, ipDay: 100 });
export const CHAT_MAX_BYTES = 35000;
export const CHAT_MAX_CHARS = 4000;
export const HISTORY_MAX = 12;
export const HISTORY_SAVED = 80;
export const PROFILE_KEY = "sanko:profile:v1";
export const CURRENT_KEY = "sanko:current:v1";
export const RECENT_KEY = "sanko:recent:v1";
export const DAY_PREFIX = "sanko:day:";

const MONTHS = Object.freeze({
  января:1, февраля:2, марта:3, апреля:4, мая:5, июня:6,
  июля:7, августа:8, сентября:9, октября:10, ноября:11, декабря:12
});
export function dayInMoscow(epochMs = Date.now()) {
  return new Date(epochMs + 3 * 3600000).toISOString().slice(0, 10);
}
export function previousDay(iso, offset = 1) {
  const ms = Date.parse(iso + "T00:00:00Z");
  return Number.isFinite(ms) ? new Date(ms - offset * 86400000).toISOString().slice(0, 10) : "";
}
export function nextDay(iso) {
  const ms = Date.parse(iso + "T00:00:00Z");
  return Number.isFinite(ms) ? new Date(ms + 86400000).toISOString().slice(0, 10) : "";
}
export function isRealDay(value) {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
export function dateIntent(question, today = dayInMoscow()) {
  if (typeof question !== "string") return null;
  const q = question.toLowerCase();
  const explicit = q.match(/(?<!\d)(20\d{2}-\d{2}-\d{2})(?!\d)/u);
  if (explicit && isRealDay(explicit[1])) return { day: explicit[1], kind: "explicit" };
  const spoken = q.match(/(?<!\d)([1-9]|[12]\d|3[01])\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(20\d{2}))?/u);
  if (spoken) {
    const year = spoken[3] || today.slice(0, 4);
    const day = year + "-" + String(MONTHS[spoken[2]]).padStart(2, "0") + "-" + spoken[1].padStart(2, "0");
    return isRealDay(day) ? { day, kind: "explicit" } : null;
  }
  if (/(?<![\p{L}])позавчера(?![\p{L}])/u.test(q)) return { day: previousDay(today, 2), kind:"relative" };
  if (/(?<![\p{L}])вчера(?![\p{L}])/u.test(q)) return { day: previousDay(today, 1), kind:"relative" };
  if (/(?<![\p{L}])сегодня(?![\p{L}])/u.test(q)) return { day: today, kind:"relative" };
  return null;
}
export function safeHistory(value) {
  if (!Array.isArray(value)) return [];
  const clean = value.filter(v => v && (v.role === "user" || v.role === "model") && typeof v.text === "string")
    .map(v => ({ role:v.role, text:v.text.trim().slice(0, 2500) }))
    .filter(v => v.text).slice(-HISTORY_MAX);
  const out=[];
  for (const item of clean) {
    const last = out[out.length-1];
    if (last && last.role === item.role) last.text = (last.text + "\n" + item.text).slice(-5000);
    else out.push(item);
  }
  return out;
}
export function strictCharacterFilter(day = "") {
  const filter = { character: { $in: ["shared", "sanko"] } };
  if (day) {
    if (!isRealDay(day)) throw new Error("Invalid date scope");
    filter.date = { $gte: day, $lt: nextDay(day) };
  }
  return filter;
}
export function safeVectorMatches(matches = [], {date = "", max = 7} = {}) {
  const output = []; let total=0;
  for (const hit of matches) {
    if (output.length >= max) break;
    const m = hit?.metadata || {};
    if (!["sanko","shared"].includes(m.character)) continue;
    if (typeof m.text !== "string" || !m.text.trim()) continue;
    if (date && !(typeof m.date === "string" && m.date.startsWith(date))) continue;
    const text = m.text.slice(0, 3000);
    if (total + text.length > 13000) break;
    const score=Number(hit.score || 0);
    if (!Number.isFinite(score)) continue;
    output.push({ text, date:String(m.date || ""), source:String(m.source || ""), layer:String(m.layer || ""), score });
    total += text.length;
  }
  return output;
}
export function limitRetryAt(kind, today = dayInMoscow()) {
  const [y,m,d] = today.split("-").map(Number);
  // Limits reset at midnight UTC+03, same calendar convention as Oleshka.
  return kind === "month" ? Date.UTC(y,m,1,0,0,0)-3*3600000 :
    Date.UTC(y,m-1,d+1,0,0,0)-3*3600000;
}
export function cleanConversationId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : crypto.randomUUID();
}
export function isAllowedOrigin(origin, extra = "") {
  if (!origin) return true; // Worker-to-Worker / CLI; still protected by quotas.
  const allowed = ["https://socman2023.github.io"];
  if (extra) { try { const u = new URL(extra); if (u.protocol === "https:") allowed.push(u.origin); } catch {} }
  return allowed.includes(origin);
}
