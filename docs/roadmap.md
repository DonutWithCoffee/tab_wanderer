# tab_wanderer — Roadmap

## Current stable release

```text
Version: 1.0.3
Chrome Web Store: published / Unlisted
Commit: f496d36
Tag: v1.0.3
Release baseline: 264 pass / 0 fail
```

## Current unpublished development

Base commit before full hardening:

```text
981a9b5 feat: improve extension updates and legal-only filters
```

Current integrated hardening:

- [x] legal-only mode overrides both hide filters;
- [x] downloaded CWS update applies at a safe moment;
- [x] trusted-user requirement for Ozon write;
- [x] initialization barrier for MV3 worker;
- [x] serialized/coalesced storage writes;
- [x] alarm-based watchdog/direct/storage maintenance;
- [x] startup reconciliation and orphan worker cleanup;
- [x] known-order and notification-target retention;
- [x] storage usage/error diagnostics;
- [x] canonical Amperkot URLs and strict marker origin checks;
- [x] shared Ozon/legal classifier;
- [x] page-world Ozon resolver separated from isolated-world writer;
- [x] Ozon capture endpoint/size/content-type filtering;
- [x] warehouse fallback scan budget;
- [x] storage access restricted to trusted extension contexts;
- [x] `tabs` permission removed;
- [x] lifecycle/security/performance regression tests;
- [x] project documents synchronized.

Current automated baseline:

```text
290 pass / 0 fail
```

No version bump and no CWS package are part of this work.

## Before the next release

- [ ] Apply replacement files to a clean local project.
- [ ] Run the full automated suite.
- [ ] Complete manual smoke from `docs/smoke-checklist.md`.
- [ ] Verify worker creation/adoption without `tabs` permission.
- [ ] Verify automatic update flow on a real CWS transition when a future version exists.
- [ ] Collect enough user-facing improvements for a meaningful patch.
- [ ] Only then choose the next version and prepare release notes/package.

## Candidate product improvements

### High value / low risk

- Show a compact “last successful check” and “last update applied” timestamp in popup.
- Add a one-click “copy support summary” without order payloads.
- Warn in Options when storage usage approaches a configurable threshold.
- Add a user-visible reason when monitoring is warming/recovering.
- Add manual “check this watched order now” action.
- Add result history for the latest Ozon barcode operation without technical fallback strings.

### Medium term

- Move large known-order state to a more compact schema or IndexedDB if retention becomes insufficient.
- Split `background.js` into lifecycle/storage/monitor/direct/Ozon orchestration modules.
- Split Ozon and warehouse bridge logic into smaller testable modules.
- Add browser-level Playwright/Puppeteer smoke harness with fixture pages.
- Add schema version and explicit storage migrations.
- Add support bundle export with manifest/version, diagnostics, alarms and storage counters.

### Product expansion

- Optional central collector/aggregator for multiple branches.
- Configurable department profiles instead of hardcoded schedules.
- Managed enterprise deployment policy documentation.
- Firefox port only after Chrome behavior is stable and API gaps are reviewed.

## Deferred or rejected

- No remote code.
- No analytics by default.
- No new external service without an explicit product/privacy decision.
- No broad “server-like history” claim for local eventJournal.
- No periodic `requestUpdateCheck()` polling.
- No `unlimitedStorage` until the data model is measured and optimized.
