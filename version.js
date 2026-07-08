const VERSION = {
    version: '1.0.1',
    build: '1.0.1.0',
    stage: 'stable monitoring patch',
    date: '2026-07-08'
};

const CHANGELOG = {
    '0.9': 'stable release',
    '0.9.1': 'worker stability, reload fixes, UI improvements',
    '0.9.2': 'worker isolation, restart recovery, watchdog stability',
    '0.9.3': 'notification rules engine, notification click open, startup recovery hardening',
    '0.9.4': 'notification hardening complete, config layer base, normalization fixes, rebaseline on config change',
    '0.9.5': 'monitorScope config, URL-based filtering, config-driven worker, popup scope UI, normalization fixes',
    '0.9.6': 'monitorState, collection session, URL-driven pagination, fast/deep collection, known/window state, duplicate protection, timeout and retry-limit',
    '0.9.7': 'scope UX, notification triggers, order event model, event journal and history page foundation',
    '0.9.8': 'observability, diagnostic log retention/full export, manual-start catch-up, pagination completion, runtime consistency and core extraction',
    '0.9.9': 'orders page, watchlist/direct follow-up, reminders, options polish, diagnostics, startup catch-up suppression, startup guard hardening and warehouse/Ozon barcode QA',
    '1.0.0': 'stable monitoring release: local-first order monitoring, watched orders with reminders, diagnostics, Chrome Web Store icon metadata and warehouse/Ozon barcode helper',
    '1.0.1': 'monitoring patch: notify only about legal entity payment orders, toggle per-order follow-up and show local popup release notes without changing permissions or data handling'
};
