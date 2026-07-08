const WATCHED_ORDER_LIMIT = 100;
const WATCHED_ORDER_NOTE_LIMIT = 300;
const WATCHED_ORDER_REMINDER_NOTE_LIMIT = 200;

const WATCHED_ORDER_STATUSES = {
    ACTIVE: 'active',
    UNRESOLVED: 'unresolved'
};

const WATCHED_ORDER_REMINDER_STATUSES = {
    PENDING: 'pending',
    DONE: 'done',
    CANCELLED: 'cancelled'
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

function isWatchedOrderFollowUpEnabled(item = {}) {
    return item?.followUpEnabled !== false;
}

function normalizeWatchedOrderNote(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, WATCHED_ORDER_NOTE_LIMIT);
}


function normalizeWatchedOrderSnapshotText(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 200);
}

function normalizeWatchedOrderSnapshot(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const snapshot = {
        status: normalizeWatchedOrderSnapshotText(value.status),
        delivery: normalizeWatchedOrderSnapshotText(value.delivery),
        payment: normalizeWatchedOrderSnapshotText(value.payment),
        contractor: normalizeWatchedOrderSnapshotText(value.contractor),
        city: normalizeWatchedOrderSnapshotText(value.city)
    };

    return Object.values(snapshot).some(Boolean) ? snapshot : null;
}

function createWatchedOrderSnapshotFromOrder(order = {}) {
    return normalizeWatchedOrderSnapshot({
        status: order?.status,
        delivery: order?.delivery,
        payment: order?.payment,
        contractor: order?.contractor,
        city: order?.city
    });
}

function normalizeWatchedOrderReminderStatus(value) {
    const status = String(value || '').trim();

    if (status === WATCHED_ORDER_REMINDER_STATUSES.DONE) {
        return WATCHED_ORDER_REMINDER_STATUSES.DONE;
    }

    if (status === WATCHED_ORDER_REMINDER_STATUSES.CANCELLED) {
        return WATCHED_ORDER_REMINDER_STATUSES.CANCELLED;
    }

    return WATCHED_ORDER_REMINDER_STATUSES.PENDING;
}

function normalizeWatchedOrderReminderNote(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, WATCHED_ORDER_REMINDER_NOTE_LIMIT);
}

function normalizeWatchedOrderReminder(value, now = Date.now()) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const remindAt = normalizeWatchedOrderTimestamp(value.remindAt);

    if (!remindAt) {
        return null;
    }

    const status = normalizeWatchedOrderReminderStatus(value.status);
    const createdAt = normalizeWatchedOrderTimestamp(value.createdAt) || now;
    const updatedAt = normalizeWatchedOrderTimestamp(value.updatedAt) || createdAt;

    return {
        status,
        remindAt,
        note: normalizeWatchedOrderReminderNote(value.note),
        createdAt,
        updatedAt,
        completedAt: status === WATCHED_ORDER_REMINDER_STATUSES.DONE
            ? (normalizeWatchedOrderTimestamp(value.completedAt) || updatedAt)
            : null,
        cancelledAt: status === WATCHED_ORDER_REMINDER_STATUSES.CANCELLED
            ? (normalizeWatchedOrderTimestamp(value.cancelledAt) || updatedAt)
            : null
    };
}

function createWatchedOrderReminder(value = {}, now = Date.now()) {
    return normalizeWatchedOrderReminder({
        status: WATCHED_ORDER_REMINDER_STATUSES.PENDING,
        remindAt: value?.remindAt,
        note: value?.note,
        createdAt: now,
        updatedAt: now
    }, now);
}

function normalizeWatchedOrderItem(value, now = Date.now()) {
    const source = value && typeof value === 'object'
        ? value
        : { id: value };
    const id = normalizeWatchedOrderId(source.id);

    if (!isValidWatchedOrderId(id)) {
        return null;
    }

    const lastSnapshot = normalizeWatchedOrderSnapshot(source.lastSnapshot || source.orderSnapshot || source.snapshot);
    const item = {
        id,
        status: normalizeWatchedOrderStatus(source.status),
        followUpEnabled: source.followUpEnabled !== false,
        note: normalizeWatchedOrderNote(source.note),
        addedAt: normalizeWatchedOrderTimestamp(source.addedAt) || now,
        lastCheckedAt: normalizeWatchedOrderTimestamp(source.lastCheckedAt),
        lastBaselineAt: normalizeWatchedOrderTimestamp(source.lastBaselineAt),
        lastEventAt: normalizeWatchedOrderTimestamp(source.lastEventAt),
        lastError: source.lastError ? String(source.lastError) : null,
        reminder: normalizeWatchedOrderReminder(source.reminder, now)
    };

    if (lastSnapshot) {
        item.lastSnapshot = lastSnapshot;
    }

    return item;
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

function createWatchedOrderItem(orderId, now = Date.now(), options = {}) {
    return normalizeWatchedOrderItem({
        id: orderId,
        status: WATCHED_ORDER_STATUSES.ACTIVE,
        followUpEnabled: options?.followUpEnabled !== false,
        note: options?.note,
        addedAt: now
    }, now);
}

function getWatchedOrderIds(watchedOrders = {}) {
    return normalizeWatchedOrdersConfig(watchedOrders).items.map(item => item.id);
}

function addWatchedOrderToConfig(watchedOrders = {}, orderId, now = Date.now(), options = {}) {
    const normalizedConfig = normalizeWatchedOrdersConfig(watchedOrders, now);
    const item = createWatchedOrderItem(orderId, now, options);

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


function getWatchedOrderItem(watchedOrders = {}, orderId) {
    const normalizedId = normalizeWatchedOrderId(orderId);

    return normalizeWatchedOrdersConfig(watchedOrders).items.find(item => item.id === normalizedId) || null;
}

function hasWatchedOrderDirectBaseline(watchedOrders = {}, orderId) {
    const item = getWatchedOrderItem(watchedOrders, orderId);

    return Number(item?.lastBaselineAt) > 0;
}

function markWatchedOrderDirectBaseline(watchedOrders = {}, orderId, now = Date.now()) {
    const normalizedConfig = normalizeWatchedOrdersConfig(watchedOrders, now);
    const normalizedId = normalizeWatchedOrderId(orderId);

    return {
        items: normalizedConfig.items.map(item => {
            if (item.id !== normalizedId) {
                return item;
            }

            return normalizeWatchedOrderItem({
                ...item,
                lastBaselineAt: now
            }, now) || item;
        })
    };
}

function markWatchedOrderEvent(watchedOrders = {}, orderId, now = Date.now()) {
    const normalizedConfig = normalizeWatchedOrdersConfig(watchedOrders, now);
    const normalizedId = normalizeWatchedOrderId(orderId);

    return {
        items: normalizedConfig.items.map(item => {
            if (item.id !== normalizedId) {
                return item;
            }

            return normalizeWatchedOrderItem({
                ...item,
                lastEventAt: now
            }, now) || item;
        })
    };
}


function updateWatchedOrderReminder(watchedOrders = {}, orderId, updater, now = Date.now()) {
    const normalizedConfig = normalizeWatchedOrdersConfig(watchedOrders, now);
    const normalizedId = normalizeWatchedOrderId(orderId);
    let updatedItem = null;

    const items = normalizedConfig.items.map(item => {
        if (item.id !== normalizedId) {
            return item;
        }

        const updated = typeof updater === 'function' ? updater(item) : item;
        const normalizedItem = normalizeWatchedOrderItem(updated, now) || item;

        updatedItem = normalizedItem;

        return normalizedItem;
    });

    return {
        config: { items },
        updated: Boolean(updatedItem),
        notFound: !updatedItem,
        invalid: !isValidWatchedOrderId(normalizedId),
        item: updatedItem
    };
}

function setWatchedOrderReminder(watchedOrders = {}, orderId, reminderInput = {}, now = Date.now()) {
    const reminder = createWatchedOrderReminder(reminderInput, now);

    if (!reminder) {
        return {
            config: normalizeWatchedOrdersConfig(watchedOrders, now),
            updated: false,
            notFound: false,
            invalid: true,
            item: null,
            reminder: null
        };
    }

    const result = updateWatchedOrderReminder(watchedOrders, orderId, (item) => ({
        ...item,
        reminder
    }), now);

    return {
        ...result,
        invalid: result.invalid,
        reminder: result.item?.reminder || null
    };
}

function clearWatchedOrderReminder(watchedOrders = {}, orderId, now = Date.now()) {
    const result = updateWatchedOrderReminder(watchedOrders, orderId, (item) => ({
        ...item,
        reminder: null
    }), now);

    return {
        ...result,
        reminder: null
    };
}

function markWatchedOrderReminderDone(watchedOrders = {}, orderId, now = Date.now()) {
    return updateWatchedOrderReminder(watchedOrders, orderId, (item) => {
        if (!item.reminder) {
            return item;
        }

        return {
            ...item,
            reminder: {
                ...item.reminder,
                status: WATCHED_ORDER_REMINDER_STATUSES.DONE,
                updatedAt: now,
                completedAt: now
            }
        };
    }, now);
}

function markWatchedOrderReminderCancelled(watchedOrders = {}, orderId, now = Date.now()) {
    return updateWatchedOrderReminder(watchedOrders, orderId, (item) => {
        if (!item.reminder) {
            return item;
        }

        return {
            ...item,
            reminder: {
                ...item.reminder,
                status: WATCHED_ORDER_REMINDER_STATUSES.CANCELLED,
                updatedAt: now,
                cancelledAt: now
            }
        };
    }, now);
}

function getPendingWatchedOrderReminderItems(watchedOrders = {}) {
    return normalizeWatchedOrdersConfig(watchedOrders).items
        .filter(item => item.reminder?.status === WATCHED_ORDER_REMINDER_STATUSES.PENDING);
}

function getDueWatchedOrderReminderItems(watchedOrders = {}, now = Date.now()) {
    const numericNow = Number(now) || Date.now();

    return getPendingWatchedOrderReminderItems(watchedOrders)
        .filter(item => item.reminder.remindAt <= numericNow);
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
globalThis.WATCHED_ORDER_NOTE_LIMIT = WATCHED_ORDER_NOTE_LIMIT;
globalThis.WATCHED_ORDER_STATUSES = WATCHED_ORDER_STATUSES;
globalThis.WATCHED_ORDER_REMINDER_STATUSES = WATCHED_ORDER_REMINDER_STATUSES;
globalThis.WATCHED_ORDER_REMINDER_NOTE_LIMIT = WATCHED_ORDER_REMINDER_NOTE_LIMIT;
globalThis.normalizeWatchedOrderId = normalizeWatchedOrderId;
globalThis.isValidWatchedOrderId = isValidWatchedOrderId;
globalThis.normalizeWatchedOrderStatus = normalizeWatchedOrderStatus;
globalThis.normalizeWatchedOrderTimestamp = normalizeWatchedOrderTimestamp;
globalThis.isWatchedOrderFollowUpEnabled = isWatchedOrderFollowUpEnabled;
globalThis.normalizeWatchedOrderNote = normalizeWatchedOrderNote;
globalThis.normalizeWatchedOrderSnapshot = normalizeWatchedOrderSnapshot;
globalThis.createWatchedOrderSnapshotFromOrder = createWatchedOrderSnapshotFromOrder;
globalThis.normalizeWatchedOrderReminderStatus = normalizeWatchedOrderReminderStatus;
globalThis.normalizeWatchedOrderReminderNote = normalizeWatchedOrderReminderNote;
globalThis.normalizeWatchedOrderReminder = normalizeWatchedOrderReminder;
globalThis.createWatchedOrderReminder = createWatchedOrderReminder;
globalThis.normalizeWatchedOrderItem = normalizeWatchedOrderItem;
globalThis.normalizeWatchedOrdersConfig = normalizeWatchedOrdersConfig;
globalThis.createWatchedOrderItem = createWatchedOrderItem;
globalThis.getWatchedOrderItem = getWatchedOrderItem;
globalThis.hasWatchedOrderDirectBaseline = hasWatchedOrderDirectBaseline;
globalThis.markWatchedOrderDirectBaseline = markWatchedOrderDirectBaseline;
globalThis.markWatchedOrderEvent = markWatchedOrderEvent;
globalThis.getWatchedOrderIds = getWatchedOrderIds;
globalThis.addWatchedOrderToConfig = addWatchedOrderToConfig;
globalThis.removeWatchedOrderFromConfig = removeWatchedOrderFromConfig;
globalThis.setWatchedOrderReminder = setWatchedOrderReminder;
globalThis.clearWatchedOrderReminder = clearWatchedOrderReminder;
globalThis.markWatchedOrderReminderDone = markWatchedOrderReminderDone;
globalThis.markWatchedOrderReminderCancelled = markWatchedOrderReminderCancelled;
globalThis.getPendingWatchedOrderReminderItems = getPendingWatchedOrderReminderItems;
globalThis.getDueWatchedOrderReminderItems = getDueWatchedOrderReminderItems;
globalThis.createWatchedEventJournalOptions = createWatchedEventJournalOptions;
