# tab_wanderer — Roadmap

Документ фиксирует текущий путь разработки от состояния 0.9.7 late stage до 1.0 и post-1.0.

---

## Current position

```text
0.9.5 — Stabilization + Test Hardening ✅
0.9.6 — Deep Collection ✅
0.9.7 — Scope UX + Event/History Foundation ✅ / checkpoint stage
0.9.8 — Observability + Refactor ⏭ next
1.0 — Stable Monitoring Release ⏳
```

Текущая точка:

```text
0.9.7 late stage / transition to 0.9.8
```

0.9.7 уже вышел за рамки простого Scope UX: в него вошли event model, sync reasons, coverage metadata, event journal и history skeleton. Это нормально. Перед 0.9.8 нужно зафиксировать документацию и сделать checkpoint.

---

## 0.9.5 — Stabilization + Test Hardening ✅

Статус: завершено.

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

Цель этапа была заложить стабильное ядро перед расширением функциональности.

---

## 0.9.6 — Deep Collection ✅

Статус: завершено.

Сделано:

```text
monitorState
collectionSession
fast/deep collection policy
URL-driven pagination через ?page=N
deep sync до 10 страниц
duplicate page protection
collection timeout protection
retry-limit protection
known/window state split
monitorMode active/windowed
trusted snapshot flow
```

Важное правило:

```text
empty page не является нормальным stop condition для admin orders pagination
```

---

## 0.9.7 — Scope UX + Event/History Foundation ✅ checkpoint stage

Статус: почти закрыт, требуется documentation/checkpoint.

Изначальная цель:

```text
сделать monitorScope и notificationTriggers понятными для пользователя
```

Фактически дополнительно сделано:

```text
event field contract
known/window model correction
core/order-model.js
core/sync-model.js
core/event-journal.js
sync reasons
coverage metadata
GET_EVENT_JOURNAL
history page skeleton
notificationTriggers cleanup
```

### Завершённые slices

```text
Parser / order model alignment ✅
Notification trigger settings ✅
Notification trigger UI cleanup ✅
Scope wording / explanation ✅
Known state preservation on baseline/rebaseline ✅
Event fields reduced to status/delivery/payment/city/tags ✅
Context-only fields separated ✅
Sync reason foundation ✅
Coverage metadata foundation ✅
Event journal foundation ✅
Event journal read access ✅
History page skeleton ✅
```

### Остаток для 0.9.7 checkpoint

```text
update readme.md ✅ current task
update docs/project-context.md ✅ current task
add docs/roadmap.md ✅ current task
manual smoke test
possible small fixes after browser check
optional tag/checkpoint v0.9.7
```

### Не делать в 0.9.7

```text
не полировать history UI
не строить dashboard
не делать centralized collector
не делать Ozon barcode binding
не делать priority direct follow-up
```

History page сейчас должна оставаться skeleton.

---

## 0.9.8 — Observability + Refactor ⏭

Статус: следующий этап.

Цель:

```text
сделать систему объяснимой, диагностируемой и пригодной к pre-release стабилизации
```

### Step 1 — Monitor status snapshot

Добавить read-only runtime endpoint:

```text
GET_MONITOR_STATUS
```

Он должен возвращать:

```text
isRunning
monitorState
hasWorkerTab
pendingRebaseline
pendingSyncReason
monitorMode
knownOrdersCount
windowOrdersCount
eventJournalCount
lastBaselineDate
lastDeepSyncAt
lastCollectionMetadata
collectionSession summary
```

Правила:

```text
только чтение
не запускать worker
не менять state
не создавать notifications
не делать baseline/rebaseline
```

### Observability work

```text
status snapshot for popup/options diagnostics
collection metadata visibility
journal summary visibility
sync reason visibility
smoke-test friendly diagnostics
better logs around phase/event/suppress reason
```

### Refactor work

```text
разгрузить background.js маленькими безопасными шагами
держать Chrome APIs на краях
оставлять core/domain logic переиспользуемым
не делать большой опасный refactor
не переписывать runtime целиком
```

### Expected output

```text
диагностируемый extension
понятное состояние monitor lifecycle
меньше скрытых причин поведения
готовность к pre-release QA
```

---

## Pre-1.0 — UI/UX polish with user

Статус: после 0.9.8, перед 1.0.

Цель:

```text
довести пользовательский интерфейс до понятного и читаемого состояния вместе с пользователем
```

Входит:

```text
history page UI/UX polish
readable before/after diff
event grouping
basic filters
visual hierarchy
empty/loading/error states
popup/options wording pass
manual browser QA
```

Правило:

```text
history page сейчас только skeleton; финальную UI/UX-полировку делать совместно с пользователем
```

---

## 1.0 — Stable Monitoring Release ⏳

Цель:

```text
готовая local-first Chrome extension версия для реального использования сотрудниками
```

Definition of Done:

```text
stable worker lifecycle
worker identified by marker + tabId
no URL-based tab reuse
trusted snapshot model
knownOrdersDB preserved across rebaseline
windowOrdersDB rebuilt safely
fast poll works
deep sync works
monitorMode works
monitorScope works
notificationTriggers work
eventJournal works
history page minimally usable
notifications open order page
baseline/rebaseline/recovery do not flood notifications
manual browser smoke test passed
README/project-context/roadmap updated
tests green
release notes prepared
manifest/version bump done
tag v1.0
```

---

## Post-1.0 Roadmap

### Centralized collector / dashboard

Future direction:

```text
collect parsed events from multiple plugin instances
support two branches in different cities
store shared event history centrally
provide manager/director dashboard
possible Raspberry Pi or user VPS deployment
```

Not part of current local-first Chrome extension release.

---

### Priority direct follow-up

Future direction:

```text
user-managed list of priority order IDs/direct URLs
separate periodic direct order page checks
separate parser path from main list monitorScope
notifications/history for priority orders
```

Important:

```text
this is not notificationTriggers override for visible snapshot orders
```

The user rejected the pre-1.0 watchlist override as unnecessary complexity. Keep only future direct follow-up mechanism.

---

### Ozon barcode binding

Future direction:

```text
detect Ozon orders
read barcodes from warehouse assembly page
search Ozon product by product ID
show product/barcode preview
require manual verification / optional confirmation
bind barcode in Ozon LK
respect configurable minimum/base product price threshold
```

This must be a separate automation/action layer, not mixed into monitor worker logic.

---

### Firefox fork

Future direction after stable Chrome release:

```text
evaluate browser API differences
adapt extension runtime
fork only after Chrome 1.0 is stable
```
