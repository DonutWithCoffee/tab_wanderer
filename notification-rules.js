const RULE_OPERATOR = {
    EQUALS: 'equals',
    CONTAINS: 'contains',
    IN: 'in'
};

const NOTIFICATION_IGNORE_RULES = [
    {
        id: 'ignore-empty-payment',
        description: 'Ignore orders without a valid payment type',
        when: {
            payment: { in: ['', '–'] }
        }
    },
    {
        id: 'ignore-legal-entity-bank-transfer',
        description: 'Ignore legal entity bank transfer orders',
        when: {
            payment: { contains: 'безналичный расчет для юридических лиц' }
        }
    }
];

function normalizeRuleValue(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function matchesRuleCondition(actualValue, condition) {
    const actual = normalizeRuleValue(actualValue);

    if (!condition || typeof condition !== 'object') {
        return false;
    }

    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.EQUALS)) {
        return actual === normalizeRuleValue(condition[RULE_OPERATOR.EQUALS]);
    }

    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.CONTAINS)) {
        return actual.includes(normalizeRuleValue(condition[RULE_OPERATOR.CONTAINS]));
    }

    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.IN)) {
        const values = Array.isArray(condition[RULE_OPERATOR.IN])
            ? condition[RULE_OPERATOR.IN]
            : [condition[RULE_OPERATOR.IN]];

        return values.some(value => actual === normalizeRuleValue(value));
    }

    return false;
}

function matchesRule(order, rule) {
    const fields = Object.entries(rule.when || {});

    if (!fields.length) {
        return false;
    }

    return fields.every(([field, condition]) => {
        return matchesRuleCondition(order[field], condition);
    });
}

function evaluateNotification(order, context = {}) {
    for (const rule of NOTIFICATION_IGNORE_RULES) {
        if (!matchesRule(order, rule)) {
            continue;
        }

        return {
            notify: false,
            action: 'ignore',
            ruleId: rule.id,
            reason: rule.description,
            context
        };
    }

    return {
        notify: true,
        action: 'notify',
        ruleId: null,
        reason: 'no ignore rules matched',
        context
    };
}