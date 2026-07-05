# tab_wanderer

Chrome extension для мониторинга заказов в админке Amperkot и отдельного warehouse/Ozon barcode action flow.

`tab_wanderer` работает локально: собирает snapshot заказов через изолированную worker-вкладку, сравнивает текущее состояние с локально известным состоянием, пишет обнаруженные события в локальные журналы и показывает уведомления по настройкам пользователя.

---

## Текущий статус

```text
Стадия разработки: Pre-1.0 product simplification, reminders and notification polish
Manifest version: 0.9.9
Текущий фокус: final smoke / 1.0 RC readiness
Tests: 238 pass / 0 fail
Latest checkpoint: docs(release): finalize smoke checklist for 1.0 RC
Distribution target: Chrome Web Store / Unlisted listing
```

Документы проекта:

```text
docs/chat-handoff.md
docs/project-context.md
docs/roadmap.md
docs/smoke-checklist.md
```

---

## Distribution target

Для стабильной `1.0+` версии выбран канал распространения:

```text
Chrome Web Store
Listing type: Unlisted
Manual archive installs: только dev/QA до 1.0
```

Перед отправкой в Chrome Web Store требуется отдельная release-readiness подготовка:

```text
release package без .git / docs/private / node_modules / временных архивов
privacy policy
permissions justification
host_permissions audit
listing description + screenshots
staff install/update instructions
финальный smoke checklist
```

Расширение не должно описываться как официальный продукт Ozon или Amperkot, если нет отдельного подтверждения/разрешения.

---

## Назначение

Плагин отслеживает:

- появление новых заказов;
- изменения известных заказов;
- изменения в рабочем окне глубже первой страницы;
- события по заказам, которые сотрудник добавил в отслеживаемые;
- напоминания по отслеживаемым заказам;
- диагностическое состояние и локальный диагностический лог для поддержки;
- безопасную привязку складских штрихкодов в Ozon Seller UI со страницы сборки склада.

Плагин **не является серверной историей заказов**. Локальная история/order lookup остаётся технической основой и диагностикой, но не является главным пользовательским сценарием 1.0.

---

## Основная модель мониторинга

Система разделяет сбор данных, события и уведомления.

```text
monitorScope
→ какие заказы физически попадают в основной list-monitor

order event model
→ какие изменения считаются событием и пишутся в eventJournal

notificationTriggers
→ какие события создают desktop-уведомление

notificationSuppressors
→ какие категории уведомлений быстро подавляются без остановки сбора данных
```

`notificationTriggers` и `notificationSuppressors` не блокируют обновление состояния и запись локальной истории. Они управляют только показом уведомлений.

---

## UI model

### Popup

Popup — быстрый рабочий пульт:

```text
Start / Stop
статус мониторинга
быстрые suppressors:
  - Игнорировать юриков
  - Игнорировать ОЗОН
добавить заказ в отслеживаемые по полному orderId
открыть страницу “Заказы”
открыть настройки
скачать diagnostic log
```

### Options

Options — настройки и диагностика:

```text
режим мониторинга
уведомления
какие заказы собирать
текущие настройки под dropdown
диагностика монитора под dropdown
диагностический лог под dropdown
monitorScope groups: статус / доставка / оплата / склад под dropdown
deepSyncMaxPages
notificationTriggers
notificationSuppressors
monitor diagnostics
diagnostic log tools
```

### Заказы

Страница `watched-orders.html/watched-orders.js` — рабочий экран отслеживаемых заказов: прямые проверки, комментарии, интервал проверки и одноразовые напоминания. Hidden order lookup остаётся внутри как diagnostic/foundation, но не является пользовательским UI.

Текущие/целевые сценарии:

```text
добавить/убрать заказ из отслеживаемых
список отслеживаемых заказов
создать одно активное one-time reminder по отслеживаемому заказу
показать pending/done/cancelled reminder state
удалить pending reminder
настроить интервал прямой проверки отслеживаемых заказов
локальный order lookup/eventJournal оставить как diagnostic/foundation
не продавать локальную историю как серверную историю заказа
```

---

## Worker tab model

Основной мониторинг выполняется через отдельную worker-вкладку.

Правила:

```text
worker определяется marker + tabId
URL reuse запрещён
нельзя брать произвольную admin-вкладку с похожим URL
```

Для отслеживаемых заказов используется отдельный direct worker:

```text
#tab_wanderer_direct_worker=1
открывает конкретную карточку заказа по direct URL
парсит detail page отдельно от основного list-monitor
закрывается после проверки
интервал проверки настраивается в Options: 2 / 5 / 10 / 15 / 30 минут, default 2 минуты
```

Для Ozon используется отдельный inactive/background worker:

```text
#tab_wanderer_ozon_worker=1
открывает Ozon Seller product page/search
не должен уводить фокус с рабочей складской вкладки
используется только для action layer, не для order-monitor
```

---

## Collection model

### Fast poll

```text
каждые 15 секунд
страница 1
ловит свежие изменения
```

### Deep sync

```text
каждые 5 минут
pagination через ?page=N
по умолчанию до 50 страниц / около 1500 заказов
safe range: 1–50 страниц
```

Deep sync завершается по явной pagination-информации:

```text
pagination-last-page
pagination-single-page
empty-first-page для scope без заказов
max-pages, если страницы ещё доступны
```

Empty page не используется как обычное условие остановки для валидной глубокой страницы, но пустая первая страница при выбранном scope считается корректным завершением.

---

## Monitor modes

```text
windowed
→ page 1 fast poll + периодический deep sync

active
→ page 1 only, без deep sync
```

---

## State model

Система хранит несколько разделённых моделей состояния:

```text
knownOrdersDB
→ долговременная память всех известных заказов

windowOrdersDB
→ текущее наблюдаемое окно заказов основного list-monitor

directFollowUpOrdersDB / directFollowUpHashDB
→ baseline direct follow-up, чтобы карточка заказа не перетирала list-state
```

`knownOrdersDB` не очищается при baseline/rebaseline. Scope/mode/depth changes перестраивают текущее окно сравнения, но не стирают глобальную память известных заказов.

---

## Startup / catch-up policy

Первый сбор после ручного включения, recovery или reload используется для синхронизации состояния.

```text
catch-up = обновить state/history
live monitoring = создавать desktop-уведомления
```

Startup catch-up не создаёт пачку desktop-уведомлений по backlog.

---

## Event model

Event fields:

```text
status
delivery
payment
city
tags
```

Notification-visible fields:

```text
status
delivery
payment
city
```

Context/search fields:

```text
id
internalId
orderUrl
date
phoneNormalized
totalAmount
productsDone
productsTotal
manager
contractor
hasAutoreserve
```

Важно про tags:

```text
tags парсятся и хранятся для history/search
tags не показываются в пользовательских уведомлениях
tag-only changes не создают desktop-уведомления
```

---

## Уведомления

Текущие trigger-группы:

```text
newOrders
changedOrders
changedFields:
  status
  delivery
  payment
  city
```

Pre-1.0 notification polish target:

```text
номер заказа всегда
статус всегда
тип оплаты всегда
тип доставки всегда
изменённое поле показывает было → стало
неизменённые поля показываются текущим значением
```

Быстрые suppressors:

```text
ignoreLegalEntityPayment
→ подавляет уведомления для “Безналичный расчет для юридических лиц”

ignoreOzon
→ подавляет уведомления для ОЗОН-заказов
```

Suppressors не являются monitorScope и не останавливают сбор/историю.

---

## Event journal / order lookup

Локальный eventJournal хранит обнаруженные события:

```text
orderId
eventType
eventKind
syncReason
changedFields
diff было → стало
order context
notification decision
coverage metadata
```

Retention:

```text
max retained entries: 5000
max retained bytes: 2_000_000
eventJournalDroppedEntries сохраняет число удалённых старых событий
```

Order lookup использует:

```text
knownOrdersDB
eventJournal
watchedOrders
```

Поддерживаются запросы:

```text
полный orderId: 2579-290626
короткий номер: 2579
```

---

## Warehouse / Ozon barcode binding

Это отдельный action layer. Он не является частью основного мониторинга заказов.

Сценарии:

```text
warehouse page получает barcode preview без reload после “Собрать заказ”
старые уже собранные заказы показывают initial barcode preview при открытии страницы
панель warehouse/Ozon свёрнута по умолчанию
панель разворачивается/сворачивается по клику
кнопка “Список ШК” показывает selectable список штрихкодов по товарам
кнопка “Проверить штрихкоды” сверяет состояние Ozon без записи
кнопка “Записать в Ozon” пишет недостающие штрихкоды
```

Warehouse source priority:

```text
1. captured warehouse API response with usable barcode snapshot
2. visible DOM fallback if API snapshot is empty/unusable
```

Ozon preview/verify priority:

```text
1. POST /api/sc/barcode-details-by-item-id with { item_id: ["<ozonSku>"] }
2. drawer/DOM fallback
```

Ozon write:

```text
POST /api/barcode-add-v2
payload: { seller_id, barcodes: [{ barcode, item_id }] }
```

Rules:

```text
не хранить Ozon cookies/tokens/auth/session data
Ozon worker открывается inactive/background
multi-barcode warehouse rows не пишутся автоматически
multi-barcode rows показываются как “Пропущено мультиштрихов”
UI fallback остаётся доступным при сбоях API write/verify
```

---

## Current module layout

Core modules include:

```text
core/order-model.js
core/sync-model.js
core/collection-model.js
core/event-journal.js
core/diagnostic-log.js
core/runtime-api.js
core/monitor-status.js
core/order-lookup.js
core/direct-follow-up.js
core/watched-orders.js
core/warehouse-barcode-extractor.js
core/warehouse-ozon-view-model.js
core/ozon-product-search.js
core/ozon-barcode-binding.js
core/ozon-ui-apply-result.js
core/ozon-session-utils.js
core/ozon-session-messaging.js
```

`background.js` still owns monitor lifecycle and Ozon worker/session lifecycle. `content.js` still owns DOM rendering and runtime messaging, but warehouse/Ozon view-model logic is extracted.

---

## Development commands

```bash
npm test
```

Expected baseline:

```text
238 pass / 0 fail
```

Before commit for code/test changes:

```bash
git status
npm test
git diff --stat
git diff --name-status
```

Docs/version/checklist-only slices can be committed without npm test.

Commit style:

```bash
git add <explicit-file-list>
git diff --cached --stat
git commit -m "type(scope): short summary"
git push
```

Never use `git add .`.

---

## Private / local files

Do not commit:

```text
docs/private/
.git/
node_modules/
*.patch
*.diff
temporary zip archives
```
