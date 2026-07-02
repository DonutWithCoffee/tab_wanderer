importScripts('version.js', 'core/watched-orders.js', 'core/direct-follow-up.js', 'notification-rules.js', 'core/order-model.js', 'core/collection-model.js', 'core/sync-model.js', 'core/event-journal.js', 'core/monitor-status.js', 'core/diagnostic-log.js', 'core/notification-message.js', 'core/order-lookup.js', 'core/runtime-api.js', 'core/ozon-product-search.js', 'core/ozon-barcode-binding.js');

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
const DIRECT_FOLLOW_UP_INTERVAL_MS = 2 * 60 * 1000;
const DIRECT_FOLLOW_UP_TIMEOUT_MS = 60 * 1000;
const FAST_POLL_INTERVAL_MS = 15000;
const DEEP_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const COLLECTION_TIMEOUT_MS = 60000;
const COLLECTION_MAX_ADVANCE_ATTEMPT_BUFFER = 2;

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
        return !!tab.url && tab.url.includes(DIRECT_WORKER_MARK);
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
        tabId: directWorkerTabId
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
    const directResult = ok && result?.order
        ? processDirectFollowUpOrder(result.order, normalizedId, now)
        : null;

    userConfig = {
        ...userConfig,
        watchedOrders: markWatchedOrderCheckResult(userConfig?.watchedOrders, normalizedId, {
            ok,
            error
        }, now)
    };

    directFollowUpState = normalizeDirectFollowUpState({
        nextIndex: directFollowUpState?.nextIndex,
        lastCompletedAt: now,
        lastError: ok ? null : (error || 'Direct follow-up failed')
    });

    log(ok ? 'INFO' : 'WARN', 'DIRECT_FOLLOW_UP', ok ? 'checked' : 'failed', {
        orderId: normalizedId,
        error: ok ? null : directFollowUpState.lastError,
        result: directResult?.reason || null,
        eventCreated: directResult?.eventCreated === true,
        notified: directResult?.notified === true
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

    chrome.storage.local.set({ diagnosticLog, diagnosticLogDroppedEntries }).catch((err) => {
        console.error('[BG][ERROR][DIAGNOSTIC_LOG]', err?.message || err);
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
        diagnosticLogDroppedEntries
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
        notificationTriggers: normalizeNotificationTriggers(safe.notificationTriggers),
        notificationSuppressors: normalizeNotificationSuppressors(safe.notificationSuppressors),
        monitorScope: normalizeMonitorScope(safe.monitorScope),
        watchedOrders: normalizeWatchedOrdersConfig(safe.watchedOrders)
    };
}

async function getMarkedWorkerTabs() {
    const tabs = await chrome.tabs.query({});

    return tabs.filter(tab => {
        return !!tab.url && tab.url.includes(WORKER_MARK);
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
async function save() {
    await chrome.storage.local.set({
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
        diagnosticLogDroppedEntries
    });

    logState('SAVE');
}

async function load() {
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
        'diagnosticLogDroppedEntries'
    ]);

    knownOrdersDB = d.knownOrdersDB || {};
    knownOrdersHashDB = d.knownOrdersHashDB || {};
    windowOrdersDB = d.windowOrdersDB || {};
    windowOrdersHashDB = d.windowOrdersHashDB || {};
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
    const eventJournalRetention = applyEventJournalRetention(d.eventJournal);

    eventJournal = eventJournalRetention.entries;
    eventJournalDroppedEntries = normalizeEventJournalDroppedEntries(d.eventJournalDroppedEntries) + eventJournalRetention.dropped;
    const diagnosticLogRetention = applyDiagnosticLogRetention(d.diagnosticLog);

    diagnosticLog = diagnosticLogRetention.entries;
    diagnosticLogDroppedEntries = normalizeDiagnosticLogDroppedEntries(d.diagnosticLogDroppedEntries) + diagnosticLogRetention.dropped;
    isDiagnosticLogReady = true;

    directWorkerTabId = null;
    directFollowUpState = normalizeDirectFollowUpState(d.directFollowUpState);
    directFollowUpOrdersDB = d.directFollowUpOrdersDB && typeof d.directFollowUpOrdersDB === 'object'
        ? d.directFollowUpOrdersDB
        : {};
    directFollowUpHashDB = d.directFollowUpHashDB && typeof d.directFollowUpHashDB === 'object'
        ? d.directFollowUpHashDB
        : {};
    workerTabId = null;

    if (isRunning) {
        monitorState = 'warming';
        scheduleRebaseline(getRecoverySyncReason({
            hasKnownOrders: hasKnownOrders(),
            lastCollectionAt: lastCollectionMetadata?.collectedAt
        }));
        resetCollectionSession();
        directWorkerTabId = null;
        directFollowUpState = normalizeDirectFollowUpState({
            nextIndex: directFollowUpState?.nextIndex,
            lastCompletedAt: directFollowUpState?.lastCompletedAt,
            lastError: directFollowUpState?.currentOrderId ? 'direct follow-up reset on recovery' : directFollowUpState?.lastError
        });
    }

    log('INFO', 'INIT', 'state loaded');
    logState('LOAD');

    if (isRunning) {
        log('INFO', 'INIT', 'delayed worker init');

        setTimeout(() => {
            ensureWorkerTab();
        }, 1000);
    }
}

// ---------- CLEANUP ----------
async function cleanupOldWorkers() {
    isCleaningUp = true;

    try {
        const tabs = await chrome.tabs.query({});

        for (const tab of tabs) {
            if (!tab.url) continue;

            if (tab.url.includes(WORKER_MARK) || tab.url.includes(DIRECT_WORKER_MARK)) {
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
                    ensureWorkerTab();
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

// ---------- TAB EVENTS ----------
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === directWorkerTabId) {
        directWorkerTabId = null;

        if (directFollowUpState?.currentOrderId) {
            directFollowUpState = normalizeDirectFollowUpState({
                nextIndex: directFollowUpState.nextIndex,
                lastStartedAt: directFollowUpState.lastStartedAt,
                lastCompletedAt: directFollowUpState.lastCompletedAt,
                lastError: 'direct worker tab closed'
            });
        }
    }

    if (tabId === ozonWorkerTabId) {
        ozonWorkerTabId = null;

        if (ozonUiApplySession) {
            failOzonUiApply('Ozon worker tab closed');
        } else {
            failOzonResolvePreview('Ozon worker tab closed');
        }
        return;
    }

    if (tabId === workerTabId) {
        workerTabId = null;

        if (isRunning && !isCleaningUp && !isStarting) {
            ensureWorkerTab();
        }
    }
});

// ---------- NOTIFY ----------
function notifyOrder(o, eventContext = {}) {
    const content = createOrderNotificationContent(o, eventContext);

    log('INFO', 'NOTIFY', 'creating notification', {
        orderId: o.id,
        orderUrl: o.orderUrl || '',
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
        iconUrl: 'icon.png',
        title: content.title,
        message: content.message
    }, async (notificationId) => {
        if (chrome.runtime.lastError) {
            log('ERROR', 'NOTIFY', chrome.runtime.lastError.message);
            return;
        }

        if (o.orderUrl) {
            notificationTargets[notificationId] = {
                orderId: o.id,
                orderUrl: o.orderUrl
            };

            await save();
        }

        log('INFO', 'NOTIFY', 'created', notificationId);
    });
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
    const target = notificationTargets[notificationId];

    if (!target?.orderUrl) {
        log('WARN', 'NOTIFY_CLICK', 'target not found', notificationId);
        return;
    }

    try {
        await chrome.tabs.create({
            url: target.orderUrl,
            active: true
        });

        log('INFO', 'NOTIFY_CLICK', {
            notificationId,
            orderId: target.orderId,
            orderUrl: target.orderUrl
        });
    } catch (err) {
        log('ERROR', 'NOTIFY_CLICK', err?.message || err);
        return;
    }

    delete notificationTargets[notificationId];
    await save();

    chrome.notifications.clear(notificationId);
});

chrome.notifications.onClosed.addListener(async (notificationId) => {
    if (!notificationTargets[notificationId]) {
        return;
    }

    delete notificationTargets[notificationId];
    await save();

    log('DEBUG', 'NOTIFY', 'cleared target on close', notificationId);
});

// ---------- BASELINE ----------
function runBaseline(orders, reason = 'auto') {
    const syncReason = reason === 'auto'
        ? (pendingSyncReason || SYNC_REASONS.NORMAL)
        : normalizeSyncReason(reason);
    const nextWindowDB = {};
    const nextWindowHashDB = {};

    markDeepSyncCompleted(collectionSession);

    orders.forEach(order => {
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
    recordCollectionMetadata(collectionSession, orders, syncReason);
    clearPendingRebaseline();
    monitorState = 'active';
    resetCollectionSession();

    log('INFO', 'BASELINE', `${syncReason} count=${orders.length}`);
    logState('BASELINE');

    save();
}

function runCatchUpSnapshot(orders, reason = SYNC_REASONS.MANUAL_START) {
    const syncReason = normalizeSyncReason(reason);

    markDeepSyncCompleted(collectionSession);
    recordCollectionMetadata(collectionSession, orders, syncReason);
    clearPendingRebaseline();
    monitorState = 'active';

    log('INFO', 'CATCH_UP', `${syncReason} count=${orders.length}`);
    processOrders(orders, {
        syncReason,
        suppressNotifications: true
    });
    applyWindowSnapshot(orders);
    resetCollectionSession();
    logState('CATCH_UP');

    save();
}

function applyWindowSnapshot(orders) {
    const nextWindowDB = {};
    const nextWindowHashDB = {};

    orders.forEach(order => {
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

    log('INFO', 'WINDOW_SYNC', `applied window snapshot count=${orders.length}`);
}

// ---------- CORE ----------
function processOrders(orders, options = {}) {
    const {
        testMode = false,
        syncReason = SYNC_REASONS.NORMAL,
        suppressNotifications = false
    } = options;

    let hasChanges = false;
    let hasStateUpdates = false;

    const processLogLevel = !testMode && orders.length > 30 ? 'INFO' : 'DEBUG';
    log(processLogLevel, 'PROCESS', `orders=${orders.length} testMode=${testMode}`);

    for (const order of orders) {
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
        save();
    }
}

// ---------- WATCHDOG ----------
setInterval(() => {
    handleDirectFollowUpTimeout();

    if (collectionSession) {
    const idle = Date.now() - (collectionSession.lastActivityAt || 0);

    if (idle > COLLECTION_TIMEOUT_MS) {
        log('WARN', 'COLLECTION', 'session timeout, resetting');

        resetCollectionSession();

        if (workerTabId) {
            goToCollectionPage(1);
        }
    }
}
    if (!isRunning || !workerTabId) return;

    const referenceTime = Math.max(lastPing, workerActivatedAt);
    const diff = Date.now() - referenceTime;

    if (diff > 60000) {
        log('WARN', 'WATCHDOG', 'worker dead, restarting');

        chrome.tabs.remove(workerTabId).catch(() => {});
        workerTabId = null;

        ensureWorkerTab();
    }
}, 30000);

setInterval(() => {
    runDirectFollowUpTick();
}, DIRECT_FOLLOW_UP_INTERVAL_MS);


// ---------- OZON BARCODE RESOLVE PREVIEW ----------
function normalizeOzonResolveId(value) {
    return String(value || '')
        .replace(/\s+/g, '')
        .trim();
}

function isWarehouseOzonResolveSender(senderTab = {}) {
    return String(senderTab?.url || '').startsWith('https://amperkot.ru/web-apps/wh3/');
}

function getOzonResolveProductGroups(warehouseExtraction = {}) {
    if (typeof getOzonBindingProductGroups === 'function') {
        return getOzonBindingProductGroups(warehouseExtraction);
    }

    return Object.values(warehouseExtraction?.productsById || {})
        .filter(group => group && group.productId && group.productId !== '__unknown__');
}

function getOzonResolveProductIds(warehouseExtraction = {}) {
    return getOzonResolveProductGroups(warehouseExtraction)
        .filter(group => Array.isArray(group.eligibleBarcodes) && group.eligibleBarcodes.length > 0)
        .map(group => normalizeOzonResolveId(group.productId))
        .filter(Boolean);
}

function buildOzonResolveWorkerUrl(productId) {
    const url = new URL(buildOzonProductSearchUrl(productId, OZON_PRODUCTS_URL));
    url.hash = OZON_WORKER_MARK.replace('#', '');
    return url.toString();
}

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
    const warehouseTabId = ozonResolveSession?.warehouseTabId;

    if (!warehouseTabId || typeof chrome.tabs.sendMessage !== 'function') {
        return false;
    }

    try {
        await chrome.tabs.sendMessage(warehouseTabId, {
            type: 'OZON_RESOLVE_PREVIEW_RESULT',
            ...payload
        });
        return true;
    } catch (error) {
        log('WARN', 'OZON_RESOLVE', 'failed to send preview to warehouse tab', error?.message || error);
        return false;
    }
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
        failOzonResolvePreview('Ozon resolve timeout');
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

    ozonResolveSession = {
        warehouseTabId: senderTabId,
        warehouseExtraction,
        productIds,
        index: 0,
        ozonProductsByProductId: {},
        startedAt: Date.now()
    };

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
function getOzonUiApplyProductGroups(warehouseExtraction = {}) {
    return getOzonResolveProductGroups(warehouseExtraction)
        .map(group => ({
            ...group,
            productId: normalizeOzonResolveId(group?.productId),
            eligibleBarcodes: Array.isArray(group?.eligibleBarcodes) ? group.eligibleBarcodes : []
        }))
        .filter(group => group.productId && group.eligibleBarcodes.length > 0);
}

function getUniqueOzonUiApplyBarcodes(entries = []) {
    const seen = new Set();
    const result = [];

    for (const entry of entries) {
        const barcode = normalizeOzonResolveId(entry?.barcode || entry);

        if (!barcode || seen.has(barcode)) {
            continue;
        }

        seen.add(barcode);
        result.push(barcode);
    }

    return result;
}

function createOzonUiApplyRequestFromWarehouseExtraction(warehouseExtraction = {}) {
    const groups = getOzonUiApplyProductGroups(warehouseExtraction);

    if (!groups.length) {
        return { ok: false, error: 'no eligible warehouse barcodes' };
    }

    if (groups.length > 1) {
        return { ok: false, error: 'UI apply supports one product at a time' };
    }

    const group = groups[0];
    const barcodes = getUniqueOzonUiApplyBarcodes(group.eligibleBarcodes);

    if (!barcodes.length) {
        return { ok: false, error: 'no eligible warehouse barcodes' };
    }

    return {
        ok: true,
        productId: group.productId,
        productTitle: String(group.productTitle || ''),
        barcodes
    };
}

function buildOzonUiApplyWorkerUrl(productId) {
    return buildOzonProductSearchUrl(productId, OZON_PRODUCTS_URL);
}

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
    const warehouseTabId = ozonUiApplySession?.warehouseTabId;

    if (!warehouseTabId || typeof chrome.tabs.sendMessage !== 'function') {
        return false;
    }

    try {
        await chrome.tabs.sendMessage(warehouseTabId, {
            type: 'OZON_UI_APPLY_RESULT',
            ...payload
        });
        return true;
    } catch (error) {
        log('WARN', 'OZON_UI_APPLY', 'failed to send apply result to warehouse tab', error?.message || error);
        return false;
    }
}

async function failOzonUiApply(errorMessage = 'Ozon UI apply failed') {
    if (!ozonUiApplySession) {
        return false;
    }

    log('WARN', 'OZON_UI_APPLY', 'apply failed', errorMessage);
    await sendOzonUiApplyResultToWarehouse({ ok: false, error: errorMessage });
    await cleanupOzonUiApply({ closeTab: false });
    return true;
}

function scheduleOzonUiApplyTimeout() {
    clearOzonUiApplyTimeout();

    if (typeof setTimeout !== 'function') {
        return false;
    }

    ozonUiApplyTimeoutTimer = setTimeout(() => {
        ozonUiApplyTimeoutTimer = null;
        failOzonUiApply('Ozon UI apply timeout');
    }, OZON_UI_APPLY_TIMEOUT_MS);

    return true;
}

async function sendOzonUiApplyCommandToWorker() {
    if (!ozonUiApplySession || !ozonWorkerTabId) {
        return false;
    }

    const { productId, barcodes } = ozonUiApplySession;

    try {
        ozonUiApplySession.status = 'command-sent';
        await chrome.tabs.sendMessage(ozonWorkerTabId, {
            type: 'OZON_UI_APPLY_IN_WORKER',
            productId,
            barcodes
        });
        log('INFO', 'OZON_UI_APPLY', 'apply command sent', { productId, barcodeCount: barcodes.length });
        return true;
    } catch (error) {
        await failOzonUiApply(error?.message || 'failed to send apply command to Ozon worker');
        return false;
    }
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
    await cleanupOzonUiApply({ closeTab: false });

    ozonUiApplySession = {
        warehouseTabId: senderTabId,
        productId: request.productId,
        productTitle: request.productTitle,
        barcodes: request.barcodes,
        status: 'opening',
        startedAt: Date.now()
    };

    const url = buildOzonUiApplyWorkerUrl(request.productId);
    scheduleOzonUiApplyTimeout();

    if (ozonWorkerTabId) {
        await chrome.tabs.update(ozonWorkerTabId, { url, active: true });
    } else {
        const tab = await chrome.tabs.create({ url, active: true, pinned: true });
        ozonWorkerTabId = tab.id;
    }

    log('INFO', 'OZON_UI_APPLY', 'worker opened', {
        productId: request.productId,
        barcodeCount: request.barcodes.length,
        tabId: ozonWorkerTabId
    });

    return createRuntimeOkResponse({
        started: true,
        productId: request.productId,
        barcodeCount: request.barcodes.length
    });
}

async function handleOzonProductWorkerReady(senderTabId, msg = {}) {
    if (!ozonUiApplySession || senderTabId !== ozonWorkerTabId) {
        return createRuntimeIgnoredResponse();
    }

    const productId = normalizeOzonResolveId(msg.productId);

    if (!productId || productId !== ozonUiApplySession.productId) {
        return createRuntimeFailureResponse({ error: 'unexpected Ozon worker product id' });
    }

    await sendOzonUiApplyCommandToWorker();
    return createRuntimeOkResponse({ accepted: true });
}

async function handleOzonUiApplyResult(senderTabId, msg = {}) {
    if (!ozonUiApplySession || senderTabId !== ozonWorkerTabId) {
        return createRuntimeIgnoredResponse();
    }

    const productId = normalizeOzonResolveId(msg.productId);

    if (!productId || productId !== ozonUiApplySession.productId) {
        return createRuntimeFailureResponse({ error: 'unexpected Ozon apply result' });
    }

    clearOzonUiApplyTimeout();

    const payload = {
        ok: msg.ok === true,
        productId,
        barcodes: Array.isArray(msg.barcodes) ? msg.barcodes : ozonUiApplySession.barcodes,
        addedCount: Number(msg.addedCount) || 0,
        error: msg.error || null,
        details: msg.details || null
    };

    log(payload.ok ? 'INFO' : 'WARN', 'OZON_UI_APPLY', 'apply result received', payload);
    await sendOzonUiApplyResultToWarehouse(payload);
    await cleanupOzonUiApply({ closeTab: false });

    return createRuntimeOkResponse({ accepted: true });
}

// ---------- MESSAGES ----------
chrome.runtime.onMessage.addListener((msg, sender, send) => {
    (async () => {
        try {
            const senderTabId = sender?.tab?.id;
            const senderTab = sender?.tab;

            if (msg.type === 'CHECK_WORKER') {
                const isCorrectUrl = senderTab?.url?.includes(WORKER_MARK);

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
                const isCorrectUrl = senderTab?.url?.includes(DIRECT_WORKER_MARK);
                const currentOrderId = directFollowUpState?.currentOrderId || null;

                if (senderTabId === directWorkerTabId && isCorrectUrl) {
                    send(createRuntimeOkResponse({
                        isDirectWorker: true,
                        isRunning,
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
                const parsedOrder = msg.data && typeof msg.data === 'object' ? msg.data : null;
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
                await chrome.storage.local.set({ diagnosticLog, diagnosticLogDroppedEntries });
                send(createRuntimeOkResponse());
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

    await save();

    send(createRuntimeUpdateConfigResponse(userConfig));
    return;
}

            if (senderTab?.url?.startsWith(TARGET_URL) && senderTabId !== workerTabId) {
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

    await cleanupOldWorkers();
    await ensureWorkerTab();

    isStarting = false;

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
        processOrders(msg.data, { testMode: true });
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
const collected = collectPageIntoCollectionSession(session, msg.data, {
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
        runCatchUpSnapshot(snapshot, pendingSyncReason || SYNC_REASONS.MANUAL_START);
    } else {
        runBaseline(snapshot, pendingSyncReason || SYNC_REASONS.INITIAL);
    }

    if (shouldReturnToFirstPage) {
        await returnWorkerToFirstPageAfterDeepSession(session);
    }
} else if (isEmptyDB || !shouldEmitEvents()) {
    runBaseline(
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
    processOrders(snapshot, { syncReason });

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
        }
    })();

    return true;
});

// ---------- INIT ----------
load();