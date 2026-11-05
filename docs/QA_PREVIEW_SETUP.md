# Проверка экспериментальной оптимизации Санко на настоящей Gemini

Статус: **PR #35, тестовая ветка. Production не изменяется.**
Рабочий чат: https://socman2023.github.io/sanko-chat/
Ветка: `experiment/context-selection-no-deploy-20261105`

## Быстрый вариант — Version URL (минимум действий)

Для тестирования реальной модели при **имеющихся производственных настройках Gemini**:

1. Cloudflare Dashboard → **Workers & Pages** → `sanko-chat-api` → **Settings** → **Builds** → **Branch control**.
2. Включить **Enable Preview Builds**. Проверить, что `main` остаётся production branch.
3. Для неосновных веток выставить Preview command **`npx wrangler versions upload`**. Это НЕ `npx wrangler deploy`: версия только загружается, не становится активной production. Если старый интерфейс Cloudflare уже показывает Version URL, сохранить его режим. Не выполнять `wrangler deploy` для ветки теста.
4. При следующем коммите в экспериментальную ветку Cloudflare Builds создаёт Version URL (его можно найти в **Deployments → Build history** или в комментарии к PR). **Не угадывать URL.**
5. Открыть `<VERSION_URL>/__preview__/chat`. Не `/api/chat` напрямую: тестовая страница при авторизации всё сделает сама.
6. Ввести **существующий административный токен Санко** (тот же, что вводится в /admin/chats) и поговорить. Токен передаётся только в заголовке `X-Preview-Token` на HTTPS-адрес этого самого Worker, не сохраняется в localStorage и не публикуется в URL.

**Ограничение:** Cloudflare Version URLs используют **производственные ресурсы**. Экспериментальные вопросы тратят Gemini-квоту и записываются в ту же таблицу административной статистики и лимиты Санко. Не предназначено для массовой раздачи читателям. Тестовая страница ограничивает доступ администраторским токеном, а прямой POST /api/chat на Version URL без токена возвращает 401.

Если Cloudflare уже использует новую систему Worker Previews и не позволяет выставить versions upload, перейти к следующему варианту.

## Рекомендуемый вариант — Worker Previews (постоянные тестовые ветки)

Cloudflare Workers (релиз сентября 2026 года) поддерживает отдельный Preview с собственным URL, переменными и секретами:

1. **Settings → Builds → Branch control**: включить Preview Builds, выбрать Preview command `npx wrangler preview`. Если Cloudflare предложит **Set up Worker Previews**, следовать мастеру, понимая, что переход с legacy preview неотменяем.
2. В экспериментальной ветке уже есть блок `[previews]` в `wrangler.toml`, включая текущие D1, KV, Vectorize, Workers AI и публичные параметры.
3. В настройках **Previews Base → Variables and secrets** добавить отдельно секреты `GEMINI_API_KEY`, `IP_HASH_SECRET`, `ADMIN_UPDATE_TOKEN`. Не выкладывать значения в GitHub и не присылать в чат. Значения секретов из production не наследуются автоматически.
4. После успешного Preview build найти собственный URL Preview в **Deployments / Previews** или комментарии к PR. Тестовая страница также расположена на `<PREVIEW_URL>/__preview__/chat`.

**Важно:** текущая временная конфигурация Preview в ветке специально читает уже утверждённые канонические KV, D1 дневника и Vectorize, но **GUARD_DB также ссылается на текущую производственную D1 Санко**. Для действительно изолированной регулярной разработки перед большим тестом нужно создать отдельную D1 и применить миграции; только после этого использовать её ID в `previews.d1_databases`. Ни один секрет в репозитории не хранится.

## Как сравнивать

Открой тестовую ссылку и https://socman2023.github.io/sanko-chat/ в соседних вкладках. В каждом нажми «Новый разговор» и по очереди задай одни и те же вопросы:

- «Привет» → «Как дела?» → «А у тебя?»
- «Что нового?» → «А потом?»
- «Где сейчас Руман?» → «А ты сам видел это?»
- «Расскажи об отце», «Что значит “опосля”?»
- Вопросы о реальном каноне позднее 31 октября и проверка личного участия Санко.

Отдельно проверяй смысл, последовательность, характер, каноническую религию («Слава Вароку»), а не только длину реплик.

В обоих случаях Cloudflare Observability записывает `sanko_chat_request` и `sanko_gemini_attempt`, включая размер переданного контекста и измеренные входные токены при наличии Google `usageMetadata`. Тестовая страница не отправляет подписанные данные VK и поэтому общается от лица обычного читателя, а не подтверждённого Олешки.

Документация:
- https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/
- https://developers.cloudflare.com/workers/previews/
- https://developers.cloudflare.com/workers/previews/resources/
