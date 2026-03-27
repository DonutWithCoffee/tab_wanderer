importScripts('version.js');

let ordersDB = {};
let ordersHashDB = {};
let workerTabId = null;
let lastBaselineDate = null;
let isRunning = false;

let lastPing = Date.now();

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

// ---------- INIT ----------
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

// ---------- CLEANUP ----------
async function cleanupOldWorkers() {
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
        if (!tab.url) continue;

        if (tab.url.includes(WORKER_MARK) && tab.id !== workerTabId) {
            try {
                await chrome.tabs.remove(tab.id);
                log('INFO', 'CLEANUP', `removed old worker ${tab.id}`);
            } catch {
                log('WARN', 'CLEANUP', 'failed', tab.id);
            }
        }
    }
}

// ---------- WORKER ----------
async function ensureWorkerTab() {

    if (!isRunning) return;

    const windows = await chrome.windows.getAll();

    if (!windows || windows.length === 0) {
        log('WARN', 'WORKER', 'no window, retry later');
        setTimeout(ensureWorkerTab, 3000);
        return;
    }

    if (workerTabId) {
        try {
            const tab = await chrome.tabs.get(workerTabId);
            if (tab) return;
        } catch {
            workerTabId = null;
        }
    }

    const tab = await chrome.tabs.create({
        url: TARGET_URL + WORKER_MARK,
        active: false
    });

    await chrome.tabs.update(tab.id, { pinned: true });

    workerTabId = tab.id;

    log('INFO', 'WORKER', `created id=${workerTabId}`);

    save();
}

// если вкладку закрыли
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === workerTabId) {
        workerTabId = null;

        if (isRunning) {
            ensureWorkerTab();
        }
    }
});

// ---------- STORAGE ----------
async function load() {
    const d = await chrome.storage.local.get([
        'ordersDB',
        'ordersHashDB',
        'lastBaselineDate',
        'workerTabId',
        'isRunning'
    ]);

    ordersDB = d.ordersDB || {};
    ordersHashDB = d.ordersHashDB || {};
    lastBaselineDate = d.lastBaselineDate || null;
    workerTabId = d.workerTabId || null;
    isRunning = d.isRunning || false;

    if (!isRunning) {
        workerTabId = null;
    }

    log('INFO', 'INIT', 'state loaded');
    logState('LOAD');

    if (isRunning) {
        await cleanupOldWorkers();
        ensureWorkerTab();
    }
}

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

        if (newHash === prevHash) {
            continue;
        }

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

// ---------- AUTO BASELINE ----------
function shouldRunAutoBaseline() {
    const now = new Date();
    if (lastBaselineDate === todayKey()) return false;
    return now.getHours() >= 9;
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

        const senderTabId = sender?.tab?.id;
        const tab = sender?.tab;

        if (msg.type === 'CHECK_WORKER') {

            const isSameTab = senderTabId === workerTabId;

            if (isSameTab) {
                send({ isWorker: true, isRunning });
                return;
            }

            const isCorrectUrl = tab?.url?.startsWith(TARGET_URL);

            if (isCorrectUrl && (!workerTabId || senderTabId === workerTabId)) {
                workerTabId = senderTabId;

                log('WARN', 'WORKER', 'rebind');

                save();

                send({ isWorker: true, isRunning });
                return;
            }

            send({ isWorker: false, isRunning });
            return;
        }

        if (msg.type === 'START') {
            isRunning = true;

            log('INFO', 'CONTROL', 'START');

            const oldTabId = workerTabId;
            workerTabId = null;

            if (oldTabId) {
                try {
                    await chrome.tabs.remove(oldTabId);
                } catch {
                    log('WARN', 'WORKER', 'remove failed');
                }
            }

            await cleanupOldWorkers();
            await ensureWorkerTab();

            save();

            send({ ok: true });
            return;
        }

        if (msg.type === 'STOP') {
            isRunning = false;

            log('INFO', 'CONTROL', 'STOP');

            if (workerTabId) {
                try {
                    await chrome.tabs.remove(workerTabId);
                } catch {
                    log('WARN', 'WORKER', 'failed to remove on stop');
                }
            }

            workerTabId = null;

            save();

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
            } else if (!lastBaselineDate && shouldRunAutoBaseline()) {
                runBaseline(msg.data, 'auto');
            } else if (!lastBaselineDate) {
                runBaseline(msg.data, 'first');
            } else {
                processOrders(msg.data);
            }

            send({ ok: true });
            return;
        }

    })();

    return true;
});

// ---------- INIT ----------
load();