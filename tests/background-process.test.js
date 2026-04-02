const test = require('node:test');
const assert = require('node:assert/strict');
const {
    loadBackgroundContext,
    runExpression,
    setBackgroundState,
    getBackgroundState
} = require('./helpers/load-extension-context');

function createOrder(overrides = {}) {
    return {
        id: '1000-300326',
        status: 'Новый',
        delivery: 'Пункт самовывоза СДЭК',
        payment: 'Оплата онлайн',
        contractor: '',
        date: '30 мар. 2026 10:00',
        orderUrl: 'https://amperkot.ru/admin/orders/1000-300326/',
        ...overrides
    };
}

function createDefaultMonitorScope() {
    return {
        status: [],
        delivery: [],
        payment: [],
        orderFlags: [],
        store: [],
        reserve: [],
        assemblyStatus: [],
        predicates: {
            ozonOnly: false,
            juridicalOnly: false
        }
    };
}

function createStateWithKnownAndWindow(context, order, userConfigOverrides = {}) {
    const hash = getHashForOrder(context, order);

    return {
        knownOrdersDB: {
            [order.id]: order
        },
        knownOrdersHashDB: {
            [order.id]: hash
        },
        windowOrdersDB: {
            [order.id]: order
        },
        windowOrdersHashDB: {
            [order.id]: hash
        },
        userConfig: {
            rules: {},
            monitorScope: createDefaultMonitorScope(),
            ...userConfigOverrides
        }
    };
}

function getHashForOrder(context, order) {
    context.__testOrder = order;
    const hash = runExpression(context, 'getHash(__testOrder)');
    delete context.__testOrder;
    return hash;
}

test('processOrders adds new order, sends notification and updates state', () => {
    const context = loadBackgroundContext();

    const existingOrder = createOrder();
    const newOrder = createOrder({
        id: '1001-300326',
        orderUrl: 'https://amperkot.ru/admin/orders/1001-300326/'
    });

    setBackgroundState(
        context,
        createStateWithKnownAndWindow(context, existingOrder)
    );

    context.__testOrders = [existingOrder, newOrder];
    runExpression(context, 'processOrders(__testOrders)');
    delete context.__testOrders;

    const state = getBackgroundState(context);

    assert.equal(context.__test.notifications.length, 1);
    assert.equal(state.knownOrdersDB['1001-300326'].id, '1001-300326');
    assert.equal(state.windowOrdersDB['1001-300326'].id, '1001-300326');
    assert.equal(
        state.knownOrdersHashDB['1001-300326'],
        getHashForOrder(context, newOrder)
    );
    assert.equal(
        state.windowOrdersHashDB['1001-300326'],
        getHashForOrder(context, newOrder)
    );
});

test('processOrders sends notification on status change and updates hash', () => {
    const context = loadBackgroundContext();

    const prevOrder = createOrder({
        status: 'Новый'
    });

    const nextOrder = createOrder({
        status: 'Оплачен'
    });

    setBackgroundState(
        context,
        createStateWithKnownAndWindow(context, prevOrder)
    );

    context.__testOrders = [nextOrder];
    runExpression(context, 'processOrders(__testOrders)');
    delete context.__testOrders;

    const state = getBackgroundState(context);

    assert.equal(context.__test.notifications.length, 1);
    assert.equal(state.knownOrdersDB[prevOrder.id].status, 'Оплачен');
    assert.equal(state.windowOrdersDB[prevOrder.id].status, 'Оплачен');
    assert.equal(
        state.knownOrdersHashDB[prevOrder.id],
        getHashForOrder(context, nextOrder)
    );
    assert.equal(
        state.windowOrdersHashDB[prevOrder.id],
        getHashForOrder(context, nextOrder)
    );
});

test('processOrders applies ignore rule without notification but still updates state', () => {
    const context = loadBackgroundContext();

    const prevOrder = createOrder({
        payment: 'Оплата онлайн'
    });

    const nextOrder = createOrder({
        payment: 'Безналичный расчет для юридических лиц'
    });

    setBackgroundState(
        context,
        createStateWithKnownAndWindow(context, prevOrder, {
            rules: {
                ignoreLegalEntityBankTransfer: true
            }
        })
    );

    context.__testOrders = [nextOrder];
    runExpression(context, 'processOrders(__testOrders)');
    delete context.__testOrders;

    const state = getBackgroundState(context);

    assert.equal(context.__test.notifications.length, 0);
    assert.equal(
        state.knownOrdersDB[prevOrder.id].payment,
        'Безналичный расчет для юридических лиц'
    );
    assert.equal(
        state.windowOrdersDB[prevOrder.id].payment,
        'Безналичный расчет для юридических лиц'
    );
    assert.equal(
        state.knownOrdersHashDB[prevOrder.id],
        getHashForOrder(context, nextOrder)
    );
    assert.equal(
        state.windowOrdersHashDB[prevOrder.id],
        getHashForOrder(context, nextOrder)
    );
});

test('processOrders in testMode does not mutate state', () => {
    const context = loadBackgroundContext();

    const prevOrder = createOrder({
        status: 'Новый'
    });

    const nextOrder = createOrder({
        status: 'Оплачен'
    });

    setBackgroundState(
        context,
        createStateWithKnownAndWindow(context, prevOrder)
    );

    const before = getBackgroundState(context);

    context.__testOrders = [nextOrder];
    runExpression(context, 'processOrders(__testOrders, { testMode: true })');
    delete context.__testOrders;

    const after = getBackgroundState(context);

    assert.equal(context.__test.notifications.length, 1);
    assert.deepEqual(after.knownOrdersDB, before.knownOrdersDB);
    assert.deepEqual(after.knownOrdersHashDB, before.knownOrdersHashDB);
    assert.deepEqual(after.windowOrdersDB, before.windowOrdersDB);
    assert.deepEqual(after.windowOrdersHashDB, before.windowOrdersHashDB);
});

test('runBaseline initializes known and window state without sending notifications', () => {
    const context = loadBackgroundContext();

    setBackgroundState(context, {
        knownOrdersDB: {},
        knownOrdersHashDB: {},
        windowOrdersDB: {},
        windowOrdersHashDB: {},
        userConfig: {
            rules: {},
            monitorScope: createDefaultMonitorScope()
        },
        pendingRebaseline: true
    });

    const orders = [
        createOrder(),
        createOrder({
            id: '1001-300326',
            orderUrl: 'https://amperkot.ru/admin/orders/1001-300326/'
        })
    ];

    context.__testOrders = orders;
    runExpression(context, 'runBaseline(__testOrders, "test")');
    delete context.__testOrders;

    const state = getBackgroundState(context);

    assert.equal(context.__test.notifications.length, 0);
    assert.equal(Object.keys(state.knownOrdersDB).length, 2);
    assert.equal(Object.keys(state.knownOrdersHashDB).length, 2);
    assert.equal(Object.keys(state.windowOrdersDB).length, 2);
    assert.equal(Object.keys(state.windowOrdersHashDB).length, 2);
    assert.equal(state.pendingRebaseline, false);
    assert.equal(typeof state.lastBaselineDate, 'string');
});