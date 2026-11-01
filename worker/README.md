# Cloudflare Worker Санко — шаг 4.2

**Статус:** исходники созданы в GitHub. **Сам Worker ещё предстоит создать в Cloudflare.** Первый deploy отделён от этапа подключения баз. Действующий Worker Олешки `3.9.1` и его D1 не менялись.

## Архитектура

- Новый Worker: **`sanko-chat-api`**.
- Общий Workers AI binding: **`AI`** (будет подключён после первого bootstrap-деплоя).
- Общий Vectorize: **`KNOWLEDGE` → `heroes-knowledge`** (будет подключён после первого bootstrap-деплоя).
- Общий KV: **`CURRENT_CONTEXT` → `heroes-chat-current`**, только с ключами `sanko:*` (будет подключён позже).
- **Отдельная D1**: `GUARD_DB` → **`heroes-chat-sanko`** (ещё не создана).
- Свой Gemini API key / Google AI project и отдельная финансовая учётная запись модели, по ранее принятой схеме.
- Лимиты Санко **500 запросов в день, 15 000 в месяц, 100 с IP за день**. Лимиты Олешки неизменны и никак не расходуются обращениями к Санко.
- Системный профиль и текущие сведения **не хранятся в публичном коде** — читаются из KV `sanko:profile:v1` и `sanko:current:v1`. После авторского утверждения загрузить туда пакет персонажа; пока профиль не загружен, POST /api/chat вернёт 503 и Gemini не расходуется.

## Публичные API

- `GET /` и `GET /health`: `{status,character,version,configured}` (без секретов).
- `POST /api/chat`: тот же формат клиента, что и у Олешки: `message`, `history`, `focusDate`, `conversationId`, `greetingId`, `vkLaunch`, `vkFirstName`, `vkFirstNameUserId`. Возвращает `reply`, `conversationId`, `knowledge.focusDate`. При лимите возвращает HTTP 429, `reply`, `retryAt`.
- `POST /api/session`: подпись VK проверяется только с отдельным `VK_APP_ID` и `VK_APP_SECRET` Санко. Пока VK Mini App Санко не создан, возвращает роль `stranger`, без выдачи чужих VK-дружеских статусов.

## Датировка (сохранён принцип поправки Олешки 3.9.1)

- Вопросы с датами, «сегодня», «вчера», «позавчера» получают определённую дату по UTC+3.
- D1 `sanko_day_events` и KV `sanko:day:YYYY-MM-DD` используются только для нужного дня.
- Vectorize запрашивается с фильтром по персонажу `shared/sanko` и по дате (если она задана); после поиска ещё раз исключаются чужие metadata.
- Если за дату нет подтверждённых сведений, Worker запрещает подменять её похожим старым событием.
- **Известный на 01.11.2026 последний канонический срез Санко — 31.10.2026.** Профиль с этим срезом остаётся на авторском согласовании.

## Что отсутствует намеренно

- Нельзя публиковать в GitHub полный профиль v0.2, голосовой корпус, канонические закрытые документы, персональные переписки и ключи.
- Нет миграции таблиц Олешки, нет его административных панелей и Cron для VK-дневника.
- Нет автоматического присвоения Санко личных воспоминаний Олешки; общий Vectorize — источник фактов мира, а не всезнания героя.
- Есть Cron **только** для удаления старых записей из собственной D1 Санко: диалоги старше 30 дней, технические admissions старше 95 дней.
- Четыре возможных обращения к резервным Gemini-моделям на один допущенный запрос увеличивают потенциальный расход. Лимиты по запросам **не являются денежным лимитом**. Отдельный Google AI project и его ограничения расходов настраиваются на этапе запуска.

## Проверка исходников

Из корня репозитория:

```bash
npm test
```

Из директории `worker`:

```bash
npm test
npm run check
```

Тесты проверяют изоляцию `shared + sanko`, датировку 29/30/31 октября, квоты 500/15 000/100, отсутствие расходов при пустом профиле, VK/Origin и работу протокола ответа. Это **локальные tests/mocks**, а не доказательство реального ответа Gemini или действующих bindings.

## Как создать сам Worker `sanko-chat-api` в Cloudflare (bootstrap)

Текущий **корневой** `wrangler.toml` не содержит вымышленных ID ресурсов: его можно безопасно развернуть как **отдельный Worker**. Начальный `GET /health` покажет `configured:false`, а чат пока ответит `503`: это намеренно до подключения D1/KV/секретов.

1. В Cloudflare Dashboard открыть **Workers & Pages → Create application → GitHub** (вариант **Import existing Git repository**).
2. Выбрать GitHub-аккаунт `socman2023`, репозиторий **`sanko-chat`**, ветку **`main`**.
3. На видимом экране **Project name** изменить с `sanko-chat` на **`sanko-chat-api`**. Это обязательное совпадение с `name` в корневом `wrangler.toml`.
4. На текущем экране **нет поля Root directory**; не искать его. Конфигурация уже перенесена мной в **корень репозитория**, а её `main` указывает на `worker/src/index.js`. GitHub Pages остаётся прежним.
5. **Build command: пустой**; **Deploy command: `npx wrangler deploy` (не менять)**; **Preview command: оставить как есть**, **Enable Preview builds: можно выключить** для упрощения; **Protect with Cloudflare Access: выключено**. Нажать **Deploy**.
6. Открыть URL нового Worker и убедиться в JSON с `character: "sanko"`, `version: "sanko-worker-0.1.0"`, `configured: false`.
7. После первого deploy можно подключать bindings и секреты, не меняя Worker Олешки.

Этот bootstrap не готов обслуживать реальные сообщения, пока не закончена настройка Cloudflare.

## Подготовка к этапу 4.3 / 4.4 (после создания Worker)

1. Создать новую Cloudflare D1 **`heroes-chat-sanko`**; не касаться `heroes-chat-guard`.
2. После создания ресурсов дополнить **корневой** `wrangler.toml` блоками Workers AI (`AI`), Vectorize (`KNOWLEDGE` → `heroes-knowledge`), KV (`CURRENT_CONTEXT` → `heroes-chat-current`) и D1 (`GUARD_DB` → **только новую** `heroes-chat-sanko`), с подлинными ID. Пока эти блоки намеренно отсутствуют, чтобы первый deploy прошёл без ложных значений.
3. Применить схему **только к новой D1**, командой из каталога `worker`:
   `npx wrangler d1 migrations apply heroes-chat-sanko --remote`.
4. Создать отдельный Google AI API key в собственном проекте Санко и положить его в Cloudflare Secret `GEMINI_API_KEY`; `IP_HASH_SECRET` — второй секрет, новый случайный длинный ключ. Не передавать их в чат и не класть в GitHub.
5. После авторского утверждения поместить персональный профиль в KV key `sanko:profile:v1` и датированный срез в `sanko:current:v1`; пример формы для последнего: `{"asOf":"2026-10-31","text":"..."}`.
6. Развернуть только `sanko-chat-api`, проверить `GET /`, `POST /api/chat` и фильтры. После этого обновить `assets/config.js` новым URL. До этой операции сайт остаётся честным макетом.

**Ничего в Cloudflare на шаге 4.2 не создавалось, не редактировалось и не развёртывалось.**

Справка: [Wrangler bindings](https://developers.cloudflare.com/workers/wrangler/configuration/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Vectorize metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/).
