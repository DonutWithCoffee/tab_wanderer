importScripts('version.js', 'notification-rules.js');

let knownOrdersDB = {};
let knownOrdersHashDB = {};
let windowOrdersDB = {};
let windowOrdersHashDB = {};
let notificationTargets = {};
let workerTabId = null;
let lastBaselineDate = null;
let isRunning = false;
let monitorState = 'uninitialized';
let lastDeepSyncAt = 0;
let userConfig = null;
let pendingRebaseline = false;
let collectionSession = null;
let monitorDictionaries = null;

let lastPing = Date.now();
let workerActivatedAt = Date.now();
let isCreatingWorker = false;
let isCleaningUp = false;
let isStarting = false;
let workerRetryTimer = null;

const TARGET_URL = 'https://amperkot.ru/admin/orders/';
const WORKER_MARK = '#tab_wanderer_worker=1';
const FAST_POLL_INTERVAL_MS = 15000;
const DEEP_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DEEP_SYNC_MAX_PAGES = 10;
const COLLECTION_TIMEOUT_MS = 60000;
const COLLECTION_MAX_ADVANCE_ATTEMPTS = DEEP_SYNC_MAX_PAGES + 2;

function createCollectionSession(mode = 'fast') {
    return {
        mode,
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        advanceAttempts: 0,
        orders: {},
        isComplete: false,
        completionReason: null,
        currentPage: 1,
        lastCollectedPage: 0,
        nextPage: 2,
        seenKnownOrder: false,
        processedPages: {}
    };
}

function collectPageIntoSession(session, orders, page = 1) {
session.processedPages = session.processedPages || {};

if (session.processedPages[page]) {
    log('DEBUG', 'COLLECTION', 'duplicate page ignored', page);
    return false;
}

session.processedPages[page] = true;
session.lastActivityAt = Date.now();

    session.currentPage = page;

    if (page > session.lastCollectedPage) {
        session.lastCollectedPage = page;
    }

    session.nextPage = page + 1;

    orders.forEach(order => {
        if (!order.id) return;

        session.orders[order.id] = order;

        if (knownOrdersDB[order.id]) {
            session.seenKnownOrder = true;
        }
    });

    return true;
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

        log('INFO', 'COLLECTION', 'navigated to page', page);
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

    if (collectionSession.advanceAttempts > COLLECTION_MAX_ADVANCE_ATTEMPTS) {
        log('ERROR', 'COLLECTION', 'advance limit exceeded', {
            advanceAttempts: collectionSession.advanceAttempts,
            maxAdvanceAttempts: COLLECTION_MAX_ADVANCE_ATTEMPTS,
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

function shouldCompleteSession(session, meta) {
    if (!session) {
        return {
            complete: false,
            reason: null
        };
    }

    if (session.mode === 'fast') {
        return {
            complete: true,
            reason: 'fast-page-1'
        };
    }

    if (session.lastCollectedPage >= DEEP_SYNC_MAX_PAGES) {
        return {
            complete: true,
            reason: 'deep-sync-page-limit'
        };
    }

    if (meta.isComplete) {
        return {
            complete: true,
            reason: meta.completionReason || 'explicit-complete'
        };
    }

    return {
        complete: false,
        reason: null
    };
}

function finalizeSession(session) {
    return Object.values(session.orders || {});
}

function resetCollectionSession() {
    collectionSession = null;
}

function shouldStartDeepSync() {
    if (pendingRebaseline) {
        return true;
    }

    return (Date.now() - lastDeepSyncAt) >= DEEP_SYNC_INTERVAL_MS;
}

function ensureCollectionSession() {
    if (!collectionSession) {
        collectionSession = createCollectionSession(
            shouldStartDeepSync() ? 'deep' : 'fast'
        );
    }

    return collectionSession;
}

function markDeepSyncCompleted(session) {
    if (session?.mode === 'deep') {
        lastDeepSyncAt = Date.now();
    }
}

function completeCollectionSession(session, reason = 'legacy-single-page') {
    if (!session) {
        return [];
    }

    session.isComplete = true;
    session.completionReason = reason;

    return finalizeSession(session);
}

function normalizeOrdersMessageMeta(msg = {}) {
    const rawPage = Number(msg.page);
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

    const hasCompletionFlag = typeof msg.isComplete === 'boolean';
    const isComplete = hasCompletionFlag ? msg.isComplete : true;

    const completionReason = typeof msg.completionReason === 'string' && msg.completionReason.trim()
        ? msg.completionReason.trim()
        : (hasCompletionFlag && msg.isComplete ? 'explicit-complete' : 'legacy-single-page');

    return {
        page,
        isComplete,
        completionReason
    };
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

function log(level, scope, ...args) {
    if (!shouldLog(level)) return;
    console.log(`[BG][${level}][${scope}]`, ...args);
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
        pendingRebaseline,
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
function normalize(v) {
    return (v || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[–-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDateForHash(v) {
    const raw = String(v || '');
    const firstLine = raw.split('\n')[0] || '';

    return normalize(firstLine);
}

function getHash(o) {
    return [
        o.id,
        normalize(o.status),
        normalize(o.delivery),
        normalize(o.payment),
        normalize(o.contractor),
        normalizeDateForHash(o.date)
    ].join('|');
}

function todayKey() {
    return new Date().toDateString();
}

function getEffectiveUserConfig(storedConfig) {
    const safe = storedConfig || {};

    return {
        ...DEFAULT_CONFIG,
        ...safe,
        rules: {
            ...(DEFAULT_CONFIG.rules || {}),
            ...(safe.rules || {})
        },
        monitorScope: normalizeMonitorScope(safe.monitorScope)
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
        updatedAt: Date.now()
    };
}

function areDictionariesEqual(prev, next) {
    if (!prev && !next) return true;
    if (!prev || !next) return false;

    return JSON.stringify({
        status: prev.status || [],
        delivery: prev.delivery || [],
        payment: prev.payment || []
    }) === JSON.stringify({
        status: next.status || [],
        delivery: next.delivery || [],
        payment: next.payment || []
    });
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
        isRunning,
        monitorState,
        lastDeepSyncAt,
        userConfig,
        pendingRebaseline,
        collectionSession,
        monitorDictionaries
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
        'isRunning',
        'monitorState',
        'lastDeepSyncAt',
        'userConfig',
        'pendingRebaseline',
        'collectionSession',
        'monitorDictionaries'
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
    collectionSession = d.collectionSession || null;
    monitorDictionaries = d.monitorDictionaries || null;

    workerTabId = null;

    if (isRunning) {
        monitorState = 'warming';
        pendingRebaseline = true;
        resetCollectionSession();
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

            if (tab.url.includes(WORKER_MARK)) {
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
    if (tabId === workerTabId) {
        workerTabId = null;

        if (isRunning && !isCleaningUp && !isStarting) {
            ensureWorkerTab();
        }
    }
});

// ---------- NOTIFY ----------
function notifyOrder(o) {
    const contractor = normalize(o.contractor);
    const payment = normalize(o.payment);

    let tag = '';

    if (contractor === 'ozon (озон)') {
        tag = 'ОЗОН';
    } else if (payment === 'безналичный расчет для юридических лиц') {
        tag = 'Юрик';
    }

    const tagSuffix = tag ? ` (${tag})` : '';

    const message = [
        `Статус: ${o.status}`,
        `Доставка: ${o.delivery}`,
        `Оплата: ${o.payment}`
    ].join('\n');

log('INFO', 'NOTIFY', 'creating notification', {
    orderId: o.id,
    orderUrl: o.orderUrl || '',
    tag,
    decision: 'notify',
    message
});

    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: `Заказ №${o.id}${tagSuffix}`,
        message
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
    const nextKnownDB = {};
    const nextKnownHashDB = {};
    const nextWindowDB = {};
    const nextWindowHashDB = {};

    markDeepSyncCompleted(collectionSession);

    orders.forEach(order => {
        if (!order.id) return;

        const hash = getHash(order);

        nextKnownDB[order.id] = order;
        nextKnownHashDB[order.id] = hash;
        nextWindowDB[order.id] = order;
        nextWindowHashDB[order.id] = hash;
    });

    knownOrdersDB = nextKnownDB;
    knownOrdersHashDB = nextKnownHashDB;
    windowOrdersDB = nextWindowDB;
    windowOrdersHashDB = nextWindowHashDB;
    lastBaselineDate = todayKey();
    pendingRebaseline = false;
    monitorState = 'active';
    resetCollectionSession();

    log('INFO', 'BASELINE', `${reason} count=${orders.length}`);
    logState('BASELINE');

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
    const { testMode = false } = options;

    let hasChanges = false;

    log('INFO', 'PROCESS', `orders=${orders.length} testMode=${testMode}`);

    for (const order of orders) {
        if (!order.id) continue;

        const newHash = getHash(order);
        const prevHash =
            windowOrdersHashDB[order.id] ||
            knownOrdersHashDB[order.id] ||
            null;

        if (newHash === prevHash) {
            continue;
        }

        hasChanges = true;

        const prevOrder =
            windowOrdersDB[order.id] ||
            knownOrdersDB[order.id] ||
            null;

        log('INFO', 'CHANGE', {
            id: order.id,
            prev: prevHash,
            next: newHash
        });

        const isNewOrder = !knownOrdersDB[order.id];

        const decision = evaluateNotification(
            order,
            {
                prevOrder,
                prevHash,
                newHash,
                isNewOrder
            },
            userConfig
        );

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
                isNewOrder
            });
        } else {
            notifyOrder(order);
        }

        if (!testMode) {
            knownOrdersDB[order.id] = order;
            knownOrdersHashDB[order.id] = newHash;
            windowOrdersDB[order.id] = order;
            windowOrdersHashDB[order.id] = newHash;
        }
    }

    if (!testMode && hasChanges) {
        logState('PROCESS');
        save();
    }
}

// ---------- WATCHDOG ----------
setInterval(() => {
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

// ---------- MESSAGES ----------
chrome.runtime.onMessage.addListener((msg, sender, send) => {
    (async () => {
        try {
            const senderTabId = sender?.tab?.id;
            const senderTab = sender?.tab;

            if (msg.type === 'CHECK_WORKER') {
                const isCorrectUrl = senderTab?.url?.includes(WORKER_MARK);

                if (senderTabId === workerTabId) {
                    send({ isWorker: true, isRunning });
                    return;
                }

                if (!workerTabId && isCorrectUrl && !isCreatingWorker) {
                    workerTabId = senderTabId;
                    workerActivatedAt = Date.now();
                    lastPing = workerActivatedAt;

                    log('INFO', 'WORKER', 'bind on init');
                    await save();

                    send({ isWorker: true, isRunning });
                    return;
                }

                send({ isWorker: false, isRunning });
                return;
            }

            if (msg.type === 'GET_CONFIG') {
                send({
                    ok: true,
                    userConfig,
                    monitorDictionaries
                });
                return;
            }

            if (msg.type === 'DICTIONARIES') {
                if (senderTabId !== workerTabId) {
                    send({ ignored: true });
                    return;
                }

                const nextDictionaries = normalizeDictionaries(msg.data);

                if (areDictionariesEqual(monitorDictionaries, nextDictionaries)) {
                    send({ ok: true, unchanged: true });
                    return;
                }

                monitorDictionaries = nextDictionaries;

                log('INFO', 'DICT', 'updated', {
                    status: monitorDictionaries.status.length,
                    delivery: monitorDictionaries.delivery.length,
                    payment: monitorDictionaries.payment.length
                });

                await save();

                send({ ok: true });
                return;
            }

if (msg.type === 'UPDATE_CONFIG') {
    const prevConfig = userConfig;

    userConfig = getEffectiveUserConfig(msg.userConfig || {});

    const ruleChanges = [];

    const prevRules = prevConfig?.rules || {};
    const nextRules = userConfig?.rules || {};

    const ruleKeys = new Set([
        ...Object.keys(prevRules),
        ...Object.keys(nextRules)
    ]);

    for (const key of ruleKeys) {
        if (prevRules[key] !== nextRules[key]) {
            ruleChanges.push({
                rule: key,
                from: prevRules[key],
                to: nextRules[key]
            });
        }
    }

    const prevScope = JSON.stringify(prevConfig?.monitorScope || {});
    const nextScope = JSON.stringify(userConfig?.monitorScope || {});
    const scopeChanged = prevScope !== nextScope;

    if (ruleChanges.length > 0 || scopeChanged) {
        pendingRebaseline = true;

        if (ruleChanges.length > 0) {
            log('INFO', 'CONFIG', 'rules changed', ruleChanges);
        }

        if (scopeChanged) {
            log('INFO', 'CONFIG', 'monitor scope changed', userConfig?.monitorScope || {});
        }

        log('INFO', 'CONFIG', 'effective config', userConfig);
        log('INFO', 'CONFIG', 'rebaseline scheduled');
    } else {
        log('DEBUG', 'CONFIG', 'no changes');
    }

    await save();

    send({
        ok: true,
        userConfig
    });
    return;
}

            if (senderTab?.url?.startsWith(TARGET_URL) && senderTabId !== workerTabId) {
                log('WARN', 'SECURITY', 'foreign tab tried to act as worker');
                send({ isWorker: false, isRunning });
                return;
            }

if (msg.type === 'START') {
    if (isRunning && workerTabId) {
        log('WARN', 'CONTROL', 'START ignored (already running)');
        send({ ok: true });
        return;
    }

    isRunning = true;
    isStarting = true;
    pendingRebaseline = true;
    monitorState = 'warming';
    resetCollectionSession();

    log('INFO', 'CONTROL', 'START');
    log('INFO', 'CONTROL', 'rebaseline scheduled on start');
    log('INFO', 'CONTROL', 'monitor state -> warming');
    log('INFO', 'CONTROL', 'monitor scope on start', userConfig?.monitorScope || {});

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

    send({ ok: true });
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

    workerTabId = null;

    await save();

    send({ ok: true });
    return;
}

if (msg.type === 'ORDERS') {
    const isTest = msg.isTest === true;

    if (!isTest) {
        lastPing = Date.now();
    }

    if (!isRunning && !isTest) {
        send({ ignored: true });
        return;
    }

    if (!isTest && senderTabId !== workerTabId) {
        send({ ignored: true });
        return;
    }

    if (isTest) {
        processOrders(msg.data, { testMode: true });
        send({ ok: true });
        return;
    }

        const isEmptyDB = Object.keys(windowOrdersDB).length === 0;
    const meta = normalizeOrdersMessageMeta(msg);

const session = ensureCollectionSession();
const collected = collectPageIntoSession(session, msg.data, meta.page);

if (!collected) {
    send({ ok: true, collecting: true, duplicate: true });
    return;
}

const decision = shouldCompleteSession(session, meta);

if (!decision.complete) {
    await save();

    const advanceResult = await advanceCollectionPage();

    send({
        ok: true,
        collecting: !advanceResult.aborted,
        advanced: advanceResult.ok,
        aborted: advanceResult.aborted
    });
    return;
}

const snapshot = completeCollectionSession(session, decision.reason);

if (pendingRebaseline) {
    runBaseline(snapshot, 'rebaseline');
} else if (isEmptyDB || monitorState !== 'active') {
    runBaseline(snapshot, 'init');
} else {
    if (session?.mode === 'deep') {
        markDeepSyncCompleted(session);
        applyWindowSnapshot(snapshot);
    } else {
        processOrders(snapshot);
    }

    resetCollectionSession();
    await save();
}

    send({ ok: true });
    return;
}

            send({ ok: false });
        } catch (err) {
            console.error('[BG][ERROR]', err);

            try {
                send({ ok: false, error: err.message });
            } catch {}
        }
    })();

    return true;
});

// ---------- INIT ----------
load();