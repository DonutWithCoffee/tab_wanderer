const RULE_OPERATOR = {
    EQUALS: 'equals',
    CONTAINS: 'contains',
    IN: 'in',
    NOT_EQUALS: 'notEquals',
    NOT_CONTAINS: 'notContains',
    NOT_IN: 'notIn'
};

const RULE_GROUP_OPERATOR = {
    ALL: 'all',
    ANY: 'any'
};

const DEFAULT_CONFIG = {
    rules: {
        ignoreEmptyStatus: false,
        ignoreEmptyDelivery: false,
        ignoreEmptyPayment: false,
        ignoreCancelled: false,
        ignoreCompleted: false,
        ignorePickup: false,
        ignoreOzon: false,
        ignoreLegalEntityBankTransfer: false,
        ignoreCashlessBankTransfer: false,
        ignoreCancelledCourierCashless: false
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
};

self.DEFAULT_CONFIG = DEFAULT_CONFIG;

const NOTIFICATION_IGNORE_RULES = [
    {
        id: 'ignore-empty-status',
        configKey: 'ignoreEmptyStatus',
        description: 'Ignore orders without a valid status',
        when: {
            status: { in: ['', '–', '-'] }
        }
    },
    {
        id: 'ignore-empty-delivery',
        configKey: 'ignoreEmptyDelivery',
        description: 'Ignore orders without a valid delivery type',
        when: {
            delivery: { in: ['', '–', '-'] }
        }
    },
    {
        id: 'ignore-empty-payment',
        configKey: 'ignoreEmptyPayment',
        description: 'Ignore orders without a valid payment type',
        when: {
            payment: { in: ['', '–', '-'] }
        }
    },
    {
        id: 'ignore-cancelled-orders',
        configKey: 'ignoreCancelled',
        description: 'Ignore cancelled orders',
        when: {
            status: { contains: 'отмен' }
        }
    },
    {
        id: 'ignore-completed-orders',
        configKey: 'ignoreCompleted',
        description: 'Ignore completed orders',
        when: {
            status: { in: ['выполнен', 'выполнено', 'завершен', 'завершён'] }
        }
    },
    {
        id: 'ignore-pickup-orders',
        configKey: 'ignorePickup',
        description: 'Ignore pickup delivery orders',
        when: {
            delivery: {
                in: [
                    'самовывоз',
                    'самовывоз со склада',
                    'самовывоз из магазина'
                ]
            }
        }
    },
    {
        id: 'ignore-ozon-contractor',
        configKey: 'ignoreOzon',
        description: 'Ignore orders from OZON contractor',
        when: {
            contractor: { equals: 'OZON (ОЗОН)' }
        }
    },
    {
        id: 'ignore-legal-entity-bank-transfer',
        configKey: 'ignoreLegalEntityBankTransfer',
        description: 'Ignore legal entity bank transfer orders',
        when: {
            payment: { contains: 'безналичный расчет для юридических лиц' }
        }
    },
    {
        id: 'ignore-cashless-bank-transfer',
        configKey: 'ignoreCashlessBankTransfer',
        description: 'Ignore standard bank transfer orders',
        when: {
            payment: {
                in: [
                    'безналичный расчет',
                    'безналичная оплата',
                    'банковский перевод'
                ]
            }
        }
    },
    {
        id: 'ignore-cancelled-courier-cashless',
        configKey: 'ignoreCancelledCourierCashless',
        description: 'Ignore cancelled courier orders with cashless payment',
        group: RULE_GROUP_OPERATOR.ALL,
        conditions: [
            {
                status: { contains: 'отмен' }
            },
            {
                delivery: { contains: 'курьер' }
            },
            {
                payment: {
                    in: [
                        'безналичный расчет',
                        'безналичная оплата',
                        'банковский перевод',
                        'безналичный расчет для юридических лиц'
                    ]
                }
            }
        ]
    }
];

function normalizeRuleValue(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeRuleValues(values) {
    return values.map(value => normalizeRuleValue(value));
}

function normalizeMonitorScope(scope = {}) {
    const safeScope = scope || {};
    const safePredicates = safeScope.predicates || {};

    return {
        status: Array.isArray(safeScope.status) ? safeScope.status : [],
        delivery: Array.isArray(safeScope.delivery) ? safeScope.delivery : [],
        payment: Array.isArray(safeScope.payment) ? safeScope.payment : [],
        orderFlags: Array.isArray(safeScope.orderFlags) ? safeScope.orderFlags : [],
        store: Array.isArray(safeScope.store) ? safeScope.store : [],
        reserve: Array.isArray(safeScope.reserve) ? safeScope.reserve : [],
        assemblyStatus: Array.isArray(safeScope.assemblyStatus) ? safeScope.assemblyStatus : [],
        predicates: {
            ozonOnly: Boolean(safePredicates.ozonOnly),
            juridicalOnly: Boolean(safePredicates.juridicalOnly)
        }
    };
}

function getEffectiveConfig(config = {}) {
    const baseRules = DEFAULT_CONFIG.rules || {};
    const incomingRules = config?.rules || {};

    return {
        ...DEFAULT_CONFIG,
        ...config,
        rules: {
            ...baseRules,
            ...incomingRules
        },
        monitorScope: normalizeMonitorScope(config?.monitorScope)
    };
}

function isRuleEnabled(rule, config) {
    if (!rule.configKey) {
        return true;
    }

    return Boolean(config.rules?.[rule.configKey]);
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

        return normalizeRuleValues(values).includes(actual);
    }

    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.NOT_EQUALS)) {
        return actual !== normalizeRuleValue(condition[RULE_OPERATOR.NOT_EQUALS]);
    }

    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.NOT_CONTAINS)) {
        return !actual.includes(normalizeRuleValue(condition[RULE_OPERATOR.NOT_CONTAINS]));
    }

    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.NOT_IN)) {
        const values = Array.isArray(condition[RULE_OPERATOR.NOT_IN])
            ? condition[RULE_OPERATOR.NOT_IN]
            : [condition[RULE_OPERATOR.NOT_IN]];

        return !normalizeRuleValues(values).includes(actual);
    }

    return false;
}

function describeCondition(condition) {
    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.EQUALS)) {
        return `equals "${condition[RULE_OPERATOR.EQUALS]}"`;
    }

    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.CONTAINS)) {
        return `contains "${condition[RULE_OPERATOR.CONTAINS]}"`;
    }

    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.IN)) {
        const values = Array.isArray(condition[RULE_OPERATOR.IN])
            ? condition[RULE_OPERATOR.IN]
            : [condition[RULE_OPERATOR.IN]];

        return `in [${values.join(', ')}]`;
    }

    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.NOT_EQUALS)) {
        return `not equals "${condition[RULE_OPERATOR.NOT_EQUALS]}"`;
    }

    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.NOT_CONTAINS)) {
        return `not contains "${condition[RULE_OPERATOR.NOT_CONTAINS]}"`;
    }

    if (Object.prototype.hasOwnProperty.call(condition, RULE_OPERATOR.NOT_IN)) {
        const values = Array.isArray(condition[RULE_OPERATOR.NOT_IN])
            ? condition[RULE_OPERATOR.NOT_IN]
            : [condition[RULE_OPERATOR.NOT_IN]];

        return `not in [${values.join(', ')}]`;
    }

    return 'unknown condition';
}

function matchFieldConditions(order, fields) {
    const entries = Object.entries(fields || {});

    if (!entries.length) {
        return { matched: false, matchedFields: [] };
    }

    const matchedFields = [];

    for (const [field, condition] of entries) {
        if (!matchesRuleCondition(order[field], condition)) {
            return { matched: false, matchedFields: [] };
        }

        matchedFields.push({
            field,
            actual: normalizeRuleValue(order[field]),
            expected: describeCondition(condition)
        });
    }

    return { matched: true, matchedFields };
}

function matchesRule(order, rule) {
    if (rule.when) {
        return matchFieldConditions(order, rule.when);
    }

    const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];

    if (!conditions.length) {
        return { matched: false, matchedFields: [] };
    }

    const mode = rule.group === RULE_GROUP_OPERATOR.ANY
        ? RULE_GROUP_OPERATOR.ANY
        : RULE_GROUP_OPERATOR.ALL;

    if (mode === RULE_GROUP_OPERATOR.ALL) {
        const matchedFields = [];

        for (const conditionGroup of conditions) {
            const result = matchFieldConditions(order, conditionGroup);

            if (!result.matched) {
                return { matched: false, matchedFields: [] };
            }

            matchedFields.push(...result.matchedFields);
        }

        return { matched: true, matchedFields };
    }

    for (const conditionGroup of conditions) {
        const result = matchFieldConditions(order, conditionGroup);

        if (result.matched) {
            return result;
        }
    }

    return { matched: false, matchedFields: [] };
}

function buildDecisionReason(rule, matchedFields) {
    if (!matchedFields.length) {
        return rule.description;
    }

    const details = matchedFields
        .map(item => `${item.field}: ${item.actual} (${item.expected})`)
        .join('; ');

    return `${rule.description}; matched ${details}`;
}

function evaluateNotification(order, context = {}, config = DEFAULT_CONFIG) {
    const effectiveConfig = getEffectiveConfig(config);

    for (const rule of NOTIFICATION_IGNORE_RULES) {
        if (!isRuleEnabled(rule, effectiveConfig)) {
            continue;
        }

        const result = matchesRule(order, rule);

        if (!result.matched) {
            continue;
        }

        return {
            notify: false,
            action: 'ignore',
            ruleId: rule.id,
            reason: buildDecisionReason(rule, result.matchedFields),
            matchedFields: result.matchedFields,
            context,
            config: effectiveConfig
        };
    }

    return {
        notify: true,
        action: 'notify',
        ruleId: null,
        reason: 'no enabled ignore rules matched',
        matchedFields: [],
        context,
        config: effectiveConfig
    };
}