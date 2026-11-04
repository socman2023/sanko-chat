export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Санко — административная панель</title>
<link rel="stylesheet" href="/admin/assets/style.css">
<script defer src="/admin/assets/app.js"></script>
</head>
<body data-page="__PAGE__">
<header class="head">
  <div class="inside">
    <h1>Управление чатом Санко</h1>
    <nav aria-label="Административные разделы">
      <a href="/admin/stats" id="statsNav">Статистика</a>
      <a href="/admin/chats" id="chatsNav">Разговоры</a>
      <a href="/admin/knowledge" id="knowledgeNav">База знаний</a>
      <a href="/admin/profile" id="profileNav">Профиль Санко</a>
      <a href="https://socman2023.github.io/sanko-chat/">Открыть чат</a>
    </nav>
  </div>
</header>
<main>
  <form id="login" class="auth">
    <label for="token">Административный токен Санко
      <input id="token" type="password" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ADMIN_UPDATE_TOKEN">
    </label>
    <button type="submit" id="load">Открыть данные</button>
    <button type="button" class="secondary" id="refresh" disabled>Обновить</button>
  </form>
  <p class="hint">Доступ к статистике и текстам разговоров защищён токеном. Пароль не сохраняется в браузере. История разговоров хранится до 30 дней.</p>
  <p id="status" role="status" aria-live="polite"></p>
  <div id="stats" hidden>
    <div class="cards">
      <div class="card"><span>Вопросов сегодня</span><strong id="today">—</strong><small id="todayLeft"></small></div>
      <div class="card"><span>За 7 дней</span><strong id="week">—</strong></div>
      <div class="card"><span>В этом месяце</span><strong id="month">—</strong><small id="monthLeft"></small></div>
      <div class="card"><span>С текущего IP</span><strong id="ip">—</strong><small id="ipLeft"></small></div>
      <div class="card"><span>Разных IP сегодня</span><strong id="unique">—</strong></div>
      <div class="card"><span>Диалогов за 30 дней</span><strong id="conversations">—</strong></div>
    </div>
    <h2>Расход токенов Gemini</h2>
    <p class="hint" id="tokenNote">Расход токенов Gemini Free Tier, без платных тарифов.</p>
    <div id="tokenUsage" hidden>
      <div class="cards">
        <div class="card"><span>Токенов сегодня</span><strong id="tokToday">—</strong></div>
        <div class="card"><span>За 7 дней</span><strong id="tokWeek">—</strong></div>
        <div class="card"><span>В этом месяце</span><strong id="tokMonth">—</strong></div>
        <div class="card"><span>В среднем на измеренный вызов</span><strong id="tokAvg">—</strong></div>
        <div class="card"><span>Входные за месяц</span><strong id="tokPrompt">—</strong></div>
        <div class="card"><span>Выходные за месяц</span><strong id="tokCandidate">—</strong></div>
        <div class="card"><span>Рассуждения за месяц</span><strong id="tokThoughts">—</strong></div>
        <div class="card"><span>Кэшированные входные</span><strong id="tokCached">—</strong></div>
        <div class="card"><span>Вызовов Gemini за месяц</span><strong id="tokCalls">—</strong></div>
        <div class="card"><span>Вызовов с неизвестным расходом</span><strong id="tokUnknown">—</strong></div>
      </div>
      <p class="hint">Кэшированные токены уже входят во входные. Общие токены берутся из totalTokenCount. Неизвестный расход нельзя считать нулём.</p>
      <h3>По моделям за 30 дней</h3>
      <section class="panel"><div class="scroll"><table><thead><tr><th>Модель</th><th>Вызовов</th><th>Измерено</th><th>Токенов</th><th>Неизвестно</th></tr></thead><tbody id="tokenModels"></tbody></table></div></section>
      <h3>Расход по дням (30 дней)</h3>
      <section class="panel"><div class="scroll"><table><thead><tr><th>Дата</th><th>Вызовов</th><th>Токенов</th><th>Неизвестно</th></tr></thead><tbody id="tokenDaily"></tbody></table></div></section>
    </div>
    <h2>Последние 30 дней</h2>
    <section class="panel"><div class="scroll"><table><thead><tr><th>Дата</th><th>Вопросов</th><th>IP</th><th>Нагрузка</th></tr></thead><tbody id="daily"></tbody></table></div></section>
    <h2>Модели и ответы за 30 дней</h2>
    <div class="twocol"><section class="panel"><h3>Использованные модели</h3><ul id="models"></ul></section><section class="panel"><h3>Статусы ответов</h3><ul id="statuses"></ul></section></div>
  </div>
  <div id="knowledge" hidden>
    <h2>Полная база знаний Санко</h2>
    <p class="hint">Загрузка исходного корпуса в личный индекс Санко. При этом записи Олешки не меняются. Книги и дневник хранятся только в закрытом D1 и Vectorize, не публикуются на сайте.</p>
    <div class="cards">
      <div class="card"><span>Фрагментов в базе</span><strong id="canonStored">—</strong></div>
      <div class="card"><span>В поисковом индексе</span><strong id="canonIndexed">—</strong></div>
    </div>
    <section class="panel" style="margin-top:16px">
      <h3>Импорт исходного корпуса</h3>
      <label for="canonFile">Файл <code>sanko_canon_chunks.jsonl</code> из подготовленного пакета</label>
      <input type="file" id="canonFile" accept=".jsonl,.txt,application/x-ndjson">
      <p class="hint">Импорт выполняется пакетами по 8 фрагментов. Оставь вкладку открытой до завершения. При прерывании загрузку можно повторить.</p>
      <label for="canonStart">Начать с номера фрагмента (0 — сначала, для возобновления)</label>
      <input type="number" id="canonStart" min="0" step="1" value="0">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
       <button type="button" id="canonImport" disabled>Загрузить в базу Санко</button>
       <button type="button" class="secondary" id="canonStop" disabled>Остановить после текущего пакета</button>
      </div>
      <progress id="canonProgress" value="0" max="100" style="width:100%;height:18px"></progress>
      <p id="canonMessage" aria-live="polite" class="hint"></p>
    </section>
    <section class="panel" style="margin-top:16px"><h3>Проверка источников</h3><ul id="canonSources"></ul></section>
  </div>
  <div id="profile" hidden>
    <h2>Персональный профиль Санко</h2>
    <p class="hint">Это отдельный личный профиль героя в KV, а не 2975 фрагментов мира. При замене сохраняется резервная копия старого профиля. Исходный файл остаётся на твоём компьютере, пока ты явно не нажмёшь кнопку публикации.</p>
    <div class="cards">
      <div class="card"><span>Символов в действующем профиле</span><strong id="profileChars">—</strong></div>
      <div class="card"><span>Резервная копия</span><strong id="profileBackup">—</strong></div>
    </div>
    <section class="panel" style="margin-top:16px">
      <h3>Действующая версия</h3>
      <p id="profileVersion">—</p>
      <p class="hint" id="profileHash"></p>
    </section>
    <section class="panel" style="margin-top:16px">
      <h3>Проверка и публикация новой редакции</h3>
      <label for="profileFile">Файл <code>SANKO_PROFILE_v0.4_READY_TO_PUBLISH.txt</code></label>
      <input id="profileFile" type="file" accept=".txt,text/plain">
      <p class="hint" id="profileSelection">Выбери файл, просмотри его и только затем публикуй. Прежний профиль сохраняется для отката.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
       <button id="profileActivate" type="button" disabled>Опубликовать профиль в KV</button>
       <button id="profileRestore" class="secondary" type="button" disabled>Вернуть предыдущий профиль</button>
      </div>
      <p class="hint" id="profileMessage" role="status" aria-live="polite"></p>
    </section>
  </div>
  <div id="chats" hidden>
    <form id="searchForm" class="search">
      <label for="search">Поиск по репликам <input id="search" type="search" maxlength="40" placeholder="Слово или фраза"></label>
      <button type="submit">Найти</button>
      <button type="button" class="secondary" id="reset">Сбросить</button>
    </form>
    <div class="chatlayout">
      <section class="panel">
        <h2>Разговоры <small id="total"></small></h2>
        <div id="threads" class="threads" role="list"></div>
        <div class="pages"><button id="prev" type="button" class="secondary" disabled>Назад</button><span id="pageInfo"></span><button type="button" id="next" class="secondary" disabled>Далее</button></div>
      </section>
      <section class="panel">
        <h2>Переписка</h2>
        <div id="transcript"><p class="hint">Выберите разговор слева. Тексты доступны только администратору.</p></div>
      </section>
    </div>
  </div>
  <footer>Отдельная панель Санко. Счётчики и диалоги Олешки здесь недоступны.</footer>
</main>
</body>
</html>`;

export const ADMIN_CSS = String.raw`
:root{color-scheme:light;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#223c30;background:#eae4d6}*{box-sizing:border-box}
body{margin:0;line-height:1.45}.head{background:#17372c;color:#f9ecd3;padding:23px 18px}.inside,main{max-width:1200px;margin:auto}
h1{margin:0 0 13px;font-size:clamp(24px,3vw,32px)}nav{display:flex;gap:19px;flex-wrap:wrap}nav a{color:#f0d4a2;text-decoration:none}nav a[aria-current=page]{text-decoration:underline;font-weight:700}
main{padding:23px 17px 40px}h2{font-size:20px;margin:20px 0 12px}h3{font-size:16px;margin:5px 0 14px}
.auth,.search{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-bottom:14px}.auth label,.search label{flex:1;min-width:235px;font-size:14px;font-weight:600}
input{display:block;width:100%;font:inherit;padding:11px 12px;background:#fffefb;border:1px solid #b9aa90;border-radius:7px;margin-top:4px;min-height:46px}
button{font:inherit;min-height:44px;border-radius:7px;padding:10px 17px;border:0;background:#315b49;color:white;cursor:pointer}button.secondary{color:#284535;background:#eadfce;border:1px solid #c6b498}
button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,.thread:focus-visible{outline:3px solid #b88c42;outline-offset:2px}
.hint{color:#68685e;font-size:13px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}
.card,.panel{background:#fffcf5;border:1px solid #d4c7af;border-radius:10px;box-shadow:0 3px 13px #2a392014}
.card{padding:15px}.card span{display:block;font-size:13px;color:#647063}.card strong{display:block;font-size:clamp(25px,3vw,36px);font-variant-numeric:tabular-nums}
.card small{font-size:12px;color:#6c7167}.panel{padding:16px;min-width:0}.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:9px;border-bottom:1px solid #e2d8c8;text-align:left}th{color:#516251}td.num{text-align:right;font-variant-numeric:tabular-nums}
.meter{display:inline-block;height:10px;border-radius:4px;background:#679b7a;min-width:1px}.twocol{display:grid;grid-template-columns:1fr 1fr;gap:15px}ul{margin:0;padding:0;list-style:none}li{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #eee4d4}
#status{color:#8d472d;min-height:23px;font-size:14px}.chatlayout{display:grid;grid-template-columns:minmax(280px,390px) minmax(0,1fr);gap:16px;align-items:start}
.threads{max-height:60vh;overflow-y:auto}.thread{display:block;width:100%;border-radius:0;border-bottom:1px solid #e9e1d3;background:transparent;color:#283c31;padding:12px 8px;text-align:left}
.thread:hover,.thread[aria-pressed=true]{background:#e9eadc}.thread strong,.thread small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.thread small{font-size:12px;color:#66746c}
.pages{display:flex;gap:10px;align-items:center;justify-content:center;margin-top:14px}.pages span{font-size:13px}
#transcript{max-height:72vh;overflow:auto}.turn{margin:0 0 23px}.turn p{font-size:13px;margin:2px 0;color:#6e766f}
.attempt-list{font-size:12px;color:#42564a;background:#f0f2e9;border-left:3px solid #bda477;padding:8px 8px 8px 24px;margin:6px 0 13px;overflow-wrap:anywhere}
.attempt-list li{margin:4px 0}
.bubble{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px 14px;border-radius:9px;margin:6px 0}.user{background:#e7eee7}.model{background:#f5ead4}
footer{margin-top:30px;font-size:13px;color:#6b7067}
[hidden]{display:none!important}
@media(max-width:780px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.chatlayout,.twocol{grid-template-columns:1fr}.threads{max-height:38vh}}
@media(max-width:430px){.cards{grid-template-columns:1fr 1fr}.card{padding:11px}.card strong{font-size:24px}.auth label,.search label{min-width:100%}}
`;

export const ADMIN_SCRIPT = String.raw`
(() => {
 "use strict";
 const $=id=>document.getElementById(id);
 const area=document.body.dataset.page;
 const login=$("login"),status=$("status");
 const token=$("token");
 let unlocked=false,loading=false,offset=0,search="",selected="";
 const n=x=>Number(x||0).toLocaleString("ru-RU");
 const when=t=>t?new Date(t*1000).toLocaleString("ru-RU"):"—";
 function message(text){status.textContent=text;}
 function el(tag,text,cls) {
  const x=document.createElement(tag);
  if(text!==undefined)x.textContent=String(text);
  if(cls)x.className=cls;
  return x;
 }
 function val(id,v){$(id).textContent=n(v);}
 async function api(path,body={}) {
  const res=await fetch(path,{method:"POST",cache:"no-store",
   headers:{"Authorization":"Bearer "+token.value,"Content-Type":"application/json"},
   body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({error:"invalid_response"}));
  if(!res.ok)throw Error(res.status===401?"Неверный административный токен или секрет ещё не настроен.":"Ошибка "+res.status+": "+(data.error||"нет ответа"));
  return data;
 }
 function showTokenUsage(data) {
  const t=data?.tokenUsage;
  const ok=t?.status==="ready";
  $("tokenUsage").hidden=!ok;
  $("tokenNote").textContent=ok
   ?t.note+" Число вызовов без данных о токенах учитывается отдельно."
   :"Учёт токенов пока недоступен. Проверьте D1-миграцию 0002 и версию Worker.";
  if(!ok)return;
  for(const [id,v] of [
   ["tokToday",t.today.total],["tokWeek",t.week.total],["tokMonth",t.month.total],
   ["tokAvg",t.averagePerMeteredCall==null?"—":n(t.averagePerMeteredCall)],
   ["tokPrompt",t.month.prompt],["tokCandidate",t.month.candidate],
   ["tokThoughts",t.month.thoughts],["tokCached",t.month.cached],
   ["tokCalls",t.month.calls],["tokUnknown",t.month.unknownCalls]
  ])$(id).textContent=typeof v==="string"?v:n(v);
  const models=$("tokenModels");models.replaceChildren();
  for(const x of t.models){
   const tr=el("tr");
   for(const value of [x.model,n(x.calls),n(x.meteredCalls),n(x.total),n(x.unknownCalls)])
    tr.appendChild(el("td",value));
   models.appendChild(tr);
  }
  if(!t.models.length){const tr=el("tr");tr.appendChild(el("td","Пока нет измерений."));models.appendChild(tr);}
  const daily=$("tokenDaily");daily.replaceChildren();
  for(const x of t.daily.slice().reverse()){
   const tr=el("tr");
   for(const value of [x.day,n(x.calls),n(x.total),n(x.unknownCalls)])
    tr.appendChild(el("td",value));
   daily.appendChild(tr);
  }
 }
 function showStatus(data) {
  val("today",data.today.admitted);val("week",data.week);val("month",data.month.admitted);
  val("ip",data.today.fromThisIp);val("unique",data.today.uniqueIps);
  val("conversations",data.conversations30d);
  $("todayLeft").textContent="Осталось "+n(data.today.remaining)+" из "+n(data.limits.daily);
  $("ipLeft").textContent="Осталось "+n(data.today.ipRemaining)+" из "+n(data.limits.ipDaily);
  $("monthLeft").textContent="Осталось "+n(data.month.remaining)+" из "+n(data.limits.monthly);
  const rows=$("daily");rows.replaceChildren();
  const max=Math.max(1,...data.daily.map(x=>x.admitted));
  data.daily.slice().reverse().forEach(x=>{
    const tr=el("tr");
    tr.append(el("td",x.day),el("td",n(x.admitted),"num"),el("td",n(x.uniqueIps),"num"));
    const td=el("td");const bar=el("span",undefined,"meter");
    bar.style.width=(100*x.admitted/max).toFixed(1)+"%";
    td.appendChild(bar);tr.append(td);rows.append(tr);
  });
  for(const [id,entries,name] of [["models",data.models,"model"],["statuses",data.statuses,"status"]]){
    const ul=$(id);ul.replaceChildren();
    for(const x of entries){
      const li=el("li");li.append(el("span",x[name]),el("strong",n(x.count)));ul.append(li);
    }
    if(!entries.length)ul.append(el("li","Пока нет данных."));
  }
  showTokenUsage(data);
  $("stats").hidden=false;
 }
 async function loadThread(id) {
  selected=id;const box=$("transcript");box.replaceChildren(el("p","Загружаю переписку…","hint"));
  try {
   const d=await api("/admin/chats/thread",{conversationId:id});
   box.replaceChildren();
   for(const x of d.turns){
    const item=el("article",undefined,"turn");
    item.append(el("p",when(x.askedAt)+" · "+(x.model||x.status||"модель не указана")));
    item.append(el("div",x.question,"bubble user"));
    if(x.reply)item.append(el("div",x.reply,"bubble model"));
    if(!x.reply)item.append(el("p","Ответ не был получен ("+x.status+")."));
    if(Array.isArray(x.attempts)&&x.attempts.length){
     item.append(el("p","Попытки Gemini (время · модель · результат · токены):","hint"));
     const list=el("ul",undefined,"attempt-list");
     for(const a of x.attempts){
      const tokens=a.totalTokens==null?"расход неизвестен":n(a.totalTokens)+" токенов";
      list.append(el("li",when(a.attemptedAt)+" · "+a.model+" · "+a.result+" · "+tokens));
     }
     item.append(list);
    } else if(x.status==="error"){
     item.append(el("p",d.attemptsAvailable?
      "Попытки Gemini не зарегистрированы: возможен локальный перерыв между обращениями или сбой до вызова модели.":
      "Учёт попыток Gemini сейчас недоступен.","hint"));
    }
    box.append(item);
   }
   if(!d.turns.length)box.append(el("p","В этой переписке больше нет записей.","hint"));
   for(const b of $("threads").querySelectorAll("button.thread"))b.setAttribute("aria-pressed",String(b.dataset.id===id));
  }catch(err){box.replaceChildren(el("p",err.message,"hint"));}
 }
 async function loadThreads() {
  const d=await api("/admin/chats/list",{query:search,offset,limit:20});
  $("chats").hidden=false;
  $("total").textContent="("+n(d.total)+")";
  const list=$("threads");list.replaceChildren();
  for(const x of d.threads){
   const btn=el("button",undefined,"thread");btn.type="button";btn.dataset.id=x.conversationId;
   btn.setAttribute("aria-pressed",String(x.conversationId===selected));
   btn.append(el("small",when(x.lastAt)+" · "+x.turns+" репл."));
   btn.append(el("strong",x.preview||"Без текста"));
   btn.append(el("small",x.conversationId));
   btn.addEventListener("click",()=>loadThread(x.conversationId));
   list.append(btn);
  }
  if(!d.threads.length)list.append(el("p","Совпадений нет.","hint"));
  $("prev").disabled=offset===0;
  $("next").disabled=offset+20>=d.total;
  $("pageInfo").textContent=d.total?((offset+1)+"–"+Math.min(d.total,offset+20)+" из "+d.total):"0";
 }
 async function loadCanonStatus(){
  const d=await api("/admin/knowledge/status");
  $("knowledge").hidden=false;
  val("canonStored",d.stored);val("canonIndexed",d.indexed);
  const ul=$("canonSources");ul.replaceChildren();
  for(const e of d.sources){
    const li=el("li");li.append(el("span",e.source),el("strong",n(e.n??e.count)));ul.append(li);
  }
  $("canonImport").disabled=false;
  $("canonMessage").textContent=d.indexed+" фрагментов готовы к поиску.";
 }
 async function loadProfileStatus(){
  const d=await api("/admin/profile/status");
  $("profile").hidden=false;
  val("profileChars",d.chars);
  $("profileBackup").textContent=d.hasBackup?"Есть":"Нет";
  $("profileVersion").textContent=d.version||"Не загружен";
  $("profileHash").textContent=d.sha256?"SHA-256: "+d.sha256:"";
  $("profileActivate").disabled=false;
  $("profileRestore").disabled=!d.hasBackup;
 }
 async function load() {
  if(loading)return;loading=true;$("load").disabled=true;
  message("Получаю данные…");
  try {
   if(area==="stats")showStatus(await api("/admin/stats/data"));
   else if(area==="knowledge")await loadCanonStatus();
   else if(area==="profile")await loadProfileStatus();
   else await loadThreads();
   unlocked=true;$("refresh").disabled=false;message("");
  }catch(err){
   message(err.message);if(area==="stats")$("stats").hidden=true;
   if(area==="chats")$("chats").hidden=true;
   if(area==="knowledge")$("knowledge").hidden=true;
   if(area==="profile")$("profile").hidden=true;
   unlocked=false;$("refresh").disabled=true;
  }finally{loading=false;$("load").disabled=false;}
 }
 login.addEventListener("submit",e=>{e.preventDefault();offset=0;load();});
 $("refresh").addEventListener("click",()=>{if(unlocked)load();});
 if(area==="chats"){
  $("searchForm").addEventListener("submit",e=>{
   e.preventDefault();if(!unlocked)return;search=$("search").value.trim();offset=0;selected="";load();
  });
  $("reset").addEventListener("click",()=>{if(!unlocked)return;$("search").value="";search="";offset=0;selected="";load();});
  $("prev").addEventListener("click",()=>{if(offset<20)return;offset-=20;load();});
  $("next").addEventListener("click",()=>{offset+=20;load();});
 }
 if(area==="knowledge"){
  let stopRequested=false,importing=false;
  $("canonStop").addEventListener("click",()=>{stopRequested=true;});
  $("canonImport").addEventListener("click",async()=>{
   if(importing||!unlocked)return;
   const file=$("canonFile").files?.[0];
   if(!file){message("Выбери файл .jsonl с корпусом знаний.");return;}
   importing=true;stopRequested=false;
   $("canonImport").disabled=true;$("canonStop").disabled=false;
   const p=$("canonProgress"),note=$("canonMessage");
   try{
    const raw=await file.text();
    const rows=raw.split(/\r?\n/).filter(x=>x.trim()).map(line=>JSON.parse(line));
    if(rows.length<1||rows.some(x=>typeof x.text!=="string"||!x.id))
      throw Error("Неверный формат корпуса.");
    const from=Number($("canonStart").value);
    if(!Number.isInteger(from)||from<0||from>rows.length)throw Error("Неверная начальная позиция.");
    p.max=rows.length;p.value=from;
    for(let i=from;i<rows.length;i+=8){
     if(stopRequested)break;
     note.textContent="Загружено "+i+" из "+rows.length+". Не закрывай вкладку.";
     const result=await api("/admin/knowledge/import",{records:rows.slice(i,i+8)});
     if(!result.ok||result.indexed!==Math.min(8,rows.length-i))
       throw Error("Ошибка индексации на фрагменте "+i);
     p.value=Math.min(rows.length,i+8);$("canonStart").value=String(p.value);
    }
    await loadCanonStatus();
    note.textContent=stopRequested?
      "Приостановлено на фрагменте "+p.value+" из "+rows.length:
      "Все "+rows.length+" фрагментов обработаны. Проверь число записей в индексе.";
   }catch(err){note.textContent="Импорт остановлен: "+err.message+
    " Повтори с позиции "+p.value+".";message(err.message);}
   finally{importing=false;$("canonImport").disabled=false;$("canonStop").disabled=true;}
  });
 }
 if(area==="profile"){
  $("profileFile").addEventListener("change",async()=>{
   const file=$("profileFile").files?.[0];
   if(!file){$("profileSelection").textContent="Файл не выбран.";return;}
   $("profileSelection").textContent="Выбран "+file.name+" ("+n(file.size)+" байт). Для публикации будет отдельное подтверждение.";
  });
  $("profileActivate").addEventListener("click",async()=>{
   if(!unlocked)return;
   const file=$("profileFile").files?.[0];
   if(!file){$("profileMessage").textContent="Выбери профиль в формате .txt.";return;}
   const raw=await file.text();
   if(raw.length<7500||raw.length>33000){
    $("profileMessage").textContent="Длина профиля должна быть от 7500 до 33000 символов.";
    return;
   }
   if(!window.confirm("Опубликовать новый профиль Санко в KV? Старый профиль будет сохранён для отката."))return;
   $("profileActivate").disabled=true;
   $("profileMessage").textContent="Сохраняю резервную копию и новый профиль...";
   try{
    const r=await api("/admin/profile/activate",{profile:raw});
    await loadProfileStatus();
    $("profileMessage").textContent=r.unchanged?"Профиль совпадает с действующим, запись не требовалась.":
      "Новый профиль записан в KV. Символов: "+r.chars+". SHA-256: "+r.sha256;
   }catch(e){$("profileMessage").textContent=e.message;}
   finally{$("profileActivate").disabled=false;}
  });
  $("profileRestore").addEventListener("click",async()=>{
   if(!unlocked)return;
   if(!window.confirm("Вернуть сохранённую предыдущую редакцию профиля Санко?"))return;
   $("profileRestore").disabled=true;
   $("profileMessage").textContent="Восстанавливаю предыдущую редакцию...";
   try{
    const r=await api("/admin/profile/restore");
    await loadProfileStatus();
    $("profileMessage").textContent="Предыдущий профиль восстановлен. SHA-256: "+r.sha256;
   }catch(e){$("profileMessage").textContent=e.message;}
   finally{$("profileRestore").disabled=false;}
  });
 }
 const active=$(area==="stats"?"statsNav":area==="chats"?"chatsNav":area==="knowledge"?"knowledgeNav":"profileNav");
 if(active)active.setAttribute("aria-current","page");
})();
`;
