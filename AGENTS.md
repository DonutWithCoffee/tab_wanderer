# AGENTS.md — tab_wanderer

## Project

`tab_wanderer` is a local-first Chrome extension for Amperkot admin order monitoring plus a separate warehouse/Ozon barcode action layer.

Read first in new chats:

```text
docs/chat-handoff.md
docs/project-context.md
docs/roadmap.md
docs/smoke-checklist.md
readme.md
```

## Current checkpoint

```text
Manifest version: 0.9.9
Stage: Pre-1.0 docs sync after stable Ozon/warehouse barcode flow
Expected tests: 214 pass / 0 fail
Latest pushed checkpoint: 1466ec1 refactor(ozon): extract warehouse result messaging
Working tree expected: clean
```

## Communication rules

- Communicate with the user in Russian.
- Use direct engineer-to-engineer style.
- Start with analysis, then solution, then code/artifact/commands.
- Push back on risky assumptions; do not agree automatically.
- If current code is unknown or may be stale, ask for the relevant files or an archive before changing code.
- Do not provide raw code snippets unless the user asked for code in chat; prefer full-file archives for implementation slices.
- For full-file rewrites, provide only the final version, not before/after blocks.

## Development rules

- Keep changes small and coherent.
- Prefer 1–3 files per implementation slice when practical.
- Avoid unrelated refactors.
- Do not change code before inspecting relevant current files.
- Run `npm test` after changes.
- Always include explicit commit commands when tests are green and the slice is ready.
- Do not commit or push unless the user explicitly asks or confirms.
- Never use `git add .`; stage explicit files only.
- Do not add `.diff`, `.patch`, temporary zip archives, `.git/`, `node_modules/`, or `docs/private/` to commits.

Recommended verification before commit:

```bash
git status
npm test
git diff --stat
git diff --name-status
```

Commit pattern:

```bash
git add <explicit-file-list>
git diff --cached --stat
git commit -m "type(scope): short summary"
git push
```

## Architecture invariants

```text
monitorScope controls data collection.
notificationTriggers control desktop notification eligibility only.
notificationSuppressors suppress notifications only.
Rules must not block state updates or local history.
Startup/recovery catch-up must not flood notifications.
Worker tabs are identified by marker + tabId; never reuse arbitrary tabs by URL.
Chrome APIs stay at runtime edges where practical.
Pure/domain logic belongs in core/* modules.
```

## Ozon / warehouse invariants

```text
Ozon barcode binding is an action layer, not part of the main order monitor loop.
Do not store Ozon cookies, tokens, or auth/session data.
Ozon worker opens inactive/background.
Warehouse “Собрать заказ” must not reload the page.
Warehouse barcode preview must work on page open for already assembled orders.
API response is preferred only when it contains usable barcode data.
If API shop_order has no barcode candidates, visible DOM fallback is expected.
Manual “Проверить штрихкоды” uses Ozon barcode details API first.
Ozon write uses /api/barcode-add-v2.
Post-write verify uses /api/sc/barcode-details-by-item-id with item_id as an array.
Drawer/DOM verification remains fallback only.
UI fallback must remain available if API write or verify fails.
Multi-barcode warehouse rows are skipped automatically and surfaced as “Пропущено мультиштрихов”.
Warehouse panel is collapsed by default and can show selectable barcode lists.
```
