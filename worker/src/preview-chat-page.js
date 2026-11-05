// Browser-only test harness for Cloudflare Preview / Version URLs.
// This endpoint is NOT exposed on the production Worker hostname.
// No VK identity is supplied and no browser storage is used.
export const PREVIEW_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Санко · тест оптимизации</title>
<style>
:root{font-family:system-ui,-apple-system,Arial,sans-serif;color:#17372a;background:#eee9dc}
*{box-sizing:border-box}body{margin:0}header{background:#17372a;color:#f9edd0;padding:12px 18px;
display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
header strong{font-size:1.15rem}.layout{max-width:880px;margin:16px auto;padding:0 12px}
.note{border:1px solid #c4ad79;border-radius:10px;background:#fff6df;padding:12px;
line-height:1.45;margin-bottom:12px;font-size:.91rem}
.auth{display:flex;align-items:center;gap:8px;margin:10px 0;flex-wrap:wrap}
input{padding:10px;border:1px solid #ad9974;border-radius:8px;flex:1;min-width:220px;font:inherit}
button{font:inherit;padding:10px 14px;background:#285441;color:white;border:none;border-radius:8px;cursor:pointer}
button:disabled{opacity:.5;cursor:wait}
a{color:#f3dca6}main{height:min(58vh,590px);min-height:320px;overflow-y:auto;background:#fdf7e9;
border:1px solid #bea878;border-radius:12px;padding:14px}
.turn{margin:12px 0;display:flex;flex-direction:column}.turn.user{align-items:flex-end}
.meta{font-size:.76rem;color:#7b6e59;margin-bottom:4px}.bubble{white-space:pre-wrap;overflow-wrap:anywhere;
padding:11px 14px;background:#f6eed8;border-radius:10px;max-width:86%;line-height:1.5}
.user .bubble{background:#285441;color:white}.composer{display:flex;gap:8px;margin:10px 0}
textarea{font:inherit;flex:1;resize:vertical;min-height:70px;padding:10px;border-radius:9px;border:1px solid #b49e74}
.status{font-size:.8rem;color:#625e54;min-height:22px}header .actions{display:flex;gap:12px;align-items:center}
header .actions a{font-size:.8rem}small{color:#5b6159}
</style></head>
<body><header><strong>Санко · тест оптимизации контекста</strong>
<div class="actions"><a href="https://socman2023.github.io/sanko-chat/" target="_blank" rel="noopener">Обычный Санко</a>
<button id="reset">Новый разговор</button></div></header>
<div class="layout">
<div class="note"><b>Тестовая версия.</b> Диалоги здесь не смешиваются с перепиской основного сайта.
Говори с Санко как обычный читатель: проверенная подпись ВКонтакте в этом тестовом окне не передаётся.
Сопоставляй ответы с <a href="https://socman2023.github.io/sanko-chat/" target="_blank" rel="noopener"
style="color:#285441">обычным чатом</a>. Этот Preview использует настоящий Gemini и расходует API-квоту.
Здесь нельзя публиковать администраторский токен или ссылку с ним.</div>
<div class="auth"><label for="token">Администраторский токен Санко:</label>
<input id="token" type="password" autocomplete="off" spellcheck="false"
placeholder="Введи тот же токен, что в админ-панели"></div>
<main id="messages" aria-live="polite"></main>
<form id="send" class="composer"><textarea id="input" maxlength="4000"
placeholder="Спроси Санко…" required></textarea><button id="go" type="submit">Отправить</button></form>
<div class="status" id="status">Тест готов. Переписка существует только до перезагрузки этой страницы.</div>
<small>Если всё время появляется «Связь не ладится», проверь статус Gemini и настройки секретов Preview.</small>
</div><script src="/__preview__/app.js" defer></script></body></html>`;
export const PREVIEW_JS = String.raw `(() => {
 "use strict";
 const el=id=>document.getElementById(id);
 const box=el("messages"),input=el("input"),submit=el("go"),status=el("status");
 const token=el("token"),form=el("send"),reset=el("reset");
 let history=[],id=crypto.randomUUID(),busy=false;
 function bubble(role,value,info=""){
  const line=document.createElement("div");
  line.className="turn "+role;
  const header=document.createElement("div");
  header.className="meta";
  header.textContent=(role==="user"?"Ты":"Санко")+(info?" · "+info:"");
  const body=document.createElement("div");body.className="bubble";
  body.textContent=value;line.append(header,body);box.append(line);
  box.scrollTop=box.scrollHeight;
 }
 const start=()=>{
  history=[];id=crypto.randomUUID();box.replaceChildren();
  bubble("model","Здрав будь. Ну, говори.");
  status.textContent="Новый независимый тестовый разговор.";
 };
 reset.addEventListener("click",start);
 form.addEventListener("submit",async event=>{
  event.preventDefault();
  const question=input.value.trim(),auth=token.value.trim();
  if(!question||busy)return;
  if(!auth){status.textContent="Введи администраторский токен для доступа к тестовой версии.";return}
  busy=true;submit.disabled=true;input.disabled=true;
  status.textContent="Санко отвечает…";bubble("user",question);input.value="";
  try{
   const response=await fetch("/api/chat",{
    method:"POST",headers:{"Content-Type":"application/json","X-Preview-Token":auth},
    body:JSON.stringify({message:question,history,conversationId:id})
   });
   const data=await response.json();
   if(!response.ok)throw Error(data.error||"HTTP "+response.status);
   const answer=String(data.reply||"");
   bubble("model",answer,String(data.model||""));
   history.push({role:"user",text:question},{role:"model",text:answer});
   history=history.slice(-12);
   status.textContent="Успешно · модель "+String(data.model||"неизвестна")+
    " · источников "+String(data.knowledge?.matches??"?")+
    " · записей дневника "+String(data.knowledge?.diaryPosts??"?");
  }catch(error){
   bubble("model","Тестовый запрос не выполнен.");
   status.textContent="Ошибка: "+String(error.message).slice(0,100);
  }finally{busy=false;submit.disabled=false;input.disabled=false;input.focus();}
 });
 start();
})();`;
