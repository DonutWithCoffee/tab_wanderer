# tab_wanderer — Chat Handoff

## 1. Current Known State

```text
Repo: github.com/DonutWithCoffee/tab_wanderer
Branch: main
Public stable CWS release: 1.0.4.1 / Unlisted
Last substantial tagged release: 1.0.4 / cd7d8e2 / v1.0.4
Manifest: 1.0.4.2
1.0.4.2 status: release-prep patch candidate, no Git tag
Source commit before release-prep: 6243b03
Development state: committed and pushed; release metadata pending commit
Expected automated baseline: 340 pass / 0 fail
Next release number: 1.0.4.2
```

1.0.4 опубликована и помечена тегом `v1.0.4`; 1.0.4.1 опубликована как hotfix без тега. Текущий patch candidate `1.0.4.2` построен поверх коммита `6243b03`. Он добавляет единичную read-only проверку уже укомплектованных штрихкодов при открытии подтверждённого Ozon-заказа, сериализует resolve/apply операции и усиливает Warehouse-валидацию. Live regression дополнительно исправил ложную причину `неединичная позиция`: quantity/reserved/stock не участвуют в определении единичности при явном `itemType === 0`. Baseline и live smoke: `340 pass / 0 fail`. Экспериментальный fingerprint-патч не применялся и в код не входит.

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
- automatic barcode adding has one Options checkbox, enabled by default
- trusted final assembly action is recognized by `ng-click="$ctrl.confirm()"`, not button text
- trusted Ozon assembly action waits for a fresh successful barcode snapshot
- automatic write is rejected by background unless the order is confirmed Ozon
- manual preview/check/write remains available for every order kind
- only explicit `itemType === 0` is writable; missing type is `itemTypeUnknown`
- visible DOM never invents unit type or unit quantities
- background revalidates manual and automatic payloads before opening Ozon
- existing assembled barcodes trigger one debounced read-only Ozon check per document/order
- read-only check is independent from the automatic-write setting
- one Ozon operation owns the shared worker at a time; operation/session tokens reject stale callbacks
- pending/active writes have priority over read-only checks
- automatic read-only checks queue with deduplication, TTL and bounded content retry when the worker is busy
- pending automatic write intent suppresses the page-open check temporarily; suppression returns to idle when the intent clears
- Warehouse `itemType` is scalar-only; coercive boolean/array/object/hex inputs fail closed, while quantity/reserved/stock remain diagnostic and never define unit type
- Warehouse/Ozon payloads are bounded before worker creation
- reused Warehouse XHR requests install one-shot `loadend` listeners
- delayed resolve acknowledgements/results from another Warehouse document instance are ignored
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
- При открытии assembly page подтверждённого Ozon-заказа уже существующие eligible штрихкоды проверяются один раз без записи.
- Выключенная автозапись не отключает эту read-only проверку.
- Pending automatic write intent имеет приоритет и не запускается параллельно с page-open check.
- Автоматическая read-only проверка при занятом worker не теряется: она дедуплицируется в bounded queue и запускается после записи.
- Manual resolve при занятой операции возвращает busy; новая запись отменяет manual resolve, но automatic-on-open resolve безопасно переносится в очередь.
- Boolean/array/object/hex не могут стать `itemType === 0`; quantity/reserved/stock сохраняются для диагностики и не блокируют явно подтверждённый единичный штрихкод.

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

- Hotfix `1.0.4.1` опубликован без Git tag; текущий CWS patch candidate — `1.0.4.2`.
- Загружать только точный проверенный CWS package с совпадающим SHA256.
- Маленькие patch releases без новых permissions/host permissions предпочтительны.
- Удаление permission допустимо, но требует smoke в установленной unpacked-сборке.
- Git tags создаются только для крупных обновлений; patch/hotfix builds не тегируются.
- Git tags остаются только для крупных обновлений; `1.0.4.2` не тегируется.

## 7. Sensitive Local Files

Полный архив рабочей папки может содержать `.git` и `docs/private`. В `docs/private` могут быть реальные-looking номера заказов, телефоны, email, CSRF/query secrets и DOM/API samples.

Правила:

- не включать `docs/private` в replacement ZIP или CWS package;
- не цитировать значения из private samples;
- по возможности обезличить или хранить их вне repo;
- для обычного handoff использовать `git archive HEAD`.

## 8. Next Step After Applying This Archive

1. Пользователь заменяет release-prep файлы.
2. Запускает `npm test`, `git status`, `git diff --stat`.
3. Ожидаемый baseline: `340 pass / 0 fail`.
4. Коммитит release metadata одним `chore: prepare patch release 1.0.4.2` и пушит.
5. Создаёт свежий `git archive HEAD`.
6. Из точного HEAD собирается финальный CWS ZIP с SHA256 и submission notes.
7. Git tag не создаётся.
