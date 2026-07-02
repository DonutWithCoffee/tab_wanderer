# AGENTS.md — tab_wanderer

## Project

`tab_wanderer` is a local-first Chrome extension for Amperkot admin order monitoring plus a separate warehouse/Ozon barcode action layer.

Read first:

```text
docs/codex-handoff.md
docs/project-context.md
docs/roadmap.md
docs/smoke-checklist.md
readme.md
```

## Current checkpoint

```text
Manifest version: 0.9.9
Build checkpoint: 0.9.9.9-docs
Expected tests: 201 pass / 0 fail
Last known clean HEAD: d270841 chore: ignore local diff artifacts
```

## Working rules

- Communicate with the user in Russian.
- Start with analysis, then solution, then code/commands.
- Do not change code before inspecting the relevant current files.
- Keep changes small and coherent.
- Prefer 1–3 files per implementation slice when practical.
- Avoid unrelated refactors.
- Do not commit or push unless the user explicitly asks.
- Never use `git add .`; stage explicit files only.
- Do not add `.diff`, `.patch`, temporary zip archives, or `docs/private/` to commits.
- Run `npm test` after changes.

Recommended verification before commit:

```bash
git diff --check
npm test
git status
git diff --stat
git diff --name-status
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
API response is preferred only when it contains usable barcode data.
If API shop_order has no barcode candidates, visible DOM fallback is expected.
Post-write verify must read the full drawer barcode list.
UI fallback must remain available if API write or verify fails.
Multi-barcode warehouse rows are skipped automatically and surfaced as “Пропущено мультишк”.
```
