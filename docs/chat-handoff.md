# tab_wanderer — Chat Handoff

Цель: быстро восстановить контекст проекта в новом чате и продолжить работу без потери архитектурных правил, рабочего метода и текущего состояния.

---

## 1. Current Known State

```text
Repo: DonutWithCoffee/tab_wanderer
Branch: main
Manifest version: 1.0.3
Published release: 1.0.2 (Chrome Web Store / Unlisted)
Published 1.0.2 source HEAD: f6664c6 chore: prepare release 1.0.2
Release-preparation base: 107afcc fix: harden Ozon barcode verification states
Development state: 1.0.3 release candidate — Ozon verification hardening
Prepared 1.0.3 package SHA256: ac473b773459fd30bc912c55fcdab22ec4c930fe6860eb86109e4f61bf795bd4
Expected tests for the current archive: 264 pass / 0 fail
Distribution: Chrome Web Store / Unlisted
```

Current behavior checkpoint:

```text
fresh Ozon recheck overrides stale write/verify UI state
unconfirmed write becomes green only after all expected barcodes are found
partial recheck keeps a red retryable state with an exact verified/missing count
successful recheck clears stale operation errors and uses current Ozon state
skipped warehouse rows are grouped by actual reason
“Мультиштрихкоды” is shown only for multiBarcodeType rows
technical fallback reasons remain diagnostic-only
permissions, host_permissions and data handling are unchanged
```

Release distinction:

```text
1.0.1 and 1.0.2 are confirmed published.
The published 1.0.2 package is tied to f6664c6 and must keep that release identity.
The Ozon state-consistency hardening is intentionally released as 1.0.3 rather than rewriting 1.0.2.
The prepared 1.0.3 package has not yet been confirmed uploaded, approved or published.
```

---

## 2. First Commands In A New Local Session

```bash
git pull --ff-only origin main
git status
git log --oneline -8
npm test
```

Expected after the current archive is applied and committed:

```text
working tree clean
HEAD is the 1.0.3 release commit based on 107afcc or newer
manifest is 1.0.3
npm test → 264 pass / 0 fail
```

If dependencies are missing:

```bash
npm install
npm test
```

---

## 3. Files To Read First

```text
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
Do not invent current code; inspect available files or ask for archive only when needed.
Do not silently continue from stale memory if files changed.
Keep implementation slices coherent and controlled.
Prefer 1–3 files per slice when practical, but larger LOC is acceptable when it keeps one behavior together and does not increase regression risk.
Request a fresh project archive only when current code context is missing, stale or unsafe to continue from.
For implementation work, provide an archive with full replacement files only, not a full project archive and not patch files.
Do not send raw code snippets unless the user explicitly asks.
When tests are green and a commit is appropriate, always provide commit commands.
For docs/version/checklist-only slices, skip npm test and provide commit/push commands immediately.
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
Skipped rows are grouped by actual reason; “Мультиштрихкоды” is used only for multiBarcodeType.
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
Do not start full Ozon session controller extraction unless it becomes an explicit priority.
The active next step is local verification, manual Ozon smoke and Chrome Web Store submission of 1.0.3.
```

---

## 8. Current Product Priority

Product frame:

```text
tab_wanderer = локальный мониторинг заказов + отслеживаемые заказы/напоминания + warehouse/Ozon helper
```

Current priority:

```text
ship the completed Ozon consistency hardening as patch release 1.0.3
manually smoke the recheck transitions and reason-aware skipped barcode UI
keep published 1.0.2 tied to f6664c6 and tag that exact commit if the tag is still missing
avoid permission, host permission and data handling changes in patch releases
```

Release rule:

```text
The annotated v1.0.2 tag must point to the exact published package source HEAD f6664c6.
Never move v1.0.2 to the newer hardening commit.
Create the v1.0.3 tag only after the final 1.0.3 package is confirmed published, and point it to the exact release commit.
```

---

## 9. Recommended Next Work

Recommended order:

```text
1. Apply the 1.0.3 replacement-file archive.
2. Run npm test, git status and git diff --stat.
3. Commit and push the release-preparation slice only after green local verification.
4. Smoke warehouse/Ozon flows:
   - unconfirmed write → successful recheck
   - unconfirmed write → partial/missing recheck
   - stale operation error → current successful recheck
   - true multi-barcode vs duplicate/non-unit skip labels
5. Verify/create annotated v1.0.2 on f6664c6 if it is still missing.
6. Upload tab_wanderer_cws_package_1.0.3.zip with the prepared reviewer note.
7. Create v1.0.3 only after publication is confirmed.
```

Avoid:

```text
Large background.js rewrite without a focused reason.
Mixing Ozon action code into order-monitor semantics.
Changing permissions/host_permissions in a small patch without a separate review decision.
Tagging a release from a HEAD that differs from the package actually published.
Centralized collector work before the local extension remains stable.
Storing Ozon auth/session data.
Committing private admin samples or temporary archives.
```

---

## 10. Chrome Web Store Release Readiness

Current release state:

```text
Distribution channel: Chrome Web Store
Listing type: Unlisted
1.0.1: published
1.0.2: published from f6664c6
1.0.3 package: prepared from release-preparation base 107afcc
1.0.3 package SHA256: ac473b773459fd30bc912c55fcdab22ec4c930fe6860eb86109e4f61bf795bd4
1.0.3 upload/review/publication: not confirmed
```

Reusable pre-upload checks:

```text
release package excludes .git, tests, docs, node_modules, temp archives and local samples
manifest version matches the intended release
permissions and host_permissions are unchanged unless explicitly approved
no remote code, eval, CDN scripts or dynamic executable loading
privacy policy matches local-first behavior
single-purpose listing text stays accurate
reviewer note states whether permissions/data handling changed
SHA256 and runtime file count are recorded
npm test baseline is recorded
```

Published 1.0.2 package:

```text
Source HEAD: f6664c6
SHA256: 46971aa963497ced32f13ec9e652235f24d1673dcb39f1a5245c036a44ee93de
Runtime files: 35
Automated baseline: 259 pass / 0 fail
```

Prepared 1.0.3 package:

```text
Release-preparation base: 107afcc
SHA256: ac473b773459fd30bc912c55fcdab22ec4c930fe6860eb86109e4f61bf795bd4
Runtime files: 35
Automated baseline: 264 pass / 0 fail
Permissions: unchanged
Host permissions: unchanged
Data handling: unchanged
Remote code scan: clean
```
