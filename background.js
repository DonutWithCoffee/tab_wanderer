importScripts('version.js', 'notification-rules.js');

let ordersDB = {};
let ordersHashDB = {};
let notificationTargets = {};
let workerTabId = null;
let lastBaselineDate = null;
let isRunning = false;

let lastPing = Date.now();
let workerActivatedAt = Date.now();
let isCreatingWorker = false;
let isCleaningUp = false;
let isStarting = false;
let workerRetryTimer = null;

const TARGET_URL = 'https://amperkot.ru/admin/orders/';
const WORKER_MARK = '#tab_wanderer_worker=1';

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
    const ids = Object.keys(ordersDB);
    const lastIds = ids.slice(-5);

    log('DEBUG', scope, {
        totalOrders: ids.length,
        totalHashes: Object.keys(ordersHashDB).length,
        lastOrders: lastIds,
        lastBaselineDate,
        isRunning,
        workerTabId
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

function getHash(o) {
    return [
        o.id,
        normalize(o.status),
        normalize(o.delivery),
        normalize(o.payment),
        normalize(o.contractor),
        normalize(o.date)
    ].join('|');
}

function todayKey() {
    return new Date().toDateString();
}

async function getMarkedWorkerTabs() {
    const tabs = await chrome.tabs.query({});

    return tabs.filter(tab => {
        return !!tab.url && tab.url.includes(WORKER_MARK);
    });
}

// ---------- STORAGE ----------
async function save() {
    await chrome.storage.local.set({
        ordersDB,
        ordersHashDB,
        notificationTargets,
        lastBaselineDate,
        workerTabId,
        isRunning
    });

    logState('SAVE');
}

async function load() {
    const d = await chrome.storage.local.get([
        'ordersDB',
        'ordersHashDB',
        'notificationTargets',
        'lastBaselineDate',
        'isRunning'
    ]);

    ordersDB = d.ordersDB || {};
    ordersHashDB = d.ordersHashDB || {};
    notificationTargets = d.notificationTargets || {};
    lastBaselineDate = d.lastBaselineDate || null;
    isRunning = d.isRunning || false;

    workerTabId = null;

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
        await chrome.tabs.reload(primaryTab.id);
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
            url: TARGET_URL + WORKER_MARK,
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
    const message = [
        `Статус: ${o.status}`,
        `Доставка: ${o.delivery}`,
        `Оплата: ${o.payment}`
    ].join('\n');

    log('INFO', 'NOTIFY', 'creating notification', {
        orderId: o.id,
        orderUrl: o.orderUrl || '',
        message
    });

    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: `Заказ №${o.id}`,
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
    const db = {};
    const hash = {};

    orders.forEach(order => {
        if (!order.id) return;
        db[order.id] = order;
        hash[order.id] = getHash(order);
    });

    ordersDB = db;
    ordersHashDB = hash;
    lastBaselineDate = todayKey();

    log('INFO', 'BASELINE', `${reason} count=${orders.length}`);
    logState('BASELINE');

    save();
}

// ---------- CORE ----------
function processOrders(orders, options = {}) {
    const { testMode = false } = options;

    let hasChanges = false;

    log('INFO', 'PROCESS', `orders=${orders.length} testMode=${testMode}`);

    for (const order of orders) {
        if (!order.id) continue;

        const newHash = getHash(order);
        const prevHash = ordersHashDB[order.id];

        if (newHash === prevHash) {
            continue;
        }

        hasChanges = true;

        const prevOrder = ordersDB[order.id] || null;

        log('INFO', 'CHANGE', {
            id: order.id,
            prev: prevHash,
            next: newHash
        });

        const isNewOrder = !prevOrder;

if (isNewOrder) {
    log('INFO', 'NEW_ORDER', {
        id: order.id
    });

    notifyOrder(order);
} else {
    
    const decision = evaluateNotification(order, {
        prevOrder,
        prevHash,
        newHash,
        isNewOrder
    });

    if (!decision.notify) {
        log('INFO', 'RULES', {
            id: order.id,
            action: decision.action,
            ruleId: decision.ruleId,
            reason: decision.reason
        });
    } else {
        notifyOrder(order);
    }
}

if (!testMode) {
    ordersDB[order.id] = order;
    ordersHashDB[order.id] = newHash;
}
    }

    if (!testMode && hasChanges) {
        logState('PROCESS');
        save();
    }
}

// ---------- WATCHDOG ----------
setInterval(() => {
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

                log('INFO', 'CONTROL', 'START');

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

                log('INFO', 'CONTROL', 'STOP');

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

                const isEmptyDB = Object.keys(ordersDB).length === 0;

                if (isEmptyDB) {
                    runBaseline(msg.data, 'init');
                } else {
                    processOrders(msg.data);
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