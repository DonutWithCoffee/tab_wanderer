const DIRECT_FOLLOW_UP_STATE = {
    IDLE: 'idle',
    CHECKING: 'checking'
};

function normalizeDirectFollowUpTimestamp(value) {
    const numeric = Number(value);

    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeDirectFollowUpState(value = {}) {
    const safe = value && typeof value === 'object' ? value : {};
    const currentOrderId = normalizeWatchedOrderId(safe.currentOrderId);

    return {
        state: currentOrderId ? DIRECT_FOLLOW_UP_STATE.CHECKING : DIRECT_FOLLOW_UP_STATE.IDLE,
        currentOrderId: isValidWatchedOrderId(currentOrderId) ? currentOrderId : null,
        nextIndex: Number.isInteger(Number(safe.nextIndex)) && Number(safe.nextIndex) >= 0
            ? Number(safe.nextIndex)
            : 0,
        lastStartedAt: normalizeDirectFollowUpTimestamp(safe.lastStartedAt),
        lastCompletedAt: normalizeDirectFollowUpTimestamp(safe.lastCompletedAt),
        lastError: safe.lastError ? String(safe.lastError) : null
    };
}

function createDirectFollowUpUrl(orderId, options = {}) {
    const id = normalizeWatchedOrderId(orderId);

    if (!isValidWatchedOrderId(id)) {
        return '';
    }

    const baseUrl = String(options.baseUrl || 'https://amperkot.ru/admin/orders/');
    const marker = String(options.marker || '#tab_wanderer_direct_worker=1');
    const url = new URL(`${encodeURIComponent(id)}/`, baseUrl);

    url.hash = marker.replace(/^#/, '');

    return url.toString();
}

function getActiveWatchedOrderItems(watchedOrders = {}) {
    return normalizeWatchedOrdersConfig(watchedOrders).items
        .filter(item => item.status === WATCHED_ORDER_STATUSES.ACTIVE || item.status === WATCHED_ORDER_STATUSES.UNRESOLVED);
}

function selectNextDirectFollowUpItem(watchedOrders = {}, state = {}) {
    const items = getActiveWatchedOrderItems(watchedOrders);

    if (!items.length) {
        return {
            item: null,
            itemIndex: -1,
            nextIndex: 0
        };
    }

    const normalizedState = normalizeDirectFollowUpState(state);
    const itemIndex = normalizedState.nextIndex % items.length;
    const item = items[itemIndex];

    return {
        item,
        itemIndex,
        nextIndex: (itemIndex + 1) % items.length
    };
}

function updateWatchedOrderItem(watchedOrders = {}, orderId, updater, now = Date.now()) {
    const normalizedConfig = normalizeWatchedOrdersConfig(watchedOrders, now);
    const normalizedId = normalizeWatchedOrderId(orderId);

    return {
        items: normalizedConfig.items.map(item => {
            if (item.id !== normalizedId) {
                return item;
            }

            const updated = typeof updater === 'function' ? updater(item) : item;

            return normalizeWatchedOrderItem(updated, now) || item;
        })
    };
}

function markWatchedOrderCheckStarted(watchedOrders = {}, orderId, now = Date.now()) {
    return updateWatchedOrderItem(watchedOrders, orderId, (item) => ({
        ...item,
        lastError: null
    }), now);
}

function markWatchedOrderCheckResult(watchedOrders = {}, orderId, result = {}, now = Date.now()) {
    const ok = result?.ok === true;
    const error = result?.error ? String(result.error) : null;

    return updateWatchedOrderItem(watchedOrders, orderId, (item) => ({
        ...item,
        status: ok ? WATCHED_ORDER_STATUSES.ACTIVE : WATCHED_ORDER_STATUSES.UNRESOLVED,
        lastCheckedAt: now,
        lastError: ok ? null : (error || 'Direct follow-up failed')
    }), now);
}


function buildDirectFollowUpCoverageMetadata({ orderId, checkedAt = Date.now() } = {}) {
    return {
        collectedAt: Number(checkedAt) || Date.now(),
        syncReason: SYNC_REASONS.DIRECT_FOLLOW_UP,
        monitorMode: 'direct-follow-up',
        monitorScopeSignature: `direct-follow-up:${normalizeWatchedOrderId(orderId)}`,
        sessionMode: 'direct-follow-up',
        pagesCollected: 1,
        maxPages: 1,
        ordersCollected: 1,
        completionReason: 'direct-order-checked',
        isComplete: true
    };
}

globalThis.DIRECT_FOLLOW_UP_STATE = DIRECT_FOLLOW_UP_STATE;
globalThis.normalizeDirectFollowUpTimestamp = normalizeDirectFollowUpTimestamp;
globalThis.normalizeDirectFollowUpState = normalizeDirectFollowUpState;
globalThis.createDirectFollowUpUrl = createDirectFollowUpUrl;
globalThis.getActiveWatchedOrderItems = getActiveWatchedOrderItems;
globalThis.selectNextDirectFollowUpItem = selectNextDirectFollowUpItem;
globalThis.markWatchedOrderCheckStarted = markWatchedOrderCheckStarted;
globalThis.markWatchedOrderCheckResult = markWatchedOrderCheckResult;
globalThis.buildDirectFollowUpCoverageMetadata = buildDirectFollowUpCoverageMetadata;
