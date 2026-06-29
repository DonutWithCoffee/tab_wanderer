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
let lastSentPage = null;
let runtimeMessagingDisabled = false;

function isExtensionContextInvalidatedError(error) {
    return String(error?.message || error || '')
        .toLowerCase()
        .includes('extension context invalidated');
}

function handleRuntimeMessagingError(scope, error) {
    if (!isExtensionContextInvalidatedError(error)) {
        return false;
    }

    runtimeMessagingDisabled = true;
    stopWorkerLoop();
    log('DEBUG', scope, 'extension context invalidated, stopping content worker');

    return true;
}

function getRuntimeLastError() {
    try {
        return chrome.runtime.lastError || null;
    } catch (error) {
        return error;
    }
}

function sendRuntimeMessage(payload, callback, scope = 'SEND') {
    if (runtimeMessagingDisabled) {
        log('DEBUG', scope, 'runtime messaging disabled, skip', payload?.type);
        return false;
    }

    try {
        chrome.runtime.sendMessage(payload, callback);
        return true;
    } catch (error) {
        if (handleRuntimeMessagingError(scope, error)) {
            return false;
        }

        throw error;
    }
}

// ---------- RETRY SEND ----------
function sendWithRetry(payload, retries = 3) {
    sendRuntimeMessage(payload, (response) => {
        const runtimeError = getRuntimeLastError();

        if (runtimeError) {
            if (handleRuntimeMessagingError('SEND', runtimeError)) {
                return;
            }

            log('WARN', 'SEND', 'retry...', runtimeError.message);

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
// ---------- HELPERS ----------
function normalizeCellText(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractPrimaryDate(text) {
    const raw = String(text || '');
    const firstLine = raw.split('\n')[0] || '';

    return normalizeCellText(firstLine);
}

function extractPrimaryDateFromCell(cell) {
    const dateLink = cell?.querySelector?.('a[href*="/admin/orders/"]');
    const dateFromLink = normalizeCellText(dateLink?.innerText || '');

    if (dateFromLink) {
        return dateFromLink;
    }

    return extractPrimaryDate(cell?.innerText || '');
}

function normalizePhone(text) {
    const digits = String(text || '').replace(/\D/g, '');

    if (digits.length === 11 && digits.startsWith('8')) {
        return `7${digits.slice(1)}`;
    }

    if (digits.length === 10) {
        return `7${digits}`;
    }

    return digits;
}

function parseIntegerValue(text) {
    const digits = String(text || '').replace(/\D/g, '');

    return digits ? Number(digits) : null;
}

function parseProductsProgress(text) {
    const match = String(text || '').match(/(\d+)\s*\/\s*(\d+)/);

    if (!match) {
        return {
            productsDone: null,
            productsTotal: null
        };
    }

    return {
        productsDone: Number(match[1]),
        productsTotal: Number(match[2])
    };
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
        if (text.includes('телефон')) map.phone = index;
        if (text.includes('товаров')) map.products = index;
        if (text.includes('сумма')) map.totalAmount = index;
        if (text.includes('менеджер')) map.manager = index;
        if (text.includes('город')) map.city = index;
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
    if (!map) return null;

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
            ? extractPrimaryDateFromCell(cells[map.date])
            : '';
        const phoneNormalized = map.phone !== undefined
            ? normalizePhone(cells[map.phone]?.innerText || '')
            : '';
        const totalAmount = map.totalAmount !== undefined
            ? parseIntegerValue(cells[map.totalAmount]?.innerText || '')
            : null;
        const productsProgress = map.products !== undefined
            ? parseProductsProgress(cells[map.products]?.innerText || '')
            : { productsDone: null, productsTotal: null };
        const manager = map.manager !== undefined
            ? (cells[map.manager]?.innerText?.trim() || '')
            : '';
        const city = map.city !== undefined
            ? (cells[map.city]?.innerText?.trim() || '')
            : '';
        const contractor = map.contractor !== undefined
            ? (cells[map.contractor]?.innerText?.trim() || '')
            : '';

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
            phoneNormalized,
            totalAmount,
            productsDone: productsProgress.productsDone,
            productsTotal: productsProgress.productsTotal,
            manager,
            city,
            contractor,
            orderUrl,
            hasAutoreserve,
            tags
        });
    });

    log('INFO', 'PARSE', `orders=${result.length}`);
    return result;
}

function isTableReady() {
    const rows = document.querySelectorAll('tr[data-order-id]');
    return rows.length > 0;
}

function parseDictionaries() {
    function extract(name) {
        const inputs = document.querySelectorAll(`input[type="checkbox"][name="${name}"]`);
        const result = [];

        inputs.forEach((input) => {
            const id = input.value;
            if (!id) return;

            const label =
                input.closest('label')?.querySelector('.form-check-label')?.innerText?.trim()
                || input.closest('label')?.innerText?.trim()
                || '';

            if (!label) return;

            result.push({ id, label });
        });

        return result;
    }

    const dictionaries = {
        status: extract('status[]'),
        delivery: extract('delivery[]'),
        payment: extract('payment[]'),
        orderFlags: extract('flag[]'),
        store: extract('store[]'),
        reserve: extract('reserve[]'),
        assemblyStatus: extract('assembly_status[]')
    };

    log('INFO', 'DICT', 'parsed', {
        status: dictionaries.status.length,
        delivery: dictionaries.delivery.length,
        payment: dictionaries.payment.length,
        orderFlags: dictionaries.orderFlags.length,
        store: dictionaries.store.length,
        reserve: dictionaries.reserve.length,
        assemblyStatus: dictionaries.assemblyStatus.length
    });

    return dictionaries;
}

function sendDictionaries() {
    const dictionaries = parseDictionaries();

    sendWithRetry({
        type: 'DICTIONARIES',
        data: dictionaries
    });
}

// ---------- SEND ----------
function parsePaginationState(currentPage = getCurrentPageFromUrl()) {
    const page = Number.isInteger(Number(currentPage)) && Number(currentPage) > 0
        ? Number(currentPage)
        : 1;
    const pageNumbers = [];

    const links = Array.from(document.querySelectorAll('a[href*="page="]') || []);

    links.forEach((link) => {
        const href = link?.getAttribute?.('href') || '';

        if (!href) return;

        try {
            const url = new URL(href, window.location.origin);
            const rawPage = Number(url.searchParams.get('page'));

            if (Number.isInteger(rawPage) && rawPage > 0) {
                pageNumbers.push(rawPage);
            }
        } catch {}
    });

    const uniquePageNumbers = Array.from(new Set(pageNumbers)).sort((a, b) => a - b);
    const maxPage = uniquePageNumbers.length
        ? Math.max(page, ...uniquePageNumbers)
        : page;
    const hasNextPage = uniquePageNumbers.some((value) => value > page);

    return {
        currentPage: page,
        hasPagination: uniquePageNumbers.length > 0,
        maxPage,
        hasNextPage,
        isLastPage: !hasNextPage
    };
}

function getOrdersCompletionMeta(orders, paginationState = parsePaginationState()) {
    const safeOrders = Array.isArray(orders) ? orders : [];
    const safePaginationState = paginationState || parsePaginationState();
    const currentPage = Number(safePaginationState.currentPage) || 1;

    if (safeOrders.length === 0 && currentPage === 1) {
        return {
            isComplete: true,
            completionReason: 'empty-first-page'
        };
    }

    if (!safePaginationState.hasNextPage) {
        return {
            isComplete: true,
            completionReason: safePaginationState.hasPagination
                ? 'pagination-last-page'
                : 'pagination-single-page'
        };
    }

    return {
        isComplete: false,
        completionReason: null
    };
}

function sendOrders() {
    const page = getCurrentPageFromUrl();

    if (lastSentPage === page) {
        log('DEBUG', 'SEND', 'duplicate page skip', page);
        return;
    }

    const orders = parseOrders();

    if (!orders) {
        log('WARN', 'PARSE', 'invalid parse, skip send');
        return;
    }

    const paginationState = parsePaginationState(page);
    const completion = getOrdersCompletionMeta(orders, paginationState);

    lastSentPage = page;

    sendWithRetry({
        type: 'ORDERS',
        page,
        isComplete: completion.isComplete,
        completionReason: completion.completionReason,
        pagination: paginationState,
        data: orders
    });
}


function getOrderIdFromLocation() {
    try {
        const url = new URL(window.location.href);
        const match = url.pathname.match(/\/admin\/orders\/([^/]+)\/?$/);

        return match ? normalizeCellText(match[1]) : '';
    } catch {
        return '';
    }
}

function getPageTextLines() {
    const text = document.body?.innerText || '';

    return String(text)
        .split(/\r?\n/)
        .map(normalizeCellText)
        .filter(Boolean);
}

function normalizeLabelText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[:：]/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const ORDER_DETAILS_SECTION_TITLES = [
    'Информация о заказе',
    'Данные заказа',
    'Доставка',
    'Оплата',
    'Заметки',
    'Действия'
].map(normalizeLabelText);

function lineMatchesAnyLabel(line, labels = []) {
    const normalizedLine = normalizeLabelText(line);
    const normalizedLabels = labels.map(normalizeLabelText).filter(Boolean);

    return normalizedLabels.some(label => {
        if (normalizedLine === label) return true;
        if (normalizedLine.startsWith(`${label} `)) return true;

        const colonMatch = String(line || '').match(/^([^:：]+)[:：]\s*(.+)$/);

        return !!colonMatch && normalizeLabelText(colonMatch[1]) === label;
    });
}

function findOrderDetailsSectionLines(sectionTitle, expectedLabels = []) {
    const lines = getPageTextLines();
    const normalizedTitle = normalizeLabelText(sectionTitle);
    const normalizedExpectedLabels = expectedLabels.map(normalizeLabelText).filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
        if (normalizeLabelText(lines[index]) !== normalizedTitle) {
            continue;
        }

        let end = lines.length;

        for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
            const normalizedLine = normalizeLabelText(lines[nextIndex]);

            if (
                ORDER_DETAILS_SECTION_TITLES.includes(normalizedLine)
                && normalizedLine !== normalizedTitle
            ) {
                end = nextIndex;
                break;
            }
        }

        const sectionLines = lines.slice(index + 1, end);
        const hasExpectedLabel = !normalizedExpectedLabels.length
            || sectionLines.some(line => lineMatchesAnyLabel(line, normalizedExpectedLabels));

        if (!hasExpectedLabel) {
            continue;
        }

        return sectionLines;
    }

    return [];
}

function findDetailValueByLabels(labels = [], sourceLines = null) {
    const normalizedLabels = labels.map(normalizeLabelText).filter(Boolean);
    const lines = Array.isArray(sourceLines) ? sourceLines : getPageTextLines();

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const normalizedLine = normalizeLabelText(line);

        for (const label of normalizedLabels) {
            if (normalizedLine === label) {
                return lines[index + 1] || '';
            }

            if (normalizedLine.startsWith(`${label} `)) {
                return line.slice(label.length).replace(/^\s*[:：-]?\s*/, '').trim();
            }

            const colonMatch = line.match(/^([^:：]+)[:：]\s*(.+)$/);

            if (colonMatch && normalizeLabelText(colonMatch[1]) === label) {
                return normalizeCellText(colonMatch[2]);
            }
        }
    }

    return '';
}

function findDetailValueByLabelPriority(labels = [], sourceLines = null) {
    for (const label of labels) {
        const value = findDetailValueByLabels([label], sourceLines);

        if (value) {
            return value;
        }
    }

    return '';
}

function findSectionDetailValue(sectionTitle, labels = [], expectedLabels = labels) {
    const sectionLines = findOrderDetailsSectionLines(sectionTitle, expectedLabels);

    if (!sectionLines.length) {
        return '';
    }

    return findDetailValueByLabels(labels, sectionLines);
}

function findOrderTagValues() {
    const infoLines = findOrderDetailsSectionLines('Информация о заказе', ['Теги']);

    if (!infoLines.length) {
        return Array.from(document.querySelectorAll('.label, .badge') || [])
            .map(el => normalizeCellText(el.innerText || ''))
            .filter(Boolean)
            .filter(value => normalizeLabelText(value) !== 'ндс 5%');
    }

    const result = [];

    for (let index = 0; index < infoLines.length; index += 1) {
        if (normalizeLabelText(infoLines[index]) !== 'теги') {
            continue;
        }

        for (let nextIndex = index + 1; nextIndex < infoLines.length; nextIndex += 1) {
            const value = normalizeCellText(infoLines[nextIndex]);
            const normalizedValue = normalizeLabelText(value);

            if (!value || normalizedValue === 'действия') {
                break;
            }

            result.push(value);
        }

        break;
    }

    return Array.from(new Set(result));
}

function parseOrderDetails(expectedOrderId = '') {
    const id = normalizeCellText(expectedOrderId || getOrderIdFromLocation());

    if (!id) {
        return null;
    }

    const rawUrl = (() => {
        try {
            const url = new URL(window.location.href);
            url.hash = '';
            return url.toString();
        } catch {
            return '';
        }
    })();

    const totalAmountText = findDetailValueByLabelPriority(['Итог', 'Сумма заказа', 'Сумма']);
    const productsText = findDetailValueByLabelPriority(['Подытог', 'Товаров', 'Товары', 'Состав заказа']);
    const productsProgress = parseProductsProgress(productsText);

    const tags = findOrderTagValues();

    return {
        id,
        internalId: id,
        status: findSectionDetailValue('Информация о заказе', ['Статус заказа', 'Статус'])
            || findDetailValueByLabels(['Статус заказа', 'Статус']),
        delivery: findSectionDetailValue('Доставка', ['Способ доставки'], ['Способ доставки'])
            || findDetailValueByLabels(['Способ доставки', 'Доставка']),
        payment: findSectionDetailValue('Оплата', ['Способ оплаты'], ['Способ оплаты'])
            || findDetailValueByLabels(['Способ оплаты', 'Оплата']),
        date: findSectionDetailValue('Информация о заказе', ['Время оформления', 'Дата заказа', 'Создан', 'Дата'])
            || findDetailValueByLabels(['Дата заказа', 'Создан', 'Дата']),
        phoneNormalized: normalizePhone(
            findSectionDetailValue('Данные заказа', ['Телефон', 'Телефон клиента'], ['Телефон'])
                || findDetailValueByLabels(['Телефон', 'Телефон клиента'])
        ),
        totalAmount: parseIntegerValue(totalAmountText),
        productsDone: productsProgress.productsDone,
        productsTotal: productsProgress.productsTotal,
        manager: findSectionDetailValue('Информация о заказе', ['Ответственный менеджер', 'Менеджер'])
            || findDetailValueByLabels(['Ответственный менеджер', 'Менеджер']),
        city: findSectionDetailValue('Данные заказа', ['Город'], ['Город'])
            || findDetailValueByLabels(['Город']),
        contractor: findSectionDetailValue('Данные заказа', ['Клиент', 'Контрагент', 'Юридическое лицо'], ['Клиент'])
            || findDetailValueByLabels(['Контрагент', 'Юридическое лицо']),
        orderUrl: rawUrl,
        hasAutoreserve: !!document.querySelector('.fa-lock'),
        tags
    };
}

function sendDirectOrder(expectedOrderId = '') {
    const order = parseOrderDetails(expectedOrderId);
    const orderId = expectedOrderId || order?.id || getOrderIdFromLocation();

    sendWithRetry({
        type: 'DIRECT_ORDER',
        orderId,
        data: order,
        error: order ? null : 'direct order parse failed'
    });
}

function initDirectWorker() {
    sendRuntimeMessage({ type: 'CHECK_DIRECT_WORKER' }, (res) => {
        const runtimeError = getRuntimeLastError();

        if (runtimeError) {
            if (!handleRuntimeMessagingError('DIRECT', runtimeError)) {
                log('ERROR', 'DIRECT', runtimeError.message);
            }

            return;
        }

        if (!res?.isDirectWorker || !res?.isRunning) {
            log('DEBUG', 'DIRECT', 'not direct worker');
            return;
        }

        log('INFO', 'DIRECT', 'direct worker active', res.orderId || '');
        sendDirectOrder(res.orderId || '');
    }, 'DIRECT');
}

// ---------- CONTROL ----------
function startWorkerLoop() {
    if (reloadTimer) {
        log('DEBUG', 'START', 'worker loop already active');
        return;
    }

    log('INFO', 'START', 'worker active');

        sendDictionaries();
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
    lastSentPage = null;

    log('INFO', 'STOP', 'worker stopped');
}

// ---------- INIT ----------
function init() {
    sendRuntimeMessage({ type: 'CHECK_WORKER' }, (res) => {
        const runtimeError = getRuntimeLastError();

        if (runtimeError) {
            if (!handleRuntimeMessagingError('INIT', runtimeError)) {
                log('ERROR', 'INIT', runtimeError.message);
            }

            return;
        }

        if (!res?.isWorker) {
            log('DEBUG', 'INIT', 'not list worker, checking direct role');
            stopWorkerLoop();
            initDirectWorker();
            return;
        }

        if (!res?.isRunning) {
            log('DEBUG', 'INIT', 'worker assigned but stopped');
            stopWorkerLoop();
            return;
        }

        startWorkerLoop();
    }, 'INIT');
}

function getCurrentPageFromUrl() {
    try {
        const url = new URL(window.location.href);
        const raw = url.searchParams.get('page');
        const page = Number(raw);

        return Number.isInteger(page) && page > 0 ? page : 1;
    } catch {
        return 1;
    }
}

init();