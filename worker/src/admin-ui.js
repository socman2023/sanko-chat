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
    <h2>Последние 30 дней</h2>
    <section class="panel"><div class="scroll"><table><thead><tr><th>Дата</th><th>Вопросов</th><th>IP</th><th>Нагрузка</th></tr></thead><tbody id="daily"></tbody></table></div></section>
    <h2>Модели и ответы за 30 дней</h2>
    <div class="twocol"><section class="panel"><h3>Использованные модели</h3><ul id="models"></ul></section><section class="panel"><h3>Статусы ответов</h3><ul id="statuses"></ul></section></div>
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
.bubble{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px 14px;border-radius:9px;margin:6px 0}.user{background:#e7eee7}.model{background:#f5ead4}
footer{margin-top:30px;font-size:13px;color:#6b7067}
[hidden]{display:none!important}
@media(max-width:780px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.chatlayout,.twocol{grid-template-columns:1fr}.threads{max-height:38vh}}
@media(max-width:430px){.cards{grid-template-columns:1fr 1fr}.card{padding:11px}.card strong{font-size:24px}.auth label,.search label{min-width:100%}}
`;
