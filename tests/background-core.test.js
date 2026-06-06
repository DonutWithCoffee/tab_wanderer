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
