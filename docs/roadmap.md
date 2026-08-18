# tab_wanderer — Roadmap

## Current stable release

```text
Version: 1.0.4
Chrome Web Store: published / Unlisted
Commit: cd7d8e2
Tag: v1.0.4
Release baseline: 322 pass / 0 fail
```

## Published 1.0.4.1 bugfix

Confirmed production incident on 26 July 2026:

- an automatically processed Ozon order sent a warehouse multi-barcode into the write flow;
- Ozon API accepted and verified it;
- visible DOM fallback had no reliable `product_item.type`, but bridge defaults converted the missing type and quantities into an eligible unit row.

Implemented bugfix scope:

- [x] only explicit `itemType === 0` is eligible;
- [x] missing type becomes `itemTypeUnknown` and is skipped;
- [x] visible DOM no longer invents type `0`, stock quantity `1` or reserved quantity `1`;
- [x] Angular metadata is resolved before DOM fallback and enriches DOM barcode candidates when available;
- [x] background imports the shared extractor and revalidates every manual/automatic write payload;
- [x] revalidation moves multi/unknown rows out of `eligibleBarcodes` before Ozon worker creation;
- [x] diagnostics store rejection counts and reasons without full warehouse payload;
- [x] UI groups unconfirmed barcode types separately;
- [x] regression coverage for the production-shaped multi-barcode case using synthetic identifiers;
- [x] automated baseline: 326 pass / 0 fail;
- [x] live smoke on a real order confirmed correct multi-barcode exclusion;
- [x] functional bugfix committed and pushed;
- [x] release metadata prepared as CWS build `1.0.4.1`;
- [x] exact-HEAD package published in Chrome Web Store;
- [x] no Git tag created: tags are reserved for substantial releases.

Submitted package:

```text
Commit: aa7daa1
SHA256: 221443df4eb1092a400cd522c700e530ff22a09a1dbaa9c1a518f00ee446e1a1
Baseline: 326 pass / 0 fail
Tag: intentionally omitted
```

## Current 1.0.4.3 patch candidate

Warehouse income/stock stability and browser-startup recovery:

- [x] persisted Warehouse stock city is requested during income-page initialization;
- [x] income-perform route is handled before the generic order-workflow guard, so stock config loading cannot be skipped;
- [x] duplicate income-page bridge initialization is harmless and does not create duplicate config state;
- [x] product title is shown before product ID in the stock panel;
- [x] storage API quantity is interpreted as physical quantity and `reserved_quantity` is subtracted;
- [x] storage rows with `quantity - reserved_quantity <= 0` are hidden;
- [x] production-loaded `core/warehouse-stock-view-model.js` uses the available-quantity formula;
- [x] existing main worker tab is given a restore grace period after browser startup before a replacement is created;
- [x] startup reconciliation still adopts one valid worker and removes orphan workers;
- [x] city diagnostics cannot abort Warehouse/Ozon initialization;
- [x] Ozon/Warehouse initialization is not blocked by the income-page route classification;
- [x] automated baseline: `359 pass / 1 known fail`;
- [x] live smoke confirms city restoration, available stock calculation and worker reuse;
- [ ] finish multi-product income selection/replacement behavior;
- [ ] commit and push release-prep;
- [ ] build final CWS package from exact HEAD;
- [ ] submit without Git tag.

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
- Split Ozon and warehouse bridge logic into smaller testable modules and remove the near-duplicate read/write bridge implementations.
- Replace known-order insertion-order retention with explicit `lastSeenAt`/LRU semantics.
- Apply barcode chunking in the UI write path and aggregate verification per chunk.
- Rename ambiguous apply result `ok` into explicit `completed`/`success` fields through a backward-compatible migration.
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
