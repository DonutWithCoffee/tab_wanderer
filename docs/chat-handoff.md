# tab_wanderer — Chat Handoff

Цель: быстро восстановить контекст проекта в новом чате и продолжить работу без потери архитектурных правил, рабочего метода и текущего состояния.

---

## 1. Current Known State

```text
Repo: DonutWithCoffee/tab_wanderer
Branch: main
Manifest version: 0.9.9
Stage: Pre-1.0, docs sync after stable Ozon/warehouse barcode flow and refactor cleanup
Latest pushed checkpoint: 1466ec1 refactor(ozon): extract warehouse result messaging
Expected tests: 214 pass / 0 fail
Working tree expected: clean
```

Recent important commits:

```text
0c5c09e fix(ozon): verify barcode binding through barcode details API
0c19488 feat(warehouse): add collapsible barcode preview panel
5b9dfa1 refactor(warehouse): extract Ozon preview view model
d9c38f9 refactor(ozon): extract UI apply result helpers
9f75fe1 refactor(ozon): use extracted apply result helpers
d1eb0d3 refactor(ozon): extract session utility helpers
1466ec1 refactor(ozon): extract warehouse result messaging
```

---

## 2. First Commands In A New Local Session

```bash
git pull --ff-only origin main
git status
git log --oneline -8
npm test
```

Expected:

```text
working tree clean
latest commit includes:
  1466ec1 refactor(ozon): extract warehouse result messaging
npm test → 214 pass / 0 fail
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
background.js
warehouse-barcode-bridge.js
ozon-product-bridge.js
core/warehouse-barcode-extractor.js
core/warehouse-ozon-view-model.js
core/ozon-product-search.js
core/ozon-barcode-binding.js
core/ozon-ui-apply-result.js
core/ozon-session-utils.js
core/ozon-session-messaging.js
tests/content-parser.test.js
tests/background-core.test.js
tests/warehouse-barcode-bridge.test.js
tests/warehouse-barcode-extractor.test.js
tests/ozon-product-bridge.test.js
tests/ozon-product-search.test.js
tests/ozon-barcode-binding.test.js
```

---

## 4. Working Method With The User

```text
Language: Russian.
Style: direct engineer-to-engineer.
Default flow: analysis → solution → artifact/commands.
Prefer critical issues first.
Challenge risky or wrong assumptions.
Do not invent current code; inspect files or ask for archive.
Do not silently continue from stale memory if files changed.
Keep implementation slices small and coherent.
Prefer 1–3 files per slice when practical.
For implementation work, provide full-file archive, not patch files.
Do not send raw code snippets unless the user explicitly asks.
When tests are green and a commit is appropriate, always provide commit commands.
Never use git add .
Stage explicit files only.
Do not commit/push unless user asks or confirms.
```

User preferences:

```text
The user works in VS Code integrated Git Bash on Windows.
The user prefers terminal Git commands.
The user wants to learn, but does not want noisy low-level explanations during active coding.
The user wants compact checkpoints and exact commands.
The user may ask to commit/push after green tests; provide explicit commands then.
```

---

## 5. Architecture Rules That Must Not Be Broken

```text
monitorScope decides what the monitor physically collects.
notificationTriggers decide which events notify.
notificationSuppressors suppress notifications only.
Rules must not block state update/history.
Startup/recovery catch-up must not create notification flood.
Worker identity is marker + tabId, never URL alone.
Known state and current window state are separate.
Direct follow-up state must not overwrite richer list-state.
Chrome APIs stay on edges where practical.
Pure/domain logic belongs in core modules.
```

---

## 6. Current Ozon/Warehouse Contract

```text
Ozon barcode binding is an action layer, not list-monitor collection logic.
Warehouse “Собрать заказ” must not reload the page.
Already assembled warehouse orders must show initial barcode preview on page open.
Ozon worker tab opens inactive/background.
Do not store Ozon cookies/tokens/auth/session data.
Multi-barcode warehouse rows are skipped automatically.
Skipped rows are surfaced as “Пропущено мультиштрихов”.
Warehouse panel is collapsed by default.
The panel can show selectable barcode lists grouped by product.
```

Ozon API contract:

```text
Amperkot product ID = Ozon offer/article for search.
Ozon product search URL = https://seller.ozon.ru/app/products?search=<productId>
Ozon write endpoint = POST /api/barcode-add-v2
write payload shape = { seller_id, barcodes: [{ barcode, item_id }] }
item_id = Ozon SKU / ozonSku
seller_id is captured from current Ozon Seller UI session/headers/state.
post-write verify endpoint = POST /api/sc/barcode-details-by-item-id
verify payload shape = { item_id: ["<ozonSku>"] }
verify response source = response.barcodes[].barcode
```

Source priority:

```text
Warehouse:
1. captured API response with usable barcode snapshot
2. visible DOM fallback if API snapshot is empty or unusable

Ozon preview/check:
1. /api/sc/barcode-details-by-item-id
2. drawer/DOM fallback

Ozon write verify:
1. /api/sc/barcode-details-by-item-id
2. drawer/DOM fallback
3. UI fallback if API write/verify cannot confirm
```

---

## 7. Current Refactor Status

Done:

```text
warehouse/Ozon view-model extracted to core/warehouse-ozon-view-model.js
Ozon apply result helpers extracted to core/ozon-ui-apply-result.js
Ozon session utility helpers extracted to core/ozon-session-utils.js
Ozon warehouse result messaging extracted to core/ozon-session-messaging.js
background.js is lighter, but still owns worker/session lifecycle
content.js is lighter, but still owns DOM rendering/runtime messaging
```

Stop point:

```text
Do not start full Ozon session controller extraction unless it is the active priority.
The next priority after this cleanup is documentation sync / user-provided task.
```

---

## 8. Current Documentation Priority

Current priority:

```text
Bring documentation up to date.
Remove obsolete code-agent-specific references.
Keep docs useful for future ChatGPT sessions.
Document current workflow rules explicitly.
Record latest Ozon/warehouse stable state and refactor status.
Do not touch product code during docs cleanup unless necessary.
```

---

## 9. Recommended Next Work After Docs

Possible next slices:

```text
1. User-provided priority task.
2. If returning to refactor: introduce explicit Ozon operation lock for simultaneous warehouse tabs.
3. If returning to cleanup: limit Ozon debug payloads to compact summaries.
4. If preparing release: add release/package script that excludes .git, docs/private, node_modules and temporary archives.
5. If preparing 1.0 RC: run full smoke checklist from docs/smoke-checklist.md.
```

Avoid:

```text
Large background.js rewrite without a focused reason.
Mixing Ozon action code into order-monitor semantics.
Centralized collector before local 1.0 is stable.
Storing Ozon auth/session data.
Committing private admin samples or temporary archives.
```
