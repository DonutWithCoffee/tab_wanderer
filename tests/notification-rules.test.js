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

test('normalizeMonitorScope sanitizes arrays and predicates', () => {
    const context = loadRulesContext();

    const normalized = context.normalizeMonitorScope({
        status: ['6806'],
        delivery: '9797',
        payment: null,
        orderFlags: '1',
        store: {},
        reserve: 1,
        assemblyStatus: 'partial',
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
        store: [],
        reserve: [],
        assemblyStatus: [],
        predicates: {
            ozonOnly: true,
            juridicalOnly: false
        }
    });
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
        assemblyStatus: [],
        predicates: {
            ozonOnly: false,
            juridicalOnly: false
        }
    });
});

test('getEffectiveConfig normalizes notification trigger defaults', () => {
    const context = loadRulesContext();

    const config = context.getEffectiveConfig({});

    assert.equal(config.notificationTriggers.newOrders, true);
    assert.equal(config.notificationTriggers.changedOrders, true);
    assert.equal(config.notificationTriggers.changedFields.status, true);
    assert.equal(config.notificationTriggers.changedFields.delivery, true);
    assert.equal(config.notificationTriggers.changedFields.payment, true);
    assert.equal(config.notificationTriggers.changedFields.contractor, false);
    assert.equal(config.notificationTriggers.changedFields.date, false);
    assert.equal(config.notificationTriggers.changedFields.shipmentDateText, true);
    assert.equal(config.notificationTriggers.changedFields.hasOrderFlag, true);
    assert.equal(config.notificationTriggers.changedFields.hasAutoreserve, true);
    assert.equal(config.notificationTriggers.changedFields.tags, true);
});

test('getEffectiveConfig merges incoming notification triggers with defaults', () => {
    const context = loadRulesContext();

    const config = context.getEffectiveConfig({
        notificationTriggers: {
            newOrders: false,
            changedFields: {
                status: false,
                contractor: true
            }
        }
    });

    assert.equal(config.notificationTriggers.newOrders, false);
    assert.equal(config.notificationTriggers.changedOrders, true);
    assert.equal(config.notificationTriggers.changedFields.status, false);
    assert.equal(config.notificationTriggers.changedFields.delivery, true);
    assert.equal(config.notificationTriggers.changedFields.contractor, true);
    assert.equal(config.notificationTriggers.changedFields.date, false);
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
            changedFields: ['date']
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