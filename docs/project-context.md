# tab_wanderer — Project Context Contract

Актуально на момент: release candidate `1.0.3` — Ozon verification hardening.

Этот документ заменяет старые message/handoff тексты и используется как living document для переноса контекста между чатами. Если загружен актуальный архив кода, код из архива является источником истины по реализации.

---

## 1. Project Status

```text
Проект: tab_wanderer
Назначение: Chrome extension для мониторинга заказов в Amperkot + warehouse/Ozon barcode action layer
Текущая стадия: 1.0.3 release candidate — Ozon verification hardening
Manifest version: 1.0.3
Tests: 264 pass / 0 fail
Latest checkpoint: reconcile stale Ozon apply state with fresh recheck + reason-aware skipped barcode UI
Release-preparation base: 107afcc
Branch: main
Repo: DonutWithCoffee/tab_wanderer
```

Chrome Web Store state:

```text
1.0.1: published
1.0.2: published (Unlisted) from f6664c6
1.0.3: package prepared; upload/review/publication are not confirmed
Published 1.0.2 package SHA256: 46971aa963497ced32f13ec9e652235f24d1673dcb39f1a5245c036a44ee93de
Prepared 1.0.3 package SHA256: ac473b773459fd30bc912c55fcdab22ec4c930fe6860eb86109e4f61bf795bd4
```

Roadmap position:

```text
0.9.x foundation and stabilization ✅
1.0.0 stable release ✅ published
1.0.1 monitoring/UI patch ✅ published
1.0.2 UI clarity patch ✅ published
1.0.3 Ozon verification hardening ✅ package prepared
1.0.3 manual smoke / CWS upload ⏳ pending
```

Important release invariant:

```text
The published 1.0.2 package was built from f6664c6.
Its annotated v1.0.2 tag must point to f6664c6 even though main has moved forward.
The Ozon hardening is packaged as 1.0.3 and must receive its own release commit and tag.
```

---

## 2. Communication / Development Contract

Preferred style:

```text
Russian language
engineer-to-engineer
brief but complete
analysis → solution → code/artifact/commands
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
coherent controlled slices
avoid unrelated refactor
prefer 1–3 files per implementation step when practical, but allow larger LOC when one behavior needs it and risk stays controlled
commit coherent behavior/refactor slices, not half-finished work
provide archives with full replacement files only, not full project archives
avoid .patch/.diff artifacts
ask for a fresh archive/files only when current code context is unavailable, stale or unsafe to continue from
```

Git workflow:

```text
User works in VS Code integrated Git Bash on Windows.
Repo: DonutWithCoffee/tab_wanderer
Branch: main
Tests before commit: npm test for code/test changes
Docs/version/checklist-only slices: no npm test and commit/push immediately with explicit file list
Always provide explicit git add file list and Conventional Commit message when commit is appropriate
Never use git add .
Do not commit/push unless user asks or confirms.
```

Standard commit commands:

```bash
git status
npm test
git diff --stat
git diff --name-status
git add <explicit-file-list>
git diff --cached --stat
git commit -m "type(scope): short summary"
git push
```

---

## 3. Product Vision

Плагин удерживается в более узкой продуктовой рамке:

```text
tab_wanderer = уведомления о новых/изменённых заказах + отслеживаемые заказы с напоминаниями + Ozon/warehouse модуль штрихкодов
```

Плагин решает бизнес-задачи:

```text
1. Отслеживать появление новых заказов.
2. Отслеживать изменения известных заказов.
3. Делать мониторинг глубже первой страницы.
4. Показывать информативные desktop-уведомления по заказам.
5. Позволять сотруднику быстро управлять уведомлениями.
6. Позволять сотруднику отслеживать конкретные заказы.
7. Давать одноразовые напоминания по отслеживаемым заказам.
8. Давать диагностический лог для удалённой поддержки.
9. Сохранять стабильность при reload/restart браузера.
10. Автоматизировать безопасную привязку warehouse barcodes в Ozon как отдельный action layer.
11. Распространять стабильную 1.0+ сборку через Chrome Web Store Unlisted listing.
12. В будущем — централизовать сбор событий.
```

User-facing order history/order lookup is not part of 1.0 product focus.
The code may keep eventJournal/order lookup as internal diagnostic/foundation, but the UI should not sell it as a reliable server-side order history.

Важное ограничение:

```text
tab_wanderer не является серверной историей заказов.
Он показывает только изменения, обнаруженные локальным экземпляром расширения во время наблюдения.
```

---

## Chrome Web Store release readiness

Решение по дистрибуции:

```text
Primary channel: Chrome Web Store
Listing: Unlisted
Developer registration fee: paid
Manual archive installs remain dev/QA-only
```

Chrome Web Store submission tasks:

```text
release package/checklist
privacy policy
permissions and host_permissions audit
Chrome Web Store permissions justification
single purpose listing description
screenshots
staff install/update instructions
release-specific smoke checklist and automated baseline
review feedback/resubmission plan
```

Review-risk notes:

```text
заказы и админка = business/user data, это нужно честно описать
Ozon helper не должен выглядеть как официально одобренный Ozon продукт
host_permissions должны быть узкими и объяснимыми
remote code / eval / CDN scripts недопустимы для release package
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
warehouse/Ozon action layer
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
новую domain logic постепенно выносить из background.js/content.js
warehouse/Ozon action layer не должен ломать monitor worker semantics
не сохранять Ozon cookies/tokens/auth/session данные
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

Direct follow-up worker:

```text
separate marker: #tab_wanderer_direct_worker=1
используется только для watched orders
открывает конкретную карточку заказа по direct URL
парсит detail page отдельно от list parser
закрывается после проверки
```

Ozon worker:

```text
separate marker: #tab_wanderer_ozon_worker=1
используется только для Ozon preview/apply action layer
открывается inactive/background
не должен забирать фокус со складской вкладки
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
periodic collection через ?page=N
каждые 5 минут
по умолчанию до 50 pages
safe configurable range: 1–50
```

Stop/completion:

```text
pagination-last-page
pagination-single-page
empty-first-page для scope без заказов
deep-sync-page-limit
advance-attempt-limit / timeout protection
```

Важное правило:

```text
empty page не является нормальным stop condition для валидной глубокой страницы admin orders.
empty first page при выбранном scope считается корректным завершением без заказов.
```

---

## 9. Monitor Modes

```text
windowed
→ page 1 fast poll + periodic deep sync

active
→ page 1 only, без deep sync
```

---

## 10. Event / Notification Model

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

Suppressors:

```text
ignoreLegalEntityPayment
ignoreOzon
```

Rules:

```text
tag-only changes write local history but do not create desktop notifications
suppressors suppress notifications only
new/changed trigger settings do not block state update/history
startup/recovery catch-up records state safely without notification flood
```

---

## 11. Order Lookup / Watched Orders

Current product model:

```text
history page по пользовательскому смыслу = “Заказы” page
no broad timeline
search by full orderId or 4-digit short number
multiple candidates shown before selection
selected order shows local detected changes only
watched orders managed on Orders page
popup only adds watched order by full orderId
Options links to Orders page instead of managing watchlist directly
Options manages direct follow-up interval for watched orders
```

Direct follow-up:

```text
first successful direct observation = direct baseline without notification
subsequent direct changes = eventJournal + optional notification
tag-only direct changes = history/event only, no notification
direct changes update knownOrdersDB
direct follow-up state is separate from list-state
direct follow-up interval is configurable in Options: 2 / 5 / 10 / 15 / 30 minutes; default is 2
per-order follow-up can be disabled while keeping the saved order, comment and reminder
```

---

## 12. Ozon / Warehouse Contract

Current stable behavior:

```text
warehouse page gets barcode preview without reload after “Собрать заказ”
already assembled orders get initial barcode preview on page open
panel is collapsed by default
panel expands/collapses on click
button “Список ШК” shows selectable barcode list grouped by product
button “Проверить штрихкоды” previews Ozon state without writing
button “Записать в Ozon” writes missing barcodes
Ozon worker opens inactive/background
multi-barcode warehouse rows are skipped automatically
skipped rows are grouped by actual reason; only multiBarcodeType rows are labeled “Мультиштрихкоды”
```

Ozon API contract:

```text
Amperkot product ID = Ozon offer/article for search
Ozon product search URL = https://seller.ozon.ru/app/products?search=<productId>
Ozon write endpoint = POST /api/barcode-add-v2
write payload shape = { seller_id, barcodes: [{ barcode, item_id }] }
item_id = Ozon SKU / ozonSku
post-write verify endpoint = POST /api/sc/barcode-details-by-item-id
verify payload shape = { item_id: ["<ozonSku>"] }
verify response source = response.barcodes[].barcode
```

Source priority:

```text
Warehouse source priority:
1. captured warehouse API response with usable barcode snapshot
2. visible DOM fallback if API barcode snapshot is empty/unusable

Ozon preview/check priority:
1. barcode details API
2. drawer/DOM fallback

Ozon write verify priority:
1. barcode details API
2. drawer/DOM fallback
3. UI fallback if API write/verify cannot confirm
```

Security/privacy:

```text
Do not store Ozon cookies/tokens/auth/session data.
Do not export raw HTML, cookies, tokens or full private order payloads to diagnostic logs.
Debug helpers are allowed in page memory, but should stay compact.
```

---

## 13. Current Module Layout

Core modules:

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

Main runtime files:

```text
background.js
content.js
warehouse-barcode-bridge.js
ozon-product-bridge.js
popup.js
options.js
watched-orders.js
notification-rules.js
```

Current refactor status:

```text
warehouse/Ozon view model extracted
Ozon apply result helpers extracted
Ozon session utility helpers extracted
Ozon warehouse result messaging extracted
background.js still owns monitor lifecycle and Ozon worker/session lifecycle
content.js still owns DOM rendering and runtime messaging
```

---

## 14. Tests

Current baseline:

```text
npm test → 264 pass / 0 fail
```

Important suites:

```text
tests/background-core.test.js
tests/background-process.test.js
tests/content-parser.test.js
tests/warehouse-barcode-extractor.test.js
tests/warehouse-barcode-bridge.test.js
tests/ozon-product-search.test.js
tests/ozon-barcode-binding.test.js
tests/ozon-product-bridge.test.js
tests/popup-ui.test.js
tests/options-ui.test.js
tests/watched-orders-ui.test.js
```

Ozon state regressions now covered:

```text
unconfirmed apply → fully confirmed recheck
unconfirmed apply → authoritative partial/missing recheck
stale apply error → successful current recheck
resolve error remains red and retryable
skipped rows are grouped by multi-barcode / non-unit / duplicate / missing-data reason
```

---

## 15. Current Product Priority

Current task family:

```text
1.0.3 Ozon verification hardening release
```

Decisions:

```text
Manifest and popup release notes are set to 1.0.3.
Do not treat the 1.0.3 release candidate as the published 1.0.2 package.
No permission, host permission or data handling expansion.
Full Ozon session controller extraction remains paused.
Legal-department-specific workflow remains postponed until real QA.
```

Immediate roadmap:

```text
1. Apply and locally verify the 1.0.3 release archive.
2. Commit/push the version, release notes, tests and synced docs after green verification.
3. Manual smoke the Ozon retry/recheck transitions and skipped reason labels.
4. Verify/create annotated v1.0.2 on f6664c6 if it is still missing.
5. Upload the prepared 1.0.3 runtime package and reviewer note.
6. Record the final release commit and published package state.
7. Create annotated v1.0.3 only after publication is confirmed.
```

Reminder model remains:

```text
one active pending one-time reminder per watched order
optional note
pending reminder can be cleared
follow-up interval is configured on the watched-orders page
triggered reminder becomes done
no recurring reminders in the MVP
```
