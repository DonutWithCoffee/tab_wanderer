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

test('UPDATE_CONFIG sets pendingRebaseline when rules change', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
            rules: {
                ignoreOzon: false
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
    assert.equal(state.userConfig.rules.ignoreOzon, true);
    assert.equal(state.pendingRebaseline, true);
});

test('UPDATE_CONFIG sets pendingRebaseline when scope changes', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
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
        }),
        pendingRebaseline: false
    });

    const response = await sendRuntimeMessage(context, {
        type: 'UPDATE_CONFIG',
        userConfig: {
            monitorMode: 'windowed',
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
            advanceAttempts: 12,
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
    assert.equal(Object.keys(state.knownOrdersDB).length, 2);
    assert.equal(Object.keys(state.windowOrdersDB).length, 2);
    assert.equal(state.knownOrdersDB.stale, undefined);
    assert.equal(state.windowOrdersDB.stale, undefined);
    assert.equal(state.pendingRebaseline, false);
    assert.equal(state.monitorState, 'active');
    assert.equal(context.__test.notifications.length, 0);
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

test('START creates worker tab with URL from current monitorScope and enters warming', async () => {
    const context = loadBackgroundContext();
    await settleBackgroundContext();

    setBackgroundState(context, {
        isRunning: false,
        monitorState: 'uninitialized',
        workerTabId: null,
        userConfig: getEffectiveConfigSnapshot(context, {
            monitorMode: 'windowed',
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
    assert.equal(context.__test.createdTabs.length, 1);
    assert.equal(
        context.__test.createdTabs[0].url,
        'https://amperkot.ru/admin/orders/?status%5B%5D=6806&delivery%5B%5D=9797&payment%5B%5D=9791&flag%5B%5D=1&store%5B%5D=4&reserve%5B%5D=1&assembly_status%5B%5D=yes#tab_wanderer_worker=1'
    );
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
                payment: [{ id: 9791, label: ' Наличными в офисе ' }]
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