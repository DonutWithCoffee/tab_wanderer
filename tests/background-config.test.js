const test = require('node:test');
const assert = require('node:assert/strict');
const {
    loadBackgroundContext,
    settleBackgroundContext,
    runExpression,
    setBackgroundState,
    getBackgroundState,
    sendRuntimeMessage
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

test('UPDATE_CONFIG sets pendingRebaseline when rules change', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        userConfig: {
            rules: {
                ignoreOzon: false
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
        },
        pendingRebaseline: false
    });

    const response = await sendRuntimeMessage(context, {
        type: 'UPDATE_CONFIG',
        userConfig: {
            rules: {
                ignoreOzon: true
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

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(state.userConfig.rules.ignoreOzon, true);
    assert.equal(state.pendingRebaseline, true);
});

test('UPDATE_CONFIG sets pendingRebaseline when scope changes', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
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
        pendingRebaseline: false
    });

    const response = await sendRuntimeMessage(context, {
        type: 'UPDATE_CONFIG',
        userConfig: {
            rules: {},
            monitorScope: {
                status: ['6806'],
                delivery: [],
                payment: [],
                flags: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        }
    });

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.deepEqual(state.userConfig.monitorScope.status, ['6806']);
    assert.equal(state.pendingRebaseline, true);
});

test('UPDATE_CONFIG keeps pendingRebaseline unchanged when config does not change', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const stableConfig = {
        rules: {
            ignoreOzon: true
        },
        monitorScope: {
            status: ['6806'],
            delivery: [],
            payment: [],
            flags: {
                ozonOnly: false,
                juridicalOnly: false
            }
        }
    };

    context.__testStableConfig = stableConfig;

    const effectiveStableConfig = JSON.parse(
        runExpression(context, 'JSON.stringify(getEffectiveUserConfig(__testStableConfig))')
    );

    delete context.__testStableConfig;

    setBackgroundState(context, {
        userConfig: effectiveStableConfig,
        pendingRebaseline: false
    });

    const response = await sendRuntimeMessage(context, {
        type: 'UPDATE_CONFIG',
        userConfig: stableConfig
    });

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(state.pendingRebaseline, false);
});

test('ORDERS runs rebaseline when pendingRebaseline is set', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        workerTabId: 77,
        pendingRebaseline: true,
        ordersDB: {
            stale: createOrder({ id: 'stale' })
        },
        ordersHashDB: {
            stale: 'old-hash'
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

    const orders = [
        createOrder(),
        createOrder({
            id: '1001-300326',
            orderUrl: 'https://amperkot.ru/admin/orders/1001-300326/'
        })
    ];

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            data: orders
        },
        {
            tab: {
                id: 77,
                url: 'https://amperkot.ru/admin/orders/#tab_wanderer_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(Object.keys(state.ordersDB).length, 2);
    assert.equal(state.ordersDB.stale, undefined);
    assert.equal(state.pendingRebaseline, false);
    assert.equal(context.__test.notifications.length, 0);
});

test('START creates worker tab with URL from current monitorScope', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: false,
        workerTabId: null,
        userConfig: {
            rules: {},
            monitorScope: {
                status: ['6806'],
                delivery: ['9797'],
                payment: ['9791'],
                flags: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        }
    });

    const response = await sendRuntimeMessage(context, {
        type: 'START'
    });

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(state.isRunning, true);
    assert.equal(context.__test.createdTabs.length, 1);
    assert.equal(
        context.__test.createdTabs[0].url,
        'https://amperkot.ru/admin/orders/?status%5B%5D=6806&delivery%5B%5D=9797&payment%5B%5D=9791#tab_wanderer_worker=1'
    );
});