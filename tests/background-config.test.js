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

function getEffectiveConfigSnapshot(context, config) {
    context.__testConfig = config;

    const effectiveConfig = JSON.parse(
        runExpression(context, 'JSON.stringify(getEffectiveUserConfig(__testConfig))')
    );

    delete context.__testConfig;

    return effectiveConfig;
}

function getHashForOrder(context, order) {
    context.__testOrder = order;
    const hash = runExpression(context, 'getHash(__testOrder)');
    delete context.__testOrder;
    return hash;
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

function createWindowedConfig(context, overrides = {}) {
    return getEffectiveConfigSnapshot(context, {
        monitorMode: 'windowed',
        deepSyncMaxPages: 1,
        rules: {},
        monitorScope: createDefaultMonitorScope(),
        ...overrides
    });
}

test('UPDATE_CONFIG normalizes notification triggers without scheduling rebaseline', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            notificationTriggers: {
                changedFields: {
                    status: true
                }
            },
            monitorScope: {
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
            }
        }),
        pendingRebaseline: false
    });

    const response = await sendRuntimeMessage(context, {
        type: 'UPDATE_CONFIG',
        userConfig: {
            monitorMode: 'windowed',
            rules: {
                ignoreOzon: true
            },
            notificationTriggers: {
                changedFields: {
                    status: false
                }
            },
            monitorScope: {
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
            }
        }
    });

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(state.userConfig, 'rules'), false);
    assert.equal(state.userConfig.notificationTriggers.changedFields.status, false);
    assert.equal(state.userConfig.notificationTriggers.changedFields.delivery, true);
    assert.equal(state.pendingRebaseline, false);
});

test('UPDATE_CONFIG sets pendingRebaseline when scope changes', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
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
            }
        }),
        pendingRebaseline: false
    });

    const response = await sendRuntimeMessage(context, {
        type: 'UPDATE_CONFIG',
        userConfig: {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
                status: ['6806'],
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
            }
        }
    });

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.deepEqual(state.userConfig.monitorScope.status, ['6806']);
    assert.equal(state.pendingRebaseline, true);
    assert.equal(state.pendingSyncReason, 'scope-change');
});

test('collection aborts when advance attempt limit is exceeded', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        pendingRebaseline: false,
        lastDeepSyncAt: 0,
        knownOrdersDB: {},
        knownOrdersHashDB: {},
        windowOrdersDB: {},
        windowOrdersHashDB: {},
        collectionSession: {
            mode: 'deep',
            startedAt: Date.now(),
            lastActivityAt: Date.now(),
            advanceAttempts: 33,
            orders: {
                '1000-300326': createOrder()
            },
            isComplete: false,
            completionReason: null,
            currentPage: 1,
            lastCollectedPage: 1,
            nextPage: 2,
            seenKnownOrder: false,
            processedPages: {
                1: true
            }
        },
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
                status: ['6806'],
                delivery: ['9797'],
                payment: ['9791'],
                orderFlags: [],
                store: [],
                reserve: [],
                assemblyStatus: [],
                predicates: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 2,
            isComplete: false,
            data: [createOrder({ id: '1002-300326' })]
        },
        {
            tab: {
                id: 77,
                url: 'https://amperkot.ru/admin/orders/?page=2#tab_wanderer_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(response.collecting, false);
    assert.equal(response.advanced, false);
    assert.equal(response.aborted, true);
    assert.equal(state.collectionSession, null);
    assert.equal(context.__test.tabUpdates.length, 1);
    assert.equal(
        context.__test.tabUpdates[0].updateInfo.url,
        'https://amperkot.ru/admin/orders/?status%5B%5D=6806&delivery%5B%5D=9797&payment%5B%5D=9791#tab_wanderer_worker=1'
    );
});

test('ORDERS keeps collection session open when message is not complete', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
knownOrdersDB: {},
knownOrdersHashDB: {},
windowOrdersDB: {},
windowOrdersHashDB: {},
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
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
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: false,
            data: [
                createOrder()
            ]
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
assert.equal(response.collecting, true);
assert.equal(state.monitorState, 'warming');
assert.equal(state.pendingRebaseline, true);
assert.equal(Object.keys(state.knownOrdersDB).length, 0);
assert.equal(Object.keys(state.windowOrdersDB).length, 0);
assert.equal(state.collectionSession.isComplete, false);
assert.equal(state.collectionSession.currentPage, 1);
assert.equal(state.collectionSession.lastCollectedPage, 1);
assert.equal(Object.keys(state.collectionSession.orders).length, 1);
});

test('UPDATE_CONFIG keeps pendingRebaseline unchanged when config does not change', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const stableConfig = {
        monitorMode: 'windowed',
        rules: {
            ignoreOzon: true
        },
        monitorScope: {
            status: ['6806'],
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
        }
    };

    const effectiveStableConfig = getEffectiveConfigSnapshot(context, stableConfig);

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

test('ORDERS runs rebaseline when pendingRebaseline is set and activates monitor', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

setBackgroundState(context, {
    isRunning: true,
    monitorState: 'warming',
    workerTabId: 77,
    pendingRebaseline: true,
    pendingSyncReason: 'scope-change',
    knownOrdersDB: {
        stale: createOrder({ id: 'stale' })
    },
    knownOrdersHashDB: {
        stale: 'old-hash'
    },
    windowOrdersDB: {
        stale: createOrder({ id: 'stale' })
    },
    windowOrdersHashDB: {
        stale: 'old-hash'
    },
    userConfig: getEffectiveConfigSnapshot(context, {
        monitorMode: 'windowed',
        rules: {},
        monitorScope: {
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
        }
    })
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
    assert.equal(Object.keys(state.knownOrdersDB).length, 3);
    assert.equal(Object.keys(state.windowOrdersDB).length, 2);
    assert.equal(state.knownOrdersDB.stale.id, 'stale');
    assert.equal(state.windowOrdersDB.stale, undefined);
    assert.equal(state.pendingRebaseline, false);
    assert.equal(state.pendingSyncReason, null);
    assert.equal(state.monitorState, 'active');
    assert.equal(state.lastCollectionMetadata.syncReason, 'scope-change');
    assert.equal(state.lastCollectionMetadata.ordersCollected, 2);
    assert.equal(state.lastCollectionMetadata.sessionMode, 'deep');
    assert.equal(context.__test.notifications.length, 0);
});


test('manual-start with known state records changed order while stopped without notification flood', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const prevOrder = createOrder({
        id: 'known',
        status: 'Новый'
    });
    const nextOrder = createOrder({
        id: 'known',
        status: 'Оплачен'
    });

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
        pendingSyncReason: 'manual-start',
        lastDeepSyncAt: 0,
        knownOrdersDB: {
            known: prevOrder
        },
        knownOrdersHashDB: {
            known: getHashForOrder(context, prevOrder)
        },
        windowOrdersDB: {
            known: prevOrder
        },
        windowOrdersHashDB: {
            known: getHashForOrder(context, prevOrder)
        },
        userConfig: createWindowedConfig(context)
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: false,
            data: [nextOrder]
        },
        {
            tab: {
                id: 77,
                url: 'https://amperkot.ru/admin/orders/#tab_wanderer_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);
    const changeLog = state.diagnosticLog.find(entry => entry.scope === 'CHANGE');

    assert.equal(response.ok, true);
    assert.equal(context.__test.notifications.length, 0);
    assert.equal(state.knownOrdersDB.known.status, 'Оплачен');
    assert.equal(state.windowOrdersDB.known.status, 'Оплачен');
    assert.equal(state.pendingRebaseline, false);
    assert.equal(state.pendingSyncReason, null);
    assert.equal(state.monitorState, 'active');
    assert.equal(state.lastCollectionMetadata.syncReason, 'manual-start');
    assert.equal(state.lastCollectionMetadata.ordersCollected, 1);
    assert.equal(state.eventJournal.length, 1);
    assert.equal(state.eventJournal[0].eventKind, 'catch-up');
    assert.equal(state.eventJournal[0].syncReason, 'manual-start');
    assert.equal(state.eventJournal[0].notification.notify, false);
    assert.equal(state.eventJournal[0].notification.ruleId, 'notification-startup-catch-up-suppressed');
    assert.deepEqual(JSON.parse(JSON.stringify(state.eventJournal[0].changedFields)), ['status']);
    assert.ok(changeLog);
    assert.equal(changeLog.details.id, 'known');
    assert.equal(changeLog.details.eventType, 'order-changed');
    assert.deepEqual(JSON.parse(JSON.stringify(changeLog.details.changedFields)), ['status']);
    assert.equal(Object.prototype.hasOwnProperty.call(changeLog.details, 'prev'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(changeLog.details, 'next'), false);
});

test('manual-start with known state records new order while stopped without notification flood', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const knownOrder = createOrder({ id: 'known' });
    const newOrder = createOrder({
        id: 'new-order',
        status: 'Новый',
        orderUrl: 'https://amperkot.ru/admin/orders/new-order/'
    });

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
        pendingSyncReason: 'manual-start',
        lastDeepSyncAt: 0,
        knownOrdersDB: {
            known: knownOrder
        },
        knownOrdersHashDB: {
            known: getHashForOrder(context, knownOrder)
        },
        windowOrdersDB: {
            known: knownOrder
        },
        windowOrdersHashDB: {
            known: getHashForOrder(context, knownOrder)
        },
        userConfig: createWindowedConfig(context)
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: false,
            data: [knownOrder, newOrder]
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
    assert.equal(context.__test.notifications.length, 0);
    assert.equal(state.knownOrdersDB['new-order'].id, 'new-order');
    assert.equal(state.windowOrdersDB['new-order'].id, 'new-order');
    assert.equal(state.eventJournal.length, 1);
    assert.equal(state.eventJournal[0].eventType, 'new-order');
    assert.equal(state.eventJournal[0].eventKind, 'catch-up');
    assert.equal(state.eventJournal[0].notification.notify, false);
    assert.equal(state.eventJournal[0].notification.ruleId, 'notification-startup-catch-up-suppressed');
});

test('manual-start with known state records tag-only catch-up without notification', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const prevOrder = createOrder({
        id: 'known',
        tags: []
    });
    const nextOrder = createOrder({
        id: 'known',
        tags: ['VIP']
    });

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
        pendingSyncReason: 'manual-start',
        lastDeepSyncAt: 0,
        knownOrdersDB: {
            known: prevOrder
        },
        knownOrdersHashDB: {
            known: getHashForOrder(context, prevOrder)
        },
        windowOrdersDB: {
            known: prevOrder
        },
        windowOrdersHashDB: {
            known: getHashForOrder(context, prevOrder)
        },
        userConfig: createWindowedConfig(context)
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: false,
            data: [nextOrder]
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
    assert.equal(context.__test.notifications.length, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(state.knownOrdersDB.known.tags)), ['VIP']);
    assert.deepEqual(JSON.parse(JSON.stringify(state.windowOrdersDB.known.tags)), ['VIP']);
    assert.equal(state.eventJournal.length, 1);
    assert.equal(state.eventJournal[0].eventKind, 'catch-up');
    assert.deepEqual(JSON.parse(JSON.stringify(state.eventJournal[0].changedFields)), ['tags']);
    assert.equal(state.eventJournal[0].notification.notify, false);
});

test('initial start with empty state remains silent baseline', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const newOrder = createOrder({ id: 'new-order' });

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
        pendingSyncReason: 'initial',
        lastDeepSyncAt: 0,
        knownOrdersDB: {},
        knownOrdersHashDB: {},
        windowOrdersDB: {},
        windowOrdersHashDB: {},
        userConfig: createWindowedConfig(context)
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: false,
            data: [newOrder]
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
    assert.equal(context.__test.notifications.length, 0);
    assert.equal(state.eventJournal.length, 0);
    assert.equal(state.knownOrdersDB['new-order'].id, 'new-order');
    assert.equal(state.windowOrdersDB['new-order'].id, 'new-order');
    assert.equal(state.lastCollectionMetadata.syncReason, 'initial');
    assert.equal(state.pendingRebaseline, false);
    assert.equal(state.monitorState, 'active');
});


test('recovery and stale resume with known state stay silent baseline without notification flood', async () => {
    for (const syncReason of ['recovery', 'stale-resume']) {
        const context = loadBackgroundContext();
        await settleBackgroundContext();

        const prevOrder = createOrder({
            id: `known-${syncReason}`,
            status: 'Новый'
        });
        const nextOrder = createOrder({
            id: `known-${syncReason}`,
            status: 'Комплектуется'
        });

        setBackgroundState(context, {
            isRunning: true,
            monitorState: 'warming',
            workerTabId: 77,
            pendingRebaseline: true,
            pendingSyncReason: syncReason,
            lastDeepSyncAt: 0,
            knownOrdersDB: {
                [prevOrder.id]: prevOrder
            },
            knownOrdersHashDB: {
                [prevOrder.id]: getHashForOrder(context, prevOrder)
            },
            windowOrdersDB: {
                [prevOrder.id]: prevOrder
            },
            windowOrdersHashDB: {
                [prevOrder.id]: getHashForOrder(context, prevOrder)
            },
            userConfig: getEffectiveConfigSnapshot(context, {
                monitorMode: 'windowed',
                deepSyncMaxPages: 50,
                monitorScope: createDefaultMonitorScope()
            })
        });

        const response = await sendRuntimeMessage(
            context,
            {
                type: 'ORDERS',
                page: 1,
                isComplete: true,
                completionReason: 'pagination-last-page',
                data: [nextOrder]
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
        assert.equal(state.monitorState, 'active');
        assert.equal(state.pendingRebaseline, false);
        assert.equal(state.pendingSyncReason, null);
        assert.equal(state.knownOrdersDB[prevOrder.id].status, 'Комплектуется');
        assert.equal(state.windowOrdersDB[prevOrder.id].status, 'Комплектуется');
        assert.equal(state.lastCollectionMetadata.syncReason, syncReason);
        assert.equal(state.lastCollectionMetadata.completionReason, 'pagination-last-page');
        assert.equal(context.__test.notifications.length, 0);
        assert.equal(state.eventJournal.length, 0);
    }
});

test('known order marks deep session intersection but does not stop collection before page limit', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const knownOrder = createOrder({ id: 'known' });

setBackgroundState(context, {
    isRunning: true,
    monitorState: 'active',
    workerTabId: 77,
    pendingRebaseline: false,
    lastDeepSyncAt: 0,
    knownOrdersDB: {
        known: knownOrder
    },
    knownOrdersHashDB: {
        known: 'hash'
    },
    windowOrdersDB: {
        known: knownOrder
    },
    windowOrdersHashDB: {
        known: 'hash'
    },
    userConfig: getEffectiveConfigSnapshot(context, {
        monitorMode: 'windowed',
        rules: {},
        monitorScope: {
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
        }
    })
});

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: false,
            data: [
                createOrder(),
                createOrder({ id: 'known' })
            ]
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
    assert.equal(response.collecting, true);
    assert.equal(response.advanced, true);
    assert.equal(state.collectionSession.mode, 'deep');
    assert.equal(state.collectionSession.seenKnownOrder, true);
    assert.equal(state.collectionSession.lastCollectedPage, 1);
});

test('ORDERS advances collection to next page when session is not complete', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
knownOrdersDB: {},
knownOrdersHashDB: {},
windowOrdersDB: {},
windowOrdersHashDB: {},
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
                status: ['6806'],
                delivery: ['9797'],
                payment: ['9791'],
                orderFlags: [],
                store: [],
                reserve: [],
                assemblyStatus: [],
                predicates: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: false,
            data: [createOrder()]
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
    assert.equal(response.collecting, true);
    assert.equal(response.advanced, true);
    assert.equal(state.monitorState, 'warming');
    assert.equal(state.collectionSession.currentPage, 1);
    assert.equal(state.collectionSession.nextPage, 2);
    assert.equal(context.__test.tabUpdates.length, 1);
    assert.equal(
        context.__test.tabUpdates[0].updateInfo.url,
        'https://amperkot.ru/admin/orders/?status%5B%5D=6806&delivery%5B%5D=9797&payment%5B%5D=9791&page=2#tab_wanderer_worker=1'
    );
});

test('fast cycle completes on first page without advancing when deep sync is not due', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        pendingRebaseline: false,
        lastDeepSyncAt: Date.now(),
knownOrdersDB: {
    known: createOrder({ id: 'known' })
},
knownOrdersHashDB: {
    known: 'known-hash'
},
windowOrdersDB: {
    known: createOrder({ id: 'known' })
},
windowOrdersHashDB: {
    known: 'known-hash'
},
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
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
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            data: [
                createOrder({ id: '1001-300326' })
            ]
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
    assert.equal(state.collectionSession, null);
    assert.equal(context.__test.tabUpdates.length, 0);
});

test('deep sync advances until page limit when deep sync is due', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        pendingRebaseline: false,
        lastDeepSyncAt: 0,
knownOrdersDB: {},
knownOrdersHashDB: {},
windowOrdersDB: {},
windowOrdersHashDB: {},
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
                status: ['6806'],
                delivery: ['9797'],
                payment: ['9791'],
                orderFlags: [],
                store: [],
                reserve: [],
                assemblyStatus: [],
                predicates: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: false,
            data: [createOrder()]
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
    assert.equal(response.collecting, true);
    assert.equal(response.advanced, true);
    assert.equal(state.collectionSession.mode, 'deep');
    assert.equal(state.collectionSession.currentPage, 1);
    assert.equal(state.collectionSession.nextPage, 2);
    assert.equal(context.__test.tabUpdates.length, 1);
    assert.equal(
        context.__test.tabUpdates[0].updateInfo.url,
        'https://amperkot.ru/admin/orders/?status%5B%5D=6806&delivery%5B%5D=9797&payment%5B%5D=9791&page=2#tab_wanderer_worker=1'
    );
});


test('deep sync completion returns worker to first page', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
        pendingSyncReason: 'initial',
        lastDeepSyncAt: 0,
        knownOrdersDB: {},
        knownOrdersHashDB: {},
        windowOrdersDB: {},
        windowOrdersHashDB: {},
        collectionSession: {
            mode: 'deep',
            startedAt: 1700000000000,
            lastActivityAt: 1700000000000,
            advanceAttempts: 9,
            orders: {
                page1: createOrder({ id: 'page1' })
            },
            isComplete: false,
            completionReason: null,
            currentPage: 9,
            lastCollectedPage: 9,
            nextPage: 10,
            seenKnownOrder: false,
            processedPages: {
                1: true,
                9: true
            }
        },
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
                status: ['6806'],
                delivery: ['9797'],
                payment: ['9791'],
                orderFlags: [],
                store: [],
                reserve: [],
                assemblyStatus: [],
                predicates: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 10,
            isComplete: false,
            data: [createOrder({ id: 'page10' })]
        },
        {
            tab: {
                id: 77,
                url: 'https://amperkot.ru/admin/orders/?page=10#tab_wanderer_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(state.collectionSession, null);
    assert.equal(state.monitorState, 'active');
    assert.equal(state.lastCollectionMetadata.sessionMode, 'deep');
    assert.equal(state.lastCollectionMetadata.pagesCollected, 10);
    assert.equal(state.lastCollectionMetadata.ordersCollected, 2);
    assert.equal(context.__test.tabUpdates.length, 1);
    assert.equal(
        context.__test.tabUpdates[0].updateInfo.url,
        'https://amperkot.ru/admin/orders/?status%5B%5D=6806&delivery%5B%5D=9797&payment%5B%5D=9791#tab_wanderer_worker=1'
    );
});

test('fast cycle redirects stale non-first worker page without processing it', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const currentOrder = createOrder({
        id: 'known',
        status: 'Новый'
    });
    const stalePageOrder = createOrder({
        id: 'known',
        status: 'Оплачен'
    });
    const previousMetadata = {
        syncReason: 'initial',
        sessionMode: 'deep',
        pagesCollected: 10,
        ordersCollected: 300
    };

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        pendingRebaseline: false,
        lastDeepSyncAt: Date.now(),
        knownOrdersDB: {
            known: currentOrder
        },
        knownOrdersHashDB: {
            known: getHashForOrder(context, currentOrder)
        },
        windowOrdersDB: {
            known: currentOrder
        },
        windowOrdersHashDB: {
            known: getHashForOrder(context, currentOrder)
        },
        lastCollectionMetadata: previousMetadata,
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
                status: ['6806'],
                delivery: ['9797'],
                payment: ['9791'],
                orderFlags: [],
                store: [],
                reserve: [],
                assemblyStatus: [],
                predicates: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 10,
            isComplete: false,
            data: [stalePageOrder]
        },
        {
            tab: {
                id: 77,
                url: 'https://amperkot.ru/admin/orders/?page=10#tab_wanderer_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(response.collecting, true);
    assert.equal(response.redirected, true);
    assert.equal(response.stalePage, true);
    assert.equal(state.knownOrdersDB.known.status, 'Новый');
    assert.deepEqual(state.lastCollectionMetadata, previousMetadata);
    assert.equal(context.__test.notifications.length, 0);
    assert.equal(context.__test.tabUpdates.length, 1);
    assert.equal(
        context.__test.tabUpdates[0].updateInfo.url,
        'https://amperkot.ru/admin/orders/?status%5B%5D=6806&delivery%5B%5D=9797&payment%5B%5D=9791#tab_wanderer_worker=1'
    );
});

test('START creates worker tab with URL from current monitorScope and enters warming', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: false,
        monitorState: 'uninitialized',
        workerTabId: null,
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
                status: ['6806'],
                delivery: ['9797'],
                payment: ['9791'],
                orderFlags: ['1'],
                store: ['4'],
                reserve: ['1'],
                assemblyStatus: ['yes'],
                predicates: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        })
    });

    const response = await sendRuntimeMessage(context, {
        type: 'START'
    });

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(state.isRunning, true);
    assert.equal(state.monitorState, 'warming');
    assert.equal(state.pendingRebaseline, true);
    assert.equal(state.pendingSyncReason, 'initial');
    assert.equal(context.__test.createdTabs.length, 1);
    assert.equal(
        context.__test.createdTabs[0].url,
        'https://amperkot.ru/admin/orders/?status%5B%5D=6806&delivery%5B%5D=9797&payment%5B%5D=9791&store%5B%5D=4#tab_wanderer_worker=1'
    );
});


test('START with known state schedules manual-start catch-up', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const knownOrder = createOrder({ id: 'known' });

    setBackgroundState(context, {
        isRunning: false,
        monitorState: 'uninitialized',
        workerTabId: null,
        knownOrdersDB: {
            known: knownOrder
        },
        knownOrdersHashDB: {
            known: getHashForOrder(context, knownOrder)
        },
        windowOrdersDB: {
            known: knownOrder
        },
        windowOrdersHashDB: {
            known: getHashForOrder(context, knownOrder)
        },
        userConfig: createWindowedConfig(context)
    });

    const response = await sendRuntimeMessage(context, {
        type: 'START'
    });

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(state.isRunning, true);
    assert.equal(state.monitorState, 'warming');
    assert.equal(state.pendingRebaseline, true);
    assert.equal(state.pendingSyncReason, 'manual-start');
    assert.equal(context.__test.createdTabs.length, 1);
});


test('START preserves pending scope-change baseline instead of scheduling catch-up', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const knownOrder = createOrder({
        id: 'known',
        status: 'Новый'
    });
    const changedOrder = createOrder({
        id: 'known',
        status: 'Завершен'
    });
    const newOrder = createOrder({
        id: 'new',
        status: 'Готов к выдаче'
    });

    setBackgroundState(context, {
        isRunning: false,
        monitorState: 'uninitialized',
        workerTabId: null,
        pendingRebaseline: true,
        pendingSyncReason: 'scope-change',
        knownOrdersDB: {
            known: knownOrder
        },
        knownOrdersHashDB: {
            known: getHashForOrder(context, knownOrder)
        },
        windowOrdersDB: {
            known: knownOrder
        },
        windowOrdersHashDB: {
            known: getHashForOrder(context, knownOrder)
        },
        userConfig: createWindowedConfig(context)
    });

    const startResponse = await sendRuntimeMessage(context, {
        type: 'START'
    });

    let state = getBackgroundState(context);

    assert.equal(startResponse.ok, true);
    assert.equal(state.isRunning, true);
    assert.equal(state.monitorState, 'warming');
    assert.equal(state.pendingRebaseline, true);
    assert.equal(state.pendingSyncReason, 'scope-change');
    assert.equal(context.__test.notifications.length, 0);

    const ordersResponse = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: true,
            completionReason: 'pagination-last-page',
            data: [changedOrder, newOrder]
        },
        {
            tab: {
                id: state.workerTabId,
                url: 'https://amperkot.ru/admin/orders/#tab_wanderer_worker=1'
            }
        }
    );

    state = getBackgroundState(context);

    assert.equal(ordersResponse.ok, true);
    assert.equal(state.pendingRebaseline, false);
    assert.equal(state.pendingSyncReason, null);
    assert.equal(state.monitorState, 'active');
    assert.equal(state.lastCollectionMetadata.syncReason, 'scope-change');
    assert.equal(state.knownOrdersDB.known.status, 'Завершен');
    assert.equal(state.knownOrdersDB.new.status, 'Готов к выдаче');
    assert.equal(state.eventJournal.length, 0);
    assert.equal(context.__test.notifications.length, 0);
});

test('GET_CONFIG returns monitorDictionaries together with userConfig', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const effectiveConfig = getEffectiveConfigSnapshot(context, {
        monitorMode: 'windowed',
        rules: {
            ignoreOzon: true
        },
        monitorScope: {
            status: ['6806'],
            delivery: ['9797'],
            payment: ['9791'],
            orderFlags: [],
            store: [],
            reserve: [],
            assemblyStatus: [],
            predicates: {
                ozonOnly: false,
                juridicalOnly: false
            }
        }
    });

    setBackgroundState(context, {
        userConfig: effectiveConfig,
        monitorDictionaries: {
            status: [{ id: '6806', label: 'Ожидает оплаты' }],
            delivery: [{ id: '9797', label: 'Самовывоз' }],
            payment: [{ id: '9791', label: 'Наличными в офисе' }],
            updatedAt: 123
        }
    });

    const response = await sendRuntimeMessage(context, {
        type: 'GET_CONFIG'
    });

    assert.equal(response.ok, true);
    assert.deepEqual(response.userConfig, effectiveConfig);
    assert.deepEqual(response.monitorDictionaries, {
        status: [{ id: '6806', label: 'Ожидает оплаты' }],
        delivery: [{ id: '9797', label: 'Самовывоз' }],
        payment: [{ id: '9791', label: 'Наличными в офисе' }],
        updatedAt: 123
    });
});

test('DICTIONARIES stores normalized payload from worker tab', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        workerTabId: 77
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'DICTIONARIES',
            data: {
                status: [{ id: 6806, label: ' Ожидает оплаты ' }],
                delivery: [{ id: 9797, label: ' Самовывоз ' }],
                payment: [{ id: 9791, label: ' Наличными в офисе ' }],
                orderFlags: [{ id: 1, label: ' Срочный ' }],
                store: [{ id: 4, label: ' Основной склад ' }],
                reserve: [{ id: 1, label: ' В резерве ' }],
                assemblyStatus: [{ id: 'yes', label: ' Скомплектован ' }]
            }
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
    assert.deepEqual(state.monitorDictionaries.status, [
        { id: '6806', label: 'Ожидает оплаты' }
    ]);
    assert.deepEqual(state.monitorDictionaries.delivery, [
        { id: '9797', label: 'Самовывоз' }
    ]);
    assert.deepEqual(state.monitorDictionaries.payment, [
        { id: '9791', label: 'Наличными в офисе' }
    ]);
    assert.deepEqual(state.monitorDictionaries.orderFlags, [
        { id: '1', label: 'Срочный' }
    ]);
    assert.deepEqual(state.monitorDictionaries.store, [
        { id: '4', label: 'Основной склад' }
    ]);
    assert.deepEqual(state.monitorDictionaries.reserve, [
        { id: '1', label: 'В резерве' }
    ]);
    assert.deepEqual(state.monitorDictionaries.assemblyStatus, [
        { id: 'yes', label: 'Скомплектован' }
    ]);
    assert.equal(typeof state.monitorDictionaries.updatedAt, 'number');
});

test('DICTIONARIES ignores payload from non-worker tab', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        workerTabId: 77
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'DICTIONARIES',
            data: {
                status: [{ id: '6806', label: 'Ожидает оплаты' }]
            }
        },
        {
            tab: {
                id: 99,
                url: 'https://amperkot.ru/admin/orders/'
            }
        }
    );

    const state = getBackgroundState(context);

    assert.equal(response.ignored, true);
    assert.equal(state.monitorDictionaries, null);
});

test('UPDATE_CONFIG sets pendingRebaseline when monitorMode changes', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
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
            }
        }),
        pendingRebaseline: false
    });

    const response = await sendRuntimeMessage(context, {
        type: 'UPDATE_CONFIG',
        userConfig: {
            monitorMode: 'active',
            rules: {},
            monitorScope: {
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
            }
        }
    });

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(state.userConfig.monitorMode, 'active');
    assert.equal(state.pendingRebaseline, true);
    assert.equal(state.pendingSyncReason, 'mode-change');
});

test('active mode never starts deep sync even when deepSync is due', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        pendingRebaseline: false,
        lastDeepSyncAt: 0, // normally would trigger deep sync
        knownOrdersDB: {},
        knownOrdersHashDB: {},
        windowOrdersDB: {},
        windowOrdersHashDB: {},
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'active',
            rules: {},
            monitorScope: {
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
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            data: [createOrder()]
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
    assert.equal(state.collectionSession, null); // completed immediately
    assert.equal(context.__test.tabUpdates.length, 0); // no pagination
});

test('active mode never advances to next page', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
        knownOrdersDB: {},
        knownOrdersHashDB: {},
        windowOrdersDB: {},
        windowOrdersHashDB: {},
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'active',
            rules: {},
            monitorScope: {
                status: ['6806'],
                delivery: ['9797'],
                payment: ['9791'],
                orderFlags: [],
                store: [],
                reserve: [],
                assemblyStatus: [],
                predicates: {
                    ozonOnly: false,
                    juridicalOnly: false
                }
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: false,
            data: [createOrder()]
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
    assert.equal(response.advanced, undefined);
    assert.equal(context.__test.tabUpdates.length, 0);
    assert.equal(state.collectionSession, null);
});

test('active mode always uses fast session mode', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        pendingRebaseline: true,
        lastDeepSyncAt: 0,
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'active',
            rules: {},
            monitorScope: {
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
            }
        })
    });

    const policy = JSON.parse(
        runExpression(context, 'JSON.stringify(getCollectionPolicy())')
    );

    assert.equal(policy.sessionMode, 'fast');
    assert.equal(policy.deepSyncDue, false);
    assert.equal(policy.maxPages, 1);
});

test('active deep sync emits notification for changed known order', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const prevOrder = createOrder({
        id: 'known',
        status: 'Новый'
    });

    const nextOrder = createOrder({
        id: 'known',
        status: 'Оплачен'
    });

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        pendingRebaseline: false,
        lastDeepSyncAt: 0,
        knownOrdersDB: {
            known: prevOrder
        },
        knownOrdersHashDB: {
            known: getHashForOrder(context, prevOrder)
        },
        windowOrdersDB: {
            known: prevOrder
        },
        windowOrdersHashDB: {
            known: getHashForOrder(context, prevOrder)
        },
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
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
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 10,
            isComplete: false,
            data: [nextOrder]
        },
        {
            tab: {
                id: 77,
                url: 'https://amperkot.ru/admin/orders/?page=10#tab_wanderer_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(context.__test.notifications.length, 1);
    assert.equal(state.knownOrdersDB.known.status, 'Оплачен');
    assert.equal(state.windowOrdersDB.known.status, 'Оплачен');
    assert.equal(state.collectionSession, null);
    assert.ok(state.lastDeepSyncAt > 0);
});

test('active deep sync rebuilds window snapshot after emitting events', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const oldWindowOrder = createOrder({
        id: 'old-window-order'
    });

    const currentDeepOrder = createOrder({
        id: 'current-deep-order'
    });

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        pendingRebaseline: false,
        lastDeepSyncAt: 0,
        knownOrdersDB: {
            [oldWindowOrder.id]: oldWindowOrder
        },
        knownOrdersHashDB: {
            [oldWindowOrder.id]: getHashForOrder(context, oldWindowOrder)
        },
        windowOrdersDB: {
            [oldWindowOrder.id]: oldWindowOrder
        },
        windowOrdersHashDB: {
            [oldWindowOrder.id]: getHashForOrder(context, oldWindowOrder)
        },
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 10,
            rules: {},
            monitorScope: {
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
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 10,
            isComplete: false,
            data: [currentDeepOrder]
        },
        {
            tab: {
                id: 77,
                url: 'https://amperkot.ru/admin/orders/?page=10#tab_wanderer_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(context.__test.notifications.length, 1);
    assert.equal(state.windowOrdersDB[oldWindowOrder.id], undefined);
    assert.equal(state.windowOrdersDB[currentDeepOrder.id].id, currentDeepOrder.id);
    assert.equal(state.knownOrdersDB[oldWindowOrder.id].id, oldWindowOrder.id);
    assert.equal(state.knownOrdersDB[currentDeepOrder.id].id, currentDeepOrder.id);
});

test('GET_EVENT_JOURNAL returns newest journal entries with filters', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        eventJournal: [
            {
                id: '1',
                orderId: '1000-300326',
                eventType: 'new-order',
                eventKind: 'live'
            },
            {
                id: '2',
                orderId: '2000-300326',
                eventType: 'order-changed',
                eventKind: 'catch-up'
            },
            {
                id: '3',
                orderId: '1000-300326',
                eventType: 'order-changed',
                eventKind: 'live'
            }
        ]
    });

    const response = await sendRuntimeMessage(context, {
        type: 'GET_EVENT_JOURNAL',
        options: {
            orderId: '1000-300326',
            limit: 1
        }
    });

    assert.equal(response.ok, true);
    assert.equal(response.storedTotal, 3);
    assert.equal(response.total, 2);
    assert.equal(response.returned, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(response.entries)), [
        {
            id: '3',
            orderId: '1000-300326',
            eventType: 'order-changed',
            eventKind: 'live'
        }
    ]);
});




test('ORDERS writes deep collection completion entry to diagnostic log', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
        pendingSyncReason: 'recovery',
        lastDeepSyncAt: 0,
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            monitorScope: {
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
            }
        }),
        diagnosticLog: []
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: true,
            completionReason: 'explicit-complete',
            data: [createOrder({ id: 'deep-order' })]
        },
        {
            tab: {
                id: 77,
                url: 'https://amperkot.ru/admin/orders/#tab_wanderer_worker=1'
            }
        }
    );

    const logResponse = await sendRuntimeMessage(context, {
        type: 'GET_DIAGNOSTIC_LOG',
        options: {
            scope: 'COLLECTION',
            order: 'oldest-first',
            limit: 20
        }
    });

    const entries = JSON.parse(JSON.stringify(logResponse.entries));
    const completedEntry = entries.find((entry) => entry.message === 'session completed');

    assert.equal(response.ok, true);
    assert.equal(logResponse.ok, true);
    assert.ok(completedEntry);
    assert.equal(completedEntry.details.mode, 'deep');
    assert.equal(completedEntry.details.pagesCollected, 1);
    assert.equal(completedEntry.details.ordersCount, 1);
    assert.equal(completedEntry.details.completionReason, 'explicit-complete');
});

test('ORDERS does not persist noisy fast process logs without changes', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const order = createOrder({ id: 'fast-order' });
    const hash = getHashForOrder(context, order);

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        pendingRebaseline: false,
        lastDeepSyncAt: Date.now(),
        knownOrdersDB: {
            'fast-order': order
        },
        knownOrdersHashDB: {
            'fast-order': hash
        },
        windowOrdersDB: {
            'fast-order': order
        },
        windowOrdersHashDB: {
            'fast-order': hash
        },
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            monitorScope: {
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
            }
        }),
        diagnosticLog: []
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            data: [order]
        },
        {
            tab: {
                id: 77,
                url: 'https://amperkot.ru/admin/orders/#tab_wanderer_worker=1'
            }
        }
    );

    const logResponse = await sendRuntimeMessage(context, {
        type: 'GET_DIAGNOSTIC_LOG',
        options: {
            order: 'oldest-first',
            limit: 20
        }
    });

    const entries = JSON.parse(JSON.stringify(logResponse.entries));

    assert.equal(response.ok, true);
    assert.equal(logResponse.ok, true);
    assert.equal(entries.some((entry) => entry.scope === 'PROCESS'), false);
    assert.equal(entries.some((entry) => entry.scope === 'COLLECTION' && entry.message === 'session completed'), false);
});

test('GET_DIAGNOSTIC_LOG returns newest diagnostic entries with filters', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        diagnosticLog: [
            { id: '1', createdAt: 1, level: 'INFO', scope: 'CONTROL', message: 'START', details: null },
            { id: '2', createdAt: 2, level: 'WARN', scope: 'COLLECTION', message: 'timeout', details: { page: 2 } },
            { id: '3', createdAt: 3, level: 'WARN', scope: 'WORKER', message: 'dead', details: { tabId: 77 } }
        ]
    });

    const response = await sendRuntimeMessage(context, {
        type: 'GET_DIAGNOSTIC_LOG',
        options: {
            level: 'WARN',
            limit: 1
        }
    });

    assert.equal(response.ok, true);
    assert.equal(response.storedTotal, 3);
    assert.equal(response.total, 2);
    assert.equal(response.returned, 1);
    assert.equal(response.limit, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(response.entries)), [
        { id: '3', createdAt: 3, level: 'WARN', scope: 'WORKER', message: 'dead', details: { tabId: 77 } }
    ]);
});

test('CLEAR_DIAGNOSTIC_LOG clears persistent diagnostic log', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        diagnosticLog: [
            { id: '1', createdAt: 1, level: 'INFO', scope: 'CONTROL', message: 'START', details: null }
        ],
        diagnosticLogDroppedEntries: 3
    });

    const response = await sendRuntimeMessage(context, {
        type: 'CLEAR_DIAGNOSTIC_LOG'
    });
    const state = getBackgroundState(context);
    const lastStorageSet = context.__test.storageSetCalls[context.__test.storageSetCalls.length - 1];

    assert.equal(response.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(state.diagnosticLog)), []);
    assert.equal(state.diagnosticLogDroppedEntries, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(lastStorageSet.diagnosticLog)), []);
    assert.equal(lastStorageSet.diagnosticLogDroppedEntries, 0);
});

test('GET_DIAGNOSTIC_LOG full mode returns all retained entries and retention metadata', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const diagnosticLog = Array.from({ length: 120 }, (_, index) => ({
        id: String(index + 1),
        createdAt: index + 1,
        level: 'INFO',
        scope: 'TEST',
        message: `entry-${index + 1}`,
        details: null
    }));

    setBackgroundState(context, {
        diagnosticLog,
        diagnosticLogDroppedEntries: 5
    });

    const preview = await sendRuntimeMessage(context, {
        type: 'GET_DIAGNOSTIC_LOG',
        options: {
            limit: 100,
            order: 'oldest-first'
        }
    });
    const full = await sendRuntimeMessage(context, {
        type: 'GET_DIAGNOSTIC_LOG',
        options: {
            mode: 'full',
            order: 'oldest-first'
        }
    });

    assert.equal(preview.ok, true);
    assert.equal(preview.mode, 'preview');
    assert.equal(preview.returned, 100);
    assert.equal(preview.entries[0].id, '21');
    assert.equal(full.ok, true);
    assert.equal(full.mode, 'full');
    assert.equal(full.returned, 120);
    assert.equal(full.retainedTotal, 120);
    assert.equal(full.entries[0].id, '1');
    assert.equal(full.entries[119].id, '120');
    assert.equal(full.droppedEntries, 5);
    assert.equal(full.retention.maxEntries, context.DEFAULT_DIAGNOSTIC_LOG_LIMIT);
    assert.equal(full.retention.maxBytes, context.DEFAULT_DIAGNOSTIC_LOG_MAX_BYTES);
});

test('UPDATE_CONFIG diagnostic log stores sanitized config summaries', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 50,
            monitorScope: {
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
            }
        }),
        diagnosticLog: []
    });

    const response = await sendRuntimeMessage(context, {
        type: 'UPDATE_CONFIG',
        userConfig: {
            monitorMode: 'windowed',
            deepSyncMaxPages: 50,
            monitorScope: {
                status: ['6806'],
                delivery: [],
                payment: [],
                orderFlags: [],
                store: [],
                reserve: [],
                assemblyStatus: [],
                predicates: {
                    ozonOnly: true,
                    juridicalOnly: true
                }
            }
        }
    });

    const logResponse = await sendRuntimeMessage(context, {
        type: 'GET_DIAGNOSTIC_LOG',
        options: {
            scope: 'CONFIG',
            order: 'oldest-first',
            limit: 20
        }
    });

    const entries = JSON.parse(JSON.stringify(logResponse.entries));
    const scopeEntry = entries.find((entry) => entry.message === 'monitor scope changed');
    const configEntry = entries.find((entry) => entry.message === 'effective config summary');

    assert.equal(response.ok, true);
    assert.equal(logResponse.ok, true);
    assert.ok(scopeEntry);
    assert.ok(configEntry);
    assert.equal(scopeEntry.details.scope, 'filtered');
    assert.equal(scopeEntry.details.statusCount, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(scopeEntry.details, 'predicates'), false);
    assert.equal(configEntry.details.monitorMode, 'windowed');
    assert.equal(configEntry.details.deepSyncMaxPages, 50);
    assert.equal(configEntry.details.monitorScope.scope, 'filtered');
    assert.equal(configEntry.details.monitorScope.statusCount, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(configEntry.details.monitorScope, 'predicates'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(configEntry.details, 'monitorScopeSignature'), false);
});


test('deep collection page navigation is console-only while completion stays persistent', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
        pendingSyncReason: 'recovery',
        lastDeepSyncAt: 0,
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 2,
            monitorScope: createDefaultMonitorScope()
        }),
        diagnosticLog: []
    });

    const sender = {
        tab: {
            id: 77,
            url: 'https://amperkot.ru/admin/orders/#tab_wanderer_worker=1'
        }
    };

    const firstResponse = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: false,
            data: [createOrder({ id: 'page-1-order' })]
        },
        sender
    );

    const secondResponse = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 2,
            isComplete: false,
            data: [createOrder({ id: 'page-2-order' })]
        },
        sender
    );

    const logResponse = await sendRuntimeMessage(context, {
        type: 'GET_DIAGNOSTIC_LOG',
        options: {
            scope: 'COLLECTION',
            order: 'oldest-first',
            limit: 20
        }
    });

    const entries = JSON.parse(JSON.stringify(logResponse.entries));
    const messages = entries.map(entry => entry.message);

    assert.equal(firstResponse.ok, true);
    assert.equal(firstResponse.advanced, true);
    assert.equal(secondResponse.ok, true);
    assert.equal(logResponse.ok, true);
    assert.equal(messages.includes('navigated to page 2'), false);
    assert.equal(messages.includes('session completed'), true);
});

test('deep sync completes early when pagination reports last page', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
        pendingSyncReason: 'manual-start',
        lastDeepSyncAt: 0,
        knownOrdersDB: {},
        knownOrdersHashDB: {},
        windowOrdersDB: {},
        windowOrdersHashDB: {},
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 50,
            monitorScope: createDefaultMonitorScope()
        })
    });

    const sender = {
        tab: {
            id: 77,
            url: 'https://amperkot.ru/admin/orders/#tab_wanderer_worker=1'
        }
    };

    const first = await sendRuntimeMessage(context, {
        type: 'ORDERS',
        page: 1,
        isComplete: false,
        completionReason: null,
        data: [createOrder({ id: 'page-1' })]
    }, sender);

    const second = await sendRuntimeMessage(context, {
        type: 'ORDERS',
        page: 2,
        isComplete: false,
        completionReason: null,
        data: [createOrder({ id: 'page-2' })]
    }, sender);

    const third = await sendRuntimeMessage(context, {
        type: 'ORDERS',
        page: 3,
        isComplete: true,
        completionReason: 'pagination-last-page',
        data: [createOrder({ id: 'page-3' })]
    }, sender);

    const state = getBackgroundState(context);

    assert.equal(first.collecting, true);
    assert.equal(second.collecting, true);
    assert.equal(third.ok, true);
    assert.equal(state.monitorState, 'active');
    assert.equal(state.pendingRebaseline, false);
    assert.equal(state.collectionSession, null);
    assert.equal(Object.keys(state.windowOrdersDB).length, 3);
    assert.equal(state.lastCollectionMetadata.pagesCollected, 3);
    assert.equal(state.lastCollectionMetadata.ordersCollected, 3);
    assert.equal(state.lastCollectionMetadata.completionReason, 'pagination-last-page');
    assert.equal(context.__test.tabUpdates.length, 3);
    assert.match(context.__test.tabUpdates[0].updateInfo.url, /page=2/);
    assert.match(context.__test.tabUpdates[1].updateInfo.url, /page=3/);
    assert.doesNotMatch(context.__test.tabUpdates[2].updateInfo.url, /page=/);
});

test('deep sync completes empty scoped first page without waiting for timeout', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'warming',
        workerTabId: 77,
        pendingRebaseline: true,
        pendingSyncReason: 'manual-start',
        lastDeepSyncAt: 0,
        knownOrdersDB: {},
        knownOrdersHashDB: {},
        windowOrdersDB: {},
        windowOrdersHashDB: {},
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 50,
            monitorScope: createDefaultMonitorScope()
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: true,
            completionReason: 'empty-first-page',
            data: []
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
    assert.equal(state.monitorState, 'active');
    assert.equal(state.pendingRebaseline, false);
    assert.equal(state.collectionSession, null);
    assert.equal(Object.keys(state.windowOrdersDB).length, 0);
    assert.equal(state.lastCollectionMetadata.pagesCollected, 1);
    assert.equal(state.lastCollectionMetadata.ordersCollected, 0);
    assert.equal(state.lastCollectionMetadata.completionReason, 'empty-first-page');
});

test('UPDATE_CONFIG records monitor scope change in event journal without notification', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            deepSyncMaxPages: 50,
            monitorScope: createDefaultMonitorScope()
        }),
        monitorDictionaries: {
            status: [{ id: '6806', label: 'Новый' }],
            delivery: [],
            payment: [],
            orderFlags: [],
            store: [],
            reserve: [],
            assemblyStatus: []
        },
        eventJournal: [],
        pendingRebaseline: false
    });

    const response = await sendRuntimeMessage(context, {
        type: 'UPDATE_CONFIG',
        userConfig: {
            monitorMode: 'windowed',
            deepSyncMaxPages: 50,
            monitorScope: {
                ...createDefaultMonitorScope(),
                status: ['6806']
            }
        }
    });

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(state.pendingRebaseline, true);
    assert.equal(state.pendingSyncReason, 'scope-change');
    assert.equal(context.__test.notifications.length, 0);
    assert.equal(state.eventJournal.length, 1);
    assert.equal(state.eventJournal[0].eventType, 'scope-changed');
    assert.equal(state.eventJournal[0].eventKind, 'scope-change');
    assert.equal(state.eventJournal[0].syncReason, 'scope-change');
    assert.deepEqual(state.eventJournal[0].changedFields, ['scope.status']);
    assert.deepEqual(state.eventJournal[0].diff, [
        {
            field: 'scope.status',
            before: ['Все'],
            after: ['Новый']
        }
    ]);
    assert.equal(state.eventJournal[0].notification.notify, false);
});

test('GET_EVENT_JOURNAL can filter entries to watched orders from user config', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        userConfig: createWindowedConfig(context, {
            watchedOrders: {
                items: [
                    { id: '2000-300326' }
                ]
            }
        }),
        eventJournal: [
            { orderId: '1000-300326', eventType: 'new-order', eventKind: 'live', createdAt: 1 },
            { orderId: '2000-300326', eventType: 'order-changed', eventKind: 'live', createdAt: 2 },
            { orderId: '', eventType: 'scope-changed', eventKind: 'scope-change', createdAt: 3 }
        ]
    });

    const response = await sendRuntimeMessage(context, {
        type: 'GET_EVENT_JOURNAL',
        options: {
            watchedOnly: true,
            limit: 10
        }
    });

    assert.equal(response.ok, true);
    assert.equal(response.total, 1);
    assert.equal(response.entries.length, 1);
    assert.equal(response.entries[0].orderId, '2000-300326');
});

test('direct follow-up tick opens separate direct worker for watched order', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        directWorkerTabId: null,
        directFollowUpState: null,
        userConfig: createWindowedConfig(context, {
            watchedOrders: {
                items: [
                    { id: '1000-300326' }
                ]
            }
        })
    });

    const started = await context.runDirectFollowUpTick();
    const state = getBackgroundState(context);

    assert.equal(started, true);
    assert.equal(context.__test.createdTabs.length, 1);
    assert.equal(
        context.__test.createdTabs[0].url,
        'https://amperkot.ru/admin/orders/1000-300326/#tab_wanderer_direct_worker=1'
    );
    assert.equal(context.__test.createdTabs[0].active, false);
    assert.equal(state.directWorkerTabId, 1);
    assert.equal(state.directFollowUpState.currentOrderId, '1000-300326');
    assert.equal(state.workerTabId, 77);
});

test('DIRECT_ORDER from direct worker updates watched order status and closes direct tab', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        directWorkerTabId: 88,
        directFollowUpState: {
            currentOrderId: '1000-300326',
            nextIndex: 0,
            lastStartedAt: 1700000000000
        },
        userConfig: createWindowedConfig(context, {
            watchedOrders: {
                items: [
                    { id: '1000-300326' }
                ]
            }
        })
    });

    const checkResponse = await sendRuntimeMessage(
        context,
        { type: 'CHECK_DIRECT_WORKER' },
        {
            tab: {
                id: 88,
                url: 'https://amperkot.ru/admin/orders/1000-300326/#tab_wanderer_direct_worker=1'
            }
        }
    );

    assert.equal(checkResponse.ok, true);
    assert.equal(checkResponse.isDirectWorker, true);
    assert.equal(checkResponse.orderId, '1000-300326');

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'DIRECT_ORDER',
            orderId: '1000-300326',
            data: createOrder({ id: '1000-300326', status: 'Комплектуется' })
        },
        {
            tab: {
                id: 88,
                url: 'https://amperkot.ru/admin/orders/1000-300326/#tab_wanderer_direct_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(response.checked, true);
    assert.equal(state.directWorkerTabId, null);
    assert.equal(state.directFollowUpState.currentOrderId, null);
    assert.equal(state.userConfig.watchedOrders.items[0].status, 'active');
    assert.ok(state.userConfig.watchedOrders.items[0].lastCheckedAt > 0);
    assert.equal(state.userConfig.watchedOrders.items[0].lastError, null);
    assert.deepEqual(context.__test.removedTabs, [88]);
});

test('DIRECT_ORDER first successful direct check baselines watched order without notification', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        directWorkerTabId: 88,
        directFollowUpState: {
            currentOrderId: '1000-300326',
            nextIndex: 0,
            lastStartedAt: 1700000000000
        },
        knownOrdersDB: {},
        knownOrdersHashDB: {},
        eventJournal: [],
        userConfig: createWindowedConfig(context, {
            watchedOrders: {
                items: [
                    { id: '1000-300326' }
                ]
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'DIRECT_ORDER',
            orderId: '1000-300326',
            data: createOrder({ id: '1000-300326', status: 'Комплектуется' })
        },
        {
            tab: {
                id: 88,
                url: 'https://amperkot.ru/admin/orders/1000-300326/#tab_wanderer_direct_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);
    const watchedItem = state.userConfig.watchedOrders.items[0];

    assert.equal(response.ok, true);
    assert.equal(response.checked, true);
    assert.equal(state.knownOrdersDB['1000-300326'].status, 'Комплектуется');
    assert.equal(state.eventJournal.length, 0);
    assert.equal(context.__test.notifications.length, 0);
    assert.ok(watchedItem.lastBaselineAt > 0);
    assert.ok(watchedItem.lastCheckedAt > 0);
    assert.equal(watchedItem.lastEventAt, null);
    assert.equal(watchedItem.lastError, null);
});

test('DIRECT_ORDER after direct baseline records event and notifies through shared rules', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const prevOrder = createOrder({ id: '1000-300326', status: 'Новый' });
    const nextOrder = createOrder({ id: '1000-300326', status: 'Комплектуется' });
    const prevHash = getHashForOrder(context, prevOrder);

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        directWorkerTabId: 88,
        directFollowUpState: {
            currentOrderId: '1000-300326',
            nextIndex: 0,
            lastStartedAt: 1700000000000
        },
        knownOrdersDB: {
            '1000-300326': prevOrder
        },
        knownOrdersHashDB: {
            '1000-300326': prevHash
        },
        eventJournal: [],
        userConfig: createWindowedConfig(context, {
            watchedOrders: {
                items: [
                    { id: '1000-300326', lastBaselineAt: 1700000000000 }
                ]
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'DIRECT_ORDER',
            orderId: '1000-300326',
            data: nextOrder
        },
        {
            tab: {
                id: 88,
                url: 'https://amperkot.ru/admin/orders/1000-300326/#tab_wanderer_direct_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);
    const entry = state.eventJournal[0];
    const watchedItem = state.userConfig.watchedOrders.items[0];

    assert.equal(response.ok, true);
    assert.equal(response.checked, true);
    assert.equal(context.__test.notifications.length, 1);
    assert.equal(context.__test.notifications[0].title, 'Заказ №1000-300326 изменён');
    assert.equal(context.__test.notifications[0].message, 'Статус: Новый → Комплектуется');
    assert.equal(state.knownOrdersDB['1000-300326'].status, 'Комплектуется');
    assert.equal(entry.orderId, '1000-300326');
    assert.equal(entry.eventType, 'order-changed');
    assert.equal(entry.eventKind, 'direct-follow-up');
    assert.equal(entry.syncReason, 'direct-follow-up');
    assert.deepEqual(entry.changedFields, ['status']);
    assert.equal(entry.notification.notify, true);
    assert.ok(watchedItem.lastCheckedAt > 0);
    assert.ok(watchedItem.lastEventAt > 0);
    assert.equal(watchedItem.lastError, null);
});

test('DIRECT_ORDER ignores dynamic local city time changes', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const prevOrder = createOrder({
        id: '3010-010726',
        city: 'Мытищи, Московская обл. (местное время: 12:26)'
    });
    const nextOrder = createOrder({
        id: '3010-010726',
        city: 'Мытищи, Московская обл. (местное время: 12:28)'
    });

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        directWorkerTabId: 88,
        directFollowUpState: {
            currentOrderId: '3010-010726',
            nextIndex: 0,
            lastStartedAt: 1700000000000
        },
        knownOrdersDB: {
            '3010-010726': prevOrder
        },
        knownOrdersHashDB: {
            '3010-010726': 'legacy-hash-with-local-time'
        },
        directFollowUpOrdersDB: {
            '3010-010726': prevOrder
        },
        directFollowUpHashDB: {
            '3010-010726': 'legacy-direct-hash-with-local-time'
        },
        eventJournal: [],
        userConfig: createWindowedConfig(context, {
            watchedOrders: {
                items: [
                    { id: '3010-010726', lastBaselineAt: 1700000000000 }
                ]
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'DIRECT_ORDER',
            orderId: '3010-010726',
            data: nextOrder
        },
        {
            tab: {
                id: 88,
                url: 'https://amperkot.ru/admin/orders/3010-010726/#tab_wanderer_direct_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(response.checked, true);
    assert.equal(context.__test.notifications.length, 0);
    assert.equal(state.eventJournal.length, 0);
    assert.equal(state.directFollowUpHashDB['3010-010726'], getHashForOrder(context, nextOrder));
    assert.equal(state.knownOrdersHashDB['3010-010726'], getHashForOrder(context, nextOrder));
});

test('DIRECT_ORDER first direct baseline preserves fuller known list state', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const knownOrder = createOrder({
        id: '1000-300326',
        status: 'Новый',
        delivery: 'Самовывоз',
        payment: 'Наличными в офисе',
        city: 'Санкт-Петербург',
        tags: ['Юрик']
    });
    const directOrder = createOrder({
        id: '1000-300326',
        status: 'Комплектуется',
        delivery: '',
        payment: '',
        city: '',
        tags: []
    });

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        directWorkerTabId: 88,
        directFollowUpState: {
            currentOrderId: '1000-300326',
            nextIndex: 0,
            lastStartedAt: 1700000000000
        },
        knownOrdersDB: {
            '1000-300326': knownOrder
        },
        knownOrdersHashDB: {
            '1000-300326': getHashForOrder(context, knownOrder)
        },
        eventJournal: [],
        userConfig: createWindowedConfig(context, {
            watchedOrders: {
                items: [
                    { id: '1000-300326' }
                ]
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'DIRECT_ORDER',
            orderId: '1000-300326',
            data: directOrder
        },
        {
            tab: {
                id: 88,
                url: 'https://amperkot.ru/admin/orders/1000-300326/#tab_wanderer_direct_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);

    assert.equal(response.ok, true);
    assert.equal(context.__test.notifications.length, 0);
    assert.equal(state.eventJournal.length, 0);
    assert.equal(state.knownOrdersDB['1000-300326'].status, 'Комплектуется');
    assert.equal(state.knownOrdersDB['1000-300326'].delivery, 'Самовывоз');
    assert.equal(state.knownOrdersDB['1000-300326'].payment, 'Наличными в офисе');
    assert.equal(state.knownOrdersDB['1000-300326'].city, 'Санкт-Петербург');
    assert.deepEqual(JSON.parse(JSON.stringify(state.knownOrdersDB['1000-300326'].tags)), ['Юрик']);
    assert.equal(state.directFollowUpOrdersDB['1000-300326'].status, 'Комплектуется');
    assert.equal(state.directFollowUpOrdersDB['1000-300326'].delivery, '');
});

test('DIRECT_ORDER change synchronizes window state to avoid duplicate list notification', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const prevOrder = createOrder({ id: '1000-300326', status: 'Новый' });
    const nextOrder = createOrder({ id: '1000-300326', status: 'Комплектуется' });
    const prevHash = getHashForOrder(context, prevOrder);

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        directWorkerTabId: 88,
        directFollowUpState: {
            currentOrderId: '1000-300326',
            nextIndex: 0,
            lastStartedAt: 1700000000000
        },
        knownOrdersDB: {
            '1000-300326': prevOrder
        },
        knownOrdersHashDB: {
            '1000-300326': prevHash
        },
        windowOrdersDB: {
            '1000-300326': prevOrder
        },
        windowOrdersHashDB: {
            '1000-300326': prevHash
        },
        directFollowUpOrdersDB: {
            '1000-300326': prevOrder
        },
        directFollowUpHashDB: {
            '1000-300326': prevHash
        },
        eventJournal: [],
        userConfig: createWindowedConfig(context, {
            watchedOrders: {
                items: [
                    { id: '1000-300326', lastBaselineAt: 1700000000000 }
                ]
            }
        })
    });

    await sendRuntimeMessage(
        context,
        {
            type: 'DIRECT_ORDER',
            orderId: '1000-300326',
            data: nextOrder
        },
        {
            tab: {
                id: 88,
                url: 'https://amperkot.ru/admin/orders/1000-300326/#tab_wanderer_direct_worker=1'
            }
        }
    );

    assert.equal(context.__test.notifications.length, 1);

    const listResponse = await sendRuntimeMessage(
        context,
        {
            type: 'ORDERS',
            page: 1,
            isComplete: true,
            data: [nextOrder]
        },
        {
            tab: {
                id: 77,
                url: 'https://amperkot.ru/admin/orders/#tab_wanderer_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);

    assert.equal(listResponse.ok, true);
    assert.equal(context.__test.notifications.length, 1);
    assert.equal(state.eventJournal.length, 1);
    assert.equal(state.windowOrdersDB['1000-300326'].status, 'Комплектуется');
    assert.equal(state.windowOrdersHashDB['1000-300326'], getHashForOrder(context, nextOrder));
});

test('DIRECT_ORDER tag-only direct change records history without notification', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    const prevOrder = createOrder({ id: '1000-300326', tags: ['Юрик'] });
    const nextOrder = createOrder({ id: '1000-300326', tags: ['ОЗОН'] });
    const prevHash = getHashForOrder(context, prevOrder);

    setBackgroundState(context, {
        isRunning: true,
        monitorState: 'active',
        workerTabId: 77,
        directWorkerTabId: 88,
        directFollowUpState: {
            currentOrderId: '1000-300326',
            nextIndex: 0,
            lastStartedAt: 1700000000000
        },
        knownOrdersDB: {
            '1000-300326': prevOrder
        },
        knownOrdersHashDB: {
            '1000-300326': prevHash
        },
        eventJournal: [],
        userConfig: createWindowedConfig(context, {
            watchedOrders: {
                items: [
                    { id: '1000-300326', lastBaselineAt: 1700000000000 }
                ]
            }
        })
    });

    const response = await sendRuntimeMessage(
        context,
        {
            type: 'DIRECT_ORDER',
            orderId: '1000-300326',
            data: nextOrder
        },
        {
            tab: {
                id: 88,
                url: 'https://amperkot.ru/admin/orders/1000-300326/#tab_wanderer_direct_worker=1'
            }
        }
    );

    const state = getBackgroundState(context);
    const entry = state.eventJournal[0];
    const watchedItem = state.userConfig.watchedOrders.items[0];

    assert.equal(response.ok, true);
    assert.equal(context.__test.notifications.length, 0);
    assert.equal(state.eventJournal.length, 1);
    assert.equal(entry.eventKind, 'direct-follow-up');
    assert.deepEqual(entry.changedFields, ['tags']);
    assert.equal(entry.notification.notify, false);
    assert.equal(entry.notification.ruleId, 'notification-trigger-no-enabled-changed-fields');
    assert.ok(watchedItem.lastEventAt > 0);
});

test('GET_ORDER_LOOKUP resolves short order candidates without returning broad history', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        knownOrdersDB: {
            '1001-300326': {
                id: '1001-300326',
                status: 'Оплачен'
            }
        },
        eventJournal: [
            {
                id: '1',
                orderId: '1001-290326',
                createdAt: 1700000000000,
                eventType: 'order-changed'
            },
            {
                id: '2',
                orderId: '1001-300326',
                createdAt: 1700000100000,
                eventType: 'order-changed'
            },
            {
                id: '3',
                orderId: '2000-300326',
                createdAt: 1700000200000,
                eventType: 'order-changed'
            }
        ],
        userConfig: getEffectiveConfigSnapshot(context, {
            watchedOrders: {
                items: [
                    { id: '1001-300326' }
                ]
            }
        })
    });

    const response = await sendRuntimeMessage(context, {
        type: 'GET_ORDER_LOOKUP',
        options: {
            query: '1001'
        }
    });

    assert.equal(response.ok, true);
    assert.equal(response.status, 'multiple-candidates');
    assert.deepEqual(JSON.parse(JSON.stringify(response.candidates.map(candidate => candidate.orderId))), [
        '1001-300326',
        '1001-290326'
    ]);
    assert.equal(response.entries.length, 0);
});
