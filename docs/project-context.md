# tab_wanderer — Project Context Contract

Актуально на момент: `0.9.9.8 Docs/version checkpoint`.

Этот документ заменяет старые `Message 51` и используется как living document для переноса контекста между чатами. Если загружен актуальный архив кода, код из архива является источником истины по реализации.

---

## 1. Project Status

```text
Проект: tab_wanderer
Назначение: Chrome extension для мониторинга заказов в админке Amperkot
Текущая стадия: 0.9.9.8 Docs/version checkpoint
Manifest version: 0.9.9
Build checkpoint: 0.9.9.8
Tests: 168 pass / 0 fail
```

Roadmap:

```text
0.9.5 — Stabilization + Test Hardening ✅
0.9.6 — Deep Collection ✅
0.9.7 — Scope UX + Event/History Foundation ✅
0.9.8 — Observability + Refactor ✅
0.9.9 — Product completion QA before UI polish ✅ current checkpoint
Pre-1.0 — UI/UX polish with user ⏳ next
1.0 RC ⏳
1.0 Stable Monitoring Release ⏳
Post-1.0 — centralized collector / Ozon automation / Firefox fork
```

Recent important slices:

```text
refactor(history): replace timeline with order lookup
refactor(ui): move watchlist workflow to orders page
fix(watchlist): stabilize direct follow-up state
fix(history): bound event journal retention
fix(core): suppress startup catch-up notifications
refactor(config): remove legacy monitor scope predicates
docs(project): sync 0.9.9 checkpoint
```

---

## 2. Communication / Development Contract

Preferred style:

```text
Russian language
engineer-to-engineer
brief but complete
analysis → solution → code/artifact
critical issues first
no automatic agreement with user conclusions
challenge risky/wrong assumptions explicitly
```

Important behavior rule:

```text
Do not agree by default.
If the user's conclusion is technically or product-wise risky, push back, explain why, and propose safer alternatives.
Agreement must be earned by analysis.
```

Code workflow:

```text
small coherent slices
avoid unrelated refactor
prefer 1–3 files per small implementation step when practical
but commit coherent vertical behavior slices, not tiny partial commits
full-file rewrites should be shown as final file only
if unsure about current code, ask user for fresh archive/files
```

Git workflow:

```text
User works in VS Code integrated Git Bash on Windows.
Repo: DonutWithCoffee/tab_wanderer
Branch: main
Tests before commit: npm test
Before commit, provide explicit git add file list and Conventional Commit message.
After user confirms tests are green, proceed with commit/push instructions.
```

---

## 3. Product Vision

Плагин решает бизнес-задачи:

```text
1. Отслеживать появление новых заказов.
2. Отслеживать изменения известных заказов.
3. Делать мониторинг глубже первой страницы.
4. Уменьшать шум уведомлений.
5. Позволять сотруднику быстро управлять уведомлениями.
6. Позволять сотруднику отслеживать конкретные заказы.
7. Показывать локально обнаруженные изменения по конкретному заказу.
8. Давать диагностический лог для удалённой поддержки.
9. Сохранять стабильность при reload/restart браузера.
10. В будущем — централизовать сбор событий и добавить automation/action features.
```

Важное ограничение:

```text
tab_wanderer не является серверной историей заказов.
Он показывает только изменения, обнаруженные локальным экземпляром расширения во время наблюдения.
```

---

## 4. Architecture Invariants

Обязательные слои:

```text
core / domain model
rules / notification decision
config
monitorScope
collection policy
sync model
event journal
diagnostic log
notification message model
runtime API response model
popup/options/orders UI
Chrome runtime edge
```

Жёсткие правила:

```text
UI не источник domain logic
rules не влияют на сбор данных
notificationTriggers не влияют на state update
notificationSuppressors не влияют на state update
notificationTriggers/suppressors не влияют на eventJournal/order lookup
scope не смешивается с notificationTriggers
config не содержит runtime state
worker определяется marker + tabId
URL reuse запрещён
partial diff запрещён
baseline/rebaseline/startup catch-up не должны создавать notification flood
Chrome APIs держать на краях
новую domain logic постепенно выносить из background.js
```

Всегда выбирать:

```text
deterministic > быстрее
```

---

## 5. Worker Model

Main list worker:

```text
идентификация через marker + tabId
нельзя искать произвольный tab по совпадающему URL
нельзя reuse URL как identity
```

Причина: менеджер может работать в другой admin-tab с таким же URL, и это не worker.

После deep sync worker обязан вернуться на page 1, иначе fast cycle может смотреть старую глубокую страницу вместо свежих заказов.

Direct follow-up worker:

```text
separate marker: #tab_wanderer_direct_worker=1
используется только для watched orders
открывает конкретную карточку заказа по direct URL
парсит detail page отдельно от list parser
закрывается после проверки
```

---

## 6. Trusted Snapshot / State Model

Система разделяет:

```text
knownOrdersDB
→ долговременная память обо всех известных заказах

windowOrdersDB
→ текущее наблюдаемое окно заказов main list-monitor

directFollowUpOrdersDB / directFollowUpHashDB
→ direct follow-up baseline state
```

Правила:

```text
knownOrdersDB не очищается при baseline/rebaseline
windowOrdersDB может перестраиваться из нового snapshot
partial snapshot не используется для diff
direct baseline не должен перетирать более полный list-state пустыми полями
scope/mode/depth change не должен стирать глобальную память известных заказов
```

---

## 7. Monitor State

Состояния:

```text
uninitialized
warming
active
```

Смысл:

```text
uninitialized → монитор выключен / нет активного наблюдения
warming → worker/baseline/rebaseline/catch-up phase
active → нормальное сравнение snapshot и запись событий
```

---

## 8. Collection Model

Fast cycle:

```text
page 1
polling каждые 15 секунд
быстро ловит свежие изменения
```

Deep sync:

```text
pagination через ?page=N
каждые 5 минут
настраиваемый лимит deepSyncMaxPages
safe range: 1–50 страниц
default: 50 страниц / около 1500 заказов
```

Ручная проверка:

```text
30 страниц / 900 заказов ≈ 18 секунд
50 страниц / 1500 заказов ≈ 30–35 секунд
```

Monitor modes:

```text
windowed:
  fast + deep sync

active:
  page 1 only
  deep sync не запускается
```

Important:

```text
не останавливаться только из-за встречи известного заказа
после deep session всегда возвращать worker на page 1
deep sync завершается по pagination-last-page / pagination-single-page / empty-first-page / max-pages
empty page не является обычным stop condition для валидной глубокой страницы
empty first page при выбранном scope = корректное завершение без timeout
```

Collection/session pure logic:

```text
core/collection-model.js
```

---

## 9. Sync / Catch-up Policy

Sync reasons:

```text
initial
manual-start
recovery
stale-resume
scope-change
mode-change
window-sync
direct-follow-up
normal
```

Startup/catch-up rule:

```text
catch-up = синхронизация state/history
live monitoring = desktop notifications
```

Manual start with existing known DB may produce catch-up events/history, but desktop notifications are suppressed for startup backlog.

Why:

```text
A worker starting in the morning must not notify hundreds/thousands of historical orders from the current deep window.
```

Safe baselines:

```text
initial
recovery
stale-resume
scope-change
mode-change
```

These rebuild trusted/current windows without notification flood.

---

## 10. Event Field Contract

Event fields:

```text
status
delivery
payment
city
tags
```

These fields participate in:

```text
event fingerprint
changedFields
eventJournal
order lookup detected changes
```

Notification-visible fields:

```text
status
delivery
payment
city
```

Important:

```text
tags remain event/history/search data
tags are not displayed in notifications
tag-only changes do not create desktop notifications
if status + tags changed, notification shows only status
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

Context/search fields may be stored and displayed, but they do not create notification-triggering changes.

Ignored/noise fields:

```text
shipmentDateText
hasOrderFlag
user column
```

---

## 11. Notification Decision / Message Model

Entry point:

```text
evaluateNotification(order, eventContext, config)
```

Config:

```js
notificationTriggers: {
    newOrders: true,
    changedOrders: true,
    changedFields: {
        status: true,
        delivery: true,
        payment: true,
        city: true
    }
},
notificationSuppressors: {
    ignoreLegalEntityPayment: false,
    ignoreOzon: false
}
```

Rules:

```text
notificationTriggers suppress notification only
notificationSuppressors suppress notification only
DB/hash/window state always update
eventJournal writes events independently from desktop notification decisions
startup catch-up suppresses desktop notifications
```

Messages:

```text
new-order → compact current state
order-changed → diff было → стало по notification-visible fields
```

Tags do not enter notification surface.

---

## 12. Event Journal / Order Lookup

Core files:

```text
core/event-journal.js
core/order-lookup.js
```

Journal entry stores:

```text
orderId
orderUrl
eventType
eventKind
syncReason
changedFields
diff было → стало
order context
prevHash/newHash
monitorMode
monitorScopeSignature
coverage metadata
notification decision
```

Retention policy:

```text
max retained entries = 5000
max retained bytes = 2_000_000
eventJournalDroppedEntries stores number of dropped old events
```

Runtime access:

```text
GET_EVENT_JOURNAL
GET_ORDER_LOOKUP
```

User-facing page:

```text
history.html/history.js, labeled as “Заказы”
```

Current product decision:

```text
No broad full event timeline in user UI.
Orders page is order-specific lookup + watchlist management.
```

Lookup accepts:

```text
full orderId: 2579-290626
short number: 2579
```

Sources:

```text
knownOrdersDB
eventJournal
watchedOrders
```

If a short number has multiple candidates, the user must choose a full orderId.

---

## 13. Watchlist / Direct Follow-up

Core files:

```text
core/watched-orders.js
core/direct-follow-up.js
```

Meaning:

```text
“Отслеживаемые заказы” = local user-managed watchlist of specific full order IDs.
```

Rules:

```text
popup adds watched order only by full orderId
Orders page manages watched orders and order lookup
Options only links to Orders page
watchlist bypasses monitorScope via direct follow-up
first direct observation is baseline, no notification
subsequent direct changes can write eventJournal and notify by normal rules
direct changes synchronize window state to avoid duplicate list notifications
```

Watched order item fields:

```text
id
status
addedAt
lastCheckedAt
lastBaselineAt
lastEventAt
lastError
```

---

## 14. Diagnostic Log

Core file:

```text
core/diagnostic-log.js
```

Runtime helpers:

```text
core/runtime-api.js
```

Purpose:

```text
remote support without DevTools
worker can download .txt and send it to developer
```

Runtime access:

```text
GET_DIAGNOSTIC_LOG preview → last 100 entries
GET_DIAGNOSTIC_LOG full → full retained log
CLEAR_DIAGNOSTIC_LOG
```

UI:

```text
popup → Download diagnostic log
options → diagnostic log details/dropdown in support area
preview/copy → preview
download/export → full retained log
```

Retention policy:

```text
preview limit = 100 entries
max retained entries = 5000
max retained bytes = 2_000_000
diagnosticLogDroppedEntries stores number of dropped old entries
export header shows retained/exported/dropped counts
```

Persistent log writes support-useful events, not noisy raw payloads.

Do not log:

```text
raw config predicates
raw order payloads
HTML/DOM
cookies/tokens/auth data
raw phone numbers where avoidable
```

---

## 15. UI Contract

Popup:

```text
quick control only
Start / Stop
status summary
quick notification suppressors
add watched order by full orderId only
open Orders page
open Options
Download diagnostic log
```

Options:

```text
settings + diagnostics only
monitorMode
monitorScope
deepSyncMaxPages
notificationTriggers
notificationSuppressors
monitor diagnostics
diagnostic log tools
link to Orders page
```

Orders page:

```text
order lookup by full orderId or short 4-digit number
candidate selection
selected order summary
local detected changes for selected order only
watched orders list
add/remove watch state
```

Important:

```text
Do not return broad full event timeline as default user UI.
```

---

## 16. Temporary / Removed Production Rules

Old behavior:

```text
hidden hardcoded ignore rules for Ozon and legal entity bank transfer
legacy monitorScope.predicates.ozonOnly / juridicalOnly
```

Current behavior:

```text
explicit quick notification suppressors
legacy monitorScope.predicates removed from default config / normalization / signature
old storage predicates are ignored safely
```

---

## 17. Tests

Command:

```bash
npm test
```

Current checkpoint:

```text
168 pass 0 fail
```

Test suites cover:

```text
config normalization
notification rules
URL builder
hash/date normalization
content parser
real order detail parser sample
background core/process
collection model
runtime API helpers
event journal retention
monitor status
diagnostic log
popup UI
options UI
orders/history UI
startup catch-up suppression
direct follow-up consistency
legacy monitorScope.predicates cleanup
```

---

## 18. Manual Smoke Checklist

Smoke checklist lives in:

```text
docs/smoke-checklist.md
```

Must be checked before 1.0 RC:

```text
startup catch-up no notification flood
worker isolation
fast/deep sync
popup controls
Options autosave
Orders page lookup/watchlist
direct follow-up
diagnostic export
STOP/START/reload
```

---

## 19. Current Known Boundaries

Local-first boundaries:

```text
state/history are local to one browser profile
no central DB before post-1.0
no multi-employee attribution
no complete server-side order history guarantee
```

UI boundaries:

```text
functional but not final-polished
visual hierarchy and wording polish belong to Pre-1.0 UI/UX stage
```

Direct follow-up boundaries:

```text
depends on detail page parser stability
should be validated if admin order page layout changes
```

---

## 20. Next Work

Immediate next phase:

```text
Pre-1.0 UI/UX polish with user
```

Then:

```text
1.0 RC
manual smoke QA
release notes
tag/release
1.0 Stable
```

Post-1.0:

```text
centralized collector/dashboard
multi-branch event aggregation
Ozon barcode binding automation
Firefox fork
```
