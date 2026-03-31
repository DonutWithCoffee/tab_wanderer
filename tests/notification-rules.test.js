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

test('getEffectiveConfig merges default rules with incoming config', () => {
    const context = loadRulesContext();

    const config = context.getEffectiveConfig({
        rules: {
            ignoreOzon: true
        },
        monitorScope: {
            payment: ['9791']
        }
    });

    assert.equal(config.rules.ignoreOzon, true);
    assert.equal(config.rules.ignoreCancelled, false);
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

test('evaluateNotification ignores legal entity bank transfer when rule enabled', () => {
    const context = loadRulesContext();

    const decision = context.evaluateNotification(
        createOrder({
            payment: 'Безналичный расчет для юридических лиц'
        }),
        {},
        {
            rules: {
                ignoreLegalEntityBankTransfer: true
            }
        }
    );

    assert.equal(decision.notify, false);
    assert.equal(decision.ruleId, 'ignore-legal-entity-bank-transfer');
    assert.match(decision.reason, /legal entity bank transfer/i);
});

test('evaluateNotification notifies when matching rule is disabled', () => {
    const context = loadRulesContext();

    const decision = context.evaluateNotification(
        createOrder({
            contractor: 'OZON (ОЗОН)'
        }),
        {},
        {
            rules: {
                ignoreOzon: false
            }
        }
    );

    assert.equal(decision.notify, true);
    assert.equal(decision.ruleId, null);
});