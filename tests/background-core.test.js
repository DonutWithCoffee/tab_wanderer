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
