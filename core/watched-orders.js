const WATCHED_ORDER_LIMIT = 100;

const WATCHED_ORDER_STATUSES = {
    ACTIVE: 'active',
    UNRESOLVED: 'unresolved'
};

function normalizeWatchedOrderId(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();
}

function isValidWatchedOrderId(value) {
    const id = normalizeWatchedOrderId(value);

    return /^\d{1,10}-\d{4,10}$/.test(id);
}

function normalizeWatchedOrderStatus(value) {
    const status = String(value || '').trim();

    if (status === WATCHED_ORDER_STATUSES.UNRESOLVED) {
        return WATCHED_ORDER_STATUSES.UNRESOLVED;
    }

    return WATCHED_ORDER_STATUSES.ACTIVE;
}

function normalizeWatchedOrderTimestamp(value) {
    const numeric = Number(value);

    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeWatchedOrderItem(value, now = Date.now()) {
    const source = value && typeof value === 'object'
        ? value
        : { id: value };
    const id = normalizeWatchedOrderId(source.id);

    if (!isValidWatchedOrderId(id)) {
        return null;
    }

    return {
        id,
        status: normalizeWatchedOrderStatus(source.status),
        addedAt: normalizeWatchedOrderTimestamp(source.addedAt) || now,
        lastCheckedAt: normalizeWatchedOrderTimestamp(source.lastCheckedAt),
        lastEventAt: normalizeWatchedOrderTimestamp(source.lastEventAt),
        lastError: source.lastError ? String(source.lastError) : null
    };
}

function getRawWatchedOrderItems(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (Array.isArray(value?.items)) {
        return value.items;
    }

    if (Array.isArray(value?.orders)) {
        return value.orders;
    }

    return [];
}

function normalizeWatchedOrdersConfig(value = {}, now = Date.now()) {
    const rawItems = getRawWatchedOrderItems(value);
    const seenIds = new Set();
    const items = [];

    for (const rawItem of rawItems) {
        const item = normalizeWatchedOrderItem(rawItem, now);

        if (!item || seenIds.has(item.id)) {
            continue;
        }

        seenIds.add(item.id);
        items.push(item);

        if (items.length >= WATCHED_ORDER_LIMIT) {
            break;
        }
    }

    return { items };
}

function createWatchedOrderItem(orderId, now = Date.now()) {
    return normalizeWatchedOrderItem({ id: orderId, status: WATCHED_ORDER_STATUSES.ACTIVE, addedAt: now }, now);
}

function getWatchedOrderIds(watchedOrders = {}) {
    return normalizeWatchedOrdersConfig(watchedOrders).items.map(item => item.id);
}

function addWatchedOrderToConfig(watchedOrders = {}, orderId, now = Date.now()) {
    const normalizedConfig = normalizeWatchedOrdersConfig(watchedOrders, now);
    const item = createWatchedOrderItem(orderId, now);

    if (!item) {
        return {
            config: normalizedConfig,
            added: false,
            duplicate: false,
            invalid: true,
            item: null
        };
    }

    if (normalizedConfig.items.some(existing => existing.id === item.id)) {
        return {
            config: normalizedConfig,
            added: false,
            duplicate: true,
            invalid: false,
            item
        };
    }

    if (normalizedConfig.items.length >= WATCHED_ORDER_LIMIT) {
        return {
            config: normalizedConfig,
            added: false,
            duplicate: false,
            invalid: false,
            limitReached: true,
            item
        };
    }

    return {
        config: {
            items: [...normalizedConfig.items, item]
        },
        added: true,
        duplicate: false,
        invalid: false,
        item
    };
}

function removeWatchedOrderFromConfig(watchedOrders = {}, orderId) {
    const normalizedConfig = normalizeWatchedOrdersConfig(watchedOrders);
    const normalizedId = normalizeWatchedOrderId(orderId);

    return {
        items: normalizedConfig.items.filter(item => item.id !== normalizedId)
    };
}

function createWatchedEventJournalOptions(options = {}, watchedOrders = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};

    if (safeOptions.watchedOnly !== true) {
        return { ...safeOptions };
    }

    return {
        ...safeOptions,
        watchedOrderIds: getWatchedOrderIds(watchedOrders)
    };
}

globalThis.WATCHED_ORDER_LIMIT = WATCHED_ORDER_LIMIT;
globalThis.WATCHED_ORDER_STATUSES = WATCHED_ORDER_STATUSES;
globalThis.normalizeWatchedOrderId = normalizeWatchedOrderId;
globalThis.isValidWatchedOrderId = isValidWatchedOrderId;
globalThis.normalizeWatchedOrderStatus = normalizeWatchedOrderStatus;
globalThis.normalizeWatchedOrderItem = normalizeWatchedOrderItem;
globalThis.normalizeWatchedOrdersConfig = normalizeWatchedOrdersConfig;
globalThis.createWatchedOrderItem = createWatchedOrderItem;
globalThis.getWatchedOrderIds = getWatchedOrderIds;
globalThis.addWatchedOrderToConfig = addWatchedOrderToConfig;
globalThis.removeWatchedOrderFromConfig = removeWatchedOrderFromConfig;
globalThis.createWatchedEventJournalOptions = createWatchedEventJournalOptions;
