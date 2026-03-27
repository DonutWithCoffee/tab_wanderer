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
    console.log(`[CONTENT][${level}][${scope}]`, ...args);
}

let reloadTimer = null;

// ---------- RETRY SEND ----------
function sendWithRetry(payload, retries = 3) {
    chrome.runtime.sendMessage(payload, () => {
        if (chrome.runtime.lastError) {
            log('WARN', 'SEND', 'retry...', chrome.runtime.lastError.message);

            if (retries > 0) {
                setTimeout(() => sendWithRetry(payload, retries - 1), 1000);
            } else {
                log('ERROR', 'SEND', 'failed after retries');
            }
        }
    });
}

// ---------- COLUMN MAP ----------
function getColumnMap() {
    const headers = document.querySelectorAll('thead th');
    const map = {};

    headers.forEach((th, index) => {
        const text = th.innerText.trim().toLowerCase();

        if (text.includes('статус')) map.status = index;
        if (text.includes('доставка')) map.delivery = index;
        if (text.includes('оплата')) map.payment = index;
        if (text.includes('дата')) map.date = index;
    });

    if (
        map.status === undefined ||
        map.delivery === undefined ||
        map.payment === undefined
    ) {
        log('ERROR', 'MAP', 'columns not found', map);
        return null;
    }

    return map;
}

// ---------- PARSE ----------
function parseOrders() {

    const map = getColumnMap();
    if (!map) return [];

    const rows = document.querySelectorAll('tr[data-order-id]');
    const result = [];

    rows.forEach(r => {

        const internalId = r.getAttribute('data-order-id');
        if (!internalId) return;

        const cells = r.querySelectorAll('td');

        // ссылка заказа
        const link = r.querySelector('a[href*="/admin/orders/"]');

        let displayId = link?.innerText?.trim();

        // fallback
        if (!displayId) {
            displayId = internalId;
        }

        // защита
        if (!displayId) return;

        const status = cells[map.status]?.innerText?.trim() || '';
        const delivery = cells[map.delivery]?.innerText?.trim() || '';
        const payment = cells[map.payment]?.innerText?.trim() || '';
        const date = cells[map.date]?.innerText?.trim() || '';

        result.push({
            id: displayId,
            status,
            delivery,
            payment,
            date
        });
    });

    log('INFO', 'PARSE', `orders=${result.length}`);

    return result;
}

// ---------- SEND ----------
function sendOrders() {
    const orders = parseOrders();

    if (!orders.length) return;

    sendWithRetry({
        type: 'ORDERS',
        data: orders
    });
}

// ---------- CONTROL ----------
function start() {

    if (reloadTimer) return;

    log('INFO', 'START', 'worker active');

    sendOrders();

    reloadTimer = setInterval(() => {
        log('DEBUG', 'RELOAD', 'refresh page');
        location.reload();
    }, 15000);
}

function stop() {
    if (!reloadTimer) return;

    clearInterval(reloadTimer);
    reloadTimer = null;

    log('INFO', 'STOP', 'worker stopped');
}

// ---------- INIT ----------
let initRetries = 0;
const MAX_INIT_RETRIES = 5;

chrome.runtime.sendMessage({ type: 'CHECK_WORKER' }, (res) => {

    if (!res?.isWorker) {

        if (initRetries >= MAX_INIT_RETRIES) {
            log('ERROR', 'INIT', 'failed to become worker, stopping');
            return;
        }

        initRetries++;

        log('DEBUG', 'INIT', `not worker, retry ${initRetries}`);

        setTimeout(() => {
            location.reload();
        }, 2000);

        return;
    }

    // ✅ если worker — запускаемся
    start();
});