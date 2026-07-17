# tab_wanderer — Roadmap

Документ фиксирует состояние `1.0` и дальнейший путь: review-friendly patches и post-1.0.

---

## Current position

```text
0.9.x foundation and stabilization ✅
1.0.0 stable monitoring release ✅ published
1.0.1 monitoring/UI patch ✅ published
1.0.2 UI clarity patch ✅ uploaded; review/delivery not confirmed
post-1.0.2 Ozon consistency hardening ✅ code/tests prepared
```

Version state:

```text
Manifest version: 1.0.2
Tests: 264 pass / 0 fail
Submitted 1.0.2 source HEAD: f6664c6
Submitted 1.0.2 package SHA256: 46971aa963497ced32f13ec9e652235f24d1673dcb39f1a5245c036a44ee93de
Current development code: newer than the submitted 1.0.2 package
```

Release rule: patch releases stay small and review-friendly. The next version number is chosen only after the pending 1.0.2 review state and manual smoke are known.


## Post-1.0.2 — Ozon state consistency hardening ✅

Prepared:

```text
fresh successful recheck replaces stale verifyUnconfirmed state
fresh partial recheck records exact verified and missing barcodes
successful recheck clears stale operation errors
resolve failures remain red and retryable
product/global error styling follows the effective current state
skipped warehouse rows are grouped by actual reason
“Мультиштрихкоды” is reserved for real multiBarcodeType rows
automated regression coverage added
```

This hardening is not part of the already uploaded 1.0.2 package unless that submission is explicitly replaced before approval.

---

## 1.0.2 — Ozon status clarity + quick filter grouping ✅

Submitted source/package state:

```text
source HEAD: f6664c6
package uploaded to Chrome Web Store
review and delivery are not confirmed
runtime files: 35
SHA256: 46971aa963497ced32f13ec9e652235f24d1673dcb39f1a5245c036a44ee93de
baseline: 259 pass / 0 fail
permissions/host_permissions/data handling: unchanged
remote code scan: clean
```

Included in the submitted 1.0.2 package:

```text
Ozon write/verify button states are visible by text and color
successful confirmed write is green and disabled
error or unconfirmed write is red and retryable
technical Ozon details and zero-value service text are hidden
repeated verification does not add a duplicate user-facing status line
quick filters are split into “Скрывать уведомления” and “Уведомлять только”
legal-only mode still disables the conflicting hide-legal-entities filter
popup release notes describe 1.0.2
```

Chrome Web Store note:

```text
UI clarity and bugfix release. Improves Ozon barcode recording/verification status, removes duplicate and technical service messages, and separates quick notification filters into “Hide notifications” and “Notify only” groups. No permission, host permission, or data handling changes.
```

---

## 1.0.1 — Legal entity filter + watched-order follow-up toggle ✅

Сделано:

```text
добавлен быстрый фильтр “Только юрлица”
фильтр скрывает уведомления по обычным заказам, но не меняет сбор/state/history
конфликт с “игнорировать юрлица” нормализуется: only-mode выключает ignore-mode
popup/options UI блокируют “Юрлица” при включённом “Только юрлица”
новые tests для rules/popup/options
добавлен переключатель в карточке заказа: “Проверка изменений” вкл/выкл
при выключенной проверке заказ остаётся в списке, комментарий и напоминание продолжают работать
direct follow-up выбирает только заказы с включённой проверкой
popup показывает блок “Что нового” до подтверждения пользователем
прочитанный блок не появляется снова до следующей версии
```

Chrome Web Store note для загрузки:

```text
Bugfix and local monitoring controls improvement only, no permission or data handling changes.
```

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

## Pre-1.0 — Product simplification + reminders + notification polish + Ozon/warehouse ✅

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
user-facing order history/order lookup hidden for 1.0
low-value Options filters hidden: Флаги / Резерв / Комплектация
informative notification format restored
watched-order reminder core model added
background chrome.alarms + reminder runtime API added
watched-order reminder UI added on Orders/Tracking page
watched-order direct follow-up interval setting added in Options
watched-orders management UI polished
validated add flow stabilized for existing and nonexistent orders
async validation UI no longer shows premature success or hangs on rejected orders
form metadata cleanup for popup/options/watched-orders controls
Options layout polished: monitoring mode → collection scope → notifications dropdown → current settings → monitor diagnostics → diagnostic log
Options no longer duplicates watched-orders entry point; popup remains the entry point
release-specific smoke checklist and automated baseline recorded
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

Done:

```text
hide user-facing history/order lookup entry while keeping eventJournal/order lookup as internal diagnostic/foundation
simplify Options by removing Флаги / Резерв / Комплектация from user-facing controls
restore informative notification message format
add watched-order reminder core model
add background chrome.alarms + runtime API for reminder scheduling/firing
add watched orders page UI: date/time + optional note + clear reminder
display active/completed reminder state
configure watched-order direct follow-up interval: 2 / 5 / 10 / 15 / 30 minutes
```

Reminder / direct follow-up smoke result:

```text
configured follow-up interval cadence smoke passed
fired reminder notification smoke passed
notification click-through to order page smoke passed
Orders/Tracking UI polish is complete
Options diagnostics panel polish is complete
Chrome Web Store submission was completed for the initial release
```

Reminder MVP non-goals:

```text
recurring reminders
calendar integrations
complex reminder templates
legal-department-specific workflow statuses
```

Legal entity department:

```text
postpone design until QA session with legal entity department
collect real workflow first
then decide whether they need filters, presets, reminders or separate views
```

Recommended next order:

```text
1. Apply and verify the post-1.0.2 hardening archive.
2. Commit it as one behavior/docs slice after green tests.
3. Manually smoke Ozon recheck transitions and reason-aware skipped labels.
4. Wait for explicit CWS 1.0.2 review/delivery confirmation.
5. If published, create/verify the 1.0.2 annotated tag on f6664c6.
6. Choose the next patch version for the newer hardening code.
7. After legal department QA, design legal workflow only from real requirements.
```
---

## Chrome Web Store release process — reusable checklist

Решение по каналу распространения:

```text
Primary distribution channel: Chrome Web Store
Listing type: Unlisted
Developer registration fee: paid
Manual archive distribution remains dev/QA-only after 1.0; staff distribution target is Chrome Web Store
```

Цель:

```text
подготовить расширение к проверке Chrome Web Store
сделать release package без dev/debug/private мусора
обеспечить понятное описание single purpose
обосновать permissions и host_permissions
подготовить privacy policy и staff install/update flow
```

Reusable checks before each upload:

```text
release packaging script / checklist
verify package excludes .git, docs/private, node_modules, temp archives, local samples
minimal permissions audit
minimal host_permissions audit
privacy policy draft and final text
permissions justification for Chrome Web Store dashboard
single purpose listing description
unlisted listing metadata
screenshots for popup/options/orders/Ozon warehouse flow
staff install/update instructions
review notes: extension is not officially affiliated with Ozon or Amperkot unless separately approved
check no remote code, eval, CDN scripts or dynamic code loading
release-specific smoke checklist and automated baseline recorded
plan for Google review feedback / resubmission
```

Risk notes:

```text
order data and admin page access must be described honestly
Ozon helper must be described as local workflow automation, not official Ozon endorsement
broad host permissions increase review risk; keep them narrow
notifications/alarms/tabs/storage permissions must be justified by visible user-facing features
```

## 1.0 RC ✅ historical smoke passed

RC checklist result:

```text
historical npm test baseline passed: 242 pass / 0 fail
manual smoke checklist passed by user
popup/options/orders pages verified
startup/recovery/catch-up behavior verified
deep sync and page return to page 1 verified
diagnostic log/export verified
Ozon/warehouse flow verified by smoke
release packaging candidate verified without .git, docs/private, node_modules or temp archives
Chrome Web Store submission work was completed for the initial release
```

Post-1.0 / CWS feedback cleanup candidates:

```text
Ozon operation lock for simultaneous warehouse tabs
compact Ozon debug payload policy
release packaging script
Chrome Web Store listing/privacy/permissions docs
small UI text polish if user requests
```

---

## 1.0 Stable Monitoring Release ✅ published foundation

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
```
