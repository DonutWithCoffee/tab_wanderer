const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackgroundContext } = require('./helpers/load-extension-context');

test('buildOrdersUrl builds config-driven worker URL with query params and marker', () => {
    const context = loadBackgroundContext();

    const url = context.buildOrdersUrl(
        {
            status: ['6806', '6810'],
            delivery: ['9797'],
            payment: ['9791', '9793']
        },
        2
    );

    assert.equal(
        url,
        'https://amperkot.ru/admin/orders/?status%5B%5D=6806&status%5B%5D=6810&delivery%5B%5D=9797&payment%5B%5D=9791&payment%5B%5D=9793&page=2#tab_wanderer_worker=1'
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