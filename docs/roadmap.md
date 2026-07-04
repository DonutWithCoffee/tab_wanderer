# tab_wanderer — Roadmap

Документ фиксирует путь разработки от текущего состояния `Pre-1.0` до `1.0` и post-1.0.

---

## Current position

```text
0.9.5 — Stabilization + Test Hardening ✅
0.9.6 — Deep Collection ✅
0.9.7 — Scope UX + Event/History Foundation ✅
0.9.8 — Observability + Refactor ✅
0.9.9 — Product completion QA before UI polish ✅
Pre-1.0 — Product simplification + reminders + notification polish + Ozon/warehouse ⏳ current
1.0 RC ⏳
1.0 Stable Monitoring Release ⏳
```

Version state:

```text
Manifest version: 0.9.9
Tests: 214 pass / 0 fail
Latest pushed checkpoint: c854afe docs(project): sync workflow and current handoff context
```

Решение по версии: substeps `0.9.9.x` фиксируются как development checkpoints, а manifest остаётся `0.9.9`, чтобы не превращать каждый внутренний slice в отдельную production-facing версию.

---

## 0.9.5 — Stabilization + Test Hardening ✅

Сделано:

```text
stable worker lifecycle
isolated worker tab
no URL-based worker reuse
automatic recovery foundation
watchdog
safe state storage
parser/hash/date tests
background process/config tests
popup draft tests
```

---

## 0.9.6 — Deep Collection ✅

Сделано:

```text
monitorState
collectionSession
fast/deep collection policy
URL-driven pagination через ?page=N
deep sync base
known/window state split
monitorMode active/windowed
trusted snapshot flow
duplicate page / timeout / retry-limit protection
```

Важное правило:

```text
empty page не является нормальным stop condition для admin orders pagination
empty first page при выбранном scope = корректное завершение без заказов
```

---

## 0.9.7 — Scope UX + Event/History Foundation ✅

Сделано:

```text
monitorScope UX foundation
notificationTriggers foundation
event field contract
known/window model correction
core/order-model.js
core/sync-model.js
core/event-journal.js
sync reasons
coverage metadata
GET_EVENT_JOURNAL
history page skeleton
line endings hygiene
```

Позже broad history timeline был признан продуктово неправильным для 1.0 и заменён order-specific lookup.

---

## 0.9.8 — Observability + Refactor ✅

Цель:

```text
сделать систему объяснимой, диагностируемой, поддерживаемой удалённо и готовой к QA
```

Сделано:

```text
GET_MONITOR_STATUS / monitor diagnostics snapshot
options diagnostics panel skeleton
worker return-to-page-1 after deep sync
persistent diagnostic log
full retained diagnostic log export
diagnostic log retention policy
diagnostic log noise reduction
settings UX simplification
popup quick-control model
options autosave model
deepSyncMaxPages setting
50 pages / ~1500 orders validation
scope-aware pagination completion
manual-start catch-up detection
runtime sync consistency tests
notification diff было → стало
tags removed from notification surface
core/collection-model.js extraction
core/runtime-api.js extraction
manifest/version sync to 0.9.8
```

---

## 0.9.9 — Product completion QA before UI polish ✅

Цель:

```text
закрыть продуктовые и технические разрывы до этапа визуальной/UI-polish работы
```

Сделано:

```text
monitorScope editing moved to Options
scope dictionaries shown to user
scope changes are debounced
scope change triggers safe rebaseline/current-window rebuild
knownOrdersDB preserved across scope/mode/depth changes
order-specific lookup replaces broad event timeline
watched orders managed on Orders page
direct follow-up baseline/events/notifications stabilized
legacy monitorScope.predicates removed
quick suppressors replace hidden hardcoded ignores
startup/recovery catch-up notification flood suppressed
diagnostic log/export polished
```

---

## Pre-1.0 — Product simplification + reminders + notification polish + Ozon/warehouse ⏳ current

Новая продуктовая рамка:

```text
tab_wanderer = уведомления о новых/изменённых заказах + отслеживаемые заказы с напоминаниями + Ozon/warehouse модуль штрихкодов
```

Цель этапа:

```text
облегчить пользовательский смысл плагина
убрать слабые/перегружающие пользовательские поверхности
вернуть информативные уведомления
добавить практичные напоминания к отслеживаемым заказам
сохранить стабильный Ozon/warehouse flow
```

Сделано по UI/monitor side:

```text
popup quick-control model
Options autosave model
Orders page lookup/watchlist flow
monitor diagnostics/log tools
documentation synced for new ChatGPT sessions
legacy handoff replaced with docs/chat-handoff.md
```

Сделано по warehouse/Ozon action layer:

```text
warehouse page barcode preview without reload after “Собрать заказ”
initial barcode preview on page open for already assembled orders
skipped-only Ozon products are not sent to Ozon
multi-barcode warehouse rows are skipped automatically
warehouse panel collapsed by default
panel expands/collapses on click
button “Список ШК” shows selectable barcodes grouped by product
button “Проверить штрихкоды” reads Ozon state without writing
button “Записать в Ozon” writes missing barcodes
Ozon write through /api/barcode-add-v2
post-write verify through /api/sc/barcode-details-by-item-id
verify payload uses item_id as array
barcode details response uses response.barcodes[].barcode
drawer/DOM remains fallback
UI fallback remains available if API write/verify cannot confirm
Ozon/warehouse live smoke passed by user
```

Сделано по refactor cleanup:

```text
core/warehouse-ozon-view-model.js extracted
core/ozon-ui-apply-result.js extracted
core/ozon-session-utils.js extracted
core/ozon-session-messaging.js extracted
background.js reduced but still owns worker/session lifecycle
content.js reduced but still owns DOM rendering/runtime messaging
```

### Pre-1.0 product cleanup tasks

1. Упростить пользовательскую поверхность:

```text
hide user-facing order history / order lookup entry for 1.0
keep eventJournal/order lookup code as internal diagnostic/foundation
stop describing local order history as a user-facing 1.0 feature
keep Orders page focused on watched orders and reminders
```

Причина:

```text
локальная история не является серверной историей заказа
она зависит от того, видел ли заказ конкретный экземпляр расширения
как пользовательская функция 1.0 она может создать неправильные ожидания
```

2. Упростить Options UI:

```text
remove user-facing controls for:
  - Флаги
  - Резерв
  - Комплектация
```

Не удалять сразу из parser/core:

```text
keep as context/diagnostic fields
keep tests where they protect parser behavior
remove from notification trigger controls / user settings surface
```

3. Вернуть информативный формат уведомлений:

```text
order number is always shown
status is always shown
payment type is always shown
delivery type is always shown
changed field shows было → стало
unchanged fields show current value
```

Example:

```text
Заказ 1234-010726
Статус: Новый → Собран
Оплата: Банковская карта
Доставка: СДЭК
```

4. Добавить reminders для watched orders:

```text
one-time reminder for watched order
user selects date/time
optional short note
Chrome notification fires at selected time
notification includes order number and reminder text
triggered reminder becomes done/expired
```

MVP non-goals:

```text
recurring reminders
calendar integrations
complex reminder templates
legal-department-specific workflow statuses
```

5. Legal entity department:

```text
postpone design until QA session with legal entity department
collect real workflow first
then decide whether they need filters, presets, reminders or separate views
```

6. Release packaging:

```text
not the next priority
return after product simplification, reminders and notification polish stabilize
```

Recommended next implementation order:

```text
1. Hide user-facing history/order lookup entry and update tests/docs.
2. Simplify Options by removing Flags / Reserve / Completion controls from UI.
3. Restore informative notification message format.
4. Add one-time watched order reminders.
5. After legal department QA, design legal workflow if needed.
6. Later, add release packaging script.
```

---

## 1.0 RC ⏳

Перед RC нужно:

```text
run full npm test baseline
run smoke checklist from docs/smoke-checklist.md
verify popup/options/orders pages
verify startup/recovery/catch-up behavior
verify deep sync and page return to page 1
verify diagnostic log/export
verify Ozon/warehouse flow after docs/refactor
check release packaging does not include .git, docs/private, node_modules or temp archives
```

Potential pre-RC cleanup candidates:

```text
Ozon operation lock for simultaneous warehouse tabs
compact Ozon debug payload policy
release packaging script
small UI text polish if user requests
```

---

## 1.0 Stable Monitoring Release ⏳

Scope:

```text
local-first monitoring extension
stable popup/options/orders UX
local event journal and diagnostics
configurable notification triggers/suppressors
watchlist/direct follow-up
warehouse/Ozon barcode action layer as local helper
```

Non-goals for 1.0:

```text
centralized server collector
multi-branch centralized dashboard
Firefox fork
server-side order history
Ozon auth/session storage
```

---

## Post-1.0

Possible directions:

```text
centralized collector/dashboard
multi-branch aggregation
Raspberry Pi / VPS deployment for collector
Firefox fork feasibility
Ozon operation hardening and queue/lock model
configurable minimum/base product price threshold for barcode binding
packaging/release automation
```
