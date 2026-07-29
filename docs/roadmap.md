# tab_wanderer — Roadmap

## Current stable release

```text
Version: 1.0.4
Chrome Web Store: published / Unlisted
Commit: cd7d8e2
Tag: v1.0.4
Release baseline: 322 pass / 0 fail
```

## Current 1.0.4.1 bugfix submission

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
- [x] exact-HEAD package submitted to Chrome Web Store review;
- [x] no Git tag created: tags are reserved for substantial releases.

Submitted package:

```text
Commit: aa7daa1
SHA256: 221443df4eb1092a400cd522c700e530ff22a09a1dbaa9c1a518f00ee446e1a1
Baseline: 326 pass / 0 fail
Tag: intentionally omitted
```

## Current post-1.0.4.1 development

Automatic read-only verification for already assembled Ozon orders:

- [x] wait for a confirmed `ozon` order kind;
- [x] wait for a non-empty eligible warehouse barcode snapshot;
- [x] debounce the first accepted snapshot before starting the check;
- [x] run the existing Ozon resolve/preview flow exactly once per document/order;
- [x] keep the check independent from `ozonAutoBarcodeApplyEnabled`;
- [x] skip multi-barcodes and unconfirmed types through the shared fail-closed extractor;
- [x] suppress the read check when a pending automatic write intent must take precedence;
- [x] ignore delayed resolve results from another warehouse document instance;
- [x] keep manual recheck available;
- [x] operation owner/token prevents resolve/apply from sharing or closing another session worker;
- [x] automatic read checks queue behind writes with deduplication, TTL and bounded retry;
- [x] writes preempt automatic reads safely and resume them after completion;
- [x] pending write claim closes the async persistence race before worker acquisition;
- [x] coercive `itemType` values (`false`, arrays, objects, hex) fail closed; quantity/reserved/stock values are preserved only as diagnostics and do not define barcode unit type;
- [x] warehouse payload product/row/string limits are checked before worker creation;
- [x] reused XHR capture uses one-shot `loadend` listeners;
- [x] confirmed unit `itemType === 0` remains eligible when Warehouse quantity/reserved/stock metadata is `0`, greater than `1` or reflects stock rather than barcode multiplicity;
- [x] automated baseline: 340 pass / 0 fail;
- [x] live smoke on an already assembled Ozon order;
- [x] live smoke on a newly scanned `1/1` unit barcode with warehouse stock metadata greater than one;
- [ ] one consolidated feature/fix/docs commit and push.

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
