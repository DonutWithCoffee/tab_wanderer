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
    chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
            log('WARN', 'SEND', 'retry...', chrome.runtime.lastError.message);

            if (retries > 0) {
                setTimeout(() => sendWithRetry(payload, retries - 1), 1000);
            } else {
                log('ERROR', 'SEND', 'failed after retries');
            }

            return;
        }

        if (response?.ignored) {
            log('DEBUG', 'SEND', 'message ignored by background', payload.type);
        }
    });
}

// ---------- HELPERS ----------
function extractPrimaryDate(text) {
    const raw = String(text || '');
    const firstLine = raw.split('\n')[0] || '';

    return firstLine.trim();
}

function extractShipmentDate(text) {
    const raw = String(text || '');
    const lines = raw.split('\n').map(line => line.trim());

    for (const line of lines) {
        if (line.startsWith('Отгр')) {
            return line;
        }
    }

    return '';
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
        if (text.includes('контрагент')) map.contractor = index;
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

    rows.forEach((r) => {
        const internalId = r.getAttribute('data-order-id');
        if (!internalId) return;

        const cells = r.querySelectorAll('td');
        const link = r.querySelector('a[href*="/admin/orders/"]');

        let displayId = link?.innerText?.trim();
        if (!displayId) displayId = internalId;
        if (!displayId) return;

        const rawHref = link?.getAttribute('href') || '';
        const orderUrl = rawHref
            ? new URL(rawHref, window.location.origin).toString()
            : '';

        const status = cells[map.status]?.innerText?.trim() || '';
        const delivery = cells[map.delivery]?.innerText?.trim() || '';
        const payment = cells[map.payment]?.innerText?.trim() || '';
        const date = map.date !== undefined
            ? extractPrimaryDate(cells[map.date]?.innerText || '')
            : '';
        const contractor = map.contractor !== undefined
            ? (cells[map.contractor]?.innerText?.trim() || '')
            : '';

        const shipmentDateText = map.date !== undefined
            ? extractShipmentDate(cells[map.date]?.innerText || '')
            : '';

        const hasOrderFlag = !!r.querySelector('.fa-flag');
        const hasAutoreserve = !!r.querySelector('.fa-lock');

        const tags = Array.from(r.querySelectorAll('.label, .badge'))
            .map(el => el.innerText.trim())
            .filter(Boolean);

        result.push({
            id: displayId,
            internalId,
            status,
            delivery,
            payment,
            date,
            contractor,
            orderUrl,
            shipmentDateText,
            hasOrderFlag,
            hasAutoreserve,
            tags
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
function startWorkerLoop() {
    if (reloadTimer) {
        log('DEBUG', 'START', 'worker loop already active');
        return;
    }

    log('INFO', 'START', 'worker active');

    sendOrders();

    reloadTimer = setInterval(() => {
        log('DEBUG', 'RELOAD', 'refresh page');
        location.reload();
    }, 15000);
}

function stopWorkerLoop() {
    if (!reloadTimer) return;

    clearInterval(reloadTimer);
    reloadTimer = null;

    log('INFO', 'STOP', 'worker stopped');
}

// ---------- INIT ----------
function init() {
    chrome.runtime.sendMessage({ type: 'CHECK_WORKER' }, (res) => {
        if (chrome.runtime.lastError) {
            log('ERROR', 'INIT', chrome.runtime.lastError.message);
            return;
        }

        if (!res?.isWorker) {
            log('DEBUG', 'INIT', 'not worker, idle mode');
            stopWorkerLoop();
            return;
        }

        if (!res?.isRunning) {
            log('DEBUG', 'INIT', 'worker assigned but stopped');
            stopWorkerLoop();
            return;
        }

        startWorkerLoop();
    });
}

init();