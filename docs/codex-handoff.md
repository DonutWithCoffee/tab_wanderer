# tab_wanderer — Codex Handoff

Цель: быстро восстановить контекст проекта на другом компьютере и продолжить работу через локального code agent / Codex без потери архитектурных правил.

---

## 1. Current Known State

```text
Repo: DonutWithCoffee/tab_wanderer
Branch: main
Manifest version: 0.9.9
Build checkpoint: 0.9.9.9-docs
Last known clean HEAD: d270841 chore: ignore local diff artifacts
Previous feature commit: 03d567a feat(ozon): refresh warehouse barcodes without page reload
Tests: 201 pass / 0 fail
Working tree expected: clean
```

Recent feature slice:

```text
feat(ozon): refresh warehouse barcodes without page reload
```

Behavior now:

```text
после warehouse “Собрать заказ” не делаем page reload
сначала используем captured warehouse API response
если API shop_order не даёт barcode-кандидатов, используем visible DOM fallback
manual “Проверить штрихкоды” оставлена последней кнопкой для старых заказов
“Обновить склад” удалена
“Пропущено” переименовано в “Пропущено мультишк”
Ozon worker tab открывается в фоне
Ozon write идёт через /api/barcode-add-v2 с drawer verify и UI fallback
```

---

## 2. First Commands On Home Computer

```bash
git pull --ff-only origin main
git status
git log --oneline -5
npm test
```

Expected:

```text
working tree clean
latest commits include:
  d270841 chore: ignore local diff artifacts
  03d567a feat(ozon): refresh warehouse barcodes without page reload
npm test → 201 pass / 0 fail
```

If dependencies are missing:

```bash
npm install
npm test
```

---

## 3. Files To Read First

```text
AGENTS.md
readme.md
docs/project-context.md
docs/roadmap.md
docs/smoke-checklist.md
```

For Ozon/warehouse work, also inspect:

```text
content.js
warehouse-barcode-bridge.js
ozon-product-bridge.js
core/warehouse-barcode-extractor.js
core/ozon-product-search.js
core/ozon-barcode-binding.js
tests/warehouse-barcode-bridge.test.js
tests/warehouse-barcode-extractor.test.js
tests/ozon-product-bridge.test.js
tests/ozon-product-search.test.js
tests/ozon-barcode-binding.test.js
```

---

## 4. Development Rules For Codex / Agent

```text
Russian communication with user.
Start with analysis, then solution, then code/commands.
Do not write code before understanding current files.
Do not invent current code. If unsure, inspect files or ask for archive.
Keep changes small and coherent.
Prefer 1–3 files per patch when practical.
Avoid broad refactor unless explicitly requested.
Run npm test after changes.
Never use git add . for commits.
Provide explicit git add file list.
Do not commit or push unless user asks.
Do not include .diff/.patch/temp archives in commits.
Do not touch docs/private/.
```

Commit workflow:

```bash
git diff --check
npm test
git status
git diff --stat
git diff --name-status
```

Then, only after user confirms:

```bash
git add <explicit-file-list>
git commit -m "type(scope): short summary"
git push origin main
```

---

## 5. Architecture Rules That Must Not Be Broken

```text
monitorScope decides what the monitor physically collects
notificationTriggers decide which events notify
notificationSuppressors suppress notifications only
rules must not block state update/history
startup catch-up must not create notification flood
worker is identified by marker + tabId
never reuse arbitrary admin tab by URL
knownOrdersDB is long-term local memory
windowOrdersDB is current observed list window
direct follow-up state must not overwrite richer list-state
Chrome APIs stay on edges where practical
pure/domain logic belongs in core modules
```

Ozon/warehouse-specific rules:

```text
Ozon barcode binding is action layer, not list-monitor collection logic.
Do not store Ozon cookies/tokens/auth data.
Ozon worker tab must open inactive/background.
Warehouse “Собрать заказ” must not reload the page.
API response is preferred only when it contains usable barcode data.
If API shop_order is empty for barcodes, visible DOM fallback is valid and expected.
Post-write verify must read the full drawer barcode list.
UI fallback must remain available if API write/verify fails.
```

---

## 6. Current Ozon Live Contract

```text
Amperkot product ID = Ozon offer/article for search
Ozon product search URL = https://seller.ozon.ru/app/products?search=<productId>
Ozon write endpoint = POST /api/barcode-add-v2
payload shape = { seller_id, barcodes: [{ barcode, item_id }] }
success can be { "errors": [] }
item_id = Ozon SKU / ozonSku
seller_id is captured from current Ozon Seller UI session/headers/state
```

Warehouse source priority:

```text
1. captured API response api.response.shop_order with usable barcode snapshot
2. visible DOM product cards if API barcode snapshot is empty
3. manual “Проверить штрихкоды” for old assembled orders
4. no reload in normal flow
```

---

## 7. Recommended Next Work

Safe next slices:

```text
1. Commit this documentation sync.
2. Manual smoke checklist for warehouse/Ozon flow from docs/smoke-checklist.md.
3. Small cleanup: suppress expected runtime.lastError noise around tab messaging if still visible.
4. Ozon panel wording/diagnostic polish.
5. Product requirement: configurable minimum/base product price threshold before automatic barcode binding.
6. Final Pre-1.0 UI/UX polish and 1.0 RC checklist.
```

Avoid next:

```text
large rewrite of background.js
mixing Ozon action code into order-monitor semantics
centralized collector before local 1.0 is stable
storing auth/session data
```
