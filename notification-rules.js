const DEFAULT_CONFIG = {
    monitorMode: 'windowed',
    notificationTriggers: {
        newOrders: true,
        changedOrders: true,
        changedFields: {
            status: true,
            delivery: true,
            payment: true,
            contractor: false,
            date: false,
            shipmentDateText: true,
            hasOrderFlag: true,
            hasAutoreserve: true,
            tags: true
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
};

self.DEFAULT_CONFIG = DEFAULT_CONFIG;

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

function normalizeNotificationTriggers(triggers = {}) {
    const safeTriggers = triggers || {};
    const safeChangedFields = safeTriggers.changedFields || {};
    const defaultTriggers = DEFAULT_CONFIG.notificationTriggers;
    const defaultChangedFields = defaultTriggers.changedFields;

    return {
        newOrders: safeTriggers.newOrders === undefined
            ? defaultTriggers.newOrders
            : Boolean(safeTriggers.newOrders),
        changedOrders: safeTriggers.changedOrders === undefined
            ? defaultTriggers.changedOrders
            : Boolean(safeTriggers.changedOrders),
        changedFields: {
            status: safeChangedFields.status === undefined
                ? defaultChangedFields.status
                : Boolean(safeChangedFields.status),
            delivery: safeChangedFields.delivery === undefined
                ? defaultChangedFields.delivery
                : Boolean(safeChangedFields.delivery),
            payment: safeChangedFields.payment === undefined
                ? defaultChangedFields.payment
                : Boolean(safeChangedFields.payment),
            contractor: safeChangedFields.contractor === undefined
                ? defaultChangedFields.contractor
                : Boolean(safeChangedFields.contractor),
            date: safeChangedFields.date === undefined
                ? defaultChangedFields.date
                : Boolean(safeChangedFields.date),
            shipmentDateText: safeChangedFields.shipmentDateText === undefined
                ? defaultChangedFields.shipmentDateText
                : Boolean(safeChangedFields.shipmentDateText),
            hasOrderFlag: safeChangedFields.hasOrderFlag === undefined
                ? defaultChangedFields.hasOrderFlag
                : Boolean(safeChangedFields.hasOrderFlag),
            hasAutoreserve: safeChangedFields.hasAutoreserve === undefined
                ? defaultChangedFields.hasAutoreserve
                : Boolean(safeChangedFields.hasAutoreserve),
            tags: safeChangedFields.tags === undefined
                ? defaultChangedFields.tags
                : Boolean(safeChangedFields.tags)
        }
    };
}

function getEffectiveConfig(config = {}) {
    const safeConfig = config || {};
    const configWithoutRules = { ...safeConfig };

    delete configWithoutRules.rules;

    const monitorMode = safeConfig.monitorMode === 'active'
        ? 'active'
        : 'windowed';

    return {
        ...DEFAULT_CONFIG,
        ...configWithoutRules,
        monitorMode,
        notificationTriggers: normalizeNotificationTriggers(safeConfig.notificationTriggers),
        monitorScope: normalizeMonitorScope(safeConfig.monitorScope)
    };
}

function buildTriggerDecision(ruleId, reason, context, effectiveConfig) {
    return {
        notify: false,
        action: 'suppress',
        ruleId,
        reason,
        matchedFields: [],
        context,
        config: effectiveConfig
    };
}

function getContextChangedFields(context) {
    return Array.isArray(context?.changedFields)
        ? context.changedFields
        : [];
}

function hasEnabledChangedField(changedFields, changedFieldConfig = {}) {
    return changedFields.some(field => changedFieldConfig[field] === true);
}

function evaluateNotificationTriggers(context = {}, effectiveConfig) {
    const triggers = effectiveConfig.notificationTriggers || DEFAULT_CONFIG.notificationTriggers;
    const eventType = context?.eventType;

    if (eventType === 'new-order' && !triggers.newOrders) {
        return buildTriggerDecision(
            'notification-trigger-new-orders-disabled',
            'New order notifications are disabled',
            context,
            effectiveConfig
        );
    }

    if (eventType !== 'order-changed') {
        return null;
    }

    if (!triggers.changedOrders) {
        return buildTriggerDecision(
            'notification-trigger-changed-orders-disabled',
            'Changed order notifications are disabled',
            context,
            effectiveConfig
        );
    }

    const changedFields = getContextChangedFields(context);

    if (!hasEnabledChangedField(changedFields, triggers.changedFields)) {
        return buildTriggerDecision(
            'notification-trigger-no-enabled-changed-fields',
            `No enabled changed fields matched: ${changedFields.join(', ') || 'none'}`,
            context,
            effectiveConfig
        );
    }

    return null;
}

function evaluateNotification(order, context = {}, config = DEFAULT_CONFIG) {
    const effectiveConfig = getEffectiveConfig(config);
    const triggerDecision = evaluateNotificationTriggers(context, effectiveConfig);

    if (triggerDecision) {
        return triggerDecision;
    }

    return {
        notify: true,
        action: 'notify',
        ruleId: null,
        reason: 'notification triggers allow event',
        matchedFields: [],
        context,
        config: effectiveConfig
    };
}