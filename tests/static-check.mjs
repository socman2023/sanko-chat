import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('index.html'), app=read('assets/app.js');
const config=read('assets/config.js'), worker=read('worker/src/index.js');
const wrangler=read('wrangler.toml');
assert(html.includes('./assets/config.js') && html.includes('./assets/app.js'));
assert(html.includes('sanko-portrait.jpg'));
assert(!html.includes('statusline'));
assert(!html.includes('Тестовый чат Санко'));
assert(!app.includes('сообщения передаются на отдельный сервер'));
assert(config.includes("apiUrl: 'https://sanko-chat-api.boysinger2008.workers.dev/api/chat'"));
assert(!config.includes('oleshka-chat-api'));
assert(app.includes("sanko-native-chat-v1"));
assert(app.includes("const PREVIEW = !API"));
assert(!app.includes("'Ну, здрав будь. Как у тебя дела?'"),
  'Old literary Russian greeting must not be served to Sanko visitors');
assert(!app.includes("'Привет. Говори, я слушаю.'"),
  'Remove generic ChatGPT-style greeting');
assert(app.includes("'Здрав будь! Шо хотел спросить?'"),
  'Opening needs a recognizable Sanko voice');
assert(app.includes("'Здрав будь. Шо у тебя нового?'"),
  'Opening must not invent recent events');


assert(app.includes("body.textContent = text"));

assert(app.includes("const data = await response.json().catch(() => null)"),
  'Cloudflare HTML errors must not leak as JSON parsing exceptions');
assert(app.includes("m.role === 'user' || m.role === 'model')"),
  'Only real conversation turns may reach Gemini');
assert(app.includes("conversation.push({role:'notice',text})"),
  'Service notices must be stored separately from dialogue');
assert(app.includes("data?.error === 'quota_exhausted'"),
  'Own daily/monthly limits must use server-confirmed 429 only');
assert(app.includes("addNotice(FAILURE_NOTICE)"),
  'Network and non-JSON failures require Sanko fallback speech');

assert(!app.includes('innerHTML'));
assert(worker.includes('env.CURRENT_CONTEXT') && worker.includes('env.KNOWLEDGE'));
assert(wrangler.includes('name = "sanko-chat-api"'));
assert(wrangler.includes('database_name = "heroes-chat-sanko"'));
assert(wrangler.includes('index_name = "heroes-knowledge"'));
assert(wrangler.includes('binding = "CURRENT_CONTEXT"'));
console.log('Sanko live chat UI static assertions passed.');
