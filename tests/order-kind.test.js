const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadOrderKindContext() {
    const context = { URL };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'core', 'order-kind.js'), 'utf8'),
        context,
        { filename: 'core/order-kind.js' }
    );
    return context;
}

test('order kind classifier confirms Ozon only from source plus trusted ship action', () => {
    const context = loadOrderKindContext();
    const result = context.classifyOrderKind({
        orderId: '7001-010126',
        pageComplete: true,
        source: 'OZON',
        contractor: 'OZON (ОЗОН)',
        ozonShipActionUrl: '/admin/_api/shop-orders/7001-010126/ozon/123456/posting/fbs/ship'
    });

    assert.equal(result.kind, 'ozon');
    assert.equal(result.reason, 'source-action-contractor');
    assert.equal(result.evidence.actionOzon, true);
});

test('order kind classifier marks complete pages without Ozon evidence as regular', () => {
    const context = loadOrderKindContext();

    const legalEntity = context.classifyOrderKind({
        orderId: '7002-010126',
        pageComplete: true,
        source: 'Основной сайт',
        contractor: 'ООО "МГД"'
    });
    const individual = context.classifyOrderKind({
        orderId: '7003-010126',
        pageComplete: true,
        source: '',
        contractor: ''
    });

    assert.equal(legalEntity.kind, 'regular');
    assert.equal(individual.kind, 'regular');
});

test('order kind classifier fails closed for incomplete or conflicting markers', () => {
    const context = loadOrderKindContext();

    assert.equal(context.classifyOrderKind({
        orderId: '7001-010126',
        pageComplete: false,
        source: 'OZON',
        ozonShipActionUrl: '/admin/_api/shop-orders/7001-010126/ozon/123456/posting/fbs/ship'
    }).kind, 'unknown');

    assert.equal(context.classifyOrderKind({
        orderId: '7001-010126',
        pageComplete: true,
        source: 'OZON',
        contractor: 'OZON (ОЗОН)'
    }).kind, 'unknown');
});

test('Ozon ship action validation rejects foreign origins and another order id', () => {
    const context = loadOrderKindContext();

    assert.equal(
        context.normalizeTrustedOzonShipActionUrl(
            'https://example.invalid/admin/_api/shop-orders/7001-010126/ozon/123456/posting/fbs/ship',
            '7001-010126'
        ),
        ''
    );
    assert.equal(
        context.normalizeTrustedOzonShipActionUrl(
            '/admin/_api/shop-orders/7002-010126/ozon/123456/posting/fbs/ship',
            '7001-010126'
        ),
        ''
    );
});
