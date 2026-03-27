importScripts('version.js');

let ordersDB = {};
let ordersHashDB = {};
let workerTabId = null;
let lastBaselineDate = null;
let isRunning = false;

let lastPing = Date.now();
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
    return (v || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getHash(o) {
    return [
        o.id,
        normalize(o.status),
        normalize(o.delivery),
        normalize(o.payment)
    ].join('|');
}

function todayKey() {
    return new Date().toDateString();
}

// ---------- STORAGE ----------
async function save() {
    await chrome.storage.local.set({
        ordersDB,
        ordersHashDB,
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
        'lastBaselineDate',
        'isRunning'
    ]);

    ordersDB = d.ordersDB || {};
    ordersHashDB = d.ordersHashDB || {};
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

    // ❗ даём Chrome применить изменения
    await new Promise(res => setTimeout(res, 300));

    isCleaningUp = false;
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

        // ❗ КРИТИЧНЫЙ ФИКС — УБИВАЕМ RETRY ПЕРЕД ВСЕМ
        if (workerRetryTimer) {
            clearTimeout(workerRetryTimer);
            workerRetryTimer = null;
        }

        // ❗ ЧИСТИМ СТАРЫЕ ВКЛАДКИ
        await cleanupOldWorkers();

        const newTab = await chrome.tabs.create({
            url: TARGET_URL + WORKER_MARK,
            active: false,
            pinned: true
        });

        workerTabId = newTab.id;

        log('INFO', 'WORKER', 'created', `id=${newTab.id}`);

        save();

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

    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: `Заказ №${o.id}`,
        message
    });
}

// ---------- BASELINE ----------
function runBaseline(orders, reason = 'auto') {
    const db = {};
    const hash = {};

    orders.forEach(o => {
        if (!o.id) return;
        db[o.id] = o;
        hash[o.id] = getHash(o);
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

    log('INFO', 'PROCESS', `orders=${orders.length} testMode=${testMode}`);

    for (const o of orders) {
        if (!o.id) continue;

        if (!o.payment || o.payment === '–') {
            log('DEBUG', 'SKIP', 'empty payment', o.id);
            continue;
        }

        const newHash = getHash(o);
        const prevHash = ordersHashDB[o.id];

        if (newHash === prevHash) continue;

        log('INFO', 'CHANGE', {
            id: o.id,
            prev: prevHash,
            next: newHash
        });

        notifyOrder(o);

        if (!testMode) {
            ordersDB[o.id] = o;
            ordersHashDB[o.id] = newHash;
        }
    }

    if (!testMode) {
        logState('PROCESS');
        save();
    }
}

// ---------- WATCHDOG ----------
setInterval(() => {
    if (!isRunning || !workerTabId) return;

    const diff = Date.now() - lastPing;

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

                if (!workerTabId && isCorrectUrl) {
                    workerTabId = senderTabId;

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

            // ❗ fallback (очень важно)
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