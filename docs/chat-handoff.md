# tab_wanderer — Chat Handoff

## 1. Current Known State

```text
Repo: github.com/DonutWithCoffee/tab_wanderer
Branch: main
Public stable CWS release: 1.0.3 / Unlisted
Published release commit: f496d36
Published annotated tag: v1.0.3
Current development base before this hardening: 981a9b5
Manifest version: 1.0.3
Development state: unpublished post-1.0.3 full hardening + order-aware Ozon automation
Expected automated baseline: 310 pass / 0 fail
Next CWS version: not assigned/prepared
```

1.0.3 опубликована и закрыта. Текущий `main` содержит более новые изменения, но это не релиз 1.0.4 и не CWS candidate.

## 2. What Is In The Current Hardening

```text
security:
- Ozon write requires trusted user input
- read-only page bridge is separated from the isolated-world writer
- order links are rebuilt on the trusted Amperkot origin
- worker markers are validated together with exact origin/path
- warehouse→Ozon sender origin is parsed strictly
- storage access is restricted to TRUSTED_CONTEXTS
- tabs permission removed

service-worker lifecycle:
- initialization barrier for every incoming event
- state writes serialized and coalesced
- watchdog/direct/storage maintenance moved to chrome.alarms
- main worker reconciliation and orphan direct/Ozon cleanup on startup
- downloaded CWS update waits for a safe reload point

storage:
- known orders retention with watched/current/direct protection
- notification target TTL and count limit
- bytes-in-use and storage errors exposed in diagnostics

performance:
- Ozon fetch/XHR capture only for known endpoints
- response content-type/size checks before JSON cloning
- warehouse scan time budget and cheaper-source-first order

notification consistency:
- legal-only mode overrides both hide filters
- shared classifier for Ozon/legal entity rules and notification tags

order-aware warehouse automation:
- normal manager order tabs report compact order evidence to background
- strict order kind is ozon / regular / unknown with 24h TTL and 500-record retention
- Ozon warehouse panel opens automatically; regular/unknown stays collapsed
- unknown UI says: Тип не определён — обновите карточку заказа
- trusted Ozon assembly action waits for a fresh successful barcode snapshot
- automatic write is rejected by background unless the order is confirmed Ozon
- manual preview/check/write remains available for every order kind
```

## 3. Mandatory Working Method

- Язык: русский.
- Стиль: кратко, инженер-инженеру.
- Формат: анализ → решение → команды/артефакты.
- Не присылать большие фрагменты кода без запроса.
- Изменения передавать ZIP с полными файлами.
- Не использовать `git add .`.
- После replacement ZIP сначала только:

```bash
npm test
git status
git diff --stat
```

- Commit/push команды давать только после пользовательской проверки.
- Коммиты — цельные поведенческие срезы, Conventional Commits.
- После push, если нужны актуальные файлы, просить свежий `git archive HEAD`.

Команда архива:

```bash
rm -f ../tab_wanderer.zip && git archive --format=zip --output=../tab_wanderer.zip HEAD
```

## 4. Product Rules

### Monitoring

```text
fast poll: page 1, ~15 seconds
deep sync: ~5 minutes, configurable 1–50 pages
windowed: fast + deep
active: page 1 only
```

`monitorScope` управляет сбором. `notificationTriggers` и `notificationSuppressors` управляют только уведомлениями.

Event fields:

```text
status, delivery, payment, city
```

Context only:

```text
contractor, phone, date, amount, product progress, manager
```

Dynamic local-time text города удаляется из hash/diff.

### Watched orders

- Валидация существования до сохранения.
- Full и short order ID lookup.
- Inline comment.
- One-time reminder.
- Per-order follow-up toggle.
- Выключение follow-up не удаляет заказ, comment или reminder.

### Warehouse/Ozon

- Записывать все единичные штрихкоды.
- Не записывать `multiBarcodeType`.
- Свежая проверка имеет приоритет над старым apply-state.
- Partial verification остаётся красной/retryable.
- Технические fallback-причины не показывать обычному пользователю.
- Page scripts не должны иметь возможность синтетически инициировать запись.
- Карточка заказа классифицируется из обычной менеджерской вкладки, а не только из worker tab.
- Ozon подтверждается сочетанием `Источник: OZON` и FBS ship-ссылки того же заказа.
- Полная карточка без Ozon-маркеров считается `regular`; частичная/противоречивая — `unknown`.
- В Warehouse Ozon раскрывается автоматически, regular/unknown остаются свернутыми.
- Автозапись разрешена только после trusted assembly action и свежего успешного post-action snapshot.
- Ручные кнопки доступны для всех типов заказа.

## 5. Files To Read First

```text
readme.md
docs/project-context.md
docs/roadmap.md
docs/smoke-checklist.md
background.js
content.js
notification-rules.js
core/monitor-status.js
core/notification-message.js
core/order-kind.js
core/ozon-session-utils.js
warehouse-barcode-bridge.js
ozon-product-bridge.js
ozon-product-page-bridge.js
```

Tests for the hardening:

```text
tests/lifecycle-hardening.test.js
tests/order-kind.test.js
tests/background-core.test.js
tests/background-config.test.js
tests/content-parser.test.js
tests/notification-rules.test.js
tests/ozon-product-bridge.test.js
```

## 6. Release Discipline

- Не повышать версию до завершения кода и manual smoke.
- Не создавать CWS package заранее.
- Маленькие patch releases без новых permissions/host permissions предпочтительны.
- Удаление permission допустимо, но требует smoke в установленной unpacked-сборке.
- Tag создаётся только после подтверждённой публикации.
- Current public release identity остаётся `f496d36 / v1.0.3`.

## 7. Sensitive Local Files

Полный архив рабочей папки может содержать `.git` и `docs/private`. В `docs/private` могут быть реальные-looking номера заказов, телефоны, email, CSRF/query secrets и DOM/API samples.

Правила:

- не включать `docs/private` в replacement ZIP или CWS package;
- не цитировать значения из private samples;
- по возможности обезличить или хранить их вне repo;
- для обычного handoff использовать `git archive HEAD`.

## 8. Next Step After Applying This Archive

1. Пользователь запускает `npm test`, `git status`, `git diff --stat`.
2. Затем выполняется manual smoke из `docs/smoke-checklist.md`.
3. Проверяется manager-tab classification и автоматический Ozon flow по разделам smoke checklist.
4. Только после подтверждения можно коммитить интегрированный срез.
5. Следующий релиз формируется позже вместе с достаточным набором пользовательских изменений.
