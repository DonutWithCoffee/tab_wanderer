# tab_wanderer — Roadmap

Документ фиксирует путь разработки от текущего состояния 0.9.8 до 1.0 и post-1.0.

---

## Current position

```text
0.9.5 — Stabilization + Test Hardening ✅
0.9.6 — Deep Collection ✅
0.9.7 — Scope UX + Event/History Foundation ✅
0.9.8 — Observability + Refactor 🔥 current
Pre-1.0 — UI/UX polish with user ⏳
1.0 — Stable Monitoring Release ⏳
```

Текущая точка:

```text
0.9.8 in progress / support diagnostics + settings hardening
```

Manifest/version пока остаётся `0.9.6` до отдельного release/version bump.

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

History page на этом этапе — только технический skeleton.

---

## 0.9.8 — Observability + Refactor 🔥

Цель:

```text
сделать систему объяснимой, диагностируемой, поддерживаемой удалённо и готовой к pre-release QA
```

### Уже сделано

```text
GET_MONITOR_STATUS / monitor diagnostics snapshot ✅
options diagnostics panel skeleton ✅
worker return-to-page-1 after deep sync fix ✅
persistent diagnostic log ✅
diagnostic log .txt export from options/popup ✅
diagnostic log noise reduction ✅
settings UX simplification ✅
popup quick-control model ✅
options autosave model ✅
deepSyncMaxPages setting ✅
deep sync max validated at 50 pages / ~1500 orders ✅
notification diff было → стало ✅
tags removed from notification surface ✅
```

### Current checkpoint decisions

```text
deepSyncMaxPages default = 50
safe range = 1–50
50 pages ≈ 1500 orders
worker must return to page 1 after every deep session
tags are parsed/stored/history/search data, not notification data
tag-only changes do not notify
```

### Remaining 0.9.8 work

```text
small background.js organization cleanup
status/log wording consistency
storage/state migration sanity check
manual browser smoke test checklist
support diagnostics final pass
release/version bump planning
```

Ограничение:

```text
без большого опасного refactor
не переписывать runtime целиком
Chrome APIs держать на краях
core/domain logic постепенно отделять от background.js
```

---

## Pre-1.0 — UI/UX polish with user ⏳

Цель:

```text
довести интерфейс до понятного, читаемого и красивого состояния вместе с пользователем
```

Входит:

```text
popup UI/UX polish
options page UI/UX polish
diagnostics panel polish
diagnostic log block polish
history page UI/UX polish
wording pass
visual hierarchy
empty/loading/error states
event grouping
basic filters
readable before/after diff
manual browser QA with user
```

Правило:

```text
до этого этапа UI может быть функциональным скелетом
финальную полировку не делать без пользователя
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
deep sync works up to configured safe limit
monitorMode works
monitorScope works
notificationTriggers work
notification diff было → стало works
tags do not create user notification noise
eventJournal works
history page minimally usable
diagnostic log export works
notifications open order page
baseline/rebaseline/recovery do not flood notifications
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

### Priority direct follow-up

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
