# tab_wanderer — Roadmap

## Current stable release

```text
Version: 1.0.4
Chrome Web Store: published / Unlisted
Commit: cd7d8e2
Tag: v1.0.4
Release baseline: 322 pass / 0 fail
```

## Current 1.0.5 hotfix development

Confirmed production incident on 26 July 2026:

- an automatically processed Ozon order sent a warehouse multi-barcode into the write flow;
- Ozon API accepted and verified it;
- visible DOM fallback had no reliable `product_item.type`, but bridge defaults converted the missing type and quantities into an eligible unit row.

Implemented hotfix scope:

- [x] only explicit `itemType === 0` is eligible;
- [x] missing type becomes `itemTypeUnknown` and is skipped;
- [x] visible DOM no longer invents type `0`, stock quantity `1` or reserved quantity `1`;
- [x] Angular metadata is resolved before DOM fallback and enriches DOM barcode candidates when available;
- [x] background imports the shared extractor and revalidates every manual/automatic write payload;
- [x] revalidation moves multi/unknown rows out of `eligibleBarcodes` before Ozon worker creation;
- [x] diagnostics store rejection counts and reasons without full warehouse payload;
- [x] UI groups unconfirmed barcode types separately;
- [x] regression coverage for the production-shaped multi-barcode case using synthetic identifiers;
- [x] automated baseline: 326 pass / 0 fail.

Release path:

- [ ] Apply and live-test the hotfix replacement files while auto-add is disabled on affected installations.
- [ ] Commit and push the functional hotfix without version bump.
- [ ] Build a fresh HEAD archive.
- [ ] Prepare release 1.0.5 metadata and popup notes.
- [ ] Run final automated and Chrome smoke tests.
- [ ] Build and verify exact CWS package SHA256.
- [ ] Submit 1.0.5 as bugfix-only, without permission/data-handling changes.
- [ ] Create tag `v1.0.5` only after confirmed publication.

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
