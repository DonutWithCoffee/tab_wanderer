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
    notificationSuppressors: {
        ignoreLegalEntityPayment: false,
        ignoreOzon: false
    },
    monitorScope: {
        status: [],
        delivery: [],
        payment: [],
        orderFlags: [],
        store: [],
        reserve: [],
        assemblyStatus: []
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
    return {
        status: Array.isArray(safeScope.status) ? safeScope.status : [],
        delivery: Array.isArray(safeScope.delivery) ? safeScope.delivery : [],
        payment: Array.isArray(safeScope.payment) ? safeScope.payment : [],
        orderFlags: [],
        store: Array.isArray(safeScope.store) ? safeScope.store : [],
        reserve: [],
        assemblyStatus: []
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

function normalizeNotificationSuppressors(suppressors = {}) {
    const safeSuppressors = suppressors || {};
    const defaultSuppressors = DEFAULT_CONFIG.notificationSuppressors;

    return {
        ignoreLegalEntityPayment: safeSuppressors.ignoreLegalEntityPayment === undefined
            ? defaultSuppressors.ignoreLegalEntityPayment
            : Boolean(safeSuppressors.ignoreLegalEntityPayment),
        ignoreOzon: safeSuppressors.ignoreOzon === undefined
            ? defaultSuppressors.ignoreOzon
            : Boolean(safeSuppressors.ignoreOzon)
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
        notificationSuppressors: normalizeNotificationSuppressors(safeConfig.notificationSuppressors),
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

function normalizeNotificationRuleText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/\s+/g, ' ')
        .trim();
}

function getNormalizedOrderTags(order = {}) {
    return Array.isArray(order.tags)
        ? order.tags.map(normalizeNotificationRuleText).filter(Boolean)
        : [];
}

function isLegalEntityPaymentOrder(order = {}) {
    return normalizeNotificationRuleText(order.payment) === 'безналичный расчет для юридических лиц';
}

function isOzonOrder(order = {}) {
    const contractor = normalizeNotificationRuleText(order.contractor);
    const tags = getNormalizedOrderTags(order);

    if (contractor.includes('ozon') || contractor.includes('озон')) {
        return true;
    }

    return tags.some(tag => tag.includes('ozon') || tag.includes('озон'));
}

function evaluateNotificationSuppressors(order = {}, context = {}, effectiveConfig) {
    const suppressors = effectiveConfig.notificationSuppressors || DEFAULT_CONFIG.notificationSuppressors;

    if (suppressors.ignoreLegalEntityPayment && isLegalEntityPaymentOrder(order)) {
        return buildTriggerDecision(
            'notification-suppressor-legal-entity-payment',
            'Legal entity payment notifications are suppressed by user setting',
            context,
            effectiveConfig
        );
    }

    if (suppressors.ignoreOzon && isOzonOrder(order)) {
        return buildTriggerDecision(
            'notification-suppressor-ozon',
            'Ozon order notifications are suppressed by user setting',
            context,
            effectiveConfig
        );
    }

    return null;
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

    const suppressorDecision = evaluateNotificationSuppressors(order, context, effectiveConfig);

    if (suppressorDecision) {
        return suppressorDecision;
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
self.normalizeNotificationSuppressors = normalizeNotificationSuppressors;
self.normalizeNotificationRuleText = normalizeNotificationRuleText;
self.isLegalEntityPaymentOrder = isLegalEntityPaymentOrder;
self.isOzonOrder = isOzonOrder;
self.evaluateNotificationSuppressors = evaluateNotificationSuppressors;
