importScripts('version.js', 'core/watched-orders.js', 'core/direct-follow-up.js', 'notification-rules.js', 'core/order-model.js', 'core/collection-model.js', 'core/sync-model.js', 'core/event-journal.js', 'core/monitor-status.js', 'core/diagnostic-log.js', 'core/notification-message.js', 'core/order-lookup.js', 'core/runtime-api.js', 'core/ozon-product-search.js', 'core/ozon-barcode-binding.js', 'core/ozon-ui-apply-result.js', 'core/ozon-session-utils.js', 'core/ozon-session-messaging.js');

let knownOrdersDB = {};
let knownOrdersHashDB = {};
let windowOrdersDB = {};
let windowOrdersHashDB = {};
let notificationTargets = {};
let workerTabId = null;
let directWorkerTabId = null;
let ozonWorkerTabId = null;
let ozonResolveSession = null;
let ozonResolveTimeoutTimer = null;
let ozonUiApplySession = null;
let ozonUiApplyTimeoutTimer = null;
let directFollowUpState = normalizeDirectFollowUpState();
let directFollowUpOrdersDB = {};
let directFollowUpHashDB = {};
let lastBaselineDate = null;
let isRunning = false;
let monitorState = 'uninitialized';
let lastDeepSyncAt = 0;
let userConfig = null;
let pendingRebaseline = false;
let pendingSyncReason = null;
let collectionSession = null;
let monitorDictionaries = null;
let lastCollectionMetadata = null;
let eventJournal = [];
let eventJournalDroppedEntries = 0;
let diagnosticLog = [];
let diagnosticLogDroppedEntries = 0;
let diagnosticLogFlushTimer = null;
let isDiagnosticLogReady = false;
let pendingWatchedOrderAdd = null;
let lastWatchedOrderAddResult = null;
let pendingExtensionUpdate = null;
let storageDiagnostics = {
    lastBytesInUse: 0,
    lastCheckedAt: 0,
    lastError: null,
    lastErrorOperation: null,
    lastSuccessfulWriteAt: 0,
    knownOrdersDropped: 0,
    notificationTargetsDropped: 0,
    lastEstimatedStateBytes: 0
};
let storageWriteQueue = Promise.resolve();
let stateSaveRequested = false;
let stateSaveDrainPromise = null;
let initializationPromise = null;
let activeRuntimeMessageCount = 0;

let lastPing = Date.now();
let workerActivatedAt = Date.now();
let isCreatingWorker = false;
let isCleaningUp = false;
let isStarting = false;
let workerRetryTimer = null;

const TARGET_URL = 'https://amperkot.ru/admin/orders/';
const WORKER_MARK = '#tab_wanderer_worker=1';
const DIRECT_WORKER_MARK = '#tab_wanderer_direct_worker=1';
const OZON_WORKER_MARK = '#tab_wanderer_ozon_worker=1';
const OZON_PRODUCTS_URL = 'https://seller.ozon.ru/app/products';
const OZON_RESOLVE_TIMEOUT_MS = 30000;
const OZON_UI_APPLY_TIMEOUT_MS = 60000;
const OZON_KEEP_UI_APPLY_WORKER_OPEN_AFTER_RESULT = false;
const DIRECT_FOLLOW_UP_TIMEOUT_MS = 60 * 1000;
const WATCHED_ORDER_REMINDER_ALARM_PREFIX = 'tab_wanderer_watched_order_reminder:';
const FAST_POLL_INTERVAL_MS = 15000;
const DEEP_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const COLLECTION_TIMEOUT_MS = 60000;
const COLLECTION_MAX_ADVANCE_ATTEMPT_BUFFER = 2;
const EXTENSION_UPDATE_RETRY_ALARM = 'tab_wanderer_apply_extension_update';
const EXTENSION_UPDATE_RETRY_DELAY_MINUTES = 1;
const MONITOR_HEALTH_ALARM = 'tab_wanderer_monitor_health';
const DIRECT_FOLLOW_UP_ALARM = 'tab_wanderer_direct_follow_up';
const STORAGE_MAINTENANCE_ALARM = 'tab_wanderer_storage_maintenance';
const MONITOR_HEALTH_PERIOD_MINUTES = 1;
const DIRECT_FOLLOW_UP_PERIOD_MINUTES = 1;
const STORAGE_MAINTENANCE_PERIOD_MINUTES = 30;
const MAX_KNOWN_ORDERS = 5000;
const MAX_NOTIFICATION_TARGETS = 500;
const NOTIFICATION_TARGET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STORAGE_USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ORDER_BATCH_SIZE = 1000;
const MAX_ORDER_TEXT_LENGTH = 250;
const MAX_ORDER_TAGS = 20;
const MAX_ORDER_TAG_LENGTH = 80;
const MAX_ORDER_INTERNAL_ID_LENGTH = 100;
const MAX_ORDER_PHONE_LENGTH = 32;
const MAX_ESTIMATED_PERSISTED_STATE_BYTES = 8 * 1024 * 1024;
const STATE_RETENTION_TRIM_BATCH_SIZE = 100;
const STATE_BYTE_RETENTION_MIN_ORDER_COUNT = 500;
const STATE_BYTE_RETENTION_TRIGGER_BYTES = 6 * 1024 * 1024;

function parseTrustedUrl(value) {
    try {
        return new URL(String(value || ''));
    } catch {
        return null;
    }
}

function isTrustedAmperkotOrdersUrl(value) {
    const url = parseTrustedUrl(value);
    return Boolean(
        url
        && url.protocol === 'https:'
        && url.hostname === 'amperkot.ru'
        && /^\/admin\/orders(?:\/|$)/.test(url.pathname)
    );
}

function isMarkedAmperkotWorkerUrl(value, marker) {
    const url = parseTrustedUrl(value);
    return Boolean(
        url
        && isTrustedAmperkotOrdersUrl(url.toString())
        && url.hash === String(marker || '')
    );
}

function isMarkedOzonWorkerUrl(value) {
    const url = parseTrustedUrl(value);
    return Boolean(
        url
        && url.protocol === 'https:'
        && url.hostname === 'seller.ozon.ru'
        && url.pathname.startsWith('/app/products')
        && url.hash === OZON_WORKER_MARK
    );
}

function normalizeExtensionVersionParts(value) {
    return String(value || '')
        .split('.')
        .map((part) => {
            const numeric = Number.parseInt(part, 10);
            return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
        });
}

function compareExtensionVersions(left, right) {
    const leftParts = normalizeExtensionVersionParts(left);
    const rightParts = normalizeExtensionVersionParts(right);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
        const leftPart = leftParts[index] || 0;
        const rightPart = rightParts[index] || 0;

        if (leftPart !== rightPart) {
            return leftPart > rightPart ? 1 : -1;
        }
    }

    return 0;
}

function normalizePendingExtensionUpdate(value = {}) {
    const version = String(value?.version || '').trim();

    if (!version) {
        return null;
    }

    return {
        version,
        availableAt: Number(value?.availableAt) || Date.now()
    };
}

function getExtensionUpdateBlockers() {
    const blockers = [];

    if (ozonUiApplySession) {
        blockers.push('ozon-ui-apply');
    }

    if (ozonResolveSession) {
        blockers.push('ozon-resolve');
    }

    if (pendingWatchedOrderAdd) {
        blockers.push('watched-order-add');
    }

    if (directWorkerTabId || directFollowUpState?.currentOrderId) {
        blockers.push('direct-follow-up');
    }

    if (activeRuntimeMessageCount > 0) {
        blockers.push('runtime-message');
    }

    if (collectionSession) {
        blockers.push('collection');
    }

    if (stateSaveRequested || stateSaveDrainPromise) {
        blockers.push('storage-write');
    }

    if (isCreatingWorker || isStarting || isCleaningUp) {
        blockers.push('worker-lifecycle');
    }

    return blockers;
}

async function persistPendingExtensionUpdate() {
    const snapshot = pendingExtensionUpdate ? { ...pendingExtensionUpdate } : null;
    return enqueueStorageTask('pending-extension-update', () => (
        chrome.storage.local.set({ pendingExtensionUpdate: snapshot })
    ));
}

async function scheduleExtensionUpdateRetry() {
    await chrome.alarms.create(EXTENSION_UPDATE_RETRY_ALARM, {
        delayInMinutes: EXTENSION_UPDATE_RETRY_DELAY_MINUTES
    });
}

async function clearPendingExtensionUpdate() {
    pendingExtensionUpdate = null;
    await enqueueStorageTask('clear-pending-extension-update', () => (
        chrome.storage.local.set({ pendingExtensionUpdate: null })
    ));
    await chrome.alarms.clear(EXTENSION_UPDATE_RETRY_ALARM);
}

async function tryApplyPendingExtensionUpdate(trigger = 'unknown') {
    if (!pendingExtensionUpdate) {
        return { applied: false, reason: 'no-pending-update' };
    }

    const currentVersion = String(VERSION?.version || '0');

    if (compareExtensionVersions(pendingExtensionUpdate.version, currentVersion) <= 0) {
        const staleVersion = pendingExtensionUpdate.version;
        await clearPendingExtensionUpdate();
        log('INFO', 'UPDATE', 'cleared stale pending extension update', {
            trigger,
            currentVersion,
            pendingVersion: staleVersion
        });
        return { applied: false, reason: 'stale-update' };
    }

    const blockers = getExtensionUpdateBlockers();

    if (blockers.length) {
        await scheduleExtensionUpdateRetry();
        log('INFO', 'UPDATE', 'extension update deferred until safe state', {
            trigger,
            version: pendingExtensionUpdate.version,
            blockers
        });
        return { applied: false, reason: 'busy', blockers };
    }

    const nextVersion = pendingExtensionUpdate.version;
    await clearPendingExtensionUpdate();
    log('INFO', 'UPDATE', 'applying downloaded extension update', {
        trigger,
        currentVersion,
        nextVersion
    });
    chrome.runtime.reload();

    return { applied: true, version: nextVersion };
}

async function queueExtensionUpdate(details = {}) {
    const next = normalizePendingExtensionUpdate({
        version: details?.version,
        availableAt: Date.now()
    });

    if (!next) {
        return { applied: false, reason: 'invalid-update' };
    }

    pendingExtensionUpdate = next;
    await persistPendingExtensionUpdate();

    return tryApplyPendingExtensionUpdate('onUpdateAvailable');
}

function getConfiguredWatchedOrderFollowUpIntervalMinutes() {
    if (typeof normalizeWatchedOrderFollowUpIntervalMinutes === 'function') {
        return normalizeWatchedOrderFollowUpIntervalMinutes(userConfig?.watchedOrderFollowUpIntervalMinutes);
    }

    return Number(userConfig?.watchedOrderFollowUpIntervalMinutes) || 2;
}

function getConfiguredWatchedOrderFollowUpIntervalMs() {
    return getConfiguredWatchedOrderFollowUpIntervalMinutes() * 60 * 1000;
}

function isDirectFollowUpDue(now = Date.now()) {
    const lastCompletedAt = Number(directFollowUpState?.lastCompletedAt) || 0;
    const lastStartedAt = Number(directFollowUpState?.lastStartedAt) || 0;
    const lastActivityAt = Math.max(lastCompletedAt, lastStartedAt);

    return !lastActivityAt || (now - lastActivityAt) >= getConfiguredWatchedOrderFollowUpIntervalMs();
}

function getConfiguredDeepSyncMaxPages() {
    if (typeof normalizeDeepSyncMaxPages === 'function') {
        return normalizeDeepSyncMaxPages(userConfig?.deepSyncMaxPages);
    }

    return Number(userConfig?.deepSyncMaxPages) || 30;
}

function getCollectionPolicy() {
    const monitorMode = String(userConfig?.monitorMode || 'windowed');

    if (monitorMode === 'active') {
        return {
            sessionMode: COLLECTION_SESSION_MODES.FAST,
            deepSyncDue: false,
            maxPages: 1
        };
    }

    const deepSyncDue = pendingRebaseline
        || (Date.now() - lastDeepSyncAt) >= DEEP_SYNC_INTERVAL_MS;

    return {
        sessionMode: deepSyncDue ? COLLECTION_SESSION_MODES.DEEP : COLLECTION_SESSION_MODES.FAST,
        deepSyncDue,
        maxPages: getConfiguredDeepSyncMaxPages()
    };
}

function getCollectionMaxAdvanceAttempts() {
    return getCollectionPolicy().maxPages + COLLECTION_MAX_ADVANCE_ATTEMPT_BUFFER;
}

function getCollectionSessionMode() {
    return getCollectionPolicy().sessionMode;
}



function buildDirectFollowUpOrderUrl(orderId) {
    return createDirectFollowUpUrl(orderId, {
        baseUrl: TARGET_URL,
        marker: DIRECT_WORKER_MARK
    });
}

async function getMarkedDirectWorkerTabs() {
    const tabs = await chrome.tabs.query({});

    return tabs.filter(tab => {
        return isMarkedAmperkotWorkerUrl(tab?.url, DIRECT_WORKER_MARK);
    });
}

async function cleanupDirectWorkerTabs() {
    const tabs = await getMarkedDirectWorkerTabs();

    for (const tab of tabs) {
        try {
            await chrome.tabs.remove(tab.id);
        } catch {}
    }
}

function getDirectFollowUpSelection() {
    return selectNextDirectFollowUpItem(userConfig?.watchedOrders, directFollowUpState);
}

function getAddedWatchedOrderIds(prevWatchedOrders = {}, nextWatchedOrders = {}) {
    const prevIds = new Set(getWatchedOrderIds(prevWatchedOrders));

    return getWatchedOrderIds(nextWatchedOrders).filter(orderId => !prevIds.has(orderId));
}

function getPendingWatchedOrderAddForOrder(orderId) {
    const normalizedId = normalizeWatchedOrderId(orderId);

    if (!pendingWatchedOrderAdd || pendingWatchedOrderAdd.orderId !== normalizedId) {
        return null;
    }

    return pendingWatchedOrderAdd;
}

function clearStaleDirectFollowUpState(reason = 'stale-direct-state-cleared') {
    const staleOrderId = directFollowUpState?.currentOrderId || null;

    if (directWorkerTabId || !staleOrderId) {
        return false;
    }

    directFollowUpState = normalizeDirectFollowUpState({
        nextIndex: directFollowUpState?.nextIndex,
        lastCompletedAt: directFollowUpState?.lastCompletedAt,
        lastError: reason
    });

    log('WARN', 'DIRECT_FOLLOW_UP', 'stale direct state cleared', {
        orderId: staleOrderId,
        reason
    });

    return true;
}

function clearStalePendingWatchedOrderAdd(reason = 'stale watched order add validation cleared') {
    if (!pendingWatchedOrderAdd || directWorkerTabId || directFollowUpState?.currentOrderId) {
        return false;
    }

    const staleOrderId = pendingWatchedOrderAdd.orderId || null;

    pendingWatchedOrderAdd = null;
    lastWatchedOrderAddResult = {
        ok: false,
        orderId: staleOrderId,
        error: reason,
        completedAt: Date.now()
    };

    log('WARN', 'WATCHED_ORDERS', 'stale add validation cleared', {
        orderId: staleOrderId,
        reason
    });

    return true;
}

function completePendingWatchedOrderAdd(orderId, response) {
    const pending = getPendingWatchedOrderAddForOrder(orderId);

    if (!pending) {
        return false;
    }

    const safeResponse = response && typeof response === 'object' ? response : createRuntimeFailureResponse();

    pendingWatchedOrderAdd = null;
    lastWatchedOrderAddResult = {
        ok: safeResponse.ok === true,
        orderId: pending.orderId,
        error: safeResponse.ok === true ? null : (safeResponse.error || 'Не удалось проверить заказ.'),
        completedAt: Date.now()
    };

    log(lastWatchedOrderAddResult.ok ? 'INFO' : 'WARN', 'WATCHED_ORDERS', lastWatchedOrderAddResult.ok ? 'add validation completed' : 'add validation failed', lastWatchedOrderAddResult);

    return true;
}

function failPendingWatchedOrderAdd(orderId, error) {
    return completePendingWatchedOrderAdd(orderId, createRuntimeFailureResponse({
        error: String(error || 'Не удалось проверить заказ.'),
        orderId: normalizeWatchedOrderId(orderId),
        userConfig
    }));
}

function getNextDirectFollowUpIndexAfterOrder(orderId) {
    const normalizedId = normalizeWatchedOrderId(orderId);
    const items = getActiveWatchedOrderItems(userConfig?.watchedOrders);
    const itemIndex = items.findIndex(item => item.id === normalizedId);

    if (itemIndex === -1 || !items.length) {
        return directFollowUpState?.nextIndex || 0;
    }

    return (itemIndex + 1) % items.length;
}

async function startImmediateDirectFollowUpBaselineForAddedOrder(orderIds = []) {
    if (!Array.isArray(orderIds) || !orderIds.length) {
        return false;
    }

    if (directWorkerTabId || directFollowUpState?.currentOrderId) {
        log('INFO', 'DIRECT_FOLLOW_UP', 'immediate baseline skipped, direct worker is busy', {
            orderIds
        });
        return false;
    }

    const orderId = orderIds.find(candidate => {
        const normalizedId = normalizeWatchedOrderId(candidate);

        return normalizedId && !hasWatchedOrderDirectBaseline(userConfig?.watchedOrders, normalizedId);
    });

    if (!orderId) {
        return false;
    }

    const normalizedId = normalizeWatchedOrderId(orderId);

    log('INFO', 'DIRECT_FOLLOW_UP', 'immediate baseline requested', {
        orderId: normalizedId
    });

    return startDirectFollowUpCheck(normalizedId, getNextDirectFollowUpIndexAfterOrder(normalizedId));
}

async function startDirectFollowUpCheck(orderId, nextIndex = 0) {
    const url = buildDirectFollowUpOrderUrl(orderId);

    if (!url) {
        return false;
    }

    await cleanupDirectWorkerTabs();

    const now = Date.now();
    const tab = await chrome.tabs.create({
        url,
        active: false,
        pinned: true
    });

    directWorkerTabId = tab.id;
    directFollowUpState = normalizeDirectFollowUpState({
        currentOrderId: orderId,
        nextIndex,
        lastStartedAt: now,
        lastCompletedAt: directFollowUpState?.lastCompletedAt,
        lastError: null
    });
    userConfig = {
        ...userConfig,
        watchedOrders: markWatchedOrderCheckStarted(userConfig?.watchedOrders, orderId, now)
    };

    log('INFO', 'DIRECT_FOLLOW_UP', 'worker created', {
        orderId: normalizeWatchedOrderId(orderId),
        tabId: directWorkerTabId,
        pendingAdd: Boolean(getPendingWatchedOrderAddForOrder(orderId))
    });

    await save();

    return true;
}

async function completeDirectFollowUpCheck(orderId, result = {}) {
    const normalizedId = normalizeWatchedOrderId(orderId || directFollowUpState?.currentOrderId);

    if (!normalizedId) {
        return false;
    }

    const now = Date.now();
    const ok = result?.ok === true;
    const error = result?.error ? String(result.error) : null;
    const pendingAdd = getPendingWatchedOrderAddForOrder(normalizedId);

    if (pendingAdd && !ok) {
        userConfig = {
            ...userConfig,
            watchedOrders: removeWatchedOrderFromConfig(userConfig?.watchedOrders, normalizedId)
        };
    }

    if (pendingAdd && ok && result?.order) {
        const addResult = addWatchedOrderToConfig(userConfig?.watchedOrders, normalizedId, now, {
            note: pendingAdd.note
        });

        if (!addResult.added && !addResult.duplicate) {
            const addError = addResult.invalid
                ? 'Некорректный номер заказа.'
                : addResult.limitReached
                    ? 'Достигнут лимит отслеживаемых заказов.'
                    : 'Не удалось добавить заказ.';

            failPendingWatchedOrderAdd(normalizedId, addError);
            return completeDirectFollowUpCheck(normalizedId, {
                ok: false,
                error: addError
            });
        }

        userConfig = {
            ...userConfig,
            watchedOrders: addResult.config
        };
    }

    const directResult = ok && result?.order
        ? processDirectFollowUpOrder(result.order, normalizedId, now)
        : null;
    const hasValidatedPendingAdd = pendingAdd && directResult?.ok === true && directResult?.baseline === true;

    userConfig = {
        ...userConfig,
        watchedOrders: markWatchedOrderCheckResult(userConfig?.watchedOrders, normalizedId, {
            ok: ok && directResult?.ok !== false,
            error: error || directResult?.reason,
            order: result?.order || null
        }, now)
    };

    if (pendingAdd) {
        if (hasValidatedPendingAdd) {
            completePendingWatchedOrderAdd(normalizedId, createRuntimeOkResponse({
                added: true,
                validated: true,
                orderId: normalizedId,
                userConfig
            }));
        } else {
            userConfig = {
                ...userConfig,
                watchedOrders: removeWatchedOrderFromConfig(userConfig?.watchedOrders, normalizedId)
            };
            failPendingWatchedOrderAdd(
                normalizedId,
                error || 'Заказ не найден или страница заказа не распознана.'
            );
        }
    } else if (!ok && !hasWatchedOrderDirectBaseline(userConfig?.watchedOrders, normalizedId)) {
        userConfig = {
            ...userConfig,
            watchedOrders: removeWatchedOrderFromConfig(userConfig?.watchedOrders, normalizedId)
        };
    }

    directFollowUpState = normalizeDirectFollowUpState({
        nextIndex: directFollowUpState?.nextIndex,
        lastCompletedAt: now,
        lastError: ok && directResult?.ok !== false ? null : (error || directResult?.reason || 'Direct follow-up failed')
    });

    log(ok && directResult?.ok !== false ? 'INFO' : 'WARN', 'DIRECT_FOLLOW_UP', ok && directResult?.ok !== false ? 'checked' : 'failed', {
        orderId: normalizedId,
        error: ok && directResult?.ok !== false ? null : directFollowUpState.lastError,
        result: directResult?.reason || null,
        eventCreated: directResult?.eventCreated === true,
        notified: directResult?.notified === true,
        pendingAdd: Boolean(pendingAdd)
    });

    const tabId = directWorkerTabId;
    directWorkerTabId = null;

    if (tabId) {
        try {
            await chrome.tabs.remove(tabId);
        } catch {}
    }

    await save();

    return true;
}

async function runDirectFollowUpTick() {
    if (!isRunning || monitorState !== 'active' || directWorkerTabId || directFollowUpState?.currentOrderId) {
        return false;
    }

    if (!isDirectFollowUpDue()) {
        return false;
    }

    const selection = getDirectFollowUpSelection();

    if (!selection.item) {
        return false;
    }

    return startDirectFollowUpCheck(selection.item.id, selection.nextIndex);
}

async function handleDirectFollowUpTimeout() {
    if (!directWorkerTabId || !directFollowUpState?.currentOrderId) {
        return false;
    }

    const startedAt = Number(directFollowUpState.lastStartedAt) || 0;

    if (!startedAt || (Date.now() - startedAt) <= DIRECT_FOLLOW_UP_TIMEOUT_MS) {
        return false;
    }

    return completeDirectFollowUpCheck(directFollowUpState.currentOrderId, {
        ok: false,
        error: 'direct follow-up timeout'
    });
}

async function goToCollectionPage(page) {
    if (!workerTabId) {
        log('WARN', 'COLLECTION', 'cannot navigate, workerTabId is missing');
        return false;
    }

    try {
        await chrome.tabs.update(workerTabId, {
            url: buildOrdersUrl(userConfig?.monitorScope, page)
        });

        log('DEBUG', 'COLLECTION', 'navigated to page', page);
        return true;
    } catch (err) {
        log('ERROR', 'COLLECTION', 'failed to navigate', {
            page,
            error: err?.message || err
        });
        return false;
    }
}

async function advanceCollectionPage() {
    if (!collectionSession) {
        log('WARN', 'COLLECTION', 'advance requested without session');
        return { ok: false, aborted: false };
    }

    collectionSession.advanceAttempts += 1;
    collectionSession.lastActivityAt = Date.now();

    const maxAdvanceAttempts = getCollectionMaxAdvanceAttempts();

    if (collectionSession.advanceAttempts > maxAdvanceAttempts) {
        log('ERROR', 'COLLECTION', 'advance limit exceeded', {
            advanceAttempts: collectionSession.advanceAttempts,
            maxAdvanceAttempts,
            mode: collectionSession.mode,
            currentPage: collectionSession.currentPage,
            nextPage: collectionSession.nextPage
        });

        resetCollectionSession();

        if (workerTabId) {
            await goToCollectionPage(1);
        }

        return { ok: false, aborted: true };
    }

    const ok = await goToCollectionPage(collectionSession.nextPage);

    return { ok, aborted: false };
}

function resetCollectionSession() {
    collectionSession = null;
}

async function returnWorkerToFirstPageAfterDeepSession(session) {
    if (session?.mode !== 'deep') {
        return false;
    }

    const ok = await goToCollectionPage(1);

    if (ok) {
        log('INFO', 'COLLECTION', 'returned worker to page 1 after deep session');
    }

    return ok;
}

function shouldStartDeepSync() {
    return getCollectionPolicy().deepSyncDue;
}

function ensureCollectionSession() {
    if (!collectionSession) {
        collectionSession = createCollectionSession(
            getCollectionSessionMode()
        );
    }

    return collectionSession;
}

function markDeepSyncCompleted(session) {
    if (session?.mode === 'deep') {
        lastDeepSyncAt = Date.now();
    }
}

function shouldEmitEvents() {
    return monitorState === 'active' && pendingRebaseline !== true;
}

function logCollectionSessionCompleted(session, orders = []) {
    if (!session) {
        return;
    }

    const level = session.mode === COLLECTION_SESSION_MODES.DEEP ? 'INFO' : 'DEBUG';

    log(level, 'COLLECTION', 'session completed', createCollectionSessionLogDetails(session, orders));
}

function buildOrdersUrl(monitorScope = {}, page = 1) {
    const url = new URL(TARGET_URL);

    const statusList = Array.isArray(monitorScope.status) ? monitorScope.status : [];
    const deliveryList = Array.isArray(monitorScope.delivery) ? monitorScope.delivery : [];
    const paymentList = Array.isArray(monitorScope.payment) ? monitorScope.payment : [];
    const orderFlagsList = Array.isArray(monitorScope.orderFlags) ? monitorScope.orderFlags : [];
    const storeList = Array.isArray(monitorScope.store) ? monitorScope.store : [];
    const reserveList = Array.isArray(monitorScope.reserve) ? monitorScope.reserve : [];
    const assemblyStatusList = Array.isArray(monitorScope.assemblyStatus) ? monitorScope.assemblyStatus : [];

    statusList.forEach(value => {
        url.searchParams.append('status[]', String(value));
    });

    deliveryList.forEach(value => {
        url.searchParams.append('delivery[]', String(value));
    });

    paymentList.forEach(value => {
        url.searchParams.append('payment[]', String(value));
    });

    orderFlagsList.forEach(value => {
        url.searchParams.append('flag[]', String(value));
    });

    storeList.forEach(value => {
        url.searchParams.append('store[]', String(value));
    });

    reserveList.forEach(value => {
        url.searchParams.append('reserve[]', String(value));
    });

    assemblyStatusList.forEach(value => {
        url.searchParams.append('assembly_status[]', String(value));
    });

    if (page > 1) {
        url.searchParams.set('page', String(page));
    }

    url.hash = WORKER_MARK;

    return url.toString();
}

// ---------- LOGGER ----------
const LOG_LEVEL = 'DEBUG';

const LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

function shouldLog(level) {
    return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

function getDiagnosticLogMessage(args = []) {
    const parts = [];

    for (const arg of args) {
        if (arg === null || arg === undefined) continue;

        if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
            parts.push(String(arg));
        }
    }

    return parts.join(' ') || 'event';
}

function getDiagnosticLogDetails(args = []) {
    const objectArgs = args.filter(arg => arg && typeof arg === 'object');

    if (!objectArgs.length) {
        return null;
    }

    if (objectArgs.length === 1) {
        return sanitizeDiagnosticLogDetails(objectArgs[0]);
    }

    return sanitizeDiagnosticLogDetails({ args: objectArgs });
}

function flushDiagnosticLog() {
    if (!isDiagnosticLogReady) {
        return;
    }

    enqueueStorageTask('diagnostic-log', async () => {
        await chrome.storage.local.set({ diagnosticLog, diagnosticLogDroppedEntries });
        return true;
    });
}

function scheduleDiagnosticLogFlush(level) {
    if (!isDiagnosticLogReady || !shouldPersistDiagnosticLogLevel(level)) {
        return;
    }

    if (diagnosticLogFlushTimer) {
        return;
    }

    const delay = normalizeDiagnosticLogLevel(level) === 'ERROR'
        || normalizeDiagnosticLogLevel(level) === 'WARN'
        ? 0
        : 1000;

    diagnosticLogFlushTimer = setTimeout(() => {
        diagnosticLogFlushTimer = null;
        flushDiagnosticLog();
    }, delay);
}

function persistDiagnosticLog(level, scope, args = []) {
    if (!isDiagnosticLogReady || !shouldPersistDiagnosticLogLevel(level)) {
        return;
    }

    const entry = createDiagnosticLogEntry({
        level,
        scope,
        message: getDiagnosticLogMessage(args),
        details: getDiagnosticLogDetails(args)
    });

    const retention = appendDiagnosticLogEntryWithRetention(diagnosticLog, entry);

    diagnosticLog = retention.entries;
    diagnosticLogDroppedEntries += retention.dropped;

    scheduleDiagnosticLogFlush(level);
}

function log(level, scope, ...args) {
    if (shouldLog(level)) {
        console.log(`[BG][${level}][${scope}]`, ...args);
    }

    persistDiagnosticLog(level, scope, args);
}

log('INFO', 'VERSION', VERSION);

// ---------- STATE ----------
function logState(scope = 'STATE') {
    const knownIds = Object.keys(knownOrdersDB);
    const windowIds = Object.keys(windowOrdersDB);

    log('DEBUG', scope, {
        totalKnownOrders: knownIds.length,
        totalKnownHashes: Object.keys(knownOrdersHashDB).length,
        totalWindowOrders: windowIds.length,
        totalWindowHashes: Object.keys(windowOrdersHashDB).length,
        lastKnownOrders: knownIds.slice(-5),
        lastWindowOrders: windowIds.slice(-5),
        lastBaselineDate,
        isRunning,
        monitorState,
        lastDeepSyncAt,
        workerTabId,
        directWorkerTabId,
        directFollowUpState,
        pendingRebaseline,
        pendingSyncReason,
        lastCollectionMetadata,
        totalEventJournalEntries: Array.isArray(eventJournal) ? eventJournal.length : 0,
        eventJournalDroppedEntries,
        totalDiagnosticLogEntries: Array.isArray(diagnosticLog) ? diagnosticLog.length : 0,
        diagnosticLogDroppedEntries,
        lastEventJournalEntry: Array.isArray(eventJournal) && eventJournal.length
            ? eventJournal[eventJournal.length - 1]
            : null,
        collectionSession: collectionSession
            ? {
                mode: collectionSession.mode,
                startedAt: collectionSession.startedAt,
                lastActivityAt: collectionSession.lastActivityAt,
                advanceAttempts: collectionSession.advanceAttempts,
                totalOrders: Object.keys(collectionSession.orders || {}).length,
                isComplete: collectionSession.isComplete,
                completionReason: collectionSession.completionReason,
                currentPage: collectionSession.currentPage,
                lastCollectedPage: collectionSession.lastCollectedPage,
                nextPage: collectionSession.nextPage,
                seenKnownOrder: collectionSession.seenKnownOrder,
                processedPages: Object.keys(collectionSession.processedPages || {})
            }
            : null
    });
}

// ---------- HELPERS ----------
function todayKey() {
    return new Date().toDateString();
}

function hasKnownOrders() {
    return Object.keys(knownOrdersDB || {}).length > 0;
}

function scheduleRebaseline(reason) {
    pendingRebaseline = true;
    pendingSyncReason = normalizeSyncReason(reason);
}

function clearPendingRebaseline() {
    pendingRebaseline = false;
    pendingSyncReason = null;
}

function getCurrentPendingSyncAction() {
    return getPendingSyncAction({
        pendingRebaseline,
        syncReason: pendingSyncReason,
        hasKnownOrders: hasKnownOrders()
    });
}

function shouldRunCatchUpForPendingSync() {
    return getCurrentPendingSyncAction() === PENDING_SYNC_ACTIONS.CATCH_UP;
}

function recordCollectionMetadata(session, orders, reason = SYNC_REASONS.NORMAL) {
    const policy = getCollectionPolicy();

    lastCollectionMetadata = buildCollectionCoverageMetadata({
        session,
        reason,
        monitorMode: userConfig?.monitorMode,
        monitorScope: userConfig?.monitorScope,
        maxPages: policy.maxPages,
        ordersCount: Array.isArray(orders) ? orders.length : 0
    });
}

function appendEventJournalEntryToState(entry) {
    const retention = appendEventJournalEntryWithRetention(eventJournal, entry);

    eventJournal = retention.entries;
    eventJournalDroppedEntries += retention.dropped;
}

function appendOrderEventToJournal(order, eventContext, notificationDecision, syncReason = SYNC_REASONS.NORMAL, coverageMetadata = lastCollectionMetadata) {
    const entry = createEventJournalEntry({
        order,
        eventContext,
        notificationDecision,
        syncReason,
        monitorMode: userConfig?.monitorMode,
        monitorScope: userConfig?.monitorScope,
        coverageMetadata
    });

    appendEventJournalEntryToState(entry);
}

function createNotificationSuppressedDecision(ruleId, reason, eventContext, baseDecision = {}) {
    return {
        notify: false,
        action: 'suppress',
        ruleId,
        reason,
        matchedFields: Array.isArray(baseDecision.matchedFields)
            ? baseDecision.matchedFields
            : [],
        context: eventContext,
        config: baseDecision.config || getEffectiveUserConfig(userConfig)
    };
}

function shouldSuppressCatchUpNotification(syncReason, suppressNotifications = false) {
    if (suppressNotifications !== true) {
        return false;
    }

    const reason = normalizeSyncReason(syncReason);

    return reason === SYNC_REASONS.MANUAL_START
        || reason === SYNC_REASONS.RECOVERY
        || reason === SYNC_REASONS.STALE_RESUME
        || reason === SYNC_REASONS.INITIAL;
}

function applyNotificationSuppressionPolicy(decision, eventContext, syncReason, options = {}) {
    if (!shouldSuppressCatchUpNotification(syncReason, options.suppressNotifications)) {
        return decision;
    }

    return createNotificationSuppressedDecision(
        'notification-startup-catch-up-suppressed',
        'Startup catch-up notifications are suppressed',
        eventContext,
        decision
    );
}

function appendScopeChangeEventToJournal(prevScope, nextScope) {
    const entry = createScopeChangeJournalEntry({
        prevScope,
        nextScope,
        monitorDictionaries,
        monitorMode: userConfig?.monitorMode
    });

    appendEventJournalEntryToState(entry);
}


function markWatchedOrderBaselineForDirectFollowUp(orderId, now = Date.now()) {
    userConfig = {
        ...userConfig,
        watchedOrders: markWatchedOrderDirectBaseline(userConfig?.watchedOrders, orderId, now)
    };
}

function markWatchedOrderEventForDirectFollowUp(orderId, now = Date.now()) {
    userConfig = {
        ...userConfig,
        watchedOrders: markWatchedOrderEvent(userConfig?.watchedOrders, orderId, now)
    };
}

function storeOrderSnapshotInMainState(orderId, order) {
    const normalizedId = normalizeWatchedOrderId(orderId || order?.id);

    if (!normalizedId || !order?.id) {
        return null;
    }

    const mergedOrder = mergeOrderSnapshots(knownOrdersDB[normalizedId], order);
    const mergedHash = getHash(mergedOrder);

    knownOrdersDB[normalizedId] = mergedOrder;
    knownOrdersHashDB[normalizedId] = mergedHash;

    if (windowOrdersDB[normalizedId] || windowOrdersHashDB[normalizedId]) {
        windowOrdersDB[normalizedId] = mergeOrderSnapshots(windowOrdersDB[normalizedId], mergedOrder);
        windowOrdersHashDB[normalizedId] = getHash(windowOrdersDB[normalizedId]);
    }

    return mergedOrder;
}

function storeDirectFollowUpSnapshot(orderId, order) {
    const normalizedId = normalizeWatchedOrderId(orderId || order?.id);

    if (!normalizedId || !order?.id) {
        return null;
    }

    directFollowUpOrdersDB[normalizedId] = { ...order };
    directFollowUpHashDB[normalizedId] = getHash(order);

    return directFollowUpOrdersDB[normalizedId];
}

function baselineDirectFollowUpOrder(order, orderId, now = Date.now()) {
    const normalizedId = normalizeWatchedOrderId(orderId || order?.id);

    if (!normalizedId || !order?.id) {
        return {
            baseline: false,
            eventCreated: false,
            notified: false,
            reason: 'invalid-direct-order'
        };
    }

    storeDirectFollowUpSnapshot(normalizedId, order);
    storeOrderSnapshotInMainState(normalizedId, order);
    markWatchedOrderBaselineForDirectFollowUp(normalizedId, now);

    log('INFO', 'DIRECT_FOLLOW_UP', 'baseline', {
        orderId: normalizedId
    });

    return {
        baseline: true,
        eventCreated: false,
        notified: false,
        reason: 'direct-follow-up-baseline'
    };
}

function processDirectFollowUpOrder(order, orderId, now = Date.now()) {
    const normalizedId = normalizeWatchedOrderId(orderId || order?.id);

    if (!normalizedId || !order?.id || normalizeWatchedOrderId(order.id) !== normalizedId) {
        return {
            ok: false,
            eventCreated: false,
            notified: false,
            reason: 'invalid-direct-order'
        };
    }

    const hasBaseline = hasWatchedOrderDirectBaseline(userConfig?.watchedOrders, normalizedId);
    const prevOrder = directFollowUpOrdersDB[normalizedId] || knownOrdersDB[normalizedId] || null;
    const prevHash = directFollowUpHashDB[normalizedId] || (prevOrder ? getHash(prevOrder) : null);

    if (!hasBaseline || !prevOrder || !prevHash) {
        return {
            ok: true,
            ...baselineDirectFollowUpOrder(order, normalizedId, now)
        };
    }

    const newHash = getHash(order);

    if (newHash === prevHash) {
        if (!areStoredOrdersEqual(prevOrder, order)) {
            storeDirectFollowUpSnapshot(normalizedId, order);
            storeOrderSnapshotInMainState(normalizedId, order);
        }

        return {
            ok: true,
            eventCreated: false,
            notified: false,
            reason: 'direct-follow-up-no-change'
        };
    }

    const changedFields = getChangedFields(prevOrder, order);

    if (!changedFields.length) {
        storeDirectFollowUpSnapshot(normalizedId, order);
        storeOrderSnapshotInMainState(normalizedId, order);

        log('INFO', 'DIRECT_FOLLOW_UP', 'normalized no-change', {
            orderId: normalizedId
        });

        return {
            ok: true,
            eventCreated: false,
            notified: false,
            reason: 'direct-follow-up-normalized-no-change'
        };
    }

    const eventContext = {
        prevOrder,
        prevHash,
        newHash,
        isNewOrder: false,
        eventType: JOURNAL_EVENT_TYPES.ORDER_CHANGED,
        eventKind: JOURNAL_EVENT_KINDS.DIRECT_FOLLOW_UP,
        changedFields
    };
    const decision = evaluateNotification(order, eventContext, userConfig);

    log('INFO', 'DIRECT_FOLLOW_UP', 'change event', {
        orderId: normalizedId,
        changedFields
    });

    appendOrderEventToJournal(
        order,
        eventContext,
        decision,
        SYNC_REASONS.DIRECT_FOLLOW_UP,
        buildDirectFollowUpCoverageMetadata({ orderId: normalizedId, checkedAt: now })
    );
    markWatchedOrderEventForDirectFollowUp(normalizedId, now);

    if (!decision.notify) {
        log('INFO', 'RULES', {
            id: normalizedId,
            action: decision.action,
            ruleId: decision.ruleId,
            reason: decision.reason,
            isNewOrder: false,
            eventType: eventContext.eventType,
            eventKind: eventContext.eventKind,
            changedFields
        });
    } else {
        notifyOrder(order, eventContext);
    }

    storeDirectFollowUpSnapshot(normalizedId, order);
    storeOrderSnapshotInMainState(normalizedId, order);

    return {
        ok: true,
        eventCreated: true,
        notified: decision.notify === true,
        reason: decision.notify === true ? 'direct-follow-up-notified' : 'direct-follow-up-suppressed'
    };
}

function getMonitorStatusSnapshot() {
    return createMonitorStatusSnapshot({
        knownOrdersDB,
        knownOrdersHashDB,
        windowOrdersDB,
        windowOrdersHashDB,
        notificationTargets,
        workerTabId,
        directWorkerTabId,
        directFollowUpState,
        lastBaselineDate,
        isRunning,
        monitorState,
        lastDeepSyncAt,
        userConfig,
        pendingRebaseline,
        pendingSyncReason,
        collectionSession,
        lastCollectionMetadata,
        eventJournal,
        eventJournalDroppedEntries,
        diagnosticLog,
        diagnosticLogDroppedEntries,
        storageDiagnostics,
        pendingWatchedOrderAdd,
        lastWatchedOrderAddResult
    });
}

function getEffectiveUserConfig(storedConfig) {
    const safe = storedConfig || {};
    const configWithoutRules = { ...safe };

    delete configWithoutRules.rules;

    const monitorMode = safe.monitorMode === 'active'
        ? 'active'
        : 'windowed';

    return {
        ...DEFAULT_CONFIG,
        ...configWithoutRules,
        monitorMode,
        deepSyncMaxPages: normalizeDeepSyncMaxPages(safe.deepSyncMaxPages),
        watchedOrderFollowUpIntervalMinutes: normalizeWatchedOrderFollowUpIntervalMinutes(safe.watchedOrderFollowUpIntervalMinutes),
        notificationTriggers: normalizeNotificationTriggers(safe.notificationTriggers),
        notificationSuppressors: normalizeNotificationSuppressors(safe.notificationSuppressors),
        monitorScope: normalizeMonitorScope(safe.monitorScope),
        watchedOrders: normalizeWatchedOrdersConfig(safe.watchedOrders)
    };
}

async function getMarkedWorkerTabs() {
    const tabs = await chrome.tabs.query({});

    return tabs.filter(tab => {
        return isMarkedAmperkotWorkerUrl(tab?.url, WORKER_MARK);
    });
}

function normalizeDictionaries(raw) {
    const safe = raw || {};

    const normalizeGroup = (list) => {
        if (!Array.isArray(list)) return [];

        return list
            .map((item) => ({
                id: String(item?.id || '').trim(),
                label: String(item?.label || '').trim()
            }))
            .filter((item) => item.id && item.label);
    };

    return {
        status: normalizeGroup(safe.status),
        delivery: normalizeGroup(safe.delivery),
        payment: normalizeGroup(safe.payment),
        orderFlags: normalizeGroup(safe.orderFlags),
        store: normalizeGroup(safe.store),
        reserve: normalizeGroup(safe.reserve),
        assemblyStatus: normalizeGroup(safe.assemblyStatus),
        updatedAt: Date.now()
    };
}

function getComparableDictionariesSnapshot(dictionaries = {}) {
    const safe = dictionaries || {};

    return {
        status: safe.status || [],
        delivery: safe.delivery || [],
        payment: safe.payment || [],
        orderFlags: safe.orderFlags || [],
        store: safe.store || [],
        reserve: safe.reserve || [],
        assemblyStatus: safe.assemblyStatus || []
    };
}

function areDictionariesEqual(prev, next) {
    if (!prev && !next) return true;
    if (!prev || !next) return false;

    return JSON.stringify(getComparableDictionariesSnapshot(prev)) === JSON.stringify(getComparableDictionariesSnapshot(next));
}

// ---------- STORAGE ----------
function enqueueStorageTask(label, task) {
    const run = storageWriteQueue
        .catch(() => {})
        .then(async () => {
            try {
                const result = await task();

                if (storageDiagnostics.lastErrorOperation === label) {
                    storageDiagnostics.lastError = null;
                    storageDiagnostics.lastErrorOperation = null;
                }

                storageDiagnostics.lastSuccessfulWriteAt = Date.now();
                return result;
            } catch (err) {
                storageDiagnostics.lastError = String(err?.message || err || 'storage write failed');
                storageDiagnostics.lastErrorOperation = label;
                console.error(`[BG][ERROR][STORAGE][${label}]`, storageDiagnostics.lastError);
                return false;
            }
        });

    storageWriteQueue = run;
    return run;
}

function buildCanonicalOrderUrl(orderId) {
    const normalizedId = typeof normalizeWatchedOrderId === 'function'
        ? normalizeWatchedOrderId(orderId)
        : String(orderId || '').trim();

    return typeof isValidWatchedOrderId === 'function' && isValidWatchedOrderId(normalizedId)
        ? `${TARGET_URL}${normalizedId}/`
        : '';
}

function normalizeStoredOrder(order = {}, fallbackId = '') {
    if (!order || typeof order !== 'object') {
        return null;
    }

    const rawId = String(order.id || fallbackId || '').trim();
    const id = typeof normalizeWatchedOrderId === 'function'
        ? normalizeWatchedOrderId(rawId)
        : rawId;

    if (typeof isValidWatchedOrderId === 'function' && !isValidWatchedOrderId(id)) {
        return null;
    }

    const orderUrl = buildCanonicalOrderUrl(id);
    if (!id || !orderUrl) {
        return null;
    }

    return {
        ...order,
        id,
        orderUrl
    };
}

function normalizeBoundedOrderText(value, maxLength = MAX_ORDER_TEXT_LENGTH) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, Math.max(1, Number(maxLength) || MAX_ORDER_TEXT_LENGTH));
}

function normalizeOrderNumericValue(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return null;
    }

    return Math.min(Math.trunc(numeric), Number.MAX_SAFE_INTEGER);
}

function normalizeIncomingOrder(order = {}, fallbackId = '') {
    const identity = normalizeStoredOrder(order, fallbackId);
    if (!identity) {
        return null;
    }

    const tags = Array.isArray(order.tags)
        ? Array.from(new Set(order.tags
            .map(tag => normalizeBoundedOrderText(tag, MAX_ORDER_TAG_LENGTH))
            .filter(Boolean)))
            .slice(0, MAX_ORDER_TAGS)
        : [];

    return {
        id: identity.id,
        internalId: normalizeBoundedOrderText(order.internalId || identity.id, MAX_ORDER_INTERNAL_ID_LENGTH),
        status: normalizeBoundedOrderText(order.status),
        delivery: normalizeBoundedOrderText(order.delivery),
        payment: normalizeBoundedOrderText(order.payment),
        date: normalizeBoundedOrderText(order.date),
        phoneNormalized: String(order.phoneNormalized ?? '')
            .replace(/\D/g, '')
            .slice(0, MAX_ORDER_PHONE_LENGTH),
        totalAmount: normalizeOrderNumericValue(order.totalAmount),
        productsDone: normalizeOrderNumericValue(order.productsDone),
        productsTotal: normalizeOrderNumericValue(order.productsTotal),
        manager: normalizeBoundedOrderText(order.manager),
        city: normalizeBoundedOrderText(order.city),
        contractor: normalizeBoundedOrderText(order.contractor),
        orderUrl: identity.orderUrl,
        hasAutoreserve: order.hasAutoreserve === true,
        tags
    };
}

function normalizeIncomingOrders(orders = []) {
    if (!Array.isArray(orders)) {
        return [];
    }

    const normalized = [];
    const seenIds = new Set();

    for (const rawOrder of orders.slice(0, MAX_ORDER_BATCH_SIZE)) {
        const order = normalizeIncomingOrder(rawOrder);
        if (!order || seenIds.has(order.id)) {
            continue;
        }

        seenIds.add(order.id);
        normalized.push(order);
    }

    return normalized;
}

function normalizeStoredOrderMap(rawOrders = {}) {
    const orders = {};
    const hashes = {};
    const sourceOrders = rawOrders && typeof rawOrders === 'object' ? rawOrders : {};

    for (const [fallbackId, rawOrder] of Object.entries(sourceOrders)) {
        const order = normalizeIncomingOrder(rawOrder, fallbackId);
        if (!order) {
            continue;
        }

        orders[order.id] = order;
        hashes[order.id] = getHash(order);
    }

    return { orders, hashes };
}

function getProtectedKnownOrderIds() {
    const protectedIds = new Set([
        ...Object.keys(windowOrdersDB || {}),
        ...Object.keys(directFollowUpOrdersDB || {}),
        ...(typeof getWatchedOrderIds === 'function' ? getWatchedOrderIds(userConfig?.watchedOrders) : [])
    ]);

    return protectedIds;
}

function applyKnownOrdersRetention() {
    const allIds = Object.keys(knownOrdersDB || {});

    if (allIds.length <= MAX_KNOWN_ORDERS) {
        return 0;
    }

    const protectedIds = getProtectedKnownOrderIds();
    const keptIds = new Set(protectedIds);
    const remainingCapacity = Math.max(0, MAX_KNOWN_ORDERS - keptIds.size);
    const unprotectedIds = allIds.filter(id => !protectedIds.has(id));

    unprotectedIds.slice(-remainingCapacity).forEach(id => keptIds.add(id));

    let dropped = 0;

    for (const id of allIds) {
        if (keptIds.has(id)) {
            continue;
        }

        delete knownOrdersDB[id];
        delete knownOrdersHashDB[id];
        dropped += 1;
    }

    storageDiagnostics.knownOrdersDropped += dropped;
    return dropped;
}

function applyNotificationTargetRetention(now = Date.now()) {
    const entries = Object.entries(notificationTargets || {})
        .map(([notificationId, target]) => {
            const orderId = typeof normalizeWatchedOrderId === 'function'
                ? normalizeWatchedOrderId(target?.orderId)
                : String(target?.orderId || '').trim();
            const orderUrl = buildCanonicalOrderUrl(orderId);
            const createdAt = Number(target?.createdAt) || now;

            if (!notificationId || !orderUrl || now - createdAt > NOTIFICATION_TARGET_TTL_MS) {
                return null;
            }

            return [notificationId, {
                orderId,
                orderUrl,
                reminder: target?.reminder === true,
                createdAt
            }];
        })
        .filter(Boolean)
        .sort((left, right) => left[1].createdAt - right[1].createdAt);

    const kept = entries.slice(-MAX_NOTIFICATION_TARGETS);
    const dropped = Math.max(0, Object.keys(notificationTargets || {}).length - kept.length);

    notificationTargets = Object.fromEntries(kept);
    storageDiagnostics.notificationTargetsDropped += dropped;

    return dropped;
}

function applyStateRetention(options = {}) {
    const countRetentionDropped = applyKnownOrdersRetention();
    const notificationTargetsDropped = applyNotificationTargetRetention();
    const byteRetentionDropped = applyStateByteRetention(
        MAX_ESTIMATED_PERSISTED_STATE_BYTES,
        options.forceByteEstimate === true
    );
    const knownOrdersDropped = countRetentionDropped + byteRetentionDropped;

    if (knownOrdersDropped || notificationTargetsDropped) {
        log('INFO', 'RETENTION', 'state retention applied', {
            knownOrdersDropped,
            countRetentionDropped,
            byteRetentionDropped,
            notificationTargetsDropped,
            knownOrdersCount: Object.keys(knownOrdersDB).length,
            notificationTargetsCount: Object.keys(notificationTargets).length,
            estimatedStateBytes: storageDiagnostics.lastEstimatedStateBytes
        });
    }
}

function createPersistedStateSnapshot() {
    return {
        knownOrdersDB,
        knownOrdersHashDB,
        windowOrdersDB,
        windowOrdersHashDB,
        notificationTargets,
        lastBaselineDate,
        workerTabId,
        directWorkerTabId,
        directFollowUpState,
        directFollowUpOrdersDB,
        directFollowUpHashDB,
        isRunning,
        monitorState,
        lastDeepSyncAt,
        userConfig,
        pendingRebaseline,
        pendingSyncReason,
        collectionSession,
        monitorDictionaries,
        lastCollectionMetadata,
        eventJournal,
        eventJournalDroppedEntries,
        diagnosticLog,
        diagnosticLogDroppedEntries,
        lastWatchedOrderAddResult,
        pendingExtensionUpdate,
        storageDiagnostics
    };
}

function estimatePersistedStateBytes(snapshot = createPersistedStateSnapshot()) {
    try {
        return JSON.stringify(snapshot).length * 2;
    } catch (err) {
        storageDiagnostics.lastError = String(err?.message || err || 'state serialization failed');
        return Number.MAX_SAFE_INTEGER;
    }
}

function applyStateByteRetention(maxBytes = MAX_ESTIMATED_PERSISTED_STATE_BYTES, force = false) {
    const normalizedMaxBytes = Math.max(1024, Number(maxBytes) || MAX_ESTIMATED_PERSISTED_STATE_BYTES);
    const knownOrderCount = Object.keys(knownOrdersDB || {}).length;
    const shouldEstimate = force
        || normalizedMaxBytes !== MAX_ESTIMATED_PERSISTED_STATE_BYTES
        || knownOrderCount >= STATE_BYTE_RETENTION_MIN_ORDER_COUNT
        || storageDiagnostics.lastBytesInUse >= STATE_BYTE_RETENTION_TRIGGER_BYTES
        || storageDiagnostics.lastEstimatedStateBytes >= STATE_BYTE_RETENTION_TRIGGER_BYTES;

    if (!shouldEstimate) {
        return 0;
    }

    const protectedIds = getProtectedKnownOrderIds();
    const removableIds = Object.keys(knownOrdersDB || {}).filter(id => !protectedIds.has(id));
    let removed = 0;
    let estimatedBytes = estimatePersistedStateBytes();

    while (estimatedBytes > normalizedMaxBytes && removed < removableIds.length) {
        const end = Math.min(removableIds.length, removed + STATE_RETENTION_TRIM_BATCH_SIZE);

        for (let index = removed; index < end; index += 1) {
            const id = removableIds[index];
            delete knownOrdersDB[id];
            delete knownOrdersHashDB[id];
        }

        removed = end;
        estimatedBytes = estimatePersistedStateBytes();
    }

    storageDiagnostics.lastEstimatedStateBytes = estimatedBytes;
    storageDiagnostics.knownOrdersDropped += removed;

    return removed;
}

async function refreshStorageUsage(force = false) {
    if (typeof chrome?.storage?.local?.getBytesInUse !== 'function') {
        return storageDiagnostics.lastBytesInUse;
    }

    const now = Date.now();
    if (!force && now - storageDiagnostics.lastCheckedAt < STORAGE_USAGE_REFRESH_INTERVAL_MS) {
        return storageDiagnostics.lastBytesInUse;
    }

    try {
        storageDiagnostics.lastBytesInUse = Number(await chrome.storage.local.getBytesInUse(null)) || 0;
        storageDiagnostics.lastCheckedAt = now;

        if (storageDiagnostics.lastErrorOperation === 'storage-usage') {
            storageDiagnostics.lastError = null;
            storageDiagnostics.lastErrorOperation = null;
        }
    } catch (err) {
        storageDiagnostics.lastError = String(err?.message || err || 'storage usage check failed');
        storageDiagnostics.lastErrorOperation = 'storage-usage';
    }

    return storageDiagnostics.lastBytesInUse;
}

async function drainStateSaves() {
    while (stateSaveRequested) {
        stateSaveRequested = false;
        applyStateRetention();

        if (storageDiagnostics.lastErrorOperation === 'state') {
            storageDiagnostics.lastError = null;
            storageDiagnostics.lastErrorOperation = null;
        }
        storageDiagnostics.lastSuccessfulWriteAt = Date.now();

        await chrome.storage.local.set(createPersistedStateSnapshot());
        await refreshStorageUsage();
        logState('SAVE');
    }

    return true;
}

function save() {
    stateSaveRequested = true;

    if (!stateSaveDrainPromise) {
        stateSaveDrainPromise = enqueueStorageTask('state', drainStateSaves)
            .finally(() => {
                stateSaveDrainPromise = null;
                if (stateSaveRequested) {
                    save();
                }
            });
    }

    return stateSaveDrainPromise;
}

async function restrictStorageAccess() {
    if (typeof chrome?.storage?.local?.setAccessLevel !== 'function') {
        return false;
    }

    try {
        await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
        return true;
    } catch (err) {
        log('WARN', 'SECURITY', 'failed to restrict storage access', err?.message || err);
        return false;
    }
}

async function loadState() {
    const d = await chrome.storage.local.get([
        'knownOrdersDB',
        'knownOrdersHashDB',
        'windowOrdersDB',
        'windowOrdersHashDB',
        'notificationTargets',
        'lastBaselineDate',
        'directWorkerTabId',
        'directFollowUpState',
        'directFollowUpOrdersDB',
        'directFollowUpHashDB',
        'isRunning',
        'monitorState',
        'lastDeepSyncAt',
        'userConfig',
        'pendingRebaseline',
        'pendingSyncReason',
        'collectionSession',
        'monitorDictionaries',
        'lastCollectionMetadata',
        'eventJournal',
        'eventJournalDroppedEntries',
        'diagnosticLog',
        'diagnosticLogDroppedEntries',
        'lastWatchedOrderAddResult',
        'pendingExtensionUpdate',
        'storageDiagnostics'
    ]);

    const normalizedKnownOrders = normalizeStoredOrderMap(d.knownOrdersDB, d.knownOrdersHashDB);
    knownOrdersDB = normalizedKnownOrders.orders;
    knownOrdersHashDB = normalizedKnownOrders.hashes;

    const normalizedWindowOrders = normalizeStoredOrderMap(d.windowOrdersDB, d.windowOrdersHashDB);
    windowOrdersDB = normalizedWindowOrders.orders;
    windowOrdersHashDB = normalizedWindowOrders.hashes;
    notificationTargets = d.notificationTargets || {};
    lastBaselineDate = d.lastBaselineDate || null;
    isRunning = d.isRunning || false;
    monitorState = d.monitorState || 'uninitialized';
    lastDeepSyncAt = Number(d.lastDeepSyncAt) || 0;
    userConfig = getEffectiveUserConfig(d.userConfig);
    pendingRebaseline = d.pendingRebaseline === true;
    pendingSyncReason = d.pendingSyncReason || null;
    collectionSession = d.collectionSession || null;
    monitorDictionaries = d.monitorDictionaries || null;
    lastCollectionMetadata = d.lastCollectionMetadata || null;
    storageDiagnostics = {
        ...storageDiagnostics,
        ...(d.storageDiagnostics && typeof d.storageDiagnostics === 'object' ? d.storageDiagnostics : {})
    };

    const eventJournalRetention = applyEventJournalRetention(d.eventJournal);
    eventJournal = eventJournalRetention.entries;
    eventJournalDroppedEntries = normalizeEventJournalDroppedEntries(d.eventJournalDroppedEntries) + eventJournalRetention.dropped;

    const diagnosticLogRetention = applyDiagnosticLogRetention(d.diagnosticLog);
    diagnosticLog = diagnosticLogRetention.entries;
    diagnosticLogDroppedEntries = normalizeDiagnosticLogDroppedEntries(d.diagnosticLogDroppedEntries) + diagnosticLogRetention.dropped;
    lastWatchedOrderAddResult = d.lastWatchedOrderAddResult && typeof d.lastWatchedOrderAddResult === 'object'
        ? d.lastWatchedOrderAddResult
        : null;
    pendingExtensionUpdate = normalizePendingExtensionUpdate(d.pendingExtensionUpdate);
    isDiagnosticLogReady = true;

    directWorkerTabId = null;
    directFollowUpState = normalizeDirectFollowUpState(d.directFollowUpState);
    clearStaleDirectFollowUpState('direct follow-up reset on service worker load');
    const normalizedDirectOrders = normalizeStoredOrderMap(
        d.directFollowUpOrdersDB,
        d.directFollowUpHashDB
    );
    directFollowUpOrdersDB = normalizedDirectOrders.orders;
    directFollowUpHashDB = normalizedDirectOrders.hashes;
    workerTabId = null;
    ozonWorkerTabId = null;
    ozonResolveSession = null;
    ozonUiApplySession = null;

    applyStateRetention();

    if (isRunning) {
        monitorState = 'warming';
        scheduleRebaseline(getRecoverySyncReason({
            hasKnownOrders: hasKnownOrders(),
            lastCollectionAt: lastCollectionMetadata?.collectedAt
        }));
        resetCollectionSession();
        directFollowUpState = normalizeDirectFollowUpState({
            nextIndex: directFollowUpState?.nextIndex,
            lastCompletedAt: directFollowUpState?.lastCompletedAt,
            lastError: directFollowUpState?.currentOrderId ? 'direct follow-up reset on recovery' : directFollowUpState?.lastError
        });
    }

    log('INFO', 'INIT', 'state loaded');
    logState('LOAD');
}

// ---------- CLEANUP ----------
async function cleanupOldWorkers() {
    isCleaningUp = true;

    try {
        const tabs = await chrome.tabs.query({});

        for (const tab of tabs) {
            if (!tab.url) continue;

            if (
                isMarkedAmperkotWorkerUrl(tab.url, WORKER_MARK)
                || isMarkedAmperkotWorkerUrl(tab.url, DIRECT_WORKER_MARK)
                || isMarkedOzonWorkerUrl(tab.url)
            ) {
                try {
                    await chrome.tabs.remove(tab.id);
                    log('INFO', 'CLEANUP', `removed worker ${tab.id}`);
                } catch {
                    log('WARN', 'CLEANUP', 'failed', tab.id);
                }
            }
        }

        await new Promise(resolve => setTimeout(resolve, 300));
    } finally {
        isCleaningUp = false;
    }
}

async function reconcileWorkerTabsOnStartup() {
    const tabs = await chrome.tabs.query({});
    const mainWorkers = [];
    const staleWorkers = [];

    for (const tab of tabs || []) {
        const url = String(tab?.url || '');
        if (!url) continue;

        if (isMarkedAmperkotWorkerUrl(url, DIRECT_WORKER_MARK) || isMarkedOzonWorkerUrl(url)) {
            staleWorkers.push(tab);
        } else if (isMarkedAmperkotWorkerUrl(url, WORKER_MARK)) {
            mainWorkers.push(tab);
        }
    }

    if (!isRunning) {
        staleWorkers.push(...mainWorkers);
    } else if (mainWorkers.length) {
        mainWorkers.sort((left, right) => Number(left.id) - Number(right.id));
        const primary = mainWorkers.shift();
        workerTabId = primary.id;
        workerActivatedAt = Date.now();
        lastPing = workerActivatedAt;
        staleWorkers.push(...mainWorkers);

        try {
            await chrome.tabs.update(primary.id, {
                pinned: true,
                active: false,
                url: buildOrdersUrl(userConfig?.monitorScope, 1)
            });
            log('INFO', 'RECOVERY', 'adopted existing main worker', { tabId: primary.id });
        } catch (err) {
            log('WARN', 'RECOVERY', 'failed to adopt main worker', err?.message || err);
            staleWorkers.push(primary);
            workerTabId = null;
        }
    }

    if (staleWorkers.length) {
        isCleaningUp = true;
        try {
            for (const tab of staleWorkers) {
                try {
                    await chrome.tabs.remove(tab.id);
                    log('INFO', 'RECOVERY', 'removed orphan worker', { tabId: tab.id });
                } catch (err) {
                    log('WARN', 'RECOVERY', 'failed to remove orphan worker', {
                        tabId: tab.id,
                        error: err?.message || String(err)
                    });
                }
            }
        } finally {
            isCleaningUp = false;
        }
    }

    directWorkerTabId = null;
    ozonWorkerTabId = null;
    ozonResolveSession = null;
    ozonUiApplySession = null;

    return {
        adoptedMainWorker: workerTabId,
        removedCount: staleWorkers.length
    };
}

async function adoptExistingWorkerTab() {
    const workerTabs = await getMarkedWorkerTabs();

    if (!workerTabs.length) {
        return false;
    }

    workerTabs.sort((a, b) => a.id - b.id);

    const primaryTab = workerTabs[0];
    const duplicateTabs = workerTabs.slice(1);

    for (const tab of duplicateTabs) {
        try {
            await chrome.tabs.remove(tab.id);
            log('INFO', 'CLEANUP', `removed duplicate worker ${tab.id}`);
        } catch {
            log('WARN', 'CLEANUP', 'failed', tab.id);
        }
    }

    if (workerRetryTimer) {
        clearTimeout(workerRetryTimer);
        workerRetryTimer = null;
    }

    try {
        await chrome.tabs.update(primaryTab.id, { pinned: true });
    } catch {}

    workerTabId = primaryTab.id;
    workerActivatedAt = Date.now();
    lastPing = workerActivatedAt;

    log('INFO', 'WORKER', 'adopted existing', `id=${primaryTab.id}`);

    try {
        await chrome.tabs.update(primaryTab.id, {
    url: buildOrdersUrl(userConfig?.monitorScope, 1)
});
        log('INFO', 'WORKER', 'reloaded adopted worker', `id=${primaryTab.id}`);
    } catch (err) {
        log('WARN', 'WORKER', 'failed to reload adopted worker', err?.message || err);
    }

    await save();

    return true;
}

// ---------- WORKER ----------
async function ensureWorkerTab() {
    if (workerTabId || isCreatingWorker) return;

    isCreatingWorker = true;

    try {
        const windows = await chrome.windows.getAll({ populate: false });

        if (!windows.length) {
            log('DEBUG', 'WORKER', 'no windows yet, retrying...');

            if (!workerRetryTimer) {
                workerRetryTimer = setTimeout(() => {
                    workerRetryTimer = null;
                    ensureWorkerTab().catch((err) => {
                        log('ERROR', 'WORKER', 'retry failed', err?.message || err);
                    });
                }, 1000);
            }

            return;
        }

        if (workerRetryTimer) {
            clearTimeout(workerRetryTimer);
            workerRetryTimer = null;
        }

        const adopted = await adoptExistingWorkerTab();

        if (adopted) {
            return;
        }

        await cleanupOldWorkers();

        const newTab = await chrome.tabs.create({
            url: buildOrdersUrl(userConfig?.monitorScope, 1),
            active: false,
            pinned: true
        });

        workerTabId = newTab.id;
        workerActivatedAt = Date.now();
        lastPing = workerActivatedAt;

        log('INFO', 'WORKER', 'created', `id=${newTab.id}`);

        await save();
    } finally {
        isCreatingWorker = false;
    }
}

// ---------- EXTENSION UPDATE ----------
if (chrome?.runtime?.onUpdateAvailable?.addListener) {
    chrome.runtime.onUpdateAvailable.addListener((details) => {
        ensureInitialized()
            .then(() => queueExtensionUpdate(details))
            .catch((err) => {
                log('ERROR', 'UPDATE', err?.message || err);
            });
    });
}

// ---------- TAB EVENTS ----------
chrome.tabs.onRemoved.addListener((tabId) => {
    ensureInitialized().then(async () => {
        if (tabId === directWorkerTabId) {
            const currentOrderId = directFollowUpState?.currentOrderId;

            directWorkerTabId = null;

            if (currentOrderId) {
                await completeDirectFollowUpCheck(currentOrderId, {
                    ok: false,
                    error: 'direct worker tab closed'
                });
            }
        }

        if (tabId === ozonWorkerTabId) {
            ozonWorkerTabId = null;

            if (ozonUiApplySession) {
                await failOzonUiApply('Ozon worker tab closed');
            } else {
                await failOzonResolvePreview('Ozon worker tab closed');
            }
            return;
        }

        if (tabId === workerTabId) {
            workerTabId = null;

            if (isRunning && !isCleaningUp && !isStarting) {
                await ensureWorkerTab();
            }
        }
    }).catch((err) => {
        log('ERROR', 'TAB_EVENT', err?.message || err);
    });
});

// ---------- WATCHED ORDER REMINDERS ----------
function buildWatchedOrderReminderAlarmName(orderId) {
    const normalizedId = normalizeWatchedOrderId(orderId);

    if (!isValidWatchedOrderId(normalizedId)) {
        return null;
    }

    return `${WATCHED_ORDER_REMINDER_ALARM_PREFIX}${normalizedId}`;
}

function parseWatchedOrderReminderAlarmName(name) {
    const rawName = String(name || '');

    if (!rawName.startsWith(WATCHED_ORDER_REMINDER_ALARM_PREFIX)) {
        return null;
    }

    const orderId = normalizeWatchedOrderId(rawName.slice(WATCHED_ORDER_REMINDER_ALARM_PREFIX.length));

    return isValidWatchedOrderId(orderId) ? orderId : null;
}

function buildWatchedOrderReminderOrderUrl(orderId) {
    const normalizedId = normalizeWatchedOrderId(orderId);

    if (!isValidWatchedOrderId(normalizedId)) {
        return '';
    }

    return `${TARGET_URL}${normalizedId}/`;
}

function hasWatchedOrderReminderAlarmsApi() {
    return Boolean(chrome?.alarms?.create && chrome?.alarms?.clear);
}

async function clearWatchedOrderReminderAlarm(orderId) {
    const alarmName = buildWatchedOrderReminderAlarmName(orderId);

    if (!alarmName || !hasWatchedOrderReminderAlarmsApi()) {
        return false;
    }

    await chrome.alarms.clear(alarmName);

    return true;
}

async function scheduleWatchedOrderReminderAlarmForItem(item) {
    if (!item?.id || item.reminder?.status !== WATCHED_ORDER_REMINDER_STATUSES.PENDING) {
        return false;
    }

    const alarmName = buildWatchedOrderReminderAlarmName(item.id);
    const when = Number(item.reminder.remindAt);

    if (!alarmName || !Number.isFinite(when) || when <= 0 || !hasWatchedOrderReminderAlarmsApi()) {
        return false;
    }

    await chrome.alarms.create(alarmName, { when });

    log('INFO', 'REMINDER', 'alarm scheduled', {
        orderId: item.id,
        remindAt: when
    });

    return true;
}

async function syncWatchedOrderReminderAlarms(watchedOrders = userConfig?.watchedOrders) {
    if (!hasWatchedOrderReminderAlarmsApi()) {
        return { scheduled: 0, cleared: 0 };
    }

    const pendingItems = getPendingWatchedOrderReminderItems(watchedOrders);
    const pendingAlarmNames = new Set(
        pendingItems
            .map(item => buildWatchedOrderReminderAlarmName(item.id))
            .filter(Boolean)
    );
    let cleared = 0;
    let scheduled = 0;

    if (typeof chrome.alarms.getAll === 'function') {
        const existingAlarms = await chrome.alarms.getAll();

        for (const alarm of existingAlarms || []) {
            const name = String(alarm?.name || '');

            if (!name.startsWith(WATCHED_ORDER_REMINDER_ALARM_PREFIX) || pendingAlarmNames.has(name)) {
                continue;
            }

            await chrome.alarms.clear(name);
            cleared += 1;
        }
    }

    for (const item of pendingItems) {
        if (await scheduleWatchedOrderReminderAlarmForItem(item)) {
            scheduled += 1;
        }
    }

    if (scheduled || cleared) {
        log('INFO', 'REMINDER', 'alarms synced', { scheduled, cleared });
    }

    return { scheduled, cleared };
}

async function setWatchedOrderReminderFromRuntime(orderId, reminderInput = {}) {
    const result = setWatchedOrderReminder(userConfig?.watchedOrders, orderId, reminderInput, Date.now());

    if (!result.updated) {
        return createRuntimeFailureResponse({
            invalid: result.invalid === true,
            notFound: result.notFound === true
        });
    }

    userConfig = {
        ...userConfig,
        watchedOrders: result.config
    };

    await scheduleWatchedOrderReminderAlarmForItem(result.item);
    await save();

    return createRuntimeOkResponse({
        userConfig,
        item: result.item,
        reminder: result.reminder
    });
}

async function clearWatchedOrderReminderFromRuntime(orderId) {
    const result = clearWatchedOrderReminder(userConfig?.watchedOrders, orderId, Date.now());

    if (!result.updated) {
        return createRuntimeFailureResponse({
            invalid: result.invalid === true,
            notFound: result.notFound === true
        });
    }

    userConfig = {
        ...userConfig,
        watchedOrders: result.config
    };

    await clearWatchedOrderReminderAlarm(orderId);
    await save();

    return createRuntimeOkResponse({
        userConfig,
        item: result.item,
        reminder: null
    });
}

function createWatchedOrderReminderNotificationContent(item) {
    const orderId = normalizeWatchedOrderId(item?.id);
    const note = normalizeWatchedOrderReminderNote(item?.reminder?.note);

    return {
        title: `Напоминание по заказу ${orderId}`,
        message: note || 'Проверьте отслеживаемый заказ.'
    };
}

function notifyWatchedOrderReminder(item) {
    const content = createWatchedOrderReminderNotificationContent(item);
    const orderUrl = buildWatchedOrderReminderOrderUrl(item?.id);

    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: content.title,
        message: content.message
    }, async (notificationId) => {
        if (chrome.runtime.lastError) {
            log('ERROR', 'REMINDER', chrome.runtime.lastError.message);
            return;
        }

        if (orderUrl) {
            notificationTargets[notificationId] = {
                orderId: item.id,
                orderUrl,
                reminder: true,
                createdAt: Date.now()
            };

            await save();
        }

        log('INFO', 'REMINDER', 'notification created', {
            notificationId,
            orderId: item.id
        });
    });
}

async function handleWatchedOrderReminderAlarm(alarm = {}) {
    const orderId = parseWatchedOrderReminderAlarmName(alarm?.name);

    if (!orderId) {
        return false;
    }

    const item = getWatchedOrderItem(userConfig?.watchedOrders, orderId);

    if (!item?.reminder || item.reminder.status !== WATCHED_ORDER_REMINDER_STATUSES.PENDING) {
        log('DEBUG', 'REMINDER', 'ignored stale alarm', { orderId });
        return false;
    }

    const now = Date.now();

    if (item.reminder.remindAt > now) {
        await scheduleWatchedOrderReminderAlarmForItem(item);
        log('WARN', 'REMINDER', 'alarm fired early, rescheduled', {
            orderId,
            remindAt: item.reminder.remindAt,
            now
        });
        return false;
    }

    const result = markWatchedOrderReminderDone(userConfig?.watchedOrders, orderId, now);

    if (!result.updated) {
        return false;
    }

    userConfig = {
        ...userConfig,
        watchedOrders: result.config
    };

    notifyWatchedOrderReminder(result.item);
    await save();

    return true;
}

// ---------- NOTIFY ----------
function notifyOrder(o, eventContext = {}) {
    const content = createOrderNotificationContent(o, eventContext);

    log('INFO', 'NOTIFY', 'creating notification', {
        orderId: o.id,
        orderUrl: buildCanonicalOrderUrl(o.id),
        tag: content.tag,
        decision: 'notify',
        eventType: eventContext.eventType || null,
        changedFields: Array.isArray(eventContext.changedFields)
            ? eventContext.changedFields.map(field => String(field))
            : [],
        message: content.message
    });

    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: content.title,
        message: content.message
    }, async (notificationId) => {
        if (chrome.runtime.lastError) {
            log('ERROR', 'NOTIFY', chrome.runtime.lastError.message);
            return;
        }

        const orderUrl = buildCanonicalOrderUrl(o.id);

        if (orderUrl) {
            notificationTargets[notificationId] = {
                orderId: o.id,
                orderUrl,
                createdAt: Date.now()
            };

            await save();
        }

        log('INFO', 'NOTIFY', 'created', notificationId);
    });
}

chrome.notifications.onClicked.addListener((notificationId) => {
    ensureInitialized().then(async () => {
        const target = notificationTargets[notificationId];
        const orderUrl = buildCanonicalOrderUrl(target?.orderId);

        if (!orderUrl) {
            log('WARN', 'NOTIFY_CLICK', 'target not found', notificationId);
            return;
        }

        try {
            await chrome.tabs.create({
                url: orderUrl,
                active: true
            });

            log('INFO', 'NOTIFY_CLICK', {
                notificationId,
                orderId: target.orderId,
                orderUrl
            });
        } catch (err) {
            log('ERROR', 'NOTIFY_CLICK', err?.message || err);
            return;
        }

        delete notificationTargets[notificationId];
        await save();
        await chrome.notifications.clear(notificationId);
    }).catch((err) => {
        log('ERROR', 'NOTIFY_CLICK', err?.message || err);
    });
});

chrome.notifications.onClosed.addListener((notificationId) => {
    ensureInitialized().then(async () => {
        if (!notificationTargets[notificationId]) {
            return;
        }

        delete notificationTargets[notificationId];
        await save();

        log('DEBUG', 'NOTIFY', 'cleared target on close', notificationId);
    }).catch((err) => {
        log('ERROR', 'NOTIFY_CLOSE', err?.message || err);
    });
});

if (chrome?.alarms?.onAlarm?.addListener) {
    chrome.alarms.onAlarm.addListener((alarm) => {
        ensureInitialized().then(async () => {
            if (alarm?.name === EXTENSION_UPDATE_RETRY_ALARM) {
                await tryApplyPendingExtensionUpdate('retry-alarm');
                return;
            }

            if (alarm?.name === MONITOR_HEALTH_ALARM) {
                await runMonitorHealthCheck();
                return;
            }

            if (alarm?.name === DIRECT_FOLLOW_UP_ALARM) {
                await runDirectFollowUpTick();
                return;
            }

            if (alarm?.name === STORAGE_MAINTENANCE_ALARM) {
                await runStorageMaintenance();
                return;
            }

            await handleWatchedOrderReminderAlarm(alarm);
        }).catch((err) => {
            log('ERROR', 'ALARM', err?.message || err);
        });
    });
}

// ---------- BASELINE ----------
function runBaseline(orders, reason = 'auto') {
    const normalizedOrders = normalizeIncomingOrders(orders);
    const syncReason = reason === 'auto'
        ? (pendingSyncReason || SYNC_REASONS.NORMAL)
        : normalizeSyncReason(reason);
    const nextWindowDB = {};
    const nextWindowHashDB = {};

    markDeepSyncCompleted(collectionSession);

    normalizedOrders.forEach(order => {
        if (!order.id) return;

        const hash = getHash(order);

        knownOrdersDB[order.id] = order;
        knownOrdersHashDB[order.id] = hash;
        nextWindowDB[order.id] = order;
        nextWindowHashDB[order.id] = hash;
    });

    windowOrdersDB = nextWindowDB;
    windowOrdersHashDB = nextWindowHashDB;
    lastBaselineDate = todayKey();
    recordCollectionMetadata(collectionSession, normalizedOrders, syncReason);
    clearPendingRebaseline();
    monitorState = 'active';
    resetCollectionSession();

    log('INFO', 'BASELINE', `${syncReason} count=${normalizedOrders.length}`);
    logState('BASELINE');

    return save();
}

function runCatchUpSnapshot(orders, reason = SYNC_REASONS.MANUAL_START) {
    const normalizedOrders = normalizeIncomingOrders(orders);
    const syncReason = normalizeSyncReason(reason);

    markDeepSyncCompleted(collectionSession);
    recordCollectionMetadata(collectionSession, normalizedOrders, syncReason);
    clearPendingRebaseline();
    monitorState = 'active';

    log('INFO', 'CATCH_UP', `${syncReason} count=${normalizedOrders.length}`);
    processOrders(normalizedOrders, {
        syncReason,
        suppressNotifications: true,
        persist: false
    });
    applyWindowSnapshot(normalizedOrders);
    resetCollectionSession();
    logState('CATCH_UP');

    return save();
}

function applyWindowSnapshot(orders) {
    const normalizedOrders = normalizeIncomingOrders(orders);
    const nextWindowDB = {};
    const nextWindowHashDB = {};

    normalizedOrders.forEach(order => {
        if (!order.id) return;

        const hash = getHash(order);

        nextWindowDB[order.id] = order;
        nextWindowHashDB[order.id] = hash;

        if (!knownOrdersHashDB[order.id] || knownOrdersHashDB[order.id] !== hash) {
            knownOrdersDB[order.id] = order;
            knownOrdersHashDB[order.id] = hash;
        }
    });

    windowOrdersDB = nextWindowDB;
    windowOrdersHashDB = nextWindowHashDB;

    log('INFO', 'WINDOW_SYNC', `applied window snapshot count=${normalizedOrders.length}`);
}

// ---------- CORE ----------
function processOrders(orders, options = {}) {
    const normalizedOrders = normalizeIncomingOrders(orders);
    const {
        testMode = false,
        syncReason = SYNC_REASONS.NORMAL,
        suppressNotifications = false,
        persist = true
    } = options;

    let hasChanges = false;
    let hasStateUpdates = false;

    const processLogLevel = !testMode && normalizedOrders.length > 30 ? 'INFO' : 'DEBUG';
    log(processLogLevel, 'PROCESS', `orders=${normalizedOrders.length} testMode=${testMode}`);

    for (const order of normalizedOrders) {
        if (!order.id) continue;

        const newHash = getHash(order);
        const prevHash =
            windowOrdersHashDB[order.id] ||
            knownOrdersHashDB[order.id] ||
            null;

        const prevOrder =
            windowOrdersDB[order.id] ||
            knownOrdersDB[order.id] ||
            null;

        if (newHash === prevHash) {
            if (!testMode && !areStoredOrdersEqual(prevOrder, order)) {
                knownOrdersDB[order.id] = order;
                knownOrdersHashDB[order.id] = newHash;
                windowOrdersDB[order.id] = order;
                windowOrdersHashDB[order.id] = newHash;
                hasStateUpdates = true;
            }

            continue;
        }

        hasChanges = true;

        const isNewOrder = !knownOrdersDB[order.id];
        const eventType = isNewOrder ? 'new-order' : 'order-changed';
        const changedFields = isNewOrder
            ? []
            : getChangedFields(prevOrder, order);

        if (!isNewOrder && !changedFields.length) {
            if (!testMode) {
                knownOrdersDB[order.id] = order;
                knownOrdersHashDB[order.id] = newHash;
                windowOrdersDB[order.id] = order;
                windowOrdersHashDB[order.id] = newHash;
                hasStateUpdates = true;
            }

            log('INFO', 'CHANGE', 'normalized no-change', {
                id: order.id
            });

            continue;
        }

        log('INFO', 'CHANGE', 'event', {
            id: order.id,
            eventType,
            changedFields
        });

        const eventContext = {
            prevOrder,
            prevHash,
            newHash,
            isNewOrder,
            eventType,
            changedFields
        };

        const baseDecision = evaluateNotification(
            order,
            eventContext,
            userConfig
        );
        const decision = applyNotificationSuppressionPolicy(
            baseDecision,
            eventContext,
            syncReason,
            { suppressNotifications }
        );

        if (!testMode) {
            appendOrderEventToJournal(order, eventContext, decision, syncReason);
        }

        if (isNewOrder) {
            log('INFO', 'NEW_ORDER', {
                id: order.id
            });
        }

        if (!decision.notify) {
            log('INFO', 'RULES', {
                id: order.id,
                action: decision.action,
                ruleId: decision.ruleId,
                reason: decision.reason,
                isNewOrder,
                eventType,
                changedFields
            });
        } else {
            notifyOrder(order, eventContext);
        }

        if (!testMode) {
            knownOrdersDB[order.id] = order;
            knownOrdersHashDB[order.id] = newHash;
            windowOrdersDB[order.id] = order;
            windowOrdersHashDB[order.id] = newHash;
        }
    }

    if (!testMode && (hasChanges || hasStateUpdates)) {
        logState('PROCESS');
        return persist ? save() : Promise.resolve(true);
    }

    return Promise.resolve(true);
}

// ---------- LIFECYCLE / WATCHDOG ----------
async function ensureLifecycleAlarms() {
    if (typeof chrome?.alarms?.create !== 'function') {
        return false;
    }

    await chrome.alarms.create(MONITOR_HEALTH_ALARM, {
        periodInMinutes: MONITOR_HEALTH_PERIOD_MINUTES
    });
    await chrome.alarms.create(DIRECT_FOLLOW_UP_ALARM, {
        periodInMinutes: DIRECT_FOLLOW_UP_PERIOD_MINUTES
    });
    await chrome.alarms.create(STORAGE_MAINTENANCE_ALARM, {
        periodInMinutes: STORAGE_MAINTENANCE_PERIOD_MINUTES
    });

    return true;
}

async function runMonitorHealthCheck() {
    await handleDirectFollowUpTimeout();
    let collectionReset = false;

    if (collectionSession) {
        const idle = Date.now() - (collectionSession.lastActivityAt || 0);

        if (idle > COLLECTION_TIMEOUT_MS) {
            log('WARN', 'COLLECTION', 'session timeout, resetting');
            resetCollectionSession();
            collectionReset = true;

            if (workerTabId) {
                await goToCollectionPage(1);
            }
        }
    }

    if (!isRunning) {
        if (collectionReset) {
            await save();
        }
        return false;
    }

    if (!workerTabId) {
        await ensureWorkerTab();
        return true;
    }

    const referenceTime = Math.max(lastPing, workerActivatedAt);
    const diff = Date.now() - referenceTime;

    if (diff <= 60000) {
        if (collectionReset) {
            await save();
        }
        return false;
    }

    log('WARN', 'WATCHDOG', 'worker dead, restarting', { idleMs: diff, tabId: workerTabId });

    const staleTabId = workerTabId;
    workerTabId = null;

    try {
        await chrome.tabs.remove(staleTabId);
    } catch {}

    await ensureWorkerTab();
    return true;
}

async function runStorageMaintenance() {
    applyStateRetention({ forceByteEstimate: true });
    await refreshStorageUsage(true);
    await save();
    return true;
}


// ---------- OZON BARCODE RESOLVE PREVIEW ----------
function clearOzonResolveTimeout() {
    if (ozonResolveTimeoutTimer && typeof clearTimeout === 'function') {
        clearTimeout(ozonResolveTimeoutTimer);
    }

    ozonResolveTimeoutTimer = null;
}

async function cleanupOzonResolveWorker({ closeTab = true } = {}) {
    clearOzonResolveTimeout();

    const tabId = ozonWorkerTabId;
    ozonWorkerTabId = null;
    ozonResolveSession = null;

    if (closeTab && tabId) {
        try {
            await chrome.tabs.remove(tabId);
        } catch {}
    }
}

async function sendOzonResolvePreviewToWarehouse(payload = {}) {
    return sendOzonWarehouseMessage({
        session: ozonResolveSession,
        type: 'OZON_RESOLVE_PREVIEW_RESULT',
        payload,
        logCategory: 'OZON_RESOLVE',
        logMessage: 'failed to send preview to warehouse tab'
    });
}

function createOzonResolvePreviewPlanForSession(session = ozonResolveSession) {
    return createOzonBarcodeBindingPreviewPlan({
        warehouseExtraction: session?.warehouseExtraction || {},
        ozonProductsByProductId: session?.ozonProductsByProductId || {}
    });
}

async function finishOzonResolvePreview() {
    if (!ozonResolveSession) {
        return false;
    }

    const plan = createOzonResolvePreviewPlanForSession(ozonResolveSession);

    log('INFO', 'OZON_RESOLVE', 'preview ready', plan.summary);
    await sendOzonResolvePreviewToWarehouse({ ok: true, plan });
    await cleanupOzonResolveWorker();

    return true;
}

async function failOzonResolvePreview(errorMessage = 'Ozon resolve failed') {
    if (!ozonResolveSession) {
        return false;
    }

    log('WARN', 'OZON_RESOLVE', 'preview failed', errorMessage);
    await sendOzonResolvePreviewToWarehouse({ ok: false, error: errorMessage });
    await cleanupOzonResolveWorker();

    return true;
}

function scheduleOzonResolveTimeout() {
    clearOzonResolveTimeout();

    if (typeof setTimeout !== 'function') {
        return false;
    }

    ozonResolveTimeoutTimer = setTimeout(() => {
        ozonResolveTimeoutTimer = null;
        failOzonResolvePreview('Ozon resolve timeout').catch((err) => {
            log('ERROR', 'OZON_RESOLVE', 'timeout cleanup failed', err?.message || err);
        });
    }, OZON_RESOLVE_TIMEOUT_MS);

    return true;
}

async function openCurrentOzonResolveProduct() {
    if (!ozonResolveSession) {
        return false;
    }

    const productId = ozonResolveSession.productIds[ozonResolveSession.index];

    if (!productId) {
        return finishOzonResolvePreview();
    }

    const url = buildOzonResolveWorkerUrl(productId);
    scheduleOzonResolveTimeout();

    if (ozonWorkerTabId) {
        await chrome.tabs.update(ozonWorkerTabId, { url, active: false });
    } else {
        const tab = await chrome.tabs.create({ url, active: false, pinned: true });
        ozonWorkerTabId = tab.id;
    }

    log('INFO', 'OZON_RESOLVE', 'worker opened', {
        productId,
        index: ozonResolveSession.index + 1,
        total: ozonResolveSession.productIds.length,
        tabId: ozonWorkerTabId
    });

    return true;
}

async function startOzonResolvePreview(senderTabId, warehouseExtraction = {}) {
    const productIds = getOzonResolveProductIds(warehouseExtraction);

    if (!senderTabId) {
        return createRuntimeFailureResponse({ error: 'warehouse tab missing' });
    }

    await cleanupOzonResolveWorker();

    ozonResolveSession = createOzonResolveSessionState({
        warehouseTabId: senderTabId,
        warehouseExtraction,
        productIds
    });

    if (!productIds.length) {
        const plan = createOzonResolvePreviewPlanForSession(ozonResolveSession);
        await sendOzonResolvePreviewToWarehouse({ ok: true, plan });
        await cleanupOzonResolveWorker({ closeTab: false });
        return createRuntimeOkResponse({ started: false, plan });
    }

    await openCurrentOzonResolveProduct();

    return createRuntimeOkResponse({
        started: true,
        productCount: productIds.length
    });
}

async function handleOzonProductResolveResult(senderTabId, msg = {}) {
    if (!ozonResolveSession || senderTabId !== ozonWorkerTabId) {
        return createRuntimeIgnoredResponse();
    }

    const expectedProductId = ozonResolveSession.productIds[ozonResolveSession.index];
    const productId = normalizeOzonResolveId(msg.productId || msg.result?.productId);

    if (!expectedProductId || productId !== expectedProductId) {
        return createRuntimeFailureResponse({ error: 'unexpected Ozon product result' });
    }

    clearOzonResolveTimeout();
    ozonResolveSession.ozonProductsByProductId[productId] = msg.result && typeof msg.result === 'object'
        ? msg.result
        : { ok: false, error: 'ozon product result missing', product: null };
    ozonResolveSession.index += 1;

    if (ozonResolveSession.index >= ozonResolveSession.productIds.length) {
        await finishOzonResolvePreview();
    } else {
        await openCurrentOzonResolveProduct();
    }

    return createRuntimeOkResponse({ accepted: true });
}


// ---------- OZON UI BARCODE APPLY ----------
function clearOzonUiApplyTimeout() {
    if (ozonUiApplyTimeoutTimer && typeof clearTimeout === 'function') {
        clearTimeout(ozonUiApplyTimeoutTimer);
    }

    ozonUiApplyTimeoutTimer = null;
}

async function cleanupOzonUiApply({ closeTab = false } = {}) {
    clearOzonUiApplyTimeout();

    const tabId = ozonWorkerTabId;
    ozonUiApplySession = null;

    if (!ozonResolveSession) {
        ozonWorkerTabId = closeTab ? null : ozonWorkerTabId;
    }

    if (closeTab && tabId) {
        try {
            await chrome.tabs.remove(tabId);
        } catch {}
    }
}

async function sendOzonUiApplyResultToWarehouse(payload = {}) {
    return sendOzonWarehouseMessage({
        session: ozonUiApplySession,
        type: 'OZON_UI_APPLY_RESULT',
        payload,
        logCategory: 'OZON_UI_APPLY',
        logMessage: 'failed to send apply result to warehouse tab'
    });
}

async function failOzonUiApply(errorMessage = 'Ozon UI apply failed') {
    if (!ozonUiApplySession) {
        return false;
    }

    log('WARN', 'OZON_UI_APPLY', 'apply failed', errorMessage);
    await sendOzonUiApplyResultToWarehouse({ ok: false, error: errorMessage });
    await cleanupOzonUiApply({ closeTab: !OZON_KEEP_UI_APPLY_WORKER_OPEN_AFTER_RESULT });
    return true;
}

function scheduleOzonUiApplyTimeout() {
    clearOzonUiApplyTimeout();

    if (typeof setTimeout !== 'function') {
        return false;
    }

    ozonUiApplyTimeoutTimer = setTimeout(() => {
        ozonUiApplyTimeoutTimer = null;
        failOzonUiApply('Ozon UI apply timeout').catch((err) => {
            log('ERROR', 'OZON_UI_APPLY', 'timeout cleanup failed', err?.message || err);
        });
    }, OZON_UI_APPLY_TIMEOUT_MS);

    return true;
}

async function sendOzonUiApplyCommandToWorker() {
    if (!ozonUiApplySession || !ozonWorkerTabId) {
        return false;
    }

    const currentProduct = getCurrentOzonUiApplyProductRequest();

    if (!currentProduct) {
        return false;
    }

    const { productId, barcodes } = currentProduct;

    try {
        ozonUiApplySession.status = 'command-sent';
        await chrome.tabs.sendMessage(ozonWorkerTabId, {
            type: 'OZON_UI_APPLY_IN_WORKER',
            productId,
            barcodes
        });
        log('INFO', 'OZON_UI_APPLY', 'apply command sent', {
            productId,
            barcodeCount: barcodes.length,
            index: ozonUiApplySession.index + 1,
            total: ozonUiApplySession.productRequests.length
        });
        return true;
    } catch (error) {
        await failOzonUiApply(error?.message || 'failed to send apply command to Ozon worker');
        return false;
    }
}

async function openCurrentOzonUiApplyProduct() {
    if (!ozonUiApplySession) {
        return false;
    }

    const currentProduct = getCurrentOzonUiApplyProductRequest();

    if (!currentProduct) {
        const payload = createOzonUiApplyFinalPayload(ozonUiApplySession);
        log(payload.errorCount > 0 ? 'WARN' : 'INFO', 'OZON_UI_APPLY', 'apply batch complete', payload);
        await sendOzonUiApplyResultToWarehouse(payload);
        await cleanupOzonUiApply({ closeTab: !OZON_KEEP_UI_APPLY_WORKER_OPEN_AFTER_RESULT });
        return true;
    }

    const url = buildOzonUiApplyWorkerUrl(currentProduct.productId);
    scheduleOzonUiApplyTimeout();
    ozonUiApplySession.status = 'opening';

    if (ozonWorkerTabId) {
        await chrome.tabs.update(ozonWorkerTabId, { url, active: false });
    } else {
        const tab = await chrome.tabs.create({ url, active: false, pinned: true });
        ozonWorkerTabId = tab.id;
    }

    log('INFO', 'OZON_UI_APPLY', 'worker opened', {
        productId: currentProduct.productId,
        barcodeCount: currentProduct.barcodes.length,
        index: ozonUiApplySession.index + 1,
        total: ozonUiApplySession.productRequests.length,
        tabId: ozonWorkerTabId
    });

    return true;
}

async function startOzonUiApply(senderTabId, warehouseExtraction = {}) {
    if (!senderTabId) {
        return createRuntimeFailureResponse({ error: 'warehouse tab missing' });
    }

    const request = createOzonUiApplyRequestFromWarehouseExtraction(warehouseExtraction);

    if (!request.ok) {
        return createRuntimeFailureResponse({ error: request.error });
    }

    await cleanupOzonResolveWorker({ closeTab: false });
    await cleanupOzonUiApply({ closeTab: true });

    ozonUiApplySession = createOzonUiApplySessionState({
        warehouseTabId: senderTabId,
        productRequests: request.productRequests
    });

    await openCurrentOzonUiApplyProduct();

    return createRuntimeOkResponse({
        started: true,
        productId: request.productRequests[0]?.productId || '',
        productCount: request.productCount,
        barcodeCount: request.barcodeCount
    });
}

async function handleOzonProductWorkerReady(senderTabId, msg = {}) {
    if (!ozonUiApplySession || senderTabId !== ozonWorkerTabId) {
        return createRuntimeIgnoredResponse();
    }

    const currentProduct = getCurrentOzonUiApplyProductRequest();
    const productId = normalizeOzonResolveId(msg.productId);

    if (!currentProduct || !productId || productId !== currentProduct.productId) {
        return createRuntimeFailureResponse({ error: 'unexpected Ozon worker product id' });
    }

    await sendOzonUiApplyCommandToWorker();
    return createRuntimeOkResponse({ accepted: true });
}

async function handleOzonUiApplyResult(senderTabId, msg = {}) {
    if (!ozonUiApplySession || senderTabId !== ozonWorkerTabId) {
        return createRuntimeIgnoredResponse();
    }

    const currentProduct = getCurrentOzonUiApplyProductRequest();
    const productId = normalizeOzonResolveId(msg.productId);

    if (!currentProduct || !productId || productId !== currentProduct.productId) {
        return createRuntimeFailureResponse({ error: 'unexpected Ozon apply result' });
    }

    clearOzonUiApplyTimeout();

    const productResult = buildOzonUiApplyProductResult(currentProduct, msg);
    ozonUiApplySession.results.push(productResult);
    ozonUiApplySession.index += 1;

    log(productResult.ok ? 'INFO' : 'WARN', 'OZON_UI_APPLY', 'apply product result received', {
        ...productResult,
        index: ozonUiApplySession.index,
        total: ozonUiApplySession.productRequests.length
    });

    if (ozonUiApplySession.index >= ozonUiApplySession.productRequests.length) {
        const payload = createOzonUiApplyFinalPayload(ozonUiApplySession);
        log(payload.errorCount > 0 ? 'WARN' : 'INFO', 'OZON_UI_APPLY', 'apply batch complete', payload);
        await sendOzonUiApplyResultToWarehouse(payload);
        await cleanupOzonUiApply({ closeTab: !OZON_KEEP_UI_APPLY_WORKER_OPEN_AFTER_RESULT });
    } else {
        await openCurrentOzonUiApplyProduct();
    }

    return createRuntimeOkResponse({ accepted: true });
}


async function startWatchedOrderAddValidation(orderId, options = {}) {
    const normalizedId = normalizeWatchedOrderId(orderId);
    const note = normalizeWatchedOrderNote(options?.note);
    const now = Date.now();
    const result = addWatchedOrderToConfig(userConfig?.watchedOrders, normalizedId, now, { note });

    log('INFO', 'WATCHED_ORDERS', 'add validation requested', {
        orderId: normalizedId || String(orderId || '').trim(),
        hasNote: Boolean(note)
    });

    clearStaleDirectFollowUpState('stale direct follow-up cleared before watched order add');
    clearStalePendingWatchedOrderAdd('stale watched order add validation cleared before new add');

    if (result.invalid) {
        const response = createRuntimeFailureResponse({ error: 'Введите полный номер заказа в формате 1234-110626.' });
        lastWatchedOrderAddResult = {
            ok: false,
            orderId: normalizedId || String(orderId || '').trim(),
            error: response.error,
            completedAt: Date.now()
        };
        log('WARN', 'WATCHED_ORDERS', 'add validation rejected', lastWatchedOrderAddResult);
        return response;
    }

    if (result.duplicate) {
        return createRuntimeFailureResponse({
            error: `Заказ №${normalizedId} уже отслеживается.`,
            duplicate: true,
            orderId: normalizedId,
            userConfig
        });
    }

    if (result.limitReached) {
        return createRuntimeFailureResponse({
            error: 'Достигнут лимит отслеживаемых заказов.',
            limitReached: true,
            orderId: normalizedId,
            userConfig
        });
    }

    if (pendingWatchedOrderAdd || directWorkerTabId || directFollowUpState?.currentOrderId) {
        log('WARN', 'WATCHED_ORDERS', 'add validation busy', {
            orderId: normalizedId,
            hasPendingAdd: Boolean(pendingWatchedOrderAdd),
            directWorkerTabId,
            currentOrderId: directFollowUpState?.currentOrderId || null
        });
        return createRuntimeFailureResponse({
            error: 'Сейчас уже выполняется проверка заказа. Повторите добавление позже.',
            busy: true,
            orderId: normalizedId,
            userConfig
        });
    }

    pendingWatchedOrderAdd = {
        orderId: normalizedId,
        note,
        startedAt: now,
        accepted: true
    };
    lastWatchedOrderAddResult = null;

    log('INFO', 'WATCHED_ORDERS', 'add validation starting direct check', {
        orderId: normalizedId
    });

    const started = await startDirectFollowUpCheck(normalizedId, directFollowUpState?.nextIndex || 0);

    if (!started) {
        pendingWatchedOrderAdd = null;
        lastWatchedOrderAddResult = {
            ok: false,
            orderId: normalizedId,
            error: 'Не удалось запустить проверку заказа.',
            completedAt: Date.now()
        };
        log('WARN', 'WATCHED_ORDERS', 'add validation failed', lastWatchedOrderAddResult);
        return createRuntimeFailureResponse({
            error: 'Не удалось запустить проверку заказа.',
            orderId: normalizedId,
            userConfig
        });
    }

    return createRuntimeOkResponse({
        accepted: true,
        validating: true,
        orderId: normalizedId,
        userConfig
    });
}

// ---------- MESSAGES ----------
chrome.runtime.onMessage.addListener((msg, sender, send) => {
    (async () => {
        let runtimeOperationStarted = false;

        try {
            await ensureInitialized();
            activeRuntimeMessageCount += 1;
            runtimeOperationStarted = true;

            const senderTabId = sender?.tab?.id;
            const senderTab = sender?.tab;

            if (msg.type === 'CHECK_WORKER') {
                const isCorrectUrl = isMarkedAmperkotWorkerUrl(senderTab?.url, WORKER_MARK);

                if (senderTabId === workerTabId) {
                    send(createWorkerCheckResponse({ isWorker: true, isRunning }));
                    return;
                }

                if (!workerTabId && isCorrectUrl && !isCreatingWorker) {
                    workerTabId = senderTabId;
                    workerActivatedAt = Date.now();
                    lastPing = workerActivatedAt;

                    log('INFO', 'WORKER', 'bind on init');
                    await save();

                    send(createWorkerCheckResponse({ isWorker: true, isRunning }));
                    return;
                }

                send(createWorkerCheckResponse({ isWorker: false, isRunning }));
                return;
            }

            if (msg.type === 'CHECK_DIRECT_WORKER') {
                const isCorrectUrl = isMarkedAmperkotWorkerUrl(senderTab?.url, DIRECT_WORKER_MARK);
                const currentOrderId = directFollowUpState?.currentOrderId || null;
                const canProcessDirectOrder = isRunning || Boolean(currentOrderId);

                if (senderTabId === directWorkerTabId) {
                    if (!isCorrectUrl) {
                        log('WARN', 'DIRECT_FOLLOW_UP', 'direct worker marker missing, trusting assigned tab id', {
                            orderId: currentOrderId,
                            tabId: senderTabId
                        });
                    }

                    send(createRuntimeOkResponse({
                        isDirectWorker: true,
                        isRunning: canProcessDirectOrder,
                        orderId: currentOrderId
                    }));
                    return;
                }

                send(createRuntimeOkResponse({
                    isDirectWorker: false,
                    isRunning,
                    orderId: currentOrderId
                }));
                return;
            }

            if (msg.type === 'DIRECT_ORDER') {
                if (senderTabId !== directWorkerTabId) {
                    send(createRuntimeIgnoredResponse());
                    return;
                }

                const expectedOrderId = directFollowUpState?.currentOrderId || msg.orderId;
                const parsedOrder = normalizeIncomingOrder(msg.data, msg.orderId || expectedOrderId);
                const parsedOrderId = normalizeWatchedOrderId(parsedOrder?.id || msg.orderId || expectedOrderId);
                const expectedNormalizedId = normalizeWatchedOrderId(expectedOrderId);

                if (msg.error || !parsedOrder || parsedOrderId !== expectedNormalizedId) {
                    await completeDirectFollowUpCheck(expectedNormalizedId, {
                        ok: false,
                        error: msg.error || 'direct order parse failed'
                    });
                    send(createRuntimeOkResponse({ checked: false }));
                    return;
                }

                await completeDirectFollowUpCheck(expectedNormalizedId, { ok: true, order: parsedOrder });
                send(createRuntimeOkResponse({ checked: true, orderId: expectedNormalizedId }));
                return;
            }

            if (msg.type === 'OZON_RESOLVE_PREVIEW_REQUEST') {
                if (!isWarehouseOzonResolveSender(senderTab)) {
                    send(createRuntimeIgnoredResponse());
                    return;
                }

                send(await startOzonResolvePreview(senderTabId, msg.warehouseExtraction || {}));
                return;
            }

            if (msg.type === 'OZON_PRODUCT_RESOLVE_RESULT') {
                send(await handleOzonProductResolveResult(senderTabId, msg));
                return;
            }

            if (msg.type === 'OZON_UI_APPLY_REQUEST') {
                if (!isWarehouseOzonResolveSender(senderTab)) {
                    send(createRuntimeIgnoredResponse());
                    return;
                }

                send(await startOzonUiApply(senderTabId, msg.warehouseExtraction || {}));
                return;
            }

            if (msg.type === 'OZON_PRODUCT_WORKER_READY') {
                send(await handleOzonProductWorkerReady(senderTabId, msg));
                return;
            }

            if (msg.type === 'OZON_UI_APPLY_RESULT') {
                send(await handleOzonUiApplyResult(senderTabId, msg));
                return;
            }

            if (msg.type === 'GET_CONFIG') {
                send(createRuntimeConfigResponse(userConfig, monitorDictionaries));
                return;
            }

            if (msg.type === 'GET_EVENT_JOURNAL') {
                send(createRuntimeEventJournalResponse(
                    eventJournal,
                    createWatchedEventJournalOptions(msg.options || {}, userConfig?.watchedOrders),
                    eventJournalDroppedEntries
                ));
                return;
            }

            if (msg.type === 'GET_ORDER_LOOKUP') {
                send(createRuntimeOrderLookupResponse(
                    {
                        knownOrdersDB,
                        eventJournal,
                        watchedOrders: userConfig?.watchedOrders
                    },
                    msg.options || {},
                    eventJournalDroppedEntries
                ));
                return;
            }

            if (msg.type === 'GET_MONITOR_STATUS') {
                send(createRuntimeMonitorStatusResponse(getMonitorStatusSnapshot()));
                return;
            }

            if (msg.type === 'GET_DIAGNOSTIC_LOG') {
                send(createRuntimeDiagnosticLogResponse(diagnosticLog, msg.options || {}, diagnosticLogDroppedEntries));
                return;
            }

            if (msg.type === 'CLEAR_DIAGNOSTIC_LOG') {
                diagnosticLog = [];
                diagnosticLogDroppedEntries = 0;
                await enqueueStorageTask('clear-diagnostic-log', () => (
                    chrome.storage.local.set({ diagnosticLog: [], diagnosticLogDroppedEntries: 0 })
                ));
                send(createRuntimeOkResponse());
                return;
            }

            if (msg.type === 'ADD_WATCHED_ORDER') {
                send(await startWatchedOrderAddValidation(msg.orderId, { note: msg.note }));
                return;
            }

            if (msg.type === 'SET_WATCHED_ORDER_REMINDER') {
                send(await setWatchedOrderReminderFromRuntime(msg.orderId, msg.reminder || {}));
                return;
            }

            if (msg.type === 'CLEAR_WATCHED_ORDER_REMINDER') {
                send(await clearWatchedOrderReminderFromRuntime(msg.orderId));
                return;
            }

            if (msg.type === 'DICTIONARIES') {
                if (senderTabId !== workerTabId) {
                    send(createRuntimeIgnoredResponse());
                    return;
                }

                const nextDictionaries = normalizeDictionaries(msg.data);

                if (areDictionariesEqual(monitorDictionaries, nextDictionaries)) {
                    send(createRuntimeOkResponse({ unchanged: true }));
                    return;
                }

                monitorDictionaries = nextDictionaries;

                log('INFO', 'DICT', 'updated', {
                    status: monitorDictionaries.status.length,
                    delivery: monitorDictionaries.delivery.length,
                    payment: monitorDictionaries.payment.length,
                    orderFlags: monitorDictionaries.orderFlags.length,
                    store: monitorDictionaries.store.length,
                    reserve: monitorDictionaries.reserve.length,
                    assemblyStatus: monitorDictionaries.assemblyStatus.length
                });

                await save();

                send(createRuntimeOkResponse());
                return;
            }

if (msg.type === 'UPDATE_CONFIG') {
    const prevConfig = userConfig;

    userConfig = getEffectiveUserConfig(msg.userConfig || {});
    const addedWatchedOrderIds = getAddedWatchedOrderIds(prevConfig?.watchedOrders, userConfig?.watchedOrders);

    const prevScope = JSON.stringify(prevConfig?.monitorScope || {});
    const nextScope = JSON.stringify(userConfig?.monitorScope || {});
    const scopeChanged = prevScope !== nextScope;

    const prevMode = String(prevConfig?.monitorMode || 'windowed');
    const nextMode = String(userConfig?.monitorMode || 'windowed');
    const modeChanged = prevMode !== nextMode;

    const prevDeepSyncMaxPages = normalizeDeepSyncMaxPages(prevConfig?.deepSyncMaxPages);
    const nextDeepSyncMaxPages = normalizeDeepSyncMaxPages(userConfig?.deepSyncMaxPages);
    const deepSyncMaxPagesChanged = prevDeepSyncMaxPages !== nextDeepSyncMaxPages;

    const syncReason = getConfigChangeSyncReason({ scopeChanged, modeChanged });

    if (deepSyncMaxPagesChanged) {
        log('INFO', 'CONFIG', 'deep sync max pages changed', {
            from: prevDeepSyncMaxPages,
            to: nextDeepSyncMaxPages
        });
    }

    if (syncReason) {
        scheduleRebaseline(syncReason);
        resetCollectionSession();

        if (scopeChanged) {
            appendScopeChangeEventToJournal(prevConfig?.monitorScope, userConfig?.monitorScope);
            log('INFO', 'CONFIG', 'monitor scope changed', getMonitorScopeLogSummary(userConfig?.monitorScope));
        }

        if (modeChanged) {
            log('INFO', 'CONFIG', 'monitor mode changed', {
                from: prevMode,
                to: nextMode
            });
        }

        log('INFO', 'CONFIG', 'effective config summary', getConfigLogSummary(userConfig));
        log('INFO', 'CONFIG', 'rebaseline scheduled', { syncReason: pendingSyncReason });

        if (isRunning && workerTabId) {
            await goToCollectionPage(1);
        }
    } else if (!deepSyncMaxPagesChanged) {
        log('DEBUG', 'CONFIG', 'no changes');
    }

    await syncWatchedOrderReminderAlarms();
    await startImmediateDirectFollowUpBaselineForAddedOrder(addedWatchedOrderIds);
    await save();

    send(createRuntimeUpdateConfigResponse(userConfig));
    return;
}

            if (isTrustedAmperkotOrdersUrl(senderTab?.url) && senderTabId !== workerTabId) {
                log('WARN', 'SECURITY', 'foreign tab tried to act as worker');
                send(createWorkerCheckResponse({ isWorker: false, isRunning }));
                return;
            }

if (msg.type === 'START') {
    if (isRunning && workerTabId) {
        log('WARN', 'CONTROL', 'START ignored (already running)');
        send(createRuntimeOkResponse());
        return;
    }

    isRunning = true;
    isStarting = true;
    scheduleRebaseline(getStartRebaselineSyncReason({
        hasKnownOrders: hasKnownOrders(),
        pendingRebaseline,
        pendingSyncReason
    }));
    monitorState = 'warming';
    resetCollectionSession();

    log('INFO', 'CONTROL', 'START');
    log('INFO', 'CONTROL', 'rebaseline scheduled on start', { syncReason: pendingSyncReason });
    log('INFO', 'CONTROL', 'monitor state -> warming');
    log('INFO', 'CONTROL', 'monitor scope on start', getMonitorScopeLogSummary(userConfig?.monitorScope));

    const oldTabId = workerTabId;
    workerTabId = null;

    if (oldTabId) {
        try {
            await chrome.tabs.remove(oldTabId);
        } catch {}
    }

    try {
        await cleanupOldWorkers();
        await ensureWorkerTab();
    } finally {
        isStarting = false;
    }

    await save();

    send(createRuntimeOkResponse());
    return;
}

if (msg.type === 'STOP') {
    isRunning = false;
    monitorState = 'uninitialized';
    resetCollectionSession();

    log('INFO', 'CONTROL', 'STOP');
    log('INFO', 'CONTROL', 'monitor state -> uninitialized');

    if (workerTabId) {
        try {
            await chrome.tabs.remove(workerTabId);
        } catch {}
    }

    if (directWorkerTabId) {
        try {
            await chrome.tabs.remove(directWorkerTabId);
        } catch {}
    }

    workerTabId = null;
    directWorkerTabId = null;
    directFollowUpState = normalizeDirectFollowUpState({
        nextIndex: directFollowUpState?.nextIndex,
        lastCompletedAt: directFollowUpState?.lastCompletedAt,
        lastError: directFollowUpState?.currentOrderId ? 'direct follow-up stopped' : directFollowUpState?.lastError
    });

    await save();

    send(createRuntimeOkResponse());
    return;
}

if (msg.type === 'ORDERS') {
    const isTest = msg.isTest === true;
    const normalizedMessageOrders = normalizeIncomingOrders(msg.data);

    if (!isTest) {
        lastPing = Date.now();
    }

    if (!isRunning && !isTest) {
        send(createRuntimeIgnoredResponse());
        return;
    }

    if (!isTest && senderTabId !== workerTabId) {
        send(createRuntimeIgnoredResponse());
        return;
    }

    if (isTest) {
        await processOrders(normalizedMessageOrders, { testMode: true });
        send(createRuntimeOkResponse());
        return;
    }

        const isEmptyDB = Object.keys(windowOrdersDB).length === 0;
    const meta = normalizeOrdersMessageMeta(msg);
    const sessionMode = getCollectionSessionMode();

if (isFastCollectionPageMismatch(sessionMode, meta.page)) {
    log('WARN', 'COLLECTION', 'fast session received non-first page, redirecting worker', {
        page: meta.page,
        sessionMode
    });

    resetCollectionSession();

    const redirected = await goToCollectionPage(1);

    send(createRuntimeCollectionResponse({
        collecting: true,
        redirected,
        stalePage: true
    }));
    return;
}

const session = ensureCollectionSession();
const collected = collectPageIntoCollectionSession(session, normalizedMessageOrders, {
    page: meta.page,
    knownOrdersDB
});

if (!collected) {
    send(createRuntimeCollectionResponse({ collecting: true, duplicate: true }));
    return;
}

const decision = shouldCompleteCollectionSession(session, meta, getCollectionPolicy());

if (!decision.complete) {
    await save();

    const advanceResult = await advanceCollectionPage();

    send(createRuntimeCollectionResponse({
        collecting: !advanceResult.aborted,
        advanced: advanceResult.ok,
        aborted: advanceResult.aborted
    }));
    return;
}

const snapshot = completeCollectionSession(session, decision.reason);
logCollectionSessionCompleted(session, snapshot);
const shouldReturnToFirstPage = session?.mode === 'deep';

if (pendingRebaseline) {
    if (shouldRunCatchUpForPendingSync()) {
        await runCatchUpSnapshot(snapshot, pendingSyncReason || SYNC_REASONS.MANUAL_START);
    } else {
        await runBaseline(snapshot, pendingSyncReason || SYNC_REASONS.INITIAL);
    }

    if (shouldReturnToFirstPage) {
        await returnWorkerToFirstPageAfterDeepSession(session);
    }
} else if (isEmptyDB || !shouldEmitEvents()) {
    await runBaseline(
        snapshot,
        hasKnownOrders() ? SYNC_REASONS.WINDOW_SYNC : SYNC_REASONS.INITIAL
    );

    if (shouldReturnToFirstPage) {
        await returnWorkerToFirstPageAfterDeepSession(session);
    }
} else {
    const syncReason = SYNC_REASONS.NORMAL;

    markDeepSyncCompleted(session);
    recordCollectionMetadata(session, snapshot, syncReason);
    await processOrders(snapshot, { syncReason, persist: false });

    if (session?.mode === 'deep') {
        applyWindowSnapshot(snapshot);
        await returnWorkerToFirstPageAfterDeepSession(session);
    }

    resetCollectionSession();
    await save();
}

    send(createRuntimeOkResponse());
    return;
}

            send(createRuntimeFailureResponse());
        } catch (err) {
            console.error('[BG][ERROR]', err);

            try {
                send(createRuntimeErrorResponse(err));
            } catch {}
        } finally {
            if (runtimeOperationStarted) {
                activeRuntimeMessageCount = Math.max(0, activeRuntimeMessageCount - 1);

                if (pendingExtensionUpdate && activeRuntimeMessageCount === 0) {
                    await tryApplyPendingExtensionUpdate('runtime-message-complete');
                }
            }
        }
    })();

    return true;
});

// ---------- INIT ----------
async function initializeBackground() {
    await restrictStorageAccess();
    await loadState();
    await reconcileWorkerTabsOnStartup();
    await ensureLifecycleAlarms();
    await syncWatchedOrderReminderAlarms(userConfig?.watchedOrders);
    await refreshStorageUsage(true);

    if (isRunning && !workerTabId) {
        await ensureWorkerTab();
    }

    if (pendingExtensionUpdate) {
        await tryApplyPendingExtensionUpdate('service-worker-load');
    }

    await save();
    return true;
}

function ensureInitialized() {
    if (!initializationPromise) {
        initializationPromise = initializeBackground().catch((err) => {
            console.error('[BG][ERROR][INIT]', err?.message || err);
            initializationPromise = null;
            throw err;
        });
    }

    return initializationPromise;
}

initializationPromise = ensureInitialized();