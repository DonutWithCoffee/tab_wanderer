const DEFAULT_DEEP_SYNC_MAX_PAGES = 50;
const MIN_DEEP_SYNC_MAX_PAGES = 1;
const MAX_DEEP_SYNC_MAX_PAGES = 50;

const DEFAULT_CONFIG = {
    monitorMode: 'windowed',
    deepSyncMaxPages: DEFAULT_DEEP_SYNC_MAX_PAGES,
    notificationTriggers: {
        newOrders: true,
        changedOrders: true,
        changedFields: {
            status: true,
            delivery: true,
            payment: true,
            city: true
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
    },
    watchedOrders: {
        items: []
    }
};

self.DEFAULT_CONFIG = DEFAULT_CONFIG;
self.DEFAULT_DEEP_SYNC_MAX_PAGES = DEFAULT_DEEP_SYNC_MAX_PAGES;
self.MIN_DEEP_SYNC_MAX_PAGES = MIN_DEEP_SYNC_MAX_PAGES;
self.MAX_DEEP_SYNC_MAX_PAGES = MAX_DEEP_SYNC_MAX_PAGES;


function normalizeDeepSyncMaxPages(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return DEFAULT_DEEP_SYNC_MAX_PAGES;
    }

    const integer = Math.floor(numeric);

    if (integer < MIN_DEEP_SYNC_MAX_PAGES) {
        return MIN_DEEP_SYNC_MAX_PAGES;
    }

    if (integer > MAX_DEEP_SYNC_MAX_PAGES) {
        return MAX_DEEP_SYNC_MAX_PAGES;
    }

    return integer;
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
            city: safeChangedFields.city === undefined
                ? defaultChangedFields.city
                : Boolean(safeChangedFields.city)
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
        deepSyncMaxPages: normalizeDeepSyncMaxPages(safeConfig.deepSyncMaxPages),
        notificationTriggers: normalizeNotificationTriggers(safeConfig.notificationTriggers),
        monitorScope: normalizeMonitorScope(safeConfig.monitorScope),
        watchedOrders: typeof normalizeWatchedOrdersConfig === 'function'
            ? normalizeWatchedOrdersConfig(safeConfig.watchedOrders)
            : (safeConfig.watchedOrders || DEFAULT_CONFIG.watchedOrders)
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
self.normalizeDeepSyncMaxPages = normalizeDeepSyncMaxPages;
