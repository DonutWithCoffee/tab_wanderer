# tab_wanderer — Roadmap

Документ фиксирует путь разработки от текущего состояния `Pre-1.0 diagnostics/log polish checkpoint` до `1.0` и post-1.0.

---

## Current position

```text
0.9.5 — Stabilization + Test Hardening ✅
0.9.6 — Deep Collection ✅
0.9.7 — Scope UX + Event/History Foundation ✅
0.9.8 — Observability + Refactor ✅
0.9.9 — Product completion QA before UI polish ✅
Pre-1.0 — UI/UX polish with user ⏳ current
1.0 RC ⏳
1.0 Stable Monitoring Release ⏳
```

Version state:

```text
Manifest version: 0.9.9
Build checkpoint: 0.9.9.8
Tests: 171 pass / 0 fail
```

Решение по версии: substeps `0.9.9.x` фиксируются как development checkpoints, а manifest поднимается до `0.9.9`, чтобы не превращать каждый внутренний slice в отдельную production-facing версию.

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

### 0.9.9.1 — Monitor scope settings ✅

```text
monitorScope editing moved to Options
scope dictionaries shown to user
scope changes are debounced
scope change triggers safe rebaseline/current-window rebuild
knownOrdersDB is preserved
```

### 0.9.9.2 — History filters / timeline rethink ✅

Первичная идея broad timeline была пересмотрена.

Итоговое решение:

```text
не показывать общую ленту всех событий как пользовательскую “историю заказов”
оставить local eventJournal как internal storage
default user flow = поиск конкретного заказа
```

Причина: расширение видит только локально обнаруженные изменения и не может честно обещать полную серверную историю заказа.

### 0.9.9.3 — Watched orders config/UI foundation ✅

```text
core/watched-orders.js
userConfig.watchedOrders.items
normalization / dedupe / status fields
options foundation for add/remove before UI relocation
watchedOrdersCount in monitor status
```

### 0.9.9.4 — Direct follow-up worker + order page parser ✅

```text
separate direct worker marker
open order page by direct URL
parse detail page via parseOrderDetails
update watched order status / lastCheckedAt / lastError
close direct worker after check
```

Parser был проверен на реальном HTML карточки заказа и переведён на section-aware extraction, чтобы не путать табличные суммы/доставку с блоком “Доставка”.

### 0.9.9.5 — Direct follow-up events/history/notifications ✅

```text
first successful direct observation = direct baseline without notification
subsequent direct changes = eventJournal + optional notification
tag-only direct changes = history/event only, no notification
direct changes update knownOrdersDB
```

Позже добавлена consistency-фаза:

```text
directFollowUpOrdersDB / directFollowUpHashDB separated from list-state
direct baseline does not overwrite richer list-state with sparse detail-page data
direct changes synchronize windowOrdersDB/windowOrdersHashDB to avoid duplicate list notifications
```

### 0.9.9.6 — Temporary production rules cleanup ✅

Старые hidden hardcoded ignores заменены явными quick suppressors:

```text
ignoreLegalEntityPayment
→ suppress notifications for legal entity bank transfer

ignoreOzon
→ suppress notifications for Ozon orders
```

Cleanup:

```text
legacy monitorScope.predicates removed
old stored predicates are ignored
monitorScope signature no longer includes predicates
```

### 0.9.9.7 — Local order/history search basics ✅

Итоговая модель:

```text
history page по пользовательскому смыслу стала страницей “Заказы”
no broad event timeline
search by full orderId or 4-digit short number
multiple candidates shown before selection
selected order shows local detected changes only
watched orders managed on Orders page
popup only adds watched order by full orderId
Options links to Orders page instead of managing watchlist directly
```

### 0.9.9.8 — Docs/version checkpoint ✅ done

```text
README synced
docs/project-context.md synced
docs/roadmap.md synced
docs/smoke-checklist.md added
manifest/version.js bumped to 0.9.9 checkpoint
test count recorded: 168 pass / 0 fail
```

---

## Pre-1.0 — UI/UX polish with user ⏳ current

Цель:

```text
довести интерфейс до понятного, читаемого и красивого состояния вместе с пользователем
```

Входит:

```text
popup UI/UX polish
Options UI/UX polish
Orders page UI/UX polish
diagnostics/log wording and layout polish
empty/loading/error states
visual hierarchy
wording pass
manual browser smoke QA
```

### Pre-1.0 diagnostics/log polish checkpoint ✅ current

```text
log export wording clarified
smoke checklist clarified
manual QA checklist aligned with current diagnostics behavior
test count recorded: 171 pass / 0 fail
```

Границы этапа:

```text
не менять core semantics без отдельного QA slice
не смешивать Options с ежедневным управлением заказами
не возвращать broad full event timeline
```

---

## 1.0 RC ⏳

Цель:

```text
заморозить продуктовую семантику и проверить расширение как release candidate
```

Входит:

```text
manual smoke checklist completed
fresh diagnostic log sanity check
startup/reload/recovery checks
notification flood checks
watchlist/direct follow-up checks
order lookup checks
README/project docs final pass
release notes draft
```

---

## 1.0 — Stable Monitoring Release ⏳

Definition of Done:

```text
stable worker lifecycle
worker identified by marker + tabId
no URL-based tab reuse
trusted snapshot model
knownOrdersDB preserved across rebaseline
windowOrdersDB rebuilt safely
fast poll works
deep sync works up to configured safe limit
deep sync completes from pagination-last-page / empty-first-page / max-pages
startup catch-up does not flood desktop notifications
monitorMode works
monitorScope works
notificationTriggers work
notificationSuppressors work
notification diff было → стало works
tags do not create user notification noise
eventJournal works with retention
order lookup works for full orderId and short number
Orders page is minimally usable
watchlist/direct follow-up works
direct follow-up does not duplicate list-monitor notifications
diagnostic log export works
diagnostic log export returns full retained log
diagnostic/event log retention prevents unbounded storage growth
notifications open order page
manual browser smoke test passed
README/project-context/roadmap updated
manifest/version/release notes prepared
tests green
tag v1.0
```

---

## Post-1.0 Roadmap

### Centralized collector / dashboard

```text
collect parsed events from multiple plugin instances
support two branches in different cities
store shared event history centrally
provide manager/director dashboard
possible Raspberry Pi or user VPS deployment
```

Not part of current local-first Chrome extension release.

### Priority/direct follow-up evolution

Current 1.0-local watchlist is browser-local. Post-1.0 direction:

```text
more robust direct order page checks
better scheduling/backoff
possible central/shared watchlist
shared history across workplaces
```

### Ozon barcode binding

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

### Firefox fork

```text
evaluate browser API differences
adapt extension runtime
fork only after Chrome 1.0 is stable
```
