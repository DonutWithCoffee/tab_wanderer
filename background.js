let ordersDB = {};
let ordersHashDB = {};
let workerTabId = null;
let lastBaselineDate = null;

const TARGET_URL = 'https://amperkot.ru/admin/orders/';

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

// ---------- STORAGE DEBUG ----------
function logState(scope = 'STATE') {
    const ids = Object.keys(ordersDB);
    const lastIds = ids.slice(-5);

    log('DEBUG', scope, {
        totalOrders: ids.length,
        totalHashes: Object.keys(ordersHashDB).length,
        lastOrders: lastIds,
        lastBaselineDate
    });
}

// ---------- NORMALIZE ----------
function normalize(v) {
    return (v || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------- HASH ----------
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

// ---------- WORKER TAB ----------
async function ensureWorkerTab() {
    if (workerTabId) {
        try {
            const tab = await chrome.tabs.get(workerTabId);
            if (tab) return;
        } catch {
            log('WARN', 'WORKER', 'missing → recreating');
        }
    }

    const tab = await chrome.tabs.create({
        url: TARGET_URL,
        active: false,
        pinned: true
    });

    workerTabId = tab.id;

    log('INFO', 'WORKER', `created id=${workerTabId}`);
    save();
}

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === workerTabId) {
        log('WARN', 'WORKER', 'closed → recreating');
        workerTabId = null;
        ensureWorkerTab();
    }
});

// ---------- STORAGE ----------
async function load() {
    const d = await chrome.storage.local.get([
        'ordersDB',
        'ordersHashDB',
        'lastBaselineDate',
        'workerTabId'
    ]);

    ordersDB = d.ordersDB || {};
    ordersHashDB = d.ordersHashDB || {};
    lastBaselineDate = d.lastBaselineDate || null;
    workerTabId = d.workerTabId || null;

    log('INFO', 'INIT', 'state loaded');
    logState('LOAD');

    ensureWorkerTab();
}

async function save() {
    await chrome.storage.local.set({
        ordersDB,
        ordersHashDB,
        lastBaselineDate,
        workerTabId
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

        // ignore пустых оплат
        if (!o.payment || o.payment === '–') {
            log('DEBUG', 'SKIP', 'empty payment', o.id);
            continue;
        }

        const newHash = getHash(o);
        const prevHash = ordersHashDB[o.id];

        if (newHash === prevHash) {
            log('DEBUG', 'HASH', `skip id=${o.id}`);
            continue;
        }

        log('INFO', 'CHANGE', {
            id: o.id,
            prev: prevHash,
            next: newHash
        });

        // 🔥 уведомления теперь всегда есть
        notifyOrder(o);

        // ❗ но DB не трогаем в тестах
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

// ---------- MESSAGES ----------
chrome.runtime.onMessage.addListener((msg, sender, send) => {

    const senderTabId = sender?.tab?.id;

    if (msg.type === 'CHECK_WORKER') {
        send({ isWorker: senderTabId === workerTabId });
        return true;
    }

    if (msg.type === 'MANUAL_BASELINE') {
        runBaseline(msg.data, 'manual');
        send({ ok: true });
        return true;
    }

    if (msg.type === 'RESET_BASELINE') {

        ordersDB = {};
        ordersHashDB = {};
        lastBaselineDate = null;

        log('WARN', 'BASELINE', 'manual reset');
        logState('RESET');

        save();

        send({ ok: true });
        return true;
    }

    if (msg.type === 'ORDERS') {

        const isTest = msg.isTest === true;

        if (!isTest && senderTabId !== workerTabId) {
            log('DEBUG', 'FILTER', 'not worker tab');
            send({ ignored: true });
            return true;
        }

        if (isTest) {
            processOrders(msg.data, { testMode: true });
            send({ ok: true });
            return true;
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
        return true;
    }

    return false;
});

// ---------- INIT ----------
load();
log('INFO', 'VERSION', chrome.runtime.getManifest().version);