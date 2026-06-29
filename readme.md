# tab_wanderer

Chrome extension для мониторинга заказов в админке Amperkot.

`tab_wanderer` работает как локальный наблюдатель: собирает snapshot заказов через изолированную worker-вкладку, сравнивает текущее состояние с локально известным состоянием, пишет обнаруженные события в локальные журналы и показывает уведомления по настройкам пользователя.

---

## Текущий статус

```text
Стадия разработки: 0.9.9.8 Docs/version checkpoint
Manifest version: 0.9.9
Build checkpoint: 0.9.9.8
Текущий фокус: product completion QA перед pre-1.0 UI/UX polish
Tests: 168 pass / 0 fail
```

Документы проекта:

```text
docs/project-context.md
docs/roadmap.md
docs/smoke-checklist.md
```

---

## Назначение

Плагин отслеживает:

- появление новых заказов;
- изменения известных заказов;
- изменения в рабочем окне глубже первой страницы;
- события по заказам, которые сотрудник добавил в отслеживаемые;
- локальные обнаруженные изменения по конкретному заказу;
- диагностическое состояние и локальный диагностический лог для поддержки.

Плагин **не является серверной историей заказов**. Он показывает только то, что было обнаружено локальным экземпляром расширения во время работы.

---

## Основная модель

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

В popup добавление в watchlist выполняется только по полному номеру заказа, например `2579-290626`. Поиск по первым 4 цифрам вынесен на страницу “Заказы”, чтобы не перегружать основное окно.

### Options

Options — настройки и диагностика:

```text
monitorMode
monitorScope
deepSyncMaxPages
notificationTriggers
notificationSuppressors
monitor diagnostics
diagnostic log tools
ссылка на страницу “Заказы”
```

Ежедневное управление отслеживаемыми заказами не хранится в Options.

### Заказы

Страница `history.html/history.js` по пользовательскому смыслу стала страницей “Заказы”. Она не показывает общий шумный timeline всех событий.

Основные сценарии:

```text
поиск заказа по полному orderId или первым 4 цифрам
выбор кандидата, если короткий номер неоднозначен
карточка выбранного заказа
последнее известное состояние заказа
обнаруженные изменения только выбранного заказа
добавить/убрать заказ из отслеживаемых
список отслеживаемых заказов
```

На странице явно сохраняется смысл: это локально обнаруженные плагином изменения, а не полная серверная история заказа.

---

## Worker tab

Основной мониторинг выполняется через отдельную worker-вкладку.

Правила:

```text
worker определяется marker + tabId
URL reuse запрещён
нельзя брать произвольную admin-вкладку с похожим URL
```

Это нужно потому, что менеджер может работать в другой вкладке админки с тем же URL.

Для отслеживаемых заказов используется отдельный direct worker:

```text
#tab_wanderer_direct_worker=1
открывает конкретную карточку заказа по direct URL
парсит detail page отдельно от основного list-monitor
закрывается после проверки
```

---

## Collection model

Система использует два контура основного сбора.

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

По ручной проверке 50 страниц собираются примерно за 30–35 секунд. После deep session worker возвращается на page 1.

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

Startup catch-up не создаёт пачку desktop-уведомлений по backlog. Это защищает сотрудников от лавины уведомлений при включении плагина утром или после перезагрузки расширения.

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

Эти поля участвуют в event fingerprint, `changedFields` и eventJournal.

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

Уведомления создаются для событий, которые прошли notification decision model.

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

Быстрые suppressors:

```text
ignoreLegalEntityPayment
→ подавляет уведомления для “Безналичный расчет для юридических лиц”

ignoreOzon
→ подавляет уведомления для ОЗОН-заказов
```

Suppressors не являются monitorScope и не останавливают сбор/историю.

Для новых заказов уведомление показывает компактное текущее состояние:

```text
Статус: Новый
Доставка: Самовывоз
Оплата: ...
```

Для изменений уведомление показывает diff `было → стало`:

```text
Статус: Новый → Ожидает оплаты
Доставка: Самовывоз → Курьер СДЭК
```

При клике на уведомление открывается карточка заказа.

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

Если короткий номер совпадает с несколькими заказами, страница показывает кандидатов.

---

## Diagnostic log

Локальный diagnostic log нужен для удалённой поддержки без DevTools.

Доступ:

```text
GET_DIAGNOSTIC_LOG preview → последние 100 записей
GET_DIAGNOSTIC_LOG full → весь retained log
CLEAR_DIAGNOSTIC_LOG
```

Retention:

```text
preview limit: 100 entries
max retained entries: 5000
max retained bytes: 2_000_000
diagnosticLogDroppedEntries сохраняется и показывается в export header
```

В лог не должны попадать:

```text
телефоны
полный payload заказа
HTML/DOM
cookie/token/auth данные
```

---

## Core modules

Pure/domain logic постепенно вынесена из `background.js`:

```text
core/order-model.js
core/sync-model.js
core/collection-model.js
core/event-journal.js
core/monitor-status.js
core/diagnostic-log.js
core/notification-message.js
core/runtime-api.js
core/watched-orders.js
core/direct-follow-up.js
core/order-lookup.js
```

Chrome APIs остаются на runtime edge.

---

## Тесты

Запуск:

```bash
npm test
```

Текущий checkpoint:

```text
168 pass 0 fail
```

---

## Release direction

Следующий этап после этого checkpoint:

```text
Pre-1.0 UI/UX polish
manual browser smoke QA
1.0 RC
1.0 Stable local-first Chrome extension release
```
