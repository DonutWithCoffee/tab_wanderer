const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRulesContext } = require('./helpers/load-extension-context');

function createOrder(overrides = {}) {
    return {
        id: '1000-300326',
        status: 'Новый',
        delivery: 'Пункт самовывоза СДЭК',
        payment: 'Оплата онлайн',
        contractor: '',
        date: '30 мар. 2026 10:00',
        ...overrides
    };
}

test('normalizeMonitorScope keeps visible filters and drops hidden UI filters', () => {
    const context = loadRulesContext();

    const normalized = context.normalizeMonitorScope({
        status: ['6806'],
        delivery: '9797',
        payment: null,
        orderFlags: ['1'],
        store: ['4'],
        reserve: ['1'],
        assemblyStatus: ['partial'],
        predicates: {
            ozonOnly: 1,
            juridicalOnly: 0
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
        status: ['6806'],
        delivery: [],
        payment: [],
        orderFlags: [],
        store: ['4'],
        reserve: [],
        assemblyStatus: []
    });
    assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'predicates'), false);
});

test('getEffectiveConfig normalizes monitor scope and drops legacy rules config', () => {
    const context = loadRulesContext();

    const config = context.getEffectiveConfig({
        rules: {
            ignoreOzon: true
        },
        monitorScope: {
            payment: ['9791']
        }
    });

    assert.equal(Object.prototype.hasOwnProperty.call(config, 'rules'), false);
    assert.deepEqual(JSON.parse(JSON.stringify(config.monitorScope)), {
        status: [],
        delivery: [],
        payment: ['9791'],
        orderFlags: [],
        store: [],
        reserve: [],
        assemblyStatus: []
    });
    assert.equal(Object.prototype.hasOwnProperty.call(config.monitorScope, 'predicates'), false);
});

test('getEffectiveConfig normalizes notification trigger defaults', () => {
    const context = loadRulesContext();

    const config = context.getEffectiveConfig({});

    assert.equal(config.notificationTriggers.newOrders, true);
    assert.equal(config.notificationTriggers.changedOrders, true);
    assert.deepEqual(JSON.parse(JSON.stringify(config.notificationTriggers.changedFields)), {
        status: true,
        delivery: true,
        payment: true,
        city: true
    });
});

test('getEffectiveConfig merges incoming notification triggers with defaults', () => {
    const context = loadRulesContext();

    const config = context.getEffectiveConfig({
        notificationTriggers: {
            newOrders: false,
            changedFields: {
                status: false,
                city: false,
                contractor: true
            }
        }
    });

    assert.equal(config.notificationTriggers.newOrders, false);
    assert.equal(config.notificationTriggers.changedOrders, true);
    assert.equal(config.notificationTriggers.changedFields.status, false);
    assert.equal(config.notificationTriggers.changedFields.delivery, true);
    assert.equal(config.notificationTriggers.changedFields.city, false);
    assert.equal(Object.prototype.hasOwnProperty.call(config.notificationTriggers.changedFields, 'tags'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(config.notificationTriggers.changedFields, 'contractor'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(config.notificationTriggers.changedFields, 'date'), false);
});

test('evaluateNotification suppresses new orders when new order trigger is disabled', () => {
    const context = loadRulesContext();

    const decision = context.evaluateNotification(
        createOrder(),
        {
            eventType: 'new-order',
            isNewOrder: true,
            changedFields: []
        },
        {
            notificationTriggers: {
                newOrders: false
            }
        }
    );

    assert.equal(decision.notify, false);
    assert.equal(decision.action, 'suppress');
    assert.equal(decision.ruleId, 'notification-trigger-new-orders-disabled');
});

test('evaluateNotification suppresses changed orders when changed order trigger is disabled', () => {
    const context = loadRulesContext();

    const decision = context.evaluateNotification(
        createOrder(),
        {
            eventType: 'order-changed',
            isNewOrder: false,
            changedFields: ['status']
        },
        {
            notificationTriggers: {
                changedOrders: false
            }
        }
    );

    assert.equal(decision.notify, false);
    assert.equal(decision.action, 'suppress');
    assert.equal(decision.ruleId, 'notification-trigger-changed-orders-disabled');
});

test('evaluateNotification suppresses changed orders when changed fields are disabled', () => {
    const context = loadRulesContext();

    const decision = context.evaluateNotification(
        createOrder(),
        {
            eventType: 'order-changed',
            isNewOrder: false,
            changedFields: ['contractor']
        },
        {}
    );

    assert.equal(decision.notify, false);
    assert.equal(decision.action, 'suppress');
    assert.equal(decision.ruleId, 'notification-trigger-no-enabled-changed-fields');
});

test('evaluateNotification suppresses tag-only changes from user notifications', () => {
    const context = loadRulesContext();

    const decision = context.evaluateNotification(
        createOrder({ tags: ['перепродажа ип'] }),
        {
            eventType: 'order-changed',
            isNewOrder: false,
            changedFields: ['tags']
        },
        {}
    );

    assert.equal(decision.notify, false);
    assert.equal(decision.action, 'suppress');
    assert.equal(decision.ruleId, 'notification-trigger-no-enabled-changed-fields');
});

test('evaluateNotification notifies changed orders when an enabled changed field matches', () => {
    const context = loadRulesContext();

    const decision = context.evaluateNotification(
        createOrder(),
        {
            eventType: 'order-changed',
            isNewOrder: false,
            changedFields: ['status']
        },
        {}
    );

    assert.equal(decision.notify, true);
    assert.equal(decision.action, 'notify');
    assert.equal(decision.ruleId, null);
});

test('evaluateNotification ignores legacy hardcoded rule keys', () => {
    const context = loadRulesContext();

    const ozonDecision = context.evaluateNotification(
        createOrder({
            contractor: 'OZON (ОЗОН)'
        }),
        {
            eventType: 'new-order',
            isNewOrder: true,
            changedFields: []
        },
        {
            rules: {
                ignoreOzon: true
            }
        }
    );

    const juridicalDecision = context.evaluateNotification(
        createOrder({
            payment: 'Безналичный расчет для юридических лиц'
        }),
        {
            eventType: 'new-order',
            isNewOrder: true,
            changedFields: []
        },
        {
            rules: {
                ignoreLegalEntityBankTransfer: true
            }
        }
    );

    assert.equal(ozonDecision.notify, true);
    assert.equal(ozonDecision.ruleId, null);
    assert.equal(juridicalDecision.notify, true);
    assert.equal(juridicalDecision.ruleId, null);
});
test('getEffectiveConfig normalizes deep sync max pages', () => {
    const context = loadRulesContext();

    assert.equal(context.getEffectiveConfig({}).deepSyncMaxPages, 50);
    assert.equal(context.getEffectiveConfig({ deepSyncMaxPages: 1 }).deepSyncMaxPages, 1);
    assert.equal(context.getEffectiveConfig({ deepSyncMaxPages: 50 }).deepSyncMaxPages, 50);
    assert.equal(context.getEffectiveConfig({ deepSyncMaxPages: 999 }).deepSyncMaxPages, 50);
    assert.equal(context.getEffectiveConfig({ deepSyncMaxPages: -5 }).deepSyncMaxPages, 1);
    assert.equal(context.getEffectiveConfig({ deepSyncMaxPages: 'abc' }).deepSyncMaxPages, 50);
});

test('getEffectiveConfig normalizes watched orders config', () => {
    const context = loadRulesContext();

    const config = context.getEffectiveConfig({
        watchedOrders: {
            items: [
                { id: '1000-300326' },
                { id: '1000-300326' },
                { id: 'bad' },
                { id: '2000-300326', status: 'unresolved', lastError: 'not found' }
            ]
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(config.watchedOrders)), {
        items: [
            {
                id: '1000-300326',
                status: 'active',
                addedAt: config.watchedOrders.items[0].addedAt,
                lastCheckedAt: null,
                lastBaselineAt: null,
                lastEventAt: null,
                lastError: null,
                reminder: null
            },
            {
                id: '2000-300326',
                status: 'unresolved',
                addedAt: config.watchedOrders.items[1].addedAt,
                lastCheckedAt: null,
                lastBaselineAt: null,
                lastEventAt: null,
                lastError: 'not found',
                reminder: null
            }
        ]
    });
});

test('getEffectiveConfig normalizes notification suppressor defaults', () => {
    const context = loadRulesContext();

    const defaultConfig = context.getEffectiveConfig({});
    const mixedConfig = context.getEffectiveConfig({
        notificationSuppressors: {
            ignoreLegalEntityPayment: 1,
            ignoreOzon: 0
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(defaultConfig.notificationSuppressors)), {
        ignoreLegalEntityPayment: false,
        ignoreOzon: false
    });
    assert.deepEqual(JSON.parse(JSON.stringify(mixedConfig.notificationSuppressors)), {
        ignoreLegalEntityPayment: true,
        ignoreOzon: false
    });
});

test('evaluateNotification suppresses legal entity payment only when quick suppressor is enabled', () => {
    const context = loadRulesContext();
    const order = createOrder({ payment: 'Безналичный расчет для юридических лиц' });
    const eventContext = {
        eventType: 'new-order',
        isNewOrder: true,
        changedFields: []
    };

    const enabledDecision = context.evaluateNotification(order, eventContext, {
        notificationSuppressors: {
            ignoreLegalEntityPayment: true
        }
    });
    const disabledDecision = context.evaluateNotification(order, eventContext, {
        notificationSuppressors: {
            ignoreLegalEntityPayment: false
        }
    });

    assert.equal(enabledDecision.notify, false);
    assert.equal(enabledDecision.ruleId, 'notification-suppressor-legal-entity-payment');
    assert.equal(disabledDecision.notify, true);
    assert.equal(disabledDecision.ruleId, null);
});

test('evaluateNotification suppresses Ozon orders only when quick suppressor is enabled', () => {
    const context = loadRulesContext();
    const eventContext = {
        eventType: 'new-order',
        isNewOrder: true,
        changedFields: []
    };

    const contractorDecision = context.evaluateNotification(
        createOrder({ contractor: 'OZON (ОЗОН)' }),
        eventContext,
        {
            notificationSuppressors: {
                ignoreOzon: true
            }
        }
    );
    const tagDecision = context.evaluateNotification(
        createOrder({ tags: ['ОЗОН'] }),
        eventContext,
        {
            notificationSuppressors: {
                ignoreOzon: true
            }
        }
    );
    const disabledDecision = context.evaluateNotification(
        createOrder({ tags: ['ОЗОН'] }),
        eventContext,
        {
            notificationSuppressors: {
                ignoreOzon: false
            }
        }
    );

    assert.equal(contractorDecision.notify, false);
    assert.equal(contractorDecision.ruleId, 'notification-suppressor-ozon');
    assert.equal(tagDecision.notify, false);
    assert.equal(tagDecision.ruleId, 'notification-suppressor-ozon');
    assert.equal(disabledDecision.notify, true);
    assert.equal(disabledDecision.ruleId, null);
});
