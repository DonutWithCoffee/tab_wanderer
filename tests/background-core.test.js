const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackgroundContext } = require('./helpers/load-extension-context');

test('buildOrdersUrl builds config-driven worker URL with query params and marker', () => {
    const context = loadBackgroundContext();

    const url = context.buildOrdersUrl(
        {
            status: ['6806', '6810'],
            delivery: ['9797'],
            payment: ['9791', '9793'],
            orderFlags: ['1'],
            store: ['4', '5416'],
            reserve: ['1'],
            assemblyStatus: ['partial', 'yes']
        },
        2
    );

    assert.equal(
        url,
        'https://amperkot.ru/admin/orders/?status%5B%5D=6806&status%5B%5D=6810&delivery%5B%5D=9797&payment%5B%5D=9791&payment%5B%5D=9793&flag%5B%5D=1&store%5B%5D=4&store%5B%5D=5416&reserve%5B%5D=1&assembly_status%5B%5D=partial&assembly_status%5B%5D=yes&page=2#tab_wanderer_worker=1'
    );
});

test('buildOrdersUrl omits page parameter for first page', () => {
    const context = loadBackgroundContext();

    const url = context.buildOrdersUrl({}, 1);

    assert.equal(
        url,
        'https://amperkot.ru/admin/orders/#tab_wanderer_worker=1'
    );
});

test('normalizeDateForHash keeps only the first date line for context normalization', () => {
    const context = loadBackgroundContext();

    const normalizedDate = context.normalizeDateForHash('30 мар. 2026 10:00\nобновлено 10:01');

    assert.equal(normalizedDate, '30 мар. 2026 10:00');
});

test('getHash ignores context-only date and contractor fields', () => {
    const context = loadBackgroundContext();

    const hashA = context.getHash({
        id: '1000-300326',
        status: 'Новый',
        delivery: 'Самовывоз',
        payment: 'Наличными в офисе',
        city: 'Москва',
        contractor: 'ООО Ромашка',
        date: '30 мар. 2026 10:00\nобновлено 10:01',
        tags: ['VIP', 'Склад']
    });

    const hashB = context.getHash({
        id: '1000-300326',
        status: 'Новый',
        delivery: 'Самовывоз',
        payment: 'Наличными в офисе',
        city: 'Москва',
        contractor: 'ООО Василек',
        date: '31 мар. 2026 11:00\nобновлено 10:15',
        tags: ['склад', 'vip']
    });

    assert.equal(hashA, hashB);
});

test('getChangedFields returns deterministic field list for normalized order changes', () => {
    const context = loadBackgroundContext();

    const changedFields = [
        ...context.getChangedFields(
            {
                status: 'Новый',
                delivery: 'Самовывоз',
                payment: 'Наличными в офисе',
                city: 'Москва',
                contractor: 'ООО Ёж',
                date: '30 мар. 2026 10:00',
                shipmentDateText: 'Отгр.: 31 мар.',
                hasOrderFlag: false,
                hasAutoreserve: false,
                tags: ['VIP', 'Склад']
            },
            {
                status: 'Оплачен',
                delivery: 'Пункт выдачи СДЭК',
                payment: 'Оплата онлайн',
                city: 'Санкт-Петербург',
                contractor: 'ООО Ежик',
                date: '31 мар. 2026 11:00',
                shipmentDateText: 'Отгр.: 1 апр.',
                hasOrderFlag: true,
                hasAutoreserve: true,
                tags: ['Склад', 'Ozon']
            }
        )
    ];

    assert.deepEqual(changedFields, [
        'status',
        'delivery',
        'payment',
        'city',
        'tags'
    ]);
});

test('getChangedFields ignores context-only fields and tag order', () => {
    const context = loadBackgroundContext();

    const changedFields = [
        ...context.getChangedFields(
            {
                date: '30 мар. 2026 10:00\nобновлено 10:01',
                phoneNormalized: '79213241566',
                totalAmount: 350,
                productsDone: 0,
                productsTotal: 10,
                manager: 'Иванов',
                contractor: 'ООО Ромашка',
                hasAutoreserve: false,
                tags: ['VIP', 'Склад']
            },
            {
                date: '30 мар. 2026 10:00\nобновлено 10:15',
                phoneNormalized: '79213240000',
                totalAmount: 900,
                productsDone: 10,
                productsTotal: 10,
                manager: 'Петров',
                contractor: 'ООО Василек',
                hasAutoreserve: true,
                tags: ['склад', 'vip']
            }
        )
    ];

    assert.deepEqual(changedFields, []);
});

test('getChangedFields returns empty list when previous or next order is missing', () => {
    const context = loadBackgroundContext();

    assert.deepEqual([
        ...context.getChangedFields(null, { status: 'Новый' })
    ], []);

    assert.deepEqual([
        ...context.getChangedFields({ status: 'Новый' }, null)
    ], []);
});

test('sync reason helpers distinguish start recovery and config changes', () => {
    const context = loadBackgroundContext();
    const now = 1700000000000;

    assert.equal(context.getStartSyncReason(false), 'initial');
    assert.equal(context.getStartSyncReason(true), 'manual-start');

    assert.equal(
        context.getRecoverySyncReason({
            hasKnownOrders: false,
            now
        }),
        'initial'
    );

    assert.equal(
        context.getRecoverySyncReason({
            hasKnownOrders: true,
            lastCollectionAt: now - 1000,
            now
        }),
        'recovery'
    );

    assert.equal(
        context.getRecoverySyncReason({
            hasKnownOrders: true,
            lastCollectionAt: now - context.DEFAULT_STALE_RESUME_THRESHOLD_MS - 1,
            now
        }),
        'stale-resume'
    );

    assert.equal(
        context.getConfigChangeSyncReason({
            scopeChanged: true,
            modeChanged: true
        }),
        'scope-change'
    );

    assert.equal(
        context.getConfigChangeSyncReason({
            scopeChanged: false,
            modeChanged: true
        }),
        'mode-change'
    );

    assert.equal(
        context.getConfigChangeSyncReason({
            scopeChanged: false,
            modeChanged: false
        }),
        null
    );
});

test('collection coverage metadata contains stable scope signature', () => {
    const context = loadBackgroundContext();

    const metadataA = context.buildCollectionCoverageMetadata({
        collectedAt: 1700000000000,
        reason: 'scope-change',
        monitorMode: 'windowed',
        monitorScope: {
            status: ['6810', '6806'],
            delivery: ['9797'],
            payment: [],
            predicates: {
                ozonOnly: true,
                juridicalOnly: false
            }
        },
        maxPages: 10,
        ordersCount: 2,
        session: {
            mode: 'deep',
            lastCollectedPage: 3,
            completionReason: 'explicit-complete',
            isComplete: true
        }
    });

    const metadataB = context.buildCollectionCoverageMetadata({
        collectedAt: 1700000000000,
        reason: 'scope-change',
        monitorMode: 'windowed',
        monitorScope: {
            status: ['6806', '6810'],
            delivery: ['9797'],
            payment: [],
            predicates: {
                juridicalOnly: false,
                ozonOnly: true
            }
        },
        maxPages: 10,
        ordersCount: 2,
        session: {
            mode: 'deep',
            lastCollectedPage: 3,
            completionReason: 'explicit-complete',
            isComplete: true
        }
    });

    assert.equal(metadataA.syncReason, 'scope-change');
    assert.equal(metadataA.sessionMode, 'deep');
    assert.equal(metadataA.pagesCollected, 3);
    assert.equal(metadataA.maxPages, 10);
    assert.equal(metadataA.ordersCollected, 2);
    assert.equal(metadataA.completionReason, 'explicit-complete');
    assert.equal(metadataA.isComplete, true);
    assert.equal(metadataA.monitorScopeSignature, metadataB.monitorScopeSignature);
});

test('event journal helpers build compact before-after entries', () => {
    const context = loadBackgroundContext();

    const entry = context.createEventJournalEntry({
        createdAt: 1700000000000,
        syncReason: 'normal',
        monitorMode: 'windowed',
        monitorScope: {
            status: ['6806'],
            delivery: [],
            payment: [],
            predicates: {
                ozonOnly: false,
                juridicalOnly: false
            }
        },
        coverageMetadata: {
            collectedAt: 1700000000000,
            syncReason: 'normal',
            pagesCollected: 1
        },
        order: {
            id: '1000-300326',
            orderUrl: 'https://amperkot.ru/admin/orders/1000-300326/',
            status: 'Оплачен',
            delivery: 'Самовывоз',
            payment: 'Оплата онлайн',
            city: 'Москва',
            tags: ['VIP'],
            phoneNormalized: '79213241566',
            contractor: 'ООО Ромашка'
        },
        eventContext: {
            eventType: 'order-changed',
            changedFields: ['status', 'tags'],
            prevHash: 'old-hash',
            newHash: 'new-hash',
            prevOrder: {
                status: 'Новый',
                tags: []
            }
        },
        notificationDecision: {
            notify: false,
            action: 'suppress',
            ruleId: 'notification-trigger-no-enabled-changed-fields',
            reason: 'No enabled changed fields matched: status'
        }
    });

    assert.equal(entry.orderId, '1000-300326');
    assert.equal(entry.eventType, 'order-changed');
    assert.equal(entry.eventKind, 'live');
    assert.equal(entry.syncReason, 'normal');
    assert.deepEqual(entry.changedFields, ['status', 'tags']);
    assert.deepEqual(JSON.parse(JSON.stringify(entry.diff)), [
        {
            field: 'status',
            before: 'Новый',
            after: 'Оплачен'
        },
        {
            field: 'tags',
            before: [],
            after: ['VIP']
        }
    ]);
    assert.equal(entry.context.phoneNormalized, '79213241566');
    assert.equal(entry.context.contractor, 'ООО Ромашка');
    assert.equal(entry.notification.notify, false);
    assert.equal(entry.notification.ruleId, 'notification-trigger-no-enabled-changed-fields');
    assert.equal(entry.coverage.pagesCollected, 1);
});

test('event journal classifies catch-up and scope catch-up events', () => {
    const context = loadBackgroundContext();

    assert.equal(context.getJournalEventKind('normal'), 'live');
    assert.equal(context.getJournalEventKind('window-sync'), 'live');
    assert.equal(context.getJournalEventKind('manual-start'), 'catch-up');
    assert.equal(context.getJournalEventKind('recovery'), 'catch-up');
    assert.equal(context.getJournalEventKind('stale-resume'), 'catch-up');
    assert.equal(context.getJournalEventKind('scope-change'), 'scope-catch-up');
    assert.equal(context.getJournalEventKind('mode-change'), 'scope-catch-up');
});

test('event journal append keeps newest entries within limit', () => {
    const context = loadBackgroundContext();

    const journal = context.appendEventJournalEntry(
        [
            { id: '1' },
            { id: '2' }
        ],
        { id: '3' },
        2
    );

    assert.deepEqual(JSON.parse(JSON.stringify(journal)), [
        { id: '2' },
        { id: '3' }
    ]);
});


test('event journal snapshot returns newest entries with filters and read limit', () => {
    const context = loadBackgroundContext();

    const snapshot = context.getEventJournalSnapshot(
        [
            { id: '1', orderId: '1000', eventType: 'new-order', eventKind: 'live' },
            { id: '2', orderId: '2000', eventType: 'order-changed', eventKind: 'catch-up' },
            { id: '3', orderId: '1000', eventType: 'order-changed', eventKind: 'live' }
        ],
        {
            orderId: '1000',
            limit: 1
        }
    );

    assert.equal(snapshot.storedTotal, 3);
    assert.equal(snapshot.total, 2);
    assert.equal(snapshot.returned, 1);
    assert.equal(snapshot.limit, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.entries)), [
        { id: '3', orderId: '1000', eventType: 'order-changed', eventKind: 'live' }
    ]);
});

test('event journal normalization trims old stored entries', () => {
    const context = loadBackgroundContext();

    const journal = context.normalizeEventJournal(
        [
            { id: 'old' },
            null,
            { id: 'middle' },
            { id: 'new' }
        ],
        2
    );

    assert.deepEqual(JSON.parse(JSON.stringify(journal)), [
        { id: 'middle' },
        { id: 'new' }
    ]);
});


test('monitor status snapshot exposes diagnostic counts without order payloads', () => {
    const context = loadBackgroundContext();

    const snapshot = context.createMonitorStatusSnapshot({
        knownOrdersDB: {
            '1000': { id: '1000', status: 'Новый' },
            '2000': { id: '2000', status: 'Оплачен' }
        },
        knownOrdersHashDB: {
            '1000': 'hash-1',
            '2000': 'hash-2'
        },
        windowOrdersDB: {
            '1000': { id: '1000', status: 'Новый' }
        },
        windowOrdersHashDB: {
            '1000': 'hash-1'
        },
        notificationTargets: {
            'notification-1': { orderId: '1000' }
        },
        workerTabId: 42,
        lastBaselineDate: 'Wed Jun 10 2026',
        isRunning: true,
        monitorState: 'active',
        lastDeepSyncAt: 1700000000000,
        userConfig: {
            monitorMode: 'windowed'
        },
        pendingRebaseline: true,
        pendingSyncReason: 'scope-change',
        collectionSession: {
            mode: 'deep',
            startedAt: 1700000000001,
            lastActivityAt: 1700000000002,
            advanceAttempts: 2,
            orders: {
                '1000': { id: '1000' },
                '2000': { id: '2000' }
            },
            isComplete: false,
            completionReason: null,
            currentPage: 2,
            lastCollectedPage: 2,
            nextPage: 3,
            seenKnownOrder: true,
            processedPages: {
                2: true,
                1: true
            }
        },
        lastCollectionMetadata: {
            syncReason: 'normal',
            pagesCollected: 2
        },
        eventJournal: [
            { id: 'entry-1' },
            { id: 'entry-2' }
        ]
    });

    assert.equal(snapshot.isRunning, true);
    assert.equal(snapshot.monitorState, 'active');
    assert.equal(snapshot.monitorMode, 'windowed');
    assert.equal(snapshot.workerTabId, 42);
    assert.equal(snapshot.hasWorkerTab, true);
    assert.equal(snapshot.pendingRebaseline, true);
    assert.equal(snapshot.pendingSyncReason, 'scope-change');
    assert.equal(snapshot.knownOrdersCount, 2);
    assert.equal(snapshot.knownHashesCount, 2);
    assert.equal(snapshot.windowOrdersCount, 1);
    assert.equal(snapshot.windowHashesCount, 1);
    assert.equal(snapshot.notificationTargetsCount, 1);
    assert.equal(snapshot.eventJournalCount, 2);
    assert.equal(snapshot.lastBaselineDate, 'Wed Jun 10 2026');
    assert.equal(snapshot.lastDeepSyncAt, 1700000000000);
    assert.equal(snapshot.collectionSession.ordersCount, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.collectionSession.processedPages)), ['1', '2']);
    assert.equal(snapshot.lastCollectionMetadata.pagesCollected, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'knownOrdersDB'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'windowOrdersDB'), false);
});

test('monitor status snapshot handles empty state safely', () => {
    const context = loadBackgroundContext();
    const snapshot = context.createMonitorStatusSnapshot({});

    assert.equal(snapshot.isRunning, false);
    assert.equal(snapshot.monitorState, 'uninitialized');
    assert.equal(snapshot.monitorMode, 'windowed');
    assert.equal(snapshot.workerTabId, null);
    assert.equal(snapshot.hasWorkerTab, false);
    assert.equal(snapshot.knownOrdersCount, 0);
    assert.equal(snapshot.windowOrdersCount, 0);
    assert.equal(snapshot.eventJournalCount, 0);
    assert.equal(snapshot.collectionSession, null);
    assert.equal(snapshot.lastCollectionMetadata, null);
});

test('diagnostic log helpers sanitize sensitive payloads', () => {
    const context = loadBackgroundContext();

    const entry = context.createDiagnosticLogEntry({
        createdAt: 1700000000000,
        level: 'warn',
        scope: 'COLLECTION',
        message: 'failed to parse payload',
        details: {
            orderId: '1000-300326',
            page: 2,
            phoneNormalized: '79213241566',
            order: {
                id: '1000-300326',
                status: 'Новый'
            },
            changedFields: ['status', 'payment']
        }
    });

    assert.equal(entry.level, 'WARN');
    assert.equal(entry.scope, 'COLLECTION');
    assert.equal(entry.message, 'failed to parse payload');
    assert.equal(entry.details.orderId, '1000-300326');
    assert.equal(entry.details.page, 2);
    assert.equal(entry.details.phoneNormalized, '[redacted]');
    assert.equal(entry.details.order, '[redacted]');
    assert.deepEqual(JSON.parse(JSON.stringify(entry.details.changedFields)), ['status', 'payment']);
});

test('diagnostic log snapshot returns newest entries with filters and limit', () => {
    const context = loadBackgroundContext();

    const snapshot = context.getDiagnosticLogSnapshot(
        [
            { id: '1', createdAt: 1, level: 'INFO', scope: 'CONTROL', message: 'START' },
            { id: '2', createdAt: 2, level: 'WARN', scope: 'COLLECTION', message: 'timeout' },
            { id: '3', createdAt: 3, level: 'WARN', scope: 'WORKER', message: 'dead' }
        ],
        {
            level: 'WARN',
            limit: 1
        }
    );

    assert.equal(snapshot.storedTotal, 3);
    assert.equal(snapshot.total, 2);
    assert.equal(snapshot.returned, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.entries)), [
        { id: '3', createdAt: 3, level: 'WARN', scope: 'WORKER', message: 'dead' }
    ]);
});



test('diagnostic log snapshot can return entries in chronological order', () => {
    const context = loadBackgroundContext();

    const snapshot = context.getDiagnosticLogSnapshot(
        [
            { id: '1', createdAt: 1, level: 'INFO', scope: 'CONTROL', message: 'START' },
            { id: '2', createdAt: 2, level: 'WARN', scope: 'COLLECTION', message: 'timeout' },
            { id: '3', createdAt: 3, level: 'WARN', scope: 'WORKER', message: 'dead' }
        ],
        {
            level: 'WARN',
            limit: 2,
            order: 'oldest-first'
        }
    );

    assert.equal(snapshot.order, 'oldest-first');
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.entries)), [
        { id: '2', createdAt: 2, level: 'WARN', scope: 'COLLECTION', message: 'timeout' },
        { id: '3', createdAt: 3, level: 'WARN', scope: 'WORKER', message: 'dead' }
    ]);
});

test('diagnostic log append keeps newest entries within limit', () => {
    const context = loadBackgroundContext();

    const log = context.appendDiagnosticLogEntry(
        [
            { id: '1' },
            { id: '2' }
        ],
        { id: '3' },
        2
    );

    assert.deepEqual(JSON.parse(JSON.stringify(log)), [
        { id: '2' },
        { id: '3' }
    ]);
});

test('diagnostic log retention reports dropped entries by count and bytes', () => {
    const context = loadBackgroundContext();

    const byCount = context.appendDiagnosticLogEntryWithRetention(
        [
            { id: '1', message: 'old' },
            { id: '2', message: 'middle' }
        ],
        { id: '3', message: 'new' },
        { maxEntries: 2 }
    );

    assert.equal(byCount.dropped, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(byCount.entries)), [
        { id: '2', message: 'middle' },
        { id: '3', message: 'new' }
    ]);

    const byBytes = context.applyDiagnosticLogRetention(
        [
            { id: '1', message: 'x'.repeat(300) },
            { id: '2', message: 'y'.repeat(300) },
            { id: '3', message: 'z'.repeat(300) },
            { id: '4', message: 'short' }
        ],
        { maxEntries: 10, maxBytes: 1000 }
    );

    assert.ok(byBytes.dropped > 0);
    assert.equal(byBytes.entries[byBytes.entries.length - 1].id, '4');
    assert.ok(byBytes.retainedBytes <= byBytes.maxBytes);
});

test('diagnostic log full snapshot returns all retained entries without preview limit', () => {
    const context = loadBackgroundContext();
    const entries = Array.from({ length: 120 }, (_, index) => ({
        id: String(index + 1),
        createdAt: index + 1,
        level: 'INFO',
        scope: 'TEST',
        message: `entry-${index + 1}`
    }));

    const preview = context.getDiagnosticLogSnapshot(entries, {
        limit: 100,
        order: 'oldest-first'
    });
    const full = context.getDiagnosticLogSnapshot(entries, {
        mode: 'full',
        order: 'oldest-first',
        droppedEntries: 7
    });

    assert.equal(preview.mode, 'preview');
    assert.equal(preview.returned, 100);
    assert.equal(preview.entries[0].id, '21');
    assert.equal(full.mode, 'full');
    assert.equal(full.returned, 120);
    assert.equal(full.entries[0].id, '1');
    assert.equal(full.entries[119].id, '120');
    assert.equal(full.droppedEntries, 7);
    assert.equal(full.retention.maxEntries, context.DEFAULT_DIAGNOSTIC_LOG_LIMIT);
    assert.equal(full.retention.maxBytes, context.DEFAULT_DIAGNOSTIC_LOG_MAX_BYTES);
});

test('monitor scope log summary hides raw predicate details', () => {
    const context = loadBackgroundContext();

    const summary = context.getMonitorScopeLogSummary({
        status: ['6806'],
        delivery: [],
        payment: ['9791', '9793'],
        orderFlags: [],
        store: ['4'],
        reserve: [],
        assemblyStatus: [],
        predicates: {
            ozonOnly: true,
            juridicalOnly: true
        }
    });

    assert.equal(summary.scope, 'filtered');
    assert.equal(summary.statusCount, 1);
    assert.equal(summary.paymentCount, 2);
    assert.equal(summary.storeCount, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(summary, 'predicates'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(summary, 'ozonOnly'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(summary, 'juridicalOnly'), false);
});


test('config log summary hides raw config details and keeps support counts', () => {
    const context = loadBackgroundContext();

    const summary = context.getConfigLogSummary({
        monitorMode: 'active',
        deepSyncMaxPages: 999,
        monitorScope: {
            status: ['6806'],
            delivery: ['9797'],
            payment: [],
            predicates: {
                ozonOnly: true,
                juridicalOnly: true
            }
        },
        notificationTriggers: {
            newOrders: true,
            changedOrders: true,
            changedFields: {
                status: true,
                delivery: false,
                payment: false,
                city: true,
                tags: true
            }
        }
    });

    assert.equal(summary.monitorMode, 'active');
    assert.equal(summary.deepSyncMaxPages, 50);
    assert.equal(summary.monitorScope.scope, 'filtered');
    assert.equal(summary.monitorScope.statusCount, 1);
    assert.equal(summary.monitorScope.deliveryCount, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(summary.monitorScope, 'predicates'), false);
    assert.equal(summary.notificationTriggers.newOrders, true);
    assert.equal(summary.notificationTriggers.changedOrders, true);
    assert.deepEqual(JSON.parse(JSON.stringify(summary.notificationTriggers.enabledChangedFields)), [
        'status',
        'city'
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(summary, 'rules'), false);
});
