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

test('normalizeDateForHash keeps only the first date line', () => {
    const context = loadBackgroundContext();

    const normalizedDate = context.normalizeDateForHash('30 мар. 2026 10:00\nобновлено 10:01');

    assert.equal(normalizedDate, '30 мар. 2026 10:00');
});

test('getHash ignores noise outside the primary date line', () => {
    const context = loadBackgroundContext();

    const hashA = context.getHash({
        id: '1000-300326',
        status: 'Новый',
        delivery: 'Самовывоз',
        payment: 'Наличными в офисе',
        contractor: '',
        date: '30 мар. 2026 10:00\nобновлено 10:01'
    });

    const hashB = context.getHash({
        id: '1000-300326',
        status: 'Новый',
        delivery: 'Самовывоз',
        payment: 'Наличными в офисе',
        contractor: '',
        date: '30 мар. 2026 10:00\nобновлено 10:15'
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
                contractor: 'ООО Ежик',
                date: '30 мар. 2026 10:00',
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
        'contractor',
        'shipmentDateText',
        'hasOrderFlag',
        'hasAutoreserve',
        'tags'
    ]);
});

test('getChangedFields ignores date noise and tag order', () => {
    const context = loadBackgroundContext();

    const changedFields = [
        ...context.getChangedFields(
            {
                date: '30 мар. 2026 10:00\nобновлено 10:01',
                tags: ['VIP', 'Склад']
            },
            {
                date: '30 мар. 2026 10:00\nобновлено 10:15',
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