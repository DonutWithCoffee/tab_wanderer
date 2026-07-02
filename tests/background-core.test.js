const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackgroundContext, sendRuntimeMessage } = require('./helpers/load-extension-context');

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

test('order hash and changed fields ignore dynamic local city time', () => {
    const context = loadBackgroundContext();

    const prevOrder = {
        status: 'Новый',
        delivery: 'Курьер',
        payment: 'Оплата онлайн',
        city: 'Мытищи, Московская обл. (местное время: 12:26)',
        tags: []
    };
    const nextOrder = {
        status: 'Новый',
        delivery: 'Курьер',
        payment: 'Оплата онлайн',
        city: 'Мытищи, Московская обл. (местное время: 12:28)',
        tags: []
    };

    assert.equal(context.getHash(prevOrder), context.getHash(nextOrder));
    assert.deepEqual(JSON.parse(JSON.stringify(context.getChangedFields(prevOrder, nextOrder))), []);
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
        context.getStartRebaselineSyncReason({
            hasKnownOrders: true,
            pendingRebaseline: true,
            pendingSyncReason: 'scope-change'
        }),
        'scope-change'
    );

    assert.equal(
        context.getStartRebaselineSyncReason({
            hasKnownOrders: true,
            pendingRebaseline: true,
            pendingSyncReason: 'mode-change'
        }),
        'mode-change'
    );

    assert.equal(
        context.getStartRebaselineSyncReason({
            hasKnownOrders: true,
            pendingRebaseline: false,
            pendingSyncReason: 'scope-change'
        }),
        'manual-start'
    );

    assert.equal(
        context.getStartRebaselineSyncReason({
            hasKnownOrders: false,
            pendingRebaseline: false
        }),
        'initial'
    );

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


test('pending sync action keeps manual start catch-up separate from safe baselines', () => {
    const context = loadBackgroundContext();

    assert.equal(
        context.getPendingSyncAction({
            pendingRebaseline: false,
            syncReason: 'manual-start',
            hasKnownOrders: true
        }),
        null
    );

    assert.equal(
        context.getPendingSyncAction({
            pendingRebaseline: true,
            syncReason: 'manual-start',
            hasKnownOrders: true
        }),
        'catch-up'
    );

    assert.equal(
        context.getPendingSyncAction({
            pendingRebaseline: true,
            syncReason: 'manual-start',
            hasKnownOrders: false
        }),
        'baseline'
    );

    ['initial', 'recovery', 'stale-resume', 'scope-change', 'mode-change', 'normal'].forEach((syncReason) => {
        assert.equal(
            context.getPendingSyncAction({
                pendingRebaseline: true,
                syncReason,
                hasKnownOrders: true
            }),
            'baseline'
        );
    });
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


test('event journal helpers include readable new-order context and scope changes', () => {
    const context = loadBackgroundContext();

    const orderEntry = context.createEventJournalEntry({
        createdAt: 1700000000000,
        syncReason: 'normal',
        order: {
            id: '1000-300326',
            status: 'Новый',
            delivery: 'Самовывоз',
            payment: 'Наличными в офисе',
            city: 'Санкт-Петербург',
            tags: ['ОЗОН']
        },
        eventContext: {
            eventType: 'new-order',
            isNewOrder: true,
            changedFields: []
        },
        notificationDecision: { notify: true }
    });

    assert.equal(orderEntry.context.status, 'Новый');
    assert.equal(orderEntry.context.delivery, 'Самовывоз');
    assert.equal(orderEntry.context.payment, 'Наличными в офисе');
    assert.deepEqual(orderEntry.context.tags, ['ОЗОН']);

    const scopeEntry = context.createScopeChangeJournalEntry({
        createdAt: 1700000000001,
        prevScope: {
            status: [],
            delivery: []
        },
        nextScope: {
            status: ['6806'],
            delivery: ['9797']
        },
        monitorDictionaries: {
            status: [{ id: '6806', label: 'Новый' }],
            delivery: [{ id: '9797', label: 'Самовывоз' }]
        },
        monitorMode: 'windowed'
    });

    assert.equal(scopeEntry.eventType, 'scope-changed');
    assert.equal(scopeEntry.eventKind, 'scope-change');
    assert.equal(scopeEntry.syncReason, 'scope-change');
    assert.deepEqual(JSON.parse(JSON.stringify(scopeEntry.changedFields)), ['scope.status', 'scope.delivery']);
    assert.equal(scopeEntry.notification.notify, false);
    assert.deepEqual(JSON.parse(JSON.stringify(scopeEntry.diff)), [
        {
            field: 'scope.status',
            before: ['Все'],
            after: ['Новый']
        },
        {
            field: 'scope.delivery',
            before: ['Все'],
            after: ['Самовывоз']
        }
    ]);
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
            { id: '1', createdAt: 1000, orderId: '1000-300326', eventType: 'new-order', eventKind: 'live', changedFields: [] },
            { id: '2', createdAt: 2000, orderId: '2000-300326', eventType: 'order-changed', eventKind: 'catch-up', changedFields: ['payment'] },
            { id: '3', createdAt: 3000, orderId: '1001-300326', eventType: 'order-changed', eventKind: 'live', changedFields: ['status'] },
            { id: '4', createdAt: 4000, orderId: '', eventType: 'scope-changed', eventKind: 'scope-change', changedFields: ['scope.status'] }
        ],
        {
            orderQuery: '100',
            eventType: 'order-changed',
            eventKind: 'live',
            changedField: 'status',
            since: 2500,
            limit: 1
        }
    );

    assert.equal(snapshot.storedTotal, 4);
    assert.equal(snapshot.total, 1);
    assert.equal(snapshot.returned, 1);
    assert.equal(snapshot.limit, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.entries)), [
        { id: '3', createdAt: 3000, orderId: '1001-300326', eventType: 'order-changed', eventKind: 'live', changedFields: ['status'] }
    ]);

    const scopeSnapshot = context.getEventJournalSnapshot(
        [
            { id: '1', createdAt: 1000, orderId: '1000-300326', eventType: 'order-changed', eventKind: 'live', changedFields: ['status'] },
            { id: '2', createdAt: 2000, orderId: '', eventType: 'scope-changed', eventKind: 'scope-change', changedFields: ['scope.status'] }
        ],
        {
            changedField: 'scope'
        }
    );

    assert.equal(scopeSnapshot.total, 1);
    assert.equal(scopeSnapshot.entries[0].id, '2');
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

test('event journal retention reports dropped entries by count and bytes', () => {
    const context = loadBackgroundContext();

    const countRetention = context.applyEventJournalRetention(
        [
            { id: '1', payload: 'a' },
            { id: '2', payload: 'b' },
            { id: '3', payload: 'c' }
        ],
        { maxEntries: 2 }
    );

    assert.equal(countRetention.dropped, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(countRetention.entries.map(entry => entry.id))), ['2', '3']);
    assert.equal(countRetention.maxEntries, 2);

    const byteRetention = context.applyEventJournalRetention(
        [
            { id: '1', payload: 'x'.repeat(900) },
            { id: '2', payload: 'y'.repeat(900) },
            { id: '3', payload: 'z'.repeat(900) }
        ],
        { maxEntries: 10, maxBytes: 1000 }
    );

    assert.ok(byteRetention.dropped > 0);
    assert.ok(byteRetention.retainedBytes <= 1000);
});

test('event journal snapshot exposes retention metadata and dropped counter', () => {
    const context = loadBackgroundContext();

    const snapshot = context.getEventJournalSnapshot(
        [
            { id: '1', createdAt: 1000, orderId: '1000-300326', eventType: 'order-changed', eventKind: 'live', changedFields: ['status'] },
            { id: '2', createdAt: 2000, orderId: '1000-300326', eventType: 'order-changed', eventKind: 'live', changedFields: ['payment'] },
            { id: '3', createdAt: 3000, orderId: '1000-300326', eventType: 'order-changed', eventKind: 'live', changedFields: ['delivery'] }
        ],
        { maxEntries: 2, droppedEntries: 5 }
    );

    assert.equal(snapshot.storedTotal, 2);
    assert.equal(snapshot.retainedTotal, 2);
    assert.equal(snapshot.droppedEntries, 6);
    assert.equal(snapshot.retention.maxEntries, 2);
    assert.equal(snapshot.retention.droppedEntries, 6);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.entries.map(entry => entry.id))), ['3', '2']);
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
        ],
        eventJournalDroppedEntries: 7
    });

    assert.equal(snapshot.isRunning, true);
    assert.equal(snapshot.monitorState, 'active');
    assert.equal(snapshot.monitorMode, 'windowed');
    assert.equal(snapshot.workerTabId, 42);
    assert.equal(snapshot.hasWorkerTab, true);
    assert.equal(snapshot.pendingRebaseline, true);
    assert.equal(snapshot.pendingSyncReason, 'scope-change');
    assert.equal(snapshot.pendingSyncAction, 'baseline');
    assert.equal(snapshot.knownOrdersCount, 2);
    assert.equal(snapshot.knownHashesCount, 2);
    assert.equal(snapshot.windowOrdersCount, 1);
    assert.equal(snapshot.windowHashesCount, 1);
    assert.equal(snapshot.notificationTargetsCount, 1);
    assert.equal(snapshot.eventJournalCount, 2);
    assert.equal(snapshot.eventJournalDroppedEntries, 7);
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
    assert.equal(snapshot.pendingSyncAction, null);
    assert.equal(snapshot.knownOrdersCount, 0);
    assert.equal(snapshot.windowOrdersCount, 0);
    assert.equal(snapshot.eventJournalCount, 0);
    assert.equal(snapshot.eventJournalDroppedEntries, 0);
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

test('collection model creates deterministic session snapshots', () => {
    const context = loadBackgroundContext();
    const session = JSON.parse(JSON.stringify(context.createCollectionSession('deep', 1700000000000)));

    assert.deepEqual(session, {
        mode: 'deep',
        startedAt: 1700000000000,
        lastActivityAt: 1700000000000,
        advanceAttempts: 0,
        orders: {},
        isComplete: false,
        completionReason: null,
        currentPage: 1,
        lastCollectedPage: 0,
        nextPage: 2,
        seenKnownOrder: false,
        processedPages: {}
    });
});

test('collection model collects pages, detects known intersections and duplicates', () => {
    const context = loadBackgroundContext();
    const session = context.createCollectionSession('deep', 1700000000000);

    const collected = context.collectPageIntoCollectionSession(
        session,
        [
            { id: '1000-300326', status: 'Новый' },
            { id: '1001-300326', status: 'Комплектуется' }
        ],
        {
            page: 3,
            now: 1700000001000,
            knownOrdersDB: {
                '1001-300326': { id: '1001-300326' }
            }
        }
    );

    assert.equal(collected, true);
    assert.equal(session.currentPage, 3);
    assert.equal(session.lastCollectedPage, 3);
    assert.equal(session.nextPage, 4);
    assert.equal(session.lastActivityAt, 1700000001000);
    assert.equal(session.seenKnownOrder, true);
    assert.deepEqual(Object.keys(session.orders).sort(), ['1000-300326', '1001-300326']);

    const duplicate = context.collectPageIntoCollectionSession(session, [], { page: 3 });

    assert.equal(duplicate, false);
    assert.deepEqual(Object.keys(session.processedPages), ['3']);
});

test('collection model completion policy preserves fast, page limit and pagination completion semantics', () => {
    const context = loadBackgroundContext();

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.shouldCompleteCollectionSession(
            { mode: 'fast', lastCollectedPage: 1 },
            { isComplete: false },
            { maxPages: 50 }
        ))),
        {
            complete: true,
            reason: 'fast-page-1'
        }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.shouldCompleteCollectionSession(
            { mode: 'deep', lastCollectedPage: 50 },
            { isComplete: false },
            { maxPages: 50 }
        ))),
        {
            complete: true,
            reason: 'deep-sync-page-limit'
        }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.shouldCompleteCollectionSession(
            { mode: 'deep', lastCollectedPage: 3 },
            { isComplete: true, completionReason: 'pagination-last-page' },
            { maxPages: 50 }
        ))),
        {
            complete: true,
            reason: 'pagination-last-page'
        }
    );
});

test('collection model normalizes ORDERS message meta for legacy and explicit completion', () => {
    const context = loadBackgroundContext();

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.normalizeOrdersMessageMeta({}))),
        {
            page: 1,
            isComplete: true,
            completionReason: 'legacy-single-page'
        }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.normalizeOrdersMessageMeta({ page: '4', isComplete: false }))),
        {
            page: 4,
            isComplete: false,
            completionReason: 'legacy-single-page'
        }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.normalizeOrdersMessageMeta({ page: 0, isComplete: true }))),
        {
            page: 1,
            isComplete: true,
            completionReason: 'explicit-complete'
        }
    );
});

test('runtime api helpers build consistent safe responses', () => {
    const context = loadBackgroundContext();

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.createRuntimeOkResponse({ value: 1 }))),
        { ok: true, value: 1 }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.createRuntimeFailureResponse())),
        { ok: false }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.createRuntimeErrorResponse(new Error('boom')))),
        { ok: false, error: 'boom' }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.createRuntimeIgnoredResponse({ stalePage: true }))),
        { ignored: true, stalePage: true }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.createWorkerCheckResponse({ isWorker: true, isRunning: 1 }))),
        { isWorker: true, isRunning: false }
    );
});

test('runtime api helpers wrap monitor, journal and diagnostic snapshots', () => {
    const context = loadBackgroundContext();

    const monitorResponse = context.createRuntimeMonitorStatusResponse({ isRunning: true });
    assert.equal(monitorResponse.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(monitorResponse.status)), { isRunning: true });

    const journalResponse = context.createRuntimeEventJournalResponse(
        [
            { id: '1', orderId: '1000' },
            { id: '2', orderId: '2000' }
        ],
        { orderId: '2000' }
    );
    assert.equal(journalResponse.ok, true);
    assert.equal(journalResponse.total, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(journalResponse.entries)), [
        { id: '2', orderId: '2000' }
    ]);

    const diagnosticResponse = context.createRuntimeDiagnosticLogResponse(
        Array.from({ length: 120 }, (_, index) => ({
            id: String(index + 1),
            createdAt: index + 1,
            level: 'INFO',
            scope: 'TEST',
            message: `entry-${index + 1}`
        })),
        { mode: 'full', order: 'oldest-first' },
        9
    );
    assert.equal(diagnosticResponse.ok, true);
    assert.equal(diagnosticResponse.mode, 'full');
    assert.equal(diagnosticResponse.returned, 120);
    assert.equal(diagnosticResponse.droppedEntries, 9);
    assert.equal(diagnosticResponse.entries[0].id, '1');
});

test('watched orders helpers normalize, deduplicate and validate order ids', () => {
    const context = loadBackgroundContext();

    const normalized = context.normalizeWatchedOrdersConfig({
        items: [
            { id: ' 1000-300326 ', status: 'active', addedAt: 1700000000000 },
            { id: '1000-300326', status: 'unresolved' },
            { id: 'bad-order-id' },
            '2000-300326'
        ]
    }, 1700000001000);

    assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
        items: [
            {
                id: '1000-300326',
                status: 'active',
                addedAt: 1700000000000,
                lastCheckedAt: null,
                lastBaselineAt: null,
                lastEventAt: null,
                lastError: null
            },
            {
                id: '2000-300326',
                status: 'active',
                addedAt: 1700000001000,
                lastCheckedAt: null,
                lastBaselineAt: null,
                lastEventAt: null,
                lastError: null
            }
        ]
    });

    const added = context.addWatchedOrderToConfig(normalized, '3000-300326', 1700000002000);

    assert.equal(added.added, true);
    assert.deepEqual(JSON.parse(JSON.stringify(context.getWatchedOrderIds(added.config))), [
        '1000-300326',
        '2000-300326',
        '3000-300326'
    ]);
    assert.equal(context.addWatchedOrderToConfig(added.config, 'bad').invalid, true);
    assert.equal(context.addWatchedOrderToConfig(added.config, '1000-300326').duplicate, true);
});

test('event journal watched-only filter returns only configured watched order entries', () => {
    const context = loadBackgroundContext();
    const journal = [
        { orderId: '1000-300326', eventType: 'new-order', createdAt: 1 },
        { orderId: '2000-300326', eventType: 'order-changed', createdAt: 2 },
        { orderId: '', eventType: 'scope-changed', createdAt: 3 }
    ];

    const snapshot = context.getEventJournalSnapshot(journal, {
        watchedOnly: true,
        watchedOrderIds: ['2000-300326'],
        limit: 10
    });

    assert.equal(snapshot.total, 1);
    assert.equal(snapshot.entries.length, 1);
    assert.equal(snapshot.entries[0].orderId, '2000-300326');

    const emptySnapshot = context.getEventJournalSnapshot(journal, {
        watchedOnly: true,
        watchedOrderIds: [],
        limit: 10
    });

    assert.equal(emptySnapshot.total, 0);
});

test('monitor status snapshot exposes watched orders count without order payloads', () => {
    const context = loadBackgroundContext();
    const status = context.createMonitorStatusSnapshot({
        userConfig: context.getEffectiveConfig({
            watchedOrders: {
                items: [
                    { id: '1000-300326' },
                    { id: '2000-300326' }
                ]
            }
        })
    });

    assert.equal(status.watchedOrdersCount, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(status, 'watchedOrders'), false);
});

test('direct follow-up helpers select watched orders and update check status', () => {
    const context = loadBackgroundContext();
    const watchedOrders = context.normalizeWatchedOrdersConfig({
        items: [
            { id: '1000-300326' },
            { id: '2000-300326' }
        ]
    }, 1700000000000);

    const url = context.createDirectFollowUpUrl('1000-300326', {
        baseUrl: 'https://amperkot.ru/admin/orders/',
        marker: '#direct=1'
    });

    assert.equal(url, 'https://amperkot.ru/admin/orders/1000-300326/#direct=1');

    const first = context.selectNextDirectFollowUpItem(watchedOrders, { nextIndex: 0 });
    const second = context.selectNextDirectFollowUpItem(watchedOrders, { nextIndex: first.nextIndex });

    assert.equal(first.item.id, '1000-300326');
    assert.equal(first.nextIndex, 1);
    assert.equal(second.item.id, '2000-300326');
    assert.equal(second.nextIndex, 0);

    const failed = context.markWatchedOrderCheckResult(watchedOrders, '1000-300326', {
        ok: false,
        error: 'parse failed'
    }, 1700000005000);

    assert.equal(failed.items[0].status, 'unresolved');
    assert.equal(failed.items[0].lastCheckedAt, 1700000005000);
    assert.equal(failed.items[0].lastError, 'parse failed');

    const recovered = context.markWatchedOrderCheckResult(failed, '1000-300326', {
        ok: true
    }, 1700000006000);

    assert.equal(recovered.items[0].status, 'active');
    assert.equal(recovered.items[0].lastCheckedAt, 1700000006000);
    assert.equal(recovered.items[0].lastError, null);

    const baselined = context.markWatchedOrderDirectBaseline(recovered, '1000-300326', 1700000007000);
    const eventMarked = context.markWatchedOrderEvent(baselined, '1000-300326', 1700000008000);

    assert.equal(context.hasWatchedOrderDirectBaseline(baselined, '1000-300326'), true);
    assert.equal(eventMarked.items[0].lastBaselineAt, 1700000007000);
    assert.equal(eventMarked.items[0].lastEventAt, 1700000008000);
});

test('monitor status snapshot exposes direct follow-up state without watched order payloads', () => {
    const context = loadBackgroundContext();
    const status = context.createMonitorStatusSnapshot({
        directWorkerTabId: 42,
        directFollowUpState: {
            currentOrderId: '1000-300326',
            nextIndex: 1,
            lastStartedAt: 1700000000000
        },
        userConfig: context.getEffectiveConfig({
            watchedOrders: {
                items: [
                    { id: '1000-300326' }
                ]
            }
        })
    });

    assert.equal(status.hasDirectWorkerTab, true);
    assert.equal(status.directWorkerTabId, 42);
    assert.equal(status.directFollowUpState.state, 'checking');
    assert.equal(status.directFollowUpState.currentOrderId, '1000-300326');
    assert.equal(status.watchedOrdersCount, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(status, 'watchedOrders'), false);
});

test('order lookup resolves full and short order numbers from known orders and journal', () => {
    const context = loadBackgroundContext();
    const snapshot = context.getOrderLookupSnapshot({
        knownOrdersDB: {
            '1001-300326': {
                id: '1001-300326',
                status: 'Оплачен',
                delivery: 'Самовывоз',
                orderUrl: 'https://amperkot.ru/admin/orders/1001-300326/'
            }
        },
        eventJournal: [
            {
                id: 'event-1',
                createdAt: 1700000000000,
                orderId: '1001-290326',
                eventType: 'order-changed',
                changedFields: ['status'],
                diff: [
                    { field: 'status', before: 'Новый', after: 'Завершен' }
                ]
            },
            {
                id: 'event-2',
                createdAt: 1700000100000,
                orderId: '1001-300326',
                eventType: 'order-changed',
                changedFields: ['status'],
                diff: [
                    { field: 'status', before: 'Новый', after: 'Оплачен' }
                ]
            }
        ],
        watchedOrders: {
            items: [
                { id: '1001-300326', status: 'active', lastCheckedAt: 1700000200000 }
            ]
        }
    }, {
        query: '1001'
    });

    assert.equal(snapshot.status, 'multiple-candidates');
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.candidates.map(candidate => candidate.orderId))), [
        '1001-300326',
        '1001-290326'
    ]);
    assert.equal(snapshot.candidates[0].isWatched, true);
    assert.equal(snapshot.selectedOrderId, '');
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.entries)), []);

    const full = context.getOrderLookupSnapshot({
        knownOrdersDB: {},
        eventJournal: snapshot.candidates.map(candidate => ({
            orderId: candidate.orderId,
            createdAt: candidate.lastSeenAt,
            eventType: 'order-changed'
        })),
        watchedOrders: {}
    }, {
        query: '1001-300326'
    });

    assert.equal(full.status, 'selected');
    assert.equal(full.selectedOrderId, '1001-300326');
    assert.equal(full.entries.length, 1);

    const withDropped = context.getOrderLookupSnapshot({
        knownOrdersDB: {},
        eventJournal: [
            { orderId: '1001-300326', createdAt: 1700000000000 }
        ],
        watchedOrders: {}
    }, {
        query: '1001-300326',
        droppedEntries: 12
    });

    assert.equal(withDropped.droppedEntries, 12);
});

test('order lookup returns invalid and not-found states without exposing global journal', () => {
    const context = loadBackgroundContext();
    const invalid = context.getOrderLookupSnapshot({
        knownOrdersDB: {},
        eventJournal: [
            { orderId: '1000-300326', createdAt: 1700000000000 }
        ],
        watchedOrders: {}
    }, {
        query: 'abc'
    });

    assert.equal(invalid.status, 'invalid-query');
    assert.deepEqual(JSON.parse(JSON.stringify(invalid.entries)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(invalid.candidates)), []);

    const notFound = context.getOrderLookupSnapshot({
        knownOrdersDB: {},
        eventJournal: [
            { orderId: '1000-300326', createdAt: 1700000000000 }
        ],
        watchedOrders: {}
    }, {
        query: '9999'
    });

    assert.equal(notFound.status, 'not-found');
    assert.deepEqual(JSON.parse(JSON.stringify(notFound.entries)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(notFound.candidates)), []);
});

test('mergeOrderSnapshots preserves existing values when direct parser returns empty fields', () => {
    const context = loadBackgroundContext();

    const merged = context.mergeOrderSnapshots(
        {
            id: '1000-300326',
            status: 'Новый',
            delivery: 'Самовывоз',
            payment: 'Наличными в офисе',
            city: 'Санкт-Петербург',
            tags: ['Юрик'],
            orderUrl: 'https://amperkot.ru/admin/orders/1000-300326/'
        },
        {
            id: '1000-300326',
            status: 'Комплектуется',
            delivery: '',
            payment: '',
            city: '',
            tags: [],
            orderUrl: ''
        }
    );

    assert.equal(merged.status, 'Комплектуется');
    assert.equal(merged.delivery, 'Самовывоз');
    assert.equal(merged.payment, 'Наличными в офисе');
    assert.equal(merged.city, 'Санкт-Петербург');
    assert.deepEqual(JSON.parse(JSON.stringify(merged.tags)), ['Юрик']);
    assert.equal(merged.orderUrl, 'https://amperkot.ru/admin/orders/1000-300326/');
});

test('Ozon resolve preview opens seller product worker and returns comparison plan to warehouse tab', async () => {
    const context = loadBackgroundContext({
        setTimeout: () => 1,
        clearTimeout: () => {}
    });

    const warehouseExtraction = {
        orderId: '4171-010726',
        productsById: {
            40534835: {
                productId: '40534835',
                productTitle: 'PETG пластик',
                eligibleBarcodes: [
                    { barcode: '2486857', productId: '40534835' },
                    { barcode: '2486885', productId: '40534835' }
                ],
                skippedBarcodes: []
            }
        }
    };

    const startResponse = await sendRuntimeMessage(
        context,
        {
            type: 'OZON_RESOLVE_PREVIEW_REQUEST',
            warehouseExtraction
        },
        {
            tab: {
                id: 7,
                url: 'https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/assembly/4336?order=4171-010726'
            }
        }
    );

    assert.equal(startResponse.ok, true);
    assert.equal(startResponse.started, true);
    assert.equal(startResponse.productCount, 1);
    assert.equal(context.__test.createdTabs.length, 1);
    assert.equal(
        context.__test.createdTabs[0].url,
        'https://seller.ozon.ru/app/products?search=40534835#tab_wanderer_ozon_worker=1'
    );

    const resultResponse = await sendRuntimeMessage(
        context,
        {
            type: 'OZON_PRODUCT_RESOLVE_RESULT',
            productId: '40534835',
            result: {
                ok: true,
                productId: '40534835',
                product: {
                    offerId: '40534835',
                    ozonSku: '1675596792',
                    existingBarcodes: ['2486885']
                }
            }
        },
        {
            tab: {
                id: 1,
                url: 'https://seller.ozon.ru/app/products?search=40534835#tab_wanderer_ozon_worker=1'
            }
        }
    );

    assert.equal(resultResponse.ok, true);
    assert.equal(context.__test.tabMessages.length, 1);
    assert.equal(context.__test.tabMessages[0].tabId, 7);
    assert.equal(context.__test.tabMessages[0].message.type, 'OZON_RESOLVE_PREVIEW_RESULT');
    assert.equal(context.__test.tabMessages[0].message.ok, true);
    assert.equal(context.__test.tabMessages[0].message.plan.summary.toAddCount, 1);
    assert.equal(context.__test.tabMessages[0].message.plan.summary.alreadyExistsCount, 1);
    assert.deepEqual(context.__test.removedTabs, [1]);
});
test('Ozon UI apply opens seller product worker and relays UI command/result', async () => {
    const context = loadBackgroundContext({
        setTimeout: () => 1,
        clearTimeout: () => {}
    });

    const warehouseExtraction = {
        orderId: '3234-020726',
        productsById: {
            24260137: {
                productId: '24260137',
                productTitle: 'Модуль реле',
                eligibleBarcodes: [
                    { barcode: '987654321', productId: '24260137' }
                ],
                skippedBarcodes: []
            }
        }
    };

    const startResponse = await sendRuntimeMessage(
        context,
        {
            type: 'OZON_UI_APPLY_REQUEST',
            warehouseExtraction
        },
        {
            tab: {
                id: 7,
                url: 'https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/assembly/4336?order=3234-020726'
            }
        }
    );

    assert.equal(startResponse.ok, true);
    assert.equal(startResponse.started, true);
    assert.equal(startResponse.productId, '24260137');
    assert.equal(startResponse.barcodeCount, 1);
    assert.equal(context.__test.createdTabs.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.createdTabs[0])), {
        url: 'https://seller.ozon.ru/app/products?search=24260137',
        active: true,
        pinned: true
    });

    const readyResponse = await sendRuntimeMessage(
        context,
        {
            type: 'OZON_PRODUCT_WORKER_READY',
            productId: '24260137'
        },
        {
            tab: {
                id: 1,
                url: 'https://seller.ozon.ru/app/products?search=24260137'
            }
        }
    );

    assert.equal(readyResponse.ok, true);
    assert.equal(context.__test.tabMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.tabMessages[0])), {
        tabId: 1,
        message: {
            type: 'OZON_UI_APPLY_IN_WORKER',
            productId: '24260137',
            barcodes: ['987654321']
        }
    });

    const resultResponse = await sendRuntimeMessage(
        context,
        {
            type: 'OZON_UI_APPLY_RESULT',
            productId: '24260137',
            ok: true,
            barcodes: ['987654321'],
            addedCount: 1
        },
        {
            tab: {
                id: 1,
                url: 'https://seller.ozon.ru/app/products?search=24260137'
            }
        }
    );

    assert.equal(resultResponse.ok, true);
    assert.equal(context.__test.tabMessages.length, 2);
    assert.equal(context.__test.tabMessages[1].tabId, 7);
    assert.equal(context.__test.tabMessages[1].message.type, 'OZON_UI_APPLY_RESULT');
    assert.equal(context.__test.tabMessages[1].message.ok, true);
    assert.equal(context.__test.tabMessages[1].message.productId, '24260137');
    assert.equal(context.__test.tabMessages[1].message.productCount, 1);
    assert.equal(context.__test.tabMessages[1].message.successCount, 1);
    assert.equal(context.__test.tabMessages[1].message.errorCount, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.tabMessages[1].message.barcodes)), ['987654321']);
    assert.equal(context.__test.tabMessages[1].message.addedCount, 1);
    assert.equal(context.__test.tabMessages[1].message.productResults.length, 1);
    assert.equal(context.__test.tabMessages[1].message.productResults[0].productId, '24260137');
    assert.deepEqual(context.__test.removedTabs, []);
});


test('Ozon UI apply processes multiple products sequentially', async () => {
    const context = loadBackgroundContext({
        setTimeout: () => 1,
        clearTimeout: () => {}
    });

    const warehouseExtraction = {
        orderId: '3234-020726',
        productsById: {
            24260137: {
                productId: '24260137',
                productTitle: 'Модуль реле',
                eligibleBarcodes: [
                    { barcode: '987654321', productId: '24260137' }
                ],
                skippedBarcodes: []
            },
            42608563: {
                productId: '42608563',
                productTitle: 'Промышленный модуль',
                eligibleBarcodes: [
                    { barcode: '123456789', productId: '42608563' },
                    { barcode: '123456780', productId: '42608563' }
                ],
                skippedBarcodes: []
            }
        }
    };

    const startResponse = await sendRuntimeMessage(
        context,
        {
            type: 'OZON_UI_APPLY_REQUEST',
            warehouseExtraction
        },
        {
            tab: {
                id: 7,
                url: 'https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/assembly/4336?order=3234-020726'
            }
        }
    );

    assert.equal(startResponse.ok, true);
    assert.equal(startResponse.started, true);
    assert.equal(startResponse.productId, '24260137');
    assert.equal(startResponse.productCount, 2);
    assert.equal(startResponse.barcodeCount, 3);
    assert.equal(context.__test.createdTabs.length, 1);
    assert.equal(context.__test.createdTabs[0].url, 'https://seller.ozon.ru/app/products?search=24260137');

    const firstReadyResponse = await sendRuntimeMessage(
        context,
        {
            type: 'OZON_PRODUCT_WORKER_READY',
            productId: '24260137'
        },
        {
            tab: {
                id: 1,
                url: 'https://seller.ozon.ru/app/products?search=24260137'
            }
        }
    );

    assert.equal(firstReadyResponse.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.tabMessages[0])), {
        tabId: 1,
        message: {
            type: 'OZON_UI_APPLY_IN_WORKER',
            productId: '24260137',
            barcodes: ['987654321']
        }
    });

    const firstResultResponse = await sendRuntimeMessage(
        context,
        {
            type: 'OZON_UI_APPLY_RESULT',
            productId: '24260137',
            ok: true,
            barcodes: ['987654321'],
            addedCount: 1,
            verifiedCount: 1,
            missingBarcodes: []
        },
        {
            tab: {
                id: 1,
                url: 'https://seller.ozon.ru/app/products?search=24260137'
            }
        }
    );

    assert.equal(firstResultResponse.ok, true);
    assert.equal(context.__test.tabUpdates.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.tabUpdates[0])), {
        tabId: 1,
        updateInfo: {
            url: 'https://seller.ozon.ru/app/products?search=42608563',
            active: true
        }
    });
    assert.equal(context.__test.tabMessages.length, 1);

    const secondReadyResponse = await sendRuntimeMessage(
        context,
        {
            type: 'OZON_PRODUCT_WORKER_READY',
            productId: '42608563'
        },
        {
            tab: {
                id: 1,
                url: 'https://seller.ozon.ru/app/products?search=42608563'
            }
        }
    );

    assert.equal(secondReadyResponse.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.tabMessages[1])), {
        tabId: 1,
        message: {
            type: 'OZON_UI_APPLY_IN_WORKER',
            productId: '42608563',
            barcodes: ['123456789', '123456780']
        }
    });

    const secondResultResponse = await sendRuntimeMessage(
        context,
        {
            type: 'OZON_UI_APPLY_RESULT',
            productId: '42608563',
            ok: true,
            barcodes: ['123456789', '123456780'],
            addedCount: 2,
            verifiedCount: 2,
            missingBarcodes: []
        },
        {
            tab: {
                id: 1,
                url: 'https://seller.ozon.ru/app/products?search=42608563'
            }
        }
    );

    assert.equal(secondResultResponse.ok, true);
    assert.equal(context.__test.tabMessages.length, 3);
    assert.equal(context.__test.tabMessages[2].tabId, 7);
    assert.equal(context.__test.tabMessages[2].message.type, 'OZON_UI_APPLY_RESULT');
    assert.equal(context.__test.tabMessages[2].message.ok, true);
    assert.equal(context.__test.tabMessages[2].message.productId, '');
    assert.equal(context.__test.tabMessages[2].message.productCount, 2);
    assert.equal(context.__test.tabMessages[2].message.successCount, 2);
    assert.equal(context.__test.tabMessages[2].message.errorCount, 0);
    assert.equal(context.__test.tabMessages[2].message.addedCount, 3);
    assert.equal(context.__test.tabMessages[2].message.verifiedCount, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.tabMessages[2].message.barcodes)), ['987654321', '123456789', '123456780']);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.tabMessages[2].message.productResults.map(item => item.productId))), ['24260137', '42608563']);
});
