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

function getHashForOrder(context, order) {
    context.__testOrder = order;
    const hash = runExpression(context, 'getHash(__testOrder)');
    delete context.__testOrder;
    return hash;
}

test('processOrders adds new order, sends notification and updates state', () => {
    const context = loadBackgroundContext();

    const existingOrder = createOrder();
    const existingHash = getHashForOrder(context, existingOrder);

    setBackgroundState(context, {
        ordersDB: {
            [existingOrder.id]: existingOrder
        },
        ordersHashDB: {
            [existingOrder.id]: existingHash
        },
        userConfig: {
            rules: {},
            monitorScope: {
                status: [],
                delivery: [],
                payment: [],
                flags: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        }
    });

    const newOrder = createOrder({
        id: '1001-300326',
        orderUrl: 'https://amperkot.ru/admin/orders/1001-300326/'
    });

    context.__testOrders = [existingOrder, newOrder];
    runExpression(context, 'processOrders(__testOrders)');
    delete context.__testOrders;

    const state = getBackgroundState(context);

    assert.equal(context.__testNotifications.length, 1);
    assert.equal(state.ordersDB['1001-300326'].id, '1001-300326');
    assert.equal(
        state.ordersHashDB['1001-300326'],
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

    setBackgroundState(context, {
        ordersDB: {
            [prevOrder.id]: prevOrder
        },
        ordersHashDB: {
            [prevOrder.id]: getHashForOrder(context, prevOrder)
        },
        userConfig: {
            rules: {},
            monitorScope: {
                status: [],
                delivery: [],
                payment: [],
                flags: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        }
    });

    context.__testOrders = [nextOrder];
    runExpression(context, 'processOrders(__testOrders)');
    delete context.__testOrders;

    const state = getBackgroundState(context);

    assert.equal(context.__testNotifications.length, 1);
    assert.equal(state.ordersDB[prevOrder.id].status, 'Оплачен');
    assert.equal(
        state.ordersHashDB[prevOrder.id],
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

    setBackgroundState(context, {
        ordersDB: {
            [prevOrder.id]: prevOrder
        },
        ordersHashDB: {
            [prevOrder.id]: getHashForOrder(context, prevOrder)
        },
        userConfig: {
            rules: {
                ignoreLegalEntityBankTransfer: true
            },
            monitorScope: {
                status: [],
                delivery: [],
                payment: [],
                flags: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        }
    });

    context.__testOrders = [nextOrder];
    runExpression(context, 'processOrders(__testOrders)');
    delete context.__testOrders;

    const state = getBackgroundState(context);

    assert.equal(context.__testNotifications.length, 0);
    assert.equal(
        state.ordersDB[prevOrder.id].payment,
        'Безналичный расчет для юридических лиц'
    );
    assert.equal(
        state.ordersHashDB[prevOrder.id],
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

    setBackgroundState(context, {
        ordersDB: {
            [prevOrder.id]: prevOrder
        },
        ordersHashDB: {
            [prevOrder.id]: getHashForOrder(context, prevOrder)
        },
        userConfig: {
            rules: {},
            monitorScope: {
                status: [],
                delivery: [],
                payment: [],
                flags: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        }
    });

    const before = getBackgroundState(context);

    context.__testOrders = [nextOrder];
    runExpression(context, 'processOrders(__testOrders, { testMode: true })');
    delete context.__testOrders;

    const after = getBackgroundState(context);

    assert.equal(context.__testNotifications.length, 1);
    assert.deepEqual(after.ordersDB, before.ordersDB);
    assert.deepEqual(after.ordersHashDB, before.ordersHashDB);
});

test('runBaseline initializes state without sending notifications', () => {
    const context = loadBackgroundContext();

    setBackgroundState(context, {
        ordersDB: {},
        ordersHashDB: {},
        userConfig: {
            rules: {},
            monitorScope: {
                status: [],
                delivery: [],
                payment: [],
                flags: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
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

    assert.equal(context.__testNotifications.length, 0);
    assert.equal(Object.keys(state.ordersDB).length, 2);
    assert.equal(Object.keys(state.ordersHashDB).length, 2);
    assert.equal(state.pendingRebaseline, false);
    assert.equal(typeof state.lastBaselineDate, 'string');
});