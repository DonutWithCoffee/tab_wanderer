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

// Diagnostic-only logger. It must never be allowed to interrupt the Warehouse
// or Ozon initialization paths when diagnostics are removed/disabled.
function cityDebug(event, data = {}) {
    try {
        console.info('[TW][CITY]', new Date().toISOString(), event, data);
    } catch {}
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

function stripDynamicOrderText(text) {
    return normalizeCellText(text)
        .replace(/\s*\(?\s*местное\s+время\s*:\s*[^)]*\)?/giu, '')
        .replace(/\s*\(?\s*обновлено\s+[^)]*\)?/giu, '')
        .replace(/\s*\(?\s*\d+\s*(?:секунд[уы]?|сек\.?|минут[уы]?|мин\.?|час(?:а|ов)?)\s+назад\s*\)?/giu, '')
        .trim();
}

function normalizeOrderFieldText(fieldName, value) {
    const normalized = normalizeCellText(value);

    if (['city', 'manager', 'contractor', 'delivery', 'payment', 'status'].includes(fieldName)) {
        return stripDynamicOrderText(normalized);
    }

    return normalized;
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




function normalizeAmperkotOrderId(value) {
    const normalized = String(value || '').trim();
    return /^\d{1,10}-\d{6}$/.test(normalized) ? normalized : '';
}

function buildCanonicalAmperkotOrderUrl(orderId) {
    const normalizedId = normalizeAmperkotOrderId(orderId);
    return normalizedId ? `https://amperkot.ru/admin/orders/${normalizedId}/` : '';
}

function normalizeAmperkotOrderUrl(value, fallbackOrderId = '') {
    try {
        const url = new URL(String(value || ''), 'https://amperkot.ru');
        const match = url.pathname.match(/^\/admin\/orders\/(\d{1,10}-\d{6})\/?$/);

        if (url.protocol !== 'https:' || url.hostname !== 'amperkot.ru' || !match) {
            return buildCanonicalAmperkotOrderUrl(fallbackOrderId);
        }

        return buildCanonicalAmperkotOrderUrl(match[1]);
    } catch {
        return buildCanonicalAmperkotOrderUrl(fallbackOrderId);
    }
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
        displayId = normalizeAmperkotOrderId(displayId);
        if (!displayId) return;

        const rawHref = link?.getAttribute('href') || '';
        const orderUrl = normalizeAmperkotOrderUrl(rawHref, displayId);

        const status = normalizeOrderFieldText('status', cells[map.status]?.innerText || '');
        const delivery = normalizeOrderFieldText('delivery', cells[map.delivery]?.innerText || '');
        const payment = normalizeOrderFieldText('payment', cells[map.payment]?.innerText || '');
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
            ? normalizeOrderFieldText('manager', cells[map.manager]?.innerText || '')
            : '';
        const city = map.city !== undefined
            ? normalizeOrderFieldText('city', cells[map.city]?.innerText || '')
            : '';
        const contractor = map.contractor !== undefined
            ? normalizeOrderFieldText('contractor', cells[map.contractor]?.innerText || '')
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

function normalizeDetailValue(fieldName, value) {
    return normalizeOrderFieldText(fieldName, value);
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

function hasMeaningfulOrderDetails(order = {}) {
    return Boolean(
        order.status
        || order.delivery
        || order.payment
        || order.date
        || order.phoneNormalized
        || order.totalAmount
        || order.productsTotal
        || order.manager
        || order.city
        || order.contractor
    );
}

function parseOrderDetails(expectedOrderId = '') {
    const expectedId = normalizeAmperkotOrderId(expectedOrderId);
    const locationId = normalizeAmperkotOrderId(getOrderIdFromLocation());
    const id = expectedId || locationId;

    if (!id) {
        return null;
    }

    if (expectedId && locationId !== expectedId) {
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

    const order = {
        id,
        internalId: id,
        status: normalizeDetailValue(
            'status',
            findSectionDetailValue('Информация о заказе', ['Статус заказа', 'Статус'])
                || findDetailValueByLabels(['Статус заказа', 'Статус'])
        ),
        delivery: normalizeDetailValue(
            'delivery',
            findSectionDetailValue('Доставка', ['Способ доставки'], ['Способ доставки'])
                || findDetailValueByLabels(['Способ доставки', 'Доставка'])
        ),
        payment: normalizeDetailValue(
            'payment',
            findSectionDetailValue('Оплата', ['Способ оплаты'], ['Способ оплаты'])
                || findDetailValueByLabels(['Способ оплаты', 'Оплата'])
        ),
        date: findSectionDetailValue('Информация о заказе', ['Время оформления', 'Дата заказа', 'Создан', 'Дата'])
            || findDetailValueByLabels(['Дата заказа', 'Создан', 'Дата']),
        phoneNormalized: normalizePhone(
            findSectionDetailValue('Данные заказа', ['Телефон', 'Телефон клиента'], ['Телефон'])
                || findDetailValueByLabels(['Телефон', 'Телефон клиента'])
        ),
        totalAmount: parseIntegerValue(totalAmountText),
        productsDone: productsProgress.productsDone,
        productsTotal: productsProgress.productsTotal,
        manager: normalizeDetailValue(
            'manager',
            findSectionDetailValue('Информация о заказе', ['Ответственный менеджер', 'Менеджер'])
                || findDetailValueByLabels(['Ответственный менеджер', 'Менеджер'])
        ),
        city: normalizeDetailValue(
            'city',
            findSectionDetailValue('Данные заказа', ['Город'], ['Город'])
                || findDetailValueByLabels(['Город'])
        ),
        contractor: normalizeDetailValue(
            'contractor',
            findSectionDetailValue('Данные заказа', ['Клиент', 'Контрагент', 'Юридическое лицо'], ['Клиент'])
                || findDetailValueByLabels(['Контрагент', 'Юридическое лицо'])
        ),
        orderUrl: normalizeAmperkotOrderUrl(rawUrl, id),
        hasAutoreserve: !!document.querySelector('.fa-lock'),
        tags
    };

    return hasMeaningfulOrderDetails(order) ? order : null;
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



// ---------- ORDER KIND OBSERVATION ----------
const ORDER_KIND_REPORT_RETRY_DELAYS_MS = [0, 500, 1500, 3000];
let orderKindObservationObserver = null;
let orderKindObservationTimers = [];
let lastOrderKindObservationSignature = '';
let lastAcceptedOrderKindObservationSignature = '';
let confirmedOrderKindObservation = false;
let orderKindObservationInFlight = false;

function isAmperkotOrderDetailsPageUrl(href = window.location.href) {
    try {
        const url = new URL(href);
        return url.protocol === 'https:'
            && url.hostname === 'amperkot.ru'
            && /^\/admin\/orders\/\d{4}-\d{6}\/?$/.test(url.pathname);
    } catch {
        return false;
    }
}

function getOrderDetailsLinks() {
    return Array.from(document.querySelectorAll?.('a[href]') || []);
}

function getOrderDetailsLinkUrl(link) {
    const raw = link?.getAttribute?.('href') || link?.href || '';
    try {
        return new URL(String(raw || ''), 'https://amperkot.ru').toString();
    } catch {
        return '';
    }
}

function findOrderOzonShipActionUrl(orderId) {
    const normalizedId = normalizeAmperkotOrderId(orderId);
    if (!normalizedId) {
        return '';
    }

    const pattern = new RegExp(`^/admin/_api/shop-orders/${normalizedId}/ozon/\\d+/posting/fbs/ship/?$`);

    for (const link of getOrderDetailsLinks()) {
        const urlText = getOrderDetailsLinkUrl(link);
        if (!urlText) {
            continue;
        }

        try {
            const url = new URL(urlText);
            if (url.protocol === 'https:'
                && url.hostname === 'amperkot.ru'
                && pattern.test(url.pathname)) {
                url.hash = '';
                url.search = '';
                return url.toString();
            }
        } catch {}
    }

    return '';
}

function hasOrderWarehouseActionLink(orderId) {
    const normalizedId = normalizeAmperkotOrderId(orderId);
    if (!normalizedId) {
        return false;
    }

    return getOrderDetailsLinks().some(link => {
        const raw = link?.getAttribute?.('href') || link?.href || '';
        return String(raw || '').includes(`/web-apps/wh3/#/wh/shop-orders/actions?order=${normalizedId}`);
    });
}

function createOrderKindObservation() {
    const orderId = normalizeAmperkotOrderId(getOrderIdFromLocation());
    if (!orderId || !isAmperkotOrderDetailsPageUrl()) {
        return null;
    }

    const source = findSectionDetailValue('Информация о заказе', ['Источник']);
    const contractor = findSectionDetailValue(
        'Данные заказа',
        ['Клиент', 'Контрагент', 'Юридическое лицо'],
        ['Клиент', 'Контрагент', 'Юридическое лицо']
    );
    const ozonShipActionUrl = findOrderOzonShipActionUrl(orderId);
    const hasStatus = Boolean(document.querySelector?.('#shop-order-status'));
    const hasWarehouseAction = hasOrderWarehouseActionLink(orderId);

    return {
        orderId,
        evidence: {
            source: normalizeCellText(source).slice(0, 160),
            contractor: normalizeCellText(contractor).slice(0, 200),
            ozonShipActionUrl,
            pageComplete: hasStatus && hasWarehouseAction
        }
    };
}

function clearOrderKindObservationTimers() {
    orderKindObservationTimers.forEach(timerId => {
        try {
            clearTimeout(timerId);
        } catch {}
    });
    orderKindObservationTimers = [];
}

function stopOrderKindObservation() {
    clearOrderKindObservationTimers();
    try {
        orderKindObservationObserver?.disconnect?.();
    } catch {}
    orderKindObservationObserver = null;
}

function reportOrderKindObservation({ force = false } = {}) {
    if (orderKindObservationInFlight) {
        return false;
    }

    const observation = createOrderKindObservation();
    if (!observation) {
        return false;
    }

    const signature = JSON.stringify(observation);
    if (!force && signature === lastAcceptedOrderKindObservationSignature) {
        return true;
    }

    lastOrderKindObservationSignature = signature;
    orderKindObservationInFlight = true;

    const sent = sendRuntimeMessage({
        type: 'REPORT_ORDER_KIND',
        ...observation
    }, (response) => {
        orderKindObservationInFlight = false;
        const runtimeError = getRuntimeLastError();
        if (runtimeError) {
            handleRuntimeMessagingError('ORDER_KIND', runtimeError);
            return;
        }

        lastAcceptedOrderKindObservationSignature = signature;
        const kind = response?.orderKind?.kind || 'unknown';
        confirmedOrderKindObservation = kind === 'ozon' || kind === 'regular';

        if (confirmedOrderKindObservation) {
            stopOrderKindObservation();
        }
    }, 'ORDER_KIND');

    if (!sent) {
        orderKindObservationInFlight = false;
    }

    return sent;
}

function initOrderKindObservation() {
    if (!isAmperkotOrderDetailsPageUrl()) {
        return false;
    }

    const orderId = normalizeAmperkotOrderId(getOrderIdFromLocation());
    const pageText = normalizeCellText(document.body?.innerText || '');
    const hasOrderPageShell = Boolean(document.querySelector?.('#shop-order-status'))
        || pageText.includes(`Заказ №${orderId}`)
        || pageText.includes(`Информация по заказу №${orderId}`);

    if (!hasOrderPageShell) {
        return false;
    }

    clearOrderKindObservationTimers();
    confirmedOrderKindObservation = false;

    ORDER_KIND_REPORT_RETRY_DELAYS_MS.forEach(delayMs => {
        const timerId = setTimeout(() => {
            orderKindObservationTimers = orderKindObservationTimers.filter(id => id !== timerId);
            if (!confirmedOrderKindObservation) {
                reportOrderKindObservation({ force: delayMs === 0 });
            }
        }, delayMs);
        orderKindObservationTimers.push(timerId);
    });

    if (typeof MutationObserver === 'function' && document.body) {
        try {
            orderKindObservationObserver = new MutationObserver(() => {
                if (!confirmedOrderKindObservation) {
                    reportOrderKindObservation();
                }
            });
            orderKindObservationObserver.observe(document.body, { childList: true, subtree: true });
        } catch {}
    }

    window.addEventListener?.('pageshow', () => reportOrderKindObservation({ force: true }));
    document.addEventListener?.('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !confirmedOrderKindObservation) {
            reportOrderKindObservation({ force: true });
        }
    });

    return true;
}

// ---------- WAREHOUSE OZON BARCODE BRIDGE ----------
function createWarehouseDocumentInstanceId() {
    try {
        if (typeof crypto?.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {}

    return `warehouse-document:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
}

const WAREHOUSE_DOCUMENT_INSTANCE_ID = createWarehouseDocumentInstanceId();
const WAREHOUSE_BRIDGE_SCRIPT_ID = 'tab-wanderer-warehouse-barcode-bridge';
const WAREHOUSE_SHOP_ORDER_REQUEST_EVENT = 'tab_wanderer:warehouse-shop-order-request';
const WAREHOUSE_SHOP_ORDER_RESPONSE_EVENT = 'tab_wanderer:warehouse-shop-order-response';
const WAREHOUSE_API_CAPTURE_ARM_EVENT = 'tab_wanderer:warehouse-api-capture-arm';
const WAREHOUSE_BARCODE_PREVIEW_PANEL_ID = 'tab-wanderer-warehouse-barcode-preview';
const WAREHOUSE_BARCODE_PREVIEW_REFRESH_BUTTON_ID = 'tab-wanderer-warehouse-barcode-preview-refresh';
const WAREHOUSE_BARCODE_PREVIEW_TOGGLE_ACTION = 'toggle-preview';
const WAREHOUSE_BARCODE_LIST_TOGGLE_ACTION = 'toggle-barcode-list';
const WAREHOUSE_BARCODE_LIST_BUTTON_ID = 'tab-wanderer-warehouse-barcode-list-toggle';
const WAREHOUSE_OZON_RESOLVE_BUTTON_ID = 'tab-wanderer-warehouse-ozon-resolve';
const WAREHOUSE_OZON_APPLY_BUTTON_ID = 'tab-wanderer-warehouse-ozon-apply';
const WAREHOUSE_SOLD_DELETE_BUTTON_ID = 'tab-wanderer-warehouse-sold-delete';
const WAREHOUSE_SOLD_COMPARE_LOG_BUTTON_ID = 'tab-wanderer-warehouse-sold-compare-log';
const WAREHOUSE_STOCK_PANEL_ID = 'tab-wanderer-warehouse-stock';
const WAREHOUSE_STOCK_SUMMARY_REQUEST_EVENT = 'tab_wanderer:warehouse-product-items-summary-request';
const WAREHOUSE_STOCK_SUMMARY_RESPONSE_EVENT = 'tab_wanderer:warehouse-product-items-summary-response';
const WAREHOUSE_INCOME_SELECTION_EVENT = 'tab_wanderer:warehouse-income-product-selection';
const OZON_PRODUCT_BRIDGE_SCRIPT_ID = 'tab-wanderer-ozon-product-bridge';
const OZON_PRODUCT_REQUEST_EVENT = 'tab_wanderer:ozon-product-request';
const OZON_PRODUCT_RESPONSE_EVENT = 'tab_wanderer:ozon-product-response';
const OZON_ISOLATED_API_KEY = '__TAB_WANDERER_OZON_ISOLATED_API__';
const OZON_WORKER_MARK = '#tab_wanderer_ozon_worker=1';
const WAREHOUSE_ROUTE_WATCH_INTERVAL_MS = 1000;
const OZON_WORKER_READY_FALLBACK_MS = 3000;
const WAREHOUSE_SHOP_ORDER_MAX_READ_ATTEMPTS = 8;
const WAREHOUSE_SHOP_ORDER_RETRY_DELAY_MS = 500;
const WAREHOUSE_ASSEMBLY_ACTION_REFRESH_DELAYS_MS = [350, 1200, 2500, 5000, 8000];
const WAREHOUSE_API_CAPTURE_WINDOW_MS = 12000;
const WAREHOUSE_ASSEMBLY_ACTION_DEBUG_STORAGE_KEY = 'tab_wanderer_warehouse_action_debug_v1';
const WAREHOUSE_AUTO_APPLY_TIMEOUT_MS = 10 * 60 * 1000;
const WAREHOUSE_AUTO_RESOLVE_CHECK_DELAY_MS = 500;
const WAREHOUSE_AUTO_RESOLVE_QUEUE_RETRY_MS = 5000;
const WAREHOUSE_AUTO_RESOLVE_QUEUE_MAX_RETRIES = 24;

let lastWarehouseBarcodePreview = null;
let lastWarehouseBarcodePreviewSource = '';
let warehouseConfirmedPanelSnapshot = null; // read-only, never used as Ozon write authorization
let lastWarehouseOzonResolvePreview = null;
let warehouseSoldCleanupPreview = [];
let warehouseSoldCleanupState = 'idle';
let warehouseSoldCleanupFailedProducts = 0;
let warehouseSoldCleanupRemovedCount = 0;
let warehouseSoldCleanupListExpanded = false;
let lastWarehouseOzonUiApply = null;
let warehouseBarcodeBridgeInitialized = false;
let warehouseBridgeSnapshotRequestedOnLoad = false;
let warehouseRouteWatcherTimer = null;
let warehousePreviewActionListenersInitialized = false;
let warehouseBarcodePreviewCollapsed = true;
let warehouseBarcodePreviewCollapseTouched = false;
let warehouseOrderKindRecord = null;
let warehouseOrderKindRequestId = '';
let warehouseAutoApplyIntent = null;
let warehouseAutoBarcodeApplyEnabled = true;
let warehouseAutoApplySequence = 0;
let warehouseAutoResolveCheckTimer = null;
let warehouseAutoResolveCheckState = null;
let warehouseBarcodeListExpanded = false;
let warehouseBarcodePreviewPanelElement = null;
let warehouseStockPanelElement = null;
let warehouseStockBranch = 'default';
let lastWarehouseStockViewModel = null;
let lastWarehouseStockPayload = null;
let warehouseStockPayloads = new Map();
let warehouseStockRequestInFlight = new Set();
let warehouseStockProductObserver = null;
let warehouseStockProductSyncTimer = null;
let warehouseStockProductPollTimer = null;
let warehouseStockObservedProductIdsSignature = '';
let warehouseStockProductMeta = new Map();
let warehouseStockSelectedCardElement = null;
let warehouseStockCurrentProductId = '';
let warehouseStockCurrentProductTitle = '';
let warehouseStockBranchConfigRevision = 0;
let warehouseStockBranchConfigRequestAttempt = 0;
let warehouseRouteWatcherInitialized = false;
let warehouseStockBranchConfigRetryTimer = null;
let warehouseStockListenerInitialized = false;
let lastWarehouseRouteHref = '';
let warehouseShopOrderReadAttempt = 0;
let warehouseShopOrderReadReason = 'initial';
let warehouseShopOrderRetryTimer = null;
let warehouseAssemblyActionRefreshTimers = [];
let warehouseAssemblyActionDebug = readWarehouseAssemblyActionDebugFromSession();
let warehouseAssemblyActionListenersInitialized = false;
let lastWarehouseAssemblyActionSignature = '';
let lastWarehouseAssemblyActionAt = 0;
let ozonProductBridgeInitialized = false;
let ozonRuntimeMessageListenerInitialized = false;
let ozonResolvedSellerId = '';
let ozonWorkerReadyTimer = null;
let ozonWorkerReadyProductId = '';

function createWarehouseAutoResolveCheckState(orderId = getWarehouseOrderIdFromUrl(), status = 'idle') {
    return {
        orderId: normalizeAmperkotOrderId(orderId),
        documentInstanceId: WAREHOUSE_DOCUMENT_INSTANCE_ID,
        status,
        fingerprint: '',
        scheduledAt: 0,
        startedAt: 0,
        completedAt: 0,
        queueRetryCount: 0,
        reason: ''
    };
}

function getWarehouseAutoResolveCheckState() {
    return warehouseAutoResolveCheckState
        ? { ...warehouseAutoResolveCheckState }
        : createWarehouseAutoResolveCheckState();
}

function clearWarehouseAutoResolveCheckTimer() {
    if (warehouseAutoResolveCheckTimer && typeof clearTimeout === 'function') {
        try {
            clearTimeout(warehouseAutoResolveCheckTimer);
        } catch {}
    }

    warehouseAutoResolveCheckTimer = null;
}

function resetWarehouseAutoResolveCheck(reason = 'route-reset') {
    clearWarehouseAutoResolveCheckTimer();
    warehouseAutoResolveCheckState = createWarehouseAutoResolveCheckState(
        getWarehouseOrderIdFromUrl(),
        'idle'
    );
    warehouseAutoResolveCheckState.reason = reason;
    return getWarehouseAutoResolveCheckState();
}

function isWarehouseAppPageUrl(href = window.location.href) {
    try {
        const url = new URL(href);

        return url.hostname === 'amperkot.ru'
            && url.pathname.startsWith('/web-apps/wh3/');
    } catch {
        return false;
    }
}

function getWarehouseOrderRouteKind(href = window.location.href) {
    try {
        const url = new URL(href);

        if (!isWarehouseAppPageUrl(href)) {
            return '';
        }

        const hashPath = String(url.hash || '').replace(/^#/, '').split('?')[0];

        if (hashPath === '/wh/shop-orders/actions') {
            return 'actions';
        }

        if (/^\/wh\/shop-orders\/disassembly\/\d+$/.test(hashPath)) {
            return 'disassembly';
        }

        if (hashPath.includes('/wh/shop-orders/assembly/')) {
            return 'assembly';
        }

        if (/^\/income\/actions\/[^/]+\/perform$/.test(hashPath)) {
            return 'income-perform';
        }

        return '';
    } catch {
        return '';
    }
}

function isWarehouseOrderActionsPageUrl(href = window.location.href) {
    return getWarehouseOrderRouteKind(href) === 'actions';
}

function isWarehouseAssemblyPageUrl(href = window.location.href) {
    return getWarehouseOrderRouteKind(href) === 'assembly';
}

function isWarehouseDisassemblyPageUrl(href = window.location.href) {
    return getWarehouseOrderRouteKind(href) === 'disassembly';
}

function isWarehouseIncomePerformPageUrl(href = window.location.href) {
    return getWarehouseOrderRouteKind(href) === 'income-perform';
}

function isWarehouseOrderWorkflowPageUrl(href = window.location.href) {
    return !!getWarehouseOrderRouteKind(href);
}


function getWarehouseOrderIdFromUrl(href = window.location.href) {
    try {
        const url = new URL(href);
        if (!isWarehouseAppPageUrl(href)) {
            return '';
        }

        const hash = String(url.hash || '').replace(/^#/, '');
        const queryIndex = hash.indexOf('?');
        if (queryIndex < 0) {
            return '';
        }

        const params = new URLSearchParams(hash.slice(queryIndex + 1));
        return normalizeAmperkotOrderId(params.get('order'));
    } catch {
        return '';
    }
}

function createUnknownWarehouseOrderKindRecord(orderId = getWarehouseOrderIdFromUrl(), reason = 'not-observed') {
    return {
        orderId: normalizeAmperkotOrderId(orderId),
        kind: 'unknown',
        reason,
        observedAt: 0,
        expiresAt: 0
    };
}

function normalizeWarehouseOrderKindRecord(value = {}, expectedOrderId = getWarehouseOrderIdFromUrl()) {
    const orderId = normalizeAmperkotOrderId(value?.orderId || expectedOrderId);
    const expectedId = normalizeAmperkotOrderId(expectedOrderId);
    const kind = ['ozon', 'regular'].includes(String(value?.kind || '').toLowerCase())
        ? String(value.kind).toLowerCase()
        : 'unknown';

    if (!orderId || (expectedId && orderId !== expectedId)) {
        return createUnknownWarehouseOrderKindRecord(expectedId, 'order-mismatch');
    }

    return {
        orderId,
        kind,
        reason: String(value?.reason || '').slice(0, 80),
        observedAt: Math.max(0, Number(value?.observedAt) || 0),
        expiresAt: Math.max(0, Number(value?.expiresAt) || 0)
    };
}

function getWarehouseOrderKindDisplay(record = warehouseOrderKindRecord) {
    const kind = record?.kind || 'unknown';

    if (kind === 'ozon') {
        return {
            kind,
            text: warehouseAutoBarcodeApplyEnabled
                ? 'OZON · автозапись после сборки'
                : 'OZON · автозапись выключена',
            color: warehouseAutoBarcodeApplyEnabled ? '#169c46' : '#667685'
        };
    }

    if (kind === 'regular') {
        return {
            kind,
            text: 'Обычный заказ · только вручную',
            color: '#667685'
        };
    }

    return {
        kind: 'unknown',
        text: 'Проверяем тип заказа · действия Ozon пока недоступны',
        color: '#b26a00'
    };
}

function getWarehouseOrderKindRecord() {
    return warehouseOrderKindRecord || createUnknownWarehouseOrderKindRecord();
}

function getWarehouseAutoApplyIntent() {
    return warehouseAutoApplyIntent ? { ...warehouseAutoApplyIntent } : null;
}

function getWarehouseAutoBarcodeApplyEnabled() {
    return warehouseAutoBarcodeApplyEnabled === true;
}

function applyWarehouseAutoBarcodeApplyEnabled(value, { render = true } = {}) {
    warehouseAutoBarcodeApplyEnabled = value !== false;

    if (!warehouseAutoBarcodeApplyEnabled && warehouseAutoApplyIntent) {
        warehouseAutoApplyIntent.status = 'cancelled';
        warehouseAutoApplyIntent = null;
    }

    if (render) {
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
    }

    if (warehouseOrderKindRecord?.kind === 'ozon' && lastWarehouseBarcodePreview?.ok) {
        maybeScheduleWarehouseAutoResolveCheck(lastWarehouseBarcodePreview, lastWarehouseBarcodePreviewSource);
    }

    return warehouseAutoBarcodeApplyEnabled;
}


function applyWarehouseOrderKindRecord(value = {}, { render = true } = {}) {
    const currentOrderId = getWarehouseOrderIdFromUrl();
    const record = normalizeWarehouseOrderKindRecord(value, currentOrderId);

    warehouseOrderKindRecord = record;
    warehouseOrderKindRequestId = currentOrderId;

    if (!warehouseBarcodePreviewCollapseTouched) {
        warehouseBarcodePreviewCollapsed = record.kind !== 'ozon';
    }

    if (record.kind !== 'ozon') {
        warehouseAutoApplyIntent = null;
    }

    if (record.kind === 'ozon' && lastWarehouseBarcodePreview?.ok) {
        const autoApplyStarted = warehouseAutoApplyIntent?.status === 'waiting'
            ? maybeStartWarehouseAutoApply(lastWarehouseBarcodePreview, lastWarehouseBarcodePreviewSource)
            : false;

        if (!autoApplyStarted) {
            maybeScheduleWarehouseAutoResolveCheck(lastWarehouseBarcodePreview, lastWarehouseBarcodePreviewSource);
        }
    }

    if (render) {
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
        renderWarehouseDisassemblyPanel();
    }

    return record;
}

function requestWarehouseOrderKind({ force = false } = {}) {
    const orderId = getWarehouseOrderIdFromUrl();
    if (!orderId) {
        applyWarehouseOrderKindRecord(createUnknownWarehouseOrderKindRecord('', 'invalid-order-id'));
        return false;
    }

    if (!force && warehouseOrderKindRequestId === orderId && warehouseOrderKindRecord?.kind !== 'unknown') {
        return true;
    }

    warehouseOrderKindRequestId = orderId;
    warehouseOrderKindRecord = createUnknownWarehouseOrderKindRecord(orderId);

    return sendRuntimeMessage({
        type: 'GET_ORDER_KIND',
        orderId
    }, (response) => {
        if (getWarehouseOrderIdFromUrl() !== orderId || warehouseOrderKindRequestId !== orderId) {
            return;
        }

        const runtimeError = getRuntimeLastError();
        if (runtimeError) {
            handleRuntimeMessagingError('WAREHOUSE_ORDER_KIND', runtimeError);
            applyWarehouseOrderKindRecord(createUnknownWarehouseOrderKindRecord(orderId, 'runtime-error'));
            return;
        }

        applyWarehouseOrderKindRecord(response?.orderKind || createUnknownWarehouseOrderKindRecord(orderId));
    }, 'WAREHOUSE_ORDER_KIND');
}

function resetWarehouseOrderContext() {
    warehouseBarcodePreviewCollapseTouched = false;
    warehouseBarcodePreviewCollapsed = true;
    warehouseBarcodeListExpanded = false;
    warehouseOrderKindRequestId = '';
    warehouseOrderKindRecord = createUnknownWarehouseOrderKindRecord(getWarehouseOrderIdFromUrl());
    warehouseAutoApplyIntent = null;
    warehouseSoldCleanupPreview = [];
    warehouseSoldCleanupState = 'idle';
    warehouseSoldCleanupFailedProducts = 0;
    warehouseSoldCleanupRemovedCount = 0;
    warehouseSoldCleanupListExpanded = false;
    lastWarehouseBarcodePreviewSource = '';
    warehouseConfirmedPanelSnapshot = null;
    lastWarehouseAssemblyActionSignature = '';
    lastWarehouseAssemblyActionAt = 0;
    resetWarehouseAutoResolveCheck('order-context-reset');
}

function normalizeWarehouseBridgeText(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return '';
    }

    return String(value)
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeWarehouseBridgeId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return '';
    }

    return String(value)
        .replace(/\s+/g, '')
        .trim();
}

function firstDefinedWarehouseBridgeValue(...values) {
    return values.find(value => value !== undefined && value !== null && value !== '') ?? null;
}

function normalizeWarehouseBridgeNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    if (!normalized || !/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
        return null;
    }

    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
}

function isWarehouseBridgeNumberInvalid(value) {
    return value !== undefined
        && value !== null
        && value !== ''
        && normalizeWarehouseBridgeNumber(value) === null;
}

function sanitizeWarehouseBridgeProduct(product = {}) {
    if (!product || typeof product !== 'object') {
        return {};
    }

    return {
        id: normalizeWarehouseBridgeId(product.id || product.product_id || product.productId),
        title: normalizeWarehouseBridgeText(product.title || product.name)
    };
}

function sanitizeWarehouseBridgeProductItem(productItem = {}, orderItem = {}) {
    if (!productItem || typeof productItem !== 'object') {
        return {};
    }

    const product = sanitizeWarehouseBridgeProduct(productItem.product || {});
    const fallbackProductId = orderItem?.item_id || orderItem?.itemId || product.id;
    const fallbackProductTitle = orderItem?.title || orderItem?.name || product.title;

    const rawReservedQuantity = firstDefinedWarehouseBridgeValue(productItem.reserved_quantity, productItem.reservedQuantity);

    return {
        id: normalizeWarehouseBridgeId(productItem.id || productItem.item_id || productItem.itemId),
        barcode: normalizeWarehouseBridgeId(productItem.barcode || productItem.bar_code || productItem.code),
        type: normalizeWarehouseBridgeNumber(productItem.type),
        ...(isWarehouseBridgeNumberInvalid(productItem.type) ? { type_invalid: true } : {}),
        quantity: normalizeWarehouseBridgeNumber(productItem.quantity),
        ...(isWarehouseBridgeNumberInvalid(productItem.quantity) ? { quantity_invalid: true } : {}),
        reserved_quantity: normalizeWarehouseBridgeNumber(rawReservedQuantity),
        ...(isWarehouseBridgeNumberInvalid(rawReservedQuantity) ? { reserved_quantity_invalid: true } : {}),
        product_id: normalizeWarehouseBridgeId(productItem.product_id || productItem.productId || fallbackProductId),
        product: {
            id: normalizeWarehouseBridgeId(product.id || fallbackProductId),
            title: normalizeWarehouseBridgeText(product.title || fallbackProductTitle)
        },
        state: productItem.state && typeof productItem.state === 'object'
            ? { title: normalizeWarehouseBridgeText(productItem.state.title || productItem.state.name) }
            : null
    };
}

function sanitizeWarehouseBridgeAssemblyEntry(entry = {}) {
    const orderItem = entry?.order_item || entry?.orderItem || {};

    const rawQuantity = firstDefinedWarehouseBridgeValue(entry.quantity, entry.assembly_quantity, entry.assemblyQuantity);

    return {
        id: normalizeWarehouseBridgeId(entry.id || entry.assembly_id || entry.assemblyId),
        quantity: normalizeWarehouseBridgeNumber(rawQuantity),
        ...(isWarehouseBridgeNumberInvalid(rawQuantity) ? { quantity_invalid: true } : {}),
        product_item: sanitizeWarehouseBridgeProductItem(entry.product_item || entry.productItem || {}, orderItem),
        order_item: {
            id: normalizeWarehouseBridgeId(orderItem.id || orderItem.item_id || orderItem.itemId),
            item_id: normalizeWarehouseBridgeId(orderItem.item_id || orderItem.itemId),
            title: normalizeWarehouseBridgeText(orderItem.title || orderItem.name)
        }
    };
}

function sanitizeWarehouseBridgeOrderItem(item = {}) {
    return {
        id: normalizeWarehouseBridgeId(item.id || item.order_item_id || item.orderItemId),
        item_id: normalizeWarehouseBridgeId(item.item_id || item.itemId || item.product_id || item.productId),
        title: normalizeWarehouseBridgeText(item.title || item.name),
        quantity: normalizeWarehouseBridgeNumber(item.quantity),
        assembled_quantity: normalizeWarehouseBridgeNumber(firstDefinedWarehouseBridgeValue(item.assembled_quantity, item.assembledQuantity)),
        assemble_status: normalizeWarehouseBridgeText(item.assemble_status || item.assembleStatus || item.status)
    };
}

function sanitizeWarehouseShopOrderForBarcodeBridge(shopOrder = {}) {
    const safeOrder = shopOrder && typeof shopOrder === 'object' ? shopOrder : {};

    return {
        id: normalizeWarehouseBridgeText(safeOrder.number || safeOrder.id || safeOrder.order_id || safeOrder.orderId),
        internalId: normalizeWarehouseBridgeId(safeOrder.id || safeOrder.internalId),
        number: normalizeWarehouseBridgeText(safeOrder.number || safeOrder.order_number || safeOrder.orderNumber),
        total_quantity: normalizeWarehouseBridgeNumber(firstDefinedWarehouseBridgeValue(safeOrder.total_quantity, safeOrder.totalQuantity)),
        assembled_quantity: normalizeWarehouseBridgeNumber(firstDefinedWarehouseBridgeValue(safeOrder.assembled_quantity, safeOrder.assembledQuantity)),
        items: Array.isArray(safeOrder.items)
            ? safeOrder.items.map(sanitizeWarehouseBridgeOrderItem)
            : [],
        assembly: Array.isArray(safeOrder.assembly)
            ? safeOrder.assembly.map(sanitizeWarehouseBridgeAssemblyEntry)
            : []
    };
}

function createWarehouseBarcodePreviewFromShopOrder(shopOrder = {}) {
    const sanitizedShopOrder = sanitizeWarehouseShopOrderForBarcodeBridge(shopOrder);

    if (typeof extractWarehouseAssemblyBarcodes !== 'function') {
        return {
            ok: false,
            error: 'warehouse barcode extractor unavailable',
            shopOrder: sanitizedShopOrder,
            extraction: null,
            summary: {
                productCount: 0,
                eligibleCount: 0,
                skippedCount: 0
            }
        };
    }

    const extraction = extractWarehouseAssemblyBarcodes(sanitizedShopOrder);

    // A newly opened assembly may have no scanned unit barcodes yet. The
    // read-only Ozon comparison still needs the order's article identities.
    // Empty groups never authorize adding or removing a warehouse barcode.
    for (const orderItem of sanitizedShopOrder.items) {
        const productId = normalizeWarehouseBridgeId(orderItem.item_id);
        if (!/^\d+$/.test(productId) || extraction.productsById[productId]) continue;
        extraction.productsById[productId] = {
            productId,
            productTitle: orderItem.title || '',
            eligibleBarcodes: [],
            skippedBarcodes: []
        };
    }
    extraction.summary.productCount = Object.keys(extraction.productsById)
        .filter(productId => productId !== '__unknown__').length;

    return {
        ok: true,
        error: null,
        source: 'warehouse-assembly-page',
        url: window.location.href,
        extractedAt: new Date().toISOString(),
        shopOrder: sanitizedShopOrder,
        extraction,
        summary: extraction.summary
    };
}

function getLastWarehouseBarcodePreview() {
    return lastWarehouseBarcodePreview;
}

function getLastWarehouseOzonResolvePreview() {
    return lastWarehouseOzonResolvePreview;
}

function readWarehouseAssemblyActionDebugFromSession() {
    try {
        const value = window.sessionStorage?.getItem?.(WAREHOUSE_ASSEMBLY_ACTION_DEBUG_STORAGE_KEY);
        return value ? JSON.parse(value) : null;
    } catch {
        return null;
    }
}

function persistWarehouseAssemblyActionDebugToSession(debug = warehouseAssemblyActionDebug) {
    try {
        if (debug) {
            window.sessionStorage?.setItem?.(WAREHOUSE_ASSEMBLY_ACTION_DEBUG_STORAGE_KEY, JSON.stringify(debug));
        }
    } catch {}
}

function clearWarehouseShopOrderRetryTimer() {
    if (!warehouseShopOrderRetryTimer || typeof clearTimeout !== 'function') {
        warehouseShopOrderRetryTimer = null;
        return;
    }

    clearTimeout(warehouseShopOrderRetryTimer);
    warehouseShopOrderRetryTimer = null;
}

function clearWarehouseAssemblyActionRefreshTimers(reason = 'cleared') {
    if (Array.isArray(warehouseAssemblyActionRefreshTimers)) {
        warehouseAssemblyActionRefreshTimers.forEach(timerId => {
            try {
                clearTimeout(timerId);
            } catch {}
        });
    }

    warehouseAssemblyActionRefreshTimers = [];

    if (warehouseAssemblyActionDebug) {
        warehouseAssemblyActionDebug.reloadTimerState = 'cleared';
        warehouseAssemblyActionDebug.reloadTimerClearReason = reason;
        warehouseAssemblyActionDebug.reloadTimerClearedAt = new Date().toISOString();
        persistWarehouseAssemblyActionDebugToSession();
    }
}

function getWarehouseAssemblyActionDebugPublicSnapshot() {
    if (!warehouseAssemblyActionDebug) {
        return null;
    }

    return { ...warehouseAssemblyActionDebug };
}

function updateWarehouseAssemblyActionDebug(patch = {}) {
    warehouseAssemblyActionDebug = {
        ...(warehouseAssemblyActionDebug || {}),
        ...patch,
        updatedAt: new Date().toISOString()
    };

    persistWarehouseAssemblyActionDebugToSession();

    try {
        document.documentElement?.setAttribute?.('data-tab-wanderer-warehouse-debug', JSON.stringify({
            action: warehouseAssemblyActionDebug.actionText || '',
            source: warehouseAssemblyActionDebug.lastResponseSource || '',
            reload: warehouseAssemblyActionDebug.reloadTimerState || '',
            reason: warehouseAssemblyActionDebug.reloadTimerClearReason || warehouseAssemblyActionDebug.reloadFallbackReason || '',
            summary: warehouseAssemblyActionDebug.lastSummary || null
        }));
    } catch {}

    return warehouseAssemblyActionDebug;
}

function createWarehouseAssemblyActionDebugLine() {
    const debug = getWarehouseAssemblyActionDebugPublicSnapshot();

    if (!debug) {
        return '';
    }

    const parts = [
        debug.actionDetected ? 'клик сборки пойман' : '',
        debug.apiCaptureArmed ? 'api capture включён' : '',
        debug.reloadTimerState === 'scheduled' ? 'ожидаем DOM штрихкоды' : '',
        debug.reloadTimerState === 'fired' ? `чтение завершено: ${debug.reloadFallbackReason || 'snapshot refresh'}` : '',
        debug.reloadTimerState === 'cleared' ? `ожидание завершено: ${debug.reloadTimerClearReason || 'unknown'}` : '',
        debug.lastResponseSource ? `source: ${debug.lastResponseSource}` : '',
        debug.lastSummary ? `кандидаты ${debug.lastSummary.eligibleCount || 0}, пропущено ${debug.lastSummary.skippedCount || 0}` : '',
        debug.lastBridgeApiResult ? `api: ${debug.lastBridgeApiResult}` : '',
        Number(debug.lastBridgeApiResponseCount) > 0 ? `api responses: ${debug.lastBridgeApiResponseCount}` : ''
    ].filter(Boolean);

    return parts.length ? `Диагностика склада: ${parts.join('; ')}.` : '';
}

function isWarehouseBarcodePreviewPanelTarget(target) {
    return !!target?.closest?.(`#${WAREHOUSE_BARCODE_PREVIEW_PANEL_ID}`);
}

function getWarehouseAssemblyActionControl(target) {
    if (!target?.closest || isWarehouseBarcodePreviewPanelTarget(target)) {
        return null;
    }

    return target.closest('button, [role="button"], a, [ng-click], [data-ng-click], .btn, [class*="button"], [class*="Button"]');
}

function getWarehouseAssemblyActionControlText(control) {
    const candidates = [
        control?.innerText,
        control?.textContent,
        control?.value,
        control?.getAttribute?.('aria-label'),
        control?.getAttribute?.('title')
    ];

    for (const candidate of candidates) {
        const text = normalizeWarehouseBridgeText(candidate).toLowerCase();
        if (text) {
            return text;
        }
    }

    return '';
}

function getWarehouseAssemblyActionExpression(control) {
    const rawExpression = control?.getAttribute?.('ng-click')
        || control?.getAttribute?.('data-ng-click')
        || '';

    return String(rawExpression)
        .replace(/\s+/g, '')
        .replace(/;+$/, '')
        .toLowerCase();
}

function isWarehouseFinalConfirmActionControl(control) {
    if (!control || control.disabled || control.getAttribute?.('aria-disabled') === 'true') {
        return false;
    }

    const tagName = String(control?.tagName || '').toLowerCase();
    if (tagName && tagName !== 'button') {
        return false;
    }

    return getWarehouseAssemblyActionExpression(control) === '$ctrl.confirm()';
}

function isWarehouseAssemblyActionControl(control) {
    if (!control || control.disabled || control.getAttribute?.('aria-disabled') === 'true') {
        return false;
    }

    if (isWarehouseFinalConfirmActionControl(control)) {
        return true;
    }

    const text = getWarehouseAssemblyActionControlText(control);

    return !!text && /(?:собрать(?:\s+заказ)?|завершить\s+сборку|подтвердить\s+сборку)/i.test(text);
}

function isWarehouseAutoApplyActionControl(control) {
    return warehouseAutoBarcodeApplyEnabled === true
        && isWarehouseFinalConfirmActionControl(control);
}

function dispatchWarehouseApiCaptureArm(reason = 'warehouse-assembly-action') {
    try {
        window.dispatchEvent(new CustomEvent(WAREHOUSE_API_CAPTURE_ARM_EVENT, {
            detail: {
                reason,
                durationMs: WAREHOUSE_API_CAPTURE_WINDOW_MS
            }
        }));
        return true;
    } catch {
        return false;
    }
}


function getWarehouseBarcodePreviewFingerprint(preview = lastWarehouseBarcodePreview) {
    const entries = Array.isArray(preview?.extraction?.eligibleBarcodes)
        ? preview.extraction.eligibleBarcodes
            .map(entry => {
                const productId = normalizeWarehouseBridgeId(entry?.productId);
                const barcode = normalizeWarehouseBridgeId(entry?.barcode);
                const itemType = normalizeWarehouseBridgeNumber(entry?.itemType);

                if (!productId || !barcode || itemType === null) {
                    return '';
                }

                return `${productId}:${barcode}:${itemType}`;
            })
            .filter(Boolean)
            .sort()
        : [];

    const articles = Object.keys(preview?.extraction?.productsById || {})
        .filter(id => /^\d+$/.test(id)).sort();
    return `${articles.join(',')}|${entries.join('|')}`;
}

function hasActiveWarehouseAutoApplyIntent() {
    return Boolean(warehouseAutoApplyIntent
        && ['waiting', 'starting', 'started'].includes(warehouseAutoApplyIntent.status));
}

function canStartWarehouseAutoResolveCheck(preview = lastWarehouseBarcodePreview) {
    const orderId = getWarehouseOrderIdFromUrl();
    const previewOrderId = normalizeAmperkotOrderId(getWarehouseBarcodePreviewOrderId(preview));
    const articleCount = Object.keys(preview?.extraction?.productsById || {})
        .filter(id => /^\d+$/.test(id)).length;

    return isWarehouseAssemblyPageUrl()
        && Boolean(orderId)
        && previewOrderId === orderId
        && warehouseOrderKindRecord?.kind === 'ozon'
        && preview?.ok === true
        && articleCount > 0
        && !hasActiveWarehouseAutoApplyIntent();
}

function markWarehouseAutoResolveCheckSuppressed(reason = 'suppressed') {
    const state = warehouseAutoResolveCheckState || createWarehouseAutoResolveCheckState();

    if (!['started', 'completed', 'failed', 'manual'].includes(state.status)) {
        clearWarehouseAutoResolveCheckTimer();
        state.status = 'suppressed';
        state.reason = reason;
        warehouseAutoResolveCheckState = state;
    }

    return getWarehouseAutoResolveCheckState();
}

function scheduleWarehouseAutoResolveQueueRetry() {
    const state = warehouseAutoResolveCheckState;
    if (!state || state.status !== 'queued') {
        return false;
    }

    clearWarehouseAutoResolveCheckTimer();

    if (state.queueRetryCount >= WAREHOUSE_AUTO_RESOLVE_QUEUE_MAX_RETRIES
        || typeof setTimeout !== 'function') {
        state.status = 'failed';
        state.completedAt = Date.now();
        state.reason = 'queued-check-retry-limit';
        return false;
    }

    state.queueRetryCount += 1;
    warehouseAutoResolveCheckTimer = setTimeout(() => {
        warehouseAutoResolveCheckTimer = null;

        const currentState = warehouseAutoResolveCheckState;
        if (!currentState
            || currentState.status !== 'queued'
            || currentState.orderId !== getWarehouseOrderIdFromUrl()
            || currentState.documentInstanceId !== WAREHOUSE_DOCUMENT_INSTANCE_ID
            || !canStartWarehouseAutoResolveCheck(lastWarehouseBarcodePreview)) {
            return;
        }

        currentState.status = 'started';
        currentState.reason = 'queued-check-retry';
        if (!requestWarehouseOzonResolvePreview({ trigger: 'automatic-on-open' })) {
            currentState.status = 'failed';
            currentState.completedAt = Date.now();
            currentState.reason = 'queued-check-retry-not-sent';
        }
    }, WAREHOUSE_AUTO_RESOLVE_QUEUE_RETRY_MS);

    return true;
}

function maybeScheduleWarehouseAutoResolveCheck(preview = lastWarehouseBarcodePreview, responseSource = '') {
    const orderId = getWarehouseOrderIdFromUrl();
    const fingerprint = getWarehouseBarcodePreviewFingerprint(preview);
    let state = warehouseAutoResolveCheckState;

    if (!state || state.orderId !== orderId || state.documentInstanceId !== WAREHOUSE_DOCUMENT_INSTANCE_ID) {
        clearWarehouseAutoResolveCheckTimer();
        state = createWarehouseAutoResolveCheckState(orderId);
        warehouseAutoResolveCheckState = state;
    }

    if (hasActiveWarehouseAutoApplyIntent()) {
        markWarehouseAutoResolveCheckSuppressed('automatic-write-intent');
        return false;
    }

    if (state.status === 'suppressed') {
        state.status = 'idle';
        state.reason = 'automatic-write-intent-cleared';
        state.fingerprint = '';
    }

    if (!canStartWarehouseAutoResolveCheck(preview) || !fingerprint) {
        if (state.status === 'scheduled') {
            clearWarehouseAutoResolveCheckTimer();
            state.status = 'idle';
            state.fingerprint = '';
            state.reason = 'candidate-unavailable';
        }
        return false;
    }

    if (['started', 'queued', 'completed', 'failed', 'manual'].includes(state.status)) {
        return false;
    }

    if (state.status === 'scheduled' && state.fingerprint === fingerprint) {
        return true;
    }

    clearWarehouseAutoResolveCheckTimer();
    state.status = 'scheduled';
    state.fingerprint = fingerprint;
    state.scheduledAt = Date.now();
    state.reason = responseSource || 'warehouse-snapshot';

    if (typeof setTimeout !== 'function') {
        state.status = 'failed';
        state.reason = 'setTimeout-unavailable';
        return false;
    }

    warehouseAutoResolveCheckTimer = setTimeout(() => {
        warehouseAutoResolveCheckTimer = null;

        const currentState = warehouseAutoResolveCheckState;
        const currentFingerprint = getWarehouseBarcodePreviewFingerprint(lastWarehouseBarcodePreview);
        if (!currentState
            || currentState.status !== 'scheduled'
            || currentState.orderId !== getWarehouseOrderIdFromUrl()
            || currentState.fingerprint !== currentFingerprint
            || !canStartWarehouseAutoResolveCheck(lastWarehouseBarcodePreview)) {
            return;
        }

        currentState.status = 'started';
        currentState.startedAt = Date.now();
        currentState.reason = 'page-open-existing-barcodes';

        if (!requestWarehouseOzonResolvePreview({ trigger: 'automatic-on-open' })) {
            currentState.status = 'failed';
            currentState.completedAt = Date.now();
            currentState.reason = 'request-not-sent';
        }
    }, WAREHOUSE_AUTO_RESOLVE_CHECK_DELAY_MS);

    return true;
}

function normalizeWarehouseAutoApplyIntentRecord(value = {}, expectedOrderId = getWarehouseOrderIdFromUrl()) {
    const orderId = normalizeAmperkotOrderId(value?.orderId || expectedOrderId);
    const expectedId = normalizeAmperkotOrderId(expectedOrderId);
    const actionId = String(value?.actionId || '').slice(0, 160);
    const startedAt = Math.max(0, Number(value?.armedAt || value?.startedAt) || 0);
    const expiresAt = Math.max(startedAt, Number(value?.expiresAt) || 0);
    const sourceDocumentId = String(value?.sourceDocumentId || '').slice(0, 160);

    if (!orderId || orderId !== expectedId || !actionId || !startedAt || expiresAt <= Date.now()) {
        return null;
    }

    return {
        actionId,
        orderId,
        actionText: String(value?.actionText || '').slice(0, 120),
        startedAt,
        expiresAt,
        baselineFingerprint: '',
        baselineKnown: false,
        sourceRoute: ['actions', 'assembly'].includes(value?.sourceRoute) ? value.sourceRoute : '',
        sourceDocumentId,
        resumedAfterReload: Boolean(sourceDocumentId && sourceDocumentId !== WAREHOUSE_DOCUMENT_INSTANCE_ID),
        routeTransitionedAt: 0,
        status: 'waiting',
        trigger: 'warehouse-assembly-action'
    };
}

function requestWarehouseAutoApplyIntent() {
    const orderId = getWarehouseOrderIdFromUrl();
    if (!orderId) {
        return false;
    }

    return sendRuntimeMessage({
        type: 'GET_WAREHOUSE_AUTO_APPLY',
        orderId,
        documentInstanceId: WAREHOUSE_DOCUMENT_INSTANCE_ID
    }, (response) => {
        if (getWarehouseOrderIdFromUrl() !== orderId) {
            return;
        }

        const runtimeError = getRuntimeLastError();
        if (runtimeError) {
            handleRuntimeMessagingError('WAREHOUSE_AUTO_APPLY', runtimeError);
            return;
        }

        applyWarehouseAutoBarcodeApplyEnabled(response?.enabled !== false);

        const restored = normalizeWarehouseAutoApplyIntentRecord(response?.intent, orderId);
        if (restored && warehouseAutoBarcodeApplyEnabled === true) {
            if (!warehouseAutoApplyIntent
                || warehouseAutoApplyIntent.actionId !== restored.actionId
                || warehouseAutoApplyIntent.status === 'failed') {
                warehouseAutoApplyIntent = restored;
            }

            markWarehouseAutoResolveCheckSuppressed('automatic-write-intent');

            if (warehouseOrderKindRecord?.kind === 'ozon' && lastWarehouseBarcodePreview?.ok) {
                maybeStartWarehouseAutoApply(lastWarehouseBarcodePreview, lastWarehouseBarcodePreviewSource);
            }
            return;
        }

        if (warehouseOrderKindRecord?.kind === 'ozon' && lastWarehouseBarcodePreview?.ok) {
            maybeScheduleWarehouseAutoResolveCheck(lastWarehouseBarcodePreview, lastWarehouseBarcodePreviewSource);
        }
    }, 'WAREHOUSE_AUTO_APPLY');
}

function armWarehouseAutoApplyIntent(intent = warehouseAutoApplyIntent) {
    if (!intent?.actionId || !intent?.orderId) {
        return false;
    }

    return sendRuntimeMessage({
        type: 'ARM_WAREHOUSE_AUTO_APPLY',
        orderId: intent.orderId,
        actionId: intent.actionId,
        actionText: intent.actionText,
        sourceRoute: intent.sourceRoute,
        documentInstanceId: WAREHOUSE_DOCUMENT_INSTANCE_ID
    }, (response) => {
        const runtimeError = getRuntimeLastError();
        const currentIntent = warehouseAutoApplyIntent?.actionId === intent.actionId
            ? warehouseAutoApplyIntent
            : null;

        if (runtimeError) {
            if (currentIntent && !handleRuntimeMessagingError('WAREHOUSE_AUTO_APPLY', runtimeError)) {
                currentIntent.status = 'failed';
                currentIntent.error = runtimeError.message || 'automatic apply intent arm failed';
            }
            return;
        }

        if (!response?.ok) {
            if (currentIntent) {
                currentIntent.status = 'failed';
                currentIntent.error = response?.error || 'automatic apply intent arm rejected';
            }
            return;
        }

        if (currentIntent && response.intent) {
            currentIntent.expiresAt = Math.max(currentIntent.expiresAt, Number(response.intent.expiresAt) || 0);
            currentIntent.sourceDocumentId = String(response.intent.sourceDocumentId || WAREHOUSE_DOCUMENT_INSTANCE_ID);
        }
    }, 'WAREHOUSE_AUTO_APPLY');
}

function startWarehouseAutoApplyIntent(control = null, now = Date.now()) {
    const orderId = getWarehouseOrderIdFromUrl();
    const kind = warehouseOrderKindRecord?.kind || 'unknown';

    if (!orderId || kind !== 'ozon' || warehouseAutoBarcodeApplyEnabled !== true) {
        warehouseAutoApplyIntent = null;
        return null;
    }

    if (warehouseAutoApplyIntent
        && warehouseAutoApplyIntent.orderId === orderId
        && ['waiting', 'starting', 'started'].includes(warehouseAutoApplyIntent.status)
        && now - warehouseAutoApplyIntent.startedAt < WAREHOUSE_AUTO_APPLY_TIMEOUT_MS) {
        return warehouseAutoApplyIntent;
    }

    warehouseAutoApplySequence += 1;
    warehouseAutoApplyIntent = {
        actionId: `${orderId}:${now}:${warehouseAutoApplySequence}`,
        orderId,
        actionText: getWarehouseAssemblyActionControlText(control),
        startedAt: now,
        expiresAt: now + WAREHOUSE_AUTO_APPLY_TIMEOUT_MS,
        baselineFingerprint: getWarehouseBarcodePreviewFingerprint(),
        baselineKnown: lastWarehouseBarcodePreview?.ok === true,
        sourceRoute: getWarehouseOrderRouteKind(),
        sourceDocumentId: WAREHOUSE_DOCUMENT_INSTANCE_ID,
        resumedAfterReload: false,
        routeTransitionedAt: 0,
        status: 'waiting',
        trigger: 'warehouse-assembly-action'
    };
    markWarehouseAutoResolveCheckSuppressed('automatic-write-intent');
    armWarehouseAutoApplyIntent(warehouseAutoApplyIntent);
    return warehouseAutoApplyIntent;
}

function isWarehouseAutoApplySnapshotFresh(preview = {}, responseSource = '', now = Date.now()) {
    const intent = warehouseAutoApplyIntent;
    if (!intent || intent.status !== 'waiting' || now > intent.expiresAt) {
        return false;
    }

    const previewOrderId = normalizeAmperkotOrderId(getWarehouseBarcodePreviewOrderId(preview));
    if (!previewOrderId || previewOrderId !== intent.orderId || getWarehouseOrderIdFromUrl() !== intent.orderId) {
        return false;
    }

    const eligibleCount = Number(preview?.summary?.eligibleCount || preview?.extraction?.summary?.eligibleCount) || 0;
    if (eligibleCount <= 0) {
        return false;
    }

    if (intent.resumedAfterReload === true
        && intent.sourceDocumentId
        && intent.sourceDocumentId !== WAREHOUSE_DOCUMENT_INSTANCE_ID
        && isWarehouseAssemblyPageUrl()) {
        return true;
    }

    // Same-page automatic writes require exact scanned IDs and successful POST.
    // A changed Angular snapshot alone is not proof of successful assembly.
    if (intent.sourceRoute === 'assembly' && intent.resumedAfterReload !== true) {
        return false;
    }

    // The API may return the already assembled units before newly scanned
    // barcodes become visible. Never auto-write that unchanged snapshot.
    if (intent.baselineKnown === true) {
        const nextFingerprint = getWarehouseBarcodePreviewFingerprint(preview);
        return Boolean(nextFingerprint && nextFingerprint !== intent.baselineFingerprint);
    }

    if (responseSource === 'warehouse-api-response'
        && !(intent.sourceRoute === 'assembly' && intent.resumedAfterReload !== true)) {
        return true;
    }

    if (intent.sourceRoute === 'actions'
        && intent.routeTransitionedAt >= intent.startedAt
        && isWarehouseAssemblyPageUrl()) {
        return true;
    }

    return false;
}

function maybeStartWarehouseAutoApply(preview = {}, responseSource = '', now = Date.now()) {
    const intent = warehouseAutoApplyIntent;
    if (!intent || warehouseAutoBarcodeApplyEnabled !== true) {
        return false;
    }

    if (now > intent.expiresAt) {
        intent.status = 'expired';
        return false;
    }

    if (warehouseOrderKindRecord?.kind !== 'ozon') {
        intent.status = 'cancelled';
        return false;
    }

    if (!isWarehouseAutoApplySnapshotFresh(preview, responseSource, now)) {
        return false;
    }

    intent.status = 'starting';
    intent.snapshotSource = responseSource;
    intent.snapshotAt = now;

    const started = requestWarehouseOzonUiApply({
        trigger: 'automatic',
        actionId: intent.actionId
    });

    if (!started) {
        intent.status = 'failed';
    } else if (intent.status === 'starting') {
        intent.status = 'started';
    }

    return started;
}

function scheduleWarehouseSnapshotAfterAssemblyAction(control = null) {
    if (!isWarehouseOrderWorkflowPageUrl()) {
        return false;
    }

    if (isWarehouseDisassemblyPageUrl()) {
        ensureWarehouseRuntimeMessageListener();
        ensureWarehouseDisassemblyListener();
        ensureWarehouseDisassemblySelectionListener();
        requestWarehouseOrderKind();
        removeWarehouseBarcodePreviewPanel();
        injectWarehouseBarcodeBridgeScript({ requestSnapshotOnLoad: false });
        return true;
    }

    const actionText = getWarehouseAssemblyActionControlText(control);
    clearWarehouseAssemblyActionRefreshTimers('new assembly action');
    const apiCaptureArmed = dispatchWarehouseApiCaptureArm();

    updateWarehouseAssemblyActionDebug({
        actionDetected: true,
        actionText,
        actionExpression: getWarehouseAssemblyActionExpression(control),
        actionTag: control?.tagName || '',
        actionClass: String(control?.className || '').slice(0, 120),
        apiCaptureArmed,
        scheduledAt: new Date().toISOString(),
        reloadTimerState: 'scheduled',
        reloadTimerDelayMs: Math.max(...WAREHOUSE_ASSEMBLY_ACTION_REFRESH_DELAYS_MS),
        reloadTimerClearReason: '',
        reloadFallbackReason: '',
        lastResponseSource: '',
        lastSummary: null
    });

    setWarehouseBarcodePreviewLoading(
        isWarehouseOrderActionsPageUrl()
            ? 'Ждём переход к сборке и свежие штрихкоды. Ozon не изменяем.'
            : 'Ждём ответ склада после сборки. Ozon не изменяем.'
    );

    if (isWarehouseOrderActionsPageUrl()) {
        return true;
    }

    if (typeof setTimeout !== 'function') {
        updateWarehouseAssemblyActionDebug({ reloadTimerState: 'fired', reloadFallbackReason: 'setTimeout unavailable' });
        requestWarehouseShopOrderSnapshot({ resetAttempts: false, reason: 'assembly-action' });
        return true;
    }

    warehouseAssemblyActionRefreshTimers = [];
    WAREHOUSE_ASSEMBLY_ACTION_REFRESH_DELAYS_MS.forEach((delayMs, index) => {
        const timerId = setTimeout(() => {
            warehouseAssemblyActionRefreshTimers = warehouseAssemblyActionRefreshTimers.filter(currentTimerId => currentTimerId !== timerId);
            requestWarehouseShopOrderSnapshot({ resetAttempts: false, reason: 'assembly-action' });

            if (index === WAREHOUSE_ASSEMBLY_ACTION_REFRESH_DELAYS_MS.length - 1) {
                updateWarehouseAssemblyActionDebug({
                    reloadTimerState: 'fired',
                    reloadFallbackReason: 'visible DOM snapshot attempts completed'
                });
            }
        }, delayMs);

        warehouseAssemblyActionRefreshTimers.push(timerId);
    });

    return true;
}

function handleWarehouseAssemblyActionEvent(event) {
    if (event?.isTrusted !== true) {
        return;
    }

    const control = getWarehouseAssemblyActionControl(event?.target);

    if (!isWarehouseAssemblyActionControl(control)) {
        return;
    }

    const now = Date.now();
    const actionSignature = `${getWarehouseOrderIdFromUrl()}|${getWarehouseAssemblyActionExpression(control) || getWarehouseAssemblyActionControlText(control)}`;
    if (actionSignature === lastWarehouseAssemblyActionSignature
        && now - lastWarehouseAssemblyActionAt < 750) {
        return;
    }

    lastWarehouseAssemblyActionSignature = actionSignature;
    lastWarehouseAssemblyActionAt = now;

    if (isWarehouseAutoApplyActionControl(control)) {
        startWarehouseAutoApplyIntent(control, now);
    }
    scheduleWarehouseSnapshotAfterAssemblyAction(control);
}

function handleWarehouseAssemblyActionKeyboardEvent(event) {
    if (event.key !== 'Enter' && event.key !== ' ') {
        return;
    }

    handleWarehouseAssemblyActionEvent(event);
}

function ensureWarehouseAssemblyActionListeners() {
    if (warehouseAssemblyActionListenersInitialized || typeof document?.addEventListener !== 'function') {
        return false;
    }

    document.addEventListener('click', handleWarehouseAssemblyActionEvent, true);
    document.addEventListener('keydown', handleWarehouseAssemblyActionKeyboardEvent, true);
    warehouseAssemblyActionListenersInitialized = true;
    return true;
}

function createWarehouseBarcodePreviewLoading(message = 'Ищем данные сборки на странице склада. Ozon не изменяем.') {
    return {
        ok: null,
        status: 'loading',
        message,
        summary: {
            productCount: 0,
            eligibleCount: 0,
            skippedCount: 0
        }
    };
}

function createWarehouseBarcodePreviewError(errorMessage = 'warehouse shopOrder not found') {
    return {
        ok: false,
        error: errorMessage,
        summary: {
            productCount: 0,
            eligibleCount: 0,
            skippedCount: 0
        }
    };
}

function setWarehouseBarcodePreviewLoading(message) {
    lastWarehouseBarcodePreview = createWarehouseBarcodePreviewLoading(message);
    renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
    return lastWarehouseBarcodePreview;
}


function applyWarehousePreviewStyles(element, styles = {}) {
    if (!element?.style) {
        return element;
    }

    Object.entries(styles).forEach(([key, value]) => {
        element.style[key] = value;
    });

    return element;
}

function createWarehousePreviewElement(tagName, options = {}) {
    if (typeof document.createElement !== 'function') {
        return null;
    }

    const element = document.createElement(tagName);

    if (options.id) {
        element.id = options.id;
    }

    if (options.className) {
        element.className = options.className;
    }

    if (options.attributes && typeof options.attributes === 'object') {
        Object.entries(options.attributes).forEach(([name, value]) => {
            if (typeof element.setAttribute === 'function') {
                element.setAttribute(name, String(value));
            } else {
                element[name] = String(value);
            }
        });
    }

    if (options.text !== undefined) {
        element.textContent = String(options.text);
    }

    applyWarehousePreviewStyles(element, options.styles || {});

    return element;
}

function appendWarehousePreviewText(parent, tagName, text, styles = {}) {
    const element = createWarehousePreviewElement(tagName, { text, styles });

    if (element && parent?.appendChild) {
        parent.appendChild(element);
    }

    return element;
}

function ensureWarehouseBarcodePreviewPanel() {
    if (typeof document.getElementById !== 'function' || typeof document.createElement !== 'function') {
        return null;
    }

    if (warehouseBarcodePreviewPanelElement?.parentNode || warehouseBarcodePreviewPanelElement?.isConnected === true) {
        return warehouseBarcodePreviewPanelElement;
    }

    warehouseBarcodePreviewPanelElement = null;

    const conflictingElement = document.getElementById(WAREHOUSE_BARCODE_PREVIEW_PANEL_ID);
    if (conflictingElement?.parentNode?.removeChild) {
        conflictingElement.parentNode.removeChild(conflictingElement);
    }

    const panel = createWarehousePreviewElement('div', {
        id: WAREHOUSE_BARCODE_PREVIEW_PANEL_ID,
        styles: {
            position: 'fixed',
            right: '16px',
            bottom: '16px',
            width: '260px',
            maxHeight: 'none',
            overflow: 'hidden',
            zIndex: '2147483647',
            pointerEvents: 'auto',
            isolation: 'isolate',
            contain: 'layout style paint',
            transform: 'translateZ(0)',
            padding: '14px',
            border: '1px solid #d4d9e2',
            borderRadius: '12px',
            background: '#ffffff',
            color: '#172133',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)',
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: '13px',
            lineHeight: '18px'
        }
    });

    panel.setAttribute?.('data-tab-wanderer-panel', 'warehouse-barcode-preview');

    const target = document.body || document.documentElement;

    if (!panel || !target?.appendChild) {
        return null;
    }

    target.appendChild(panel);
    warehouseBarcodePreviewPanelElement = panel;
    return panel;
}

function clearWarehousePreviewPanel(panel) {
    if (!panel) {
        return;
    }

    while (panel.firstChild && typeof panel.removeChild === 'function') {
        panel.removeChild(panel.firstChild);
    }

    if (panel.firstChild) {
        panel.textContent = '';
    }
}

function setWarehouseBarcodePreviewPanelCollapsed(collapsed, options = {}) {
    warehouseBarcodePreviewCollapsed = collapsed === true;
    if (options.userInitiated === true) {
        warehouseBarcodePreviewCollapseTouched = true;
    }
    renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
    return warehouseBarcodePreviewCollapsed;
}

function isWarehouseBarcodePreviewPanelCollapsed() {
    return warehouseBarcodePreviewCollapsed;
}

function toggleWarehouseBarcodePreviewPanel() {
    return setWarehouseBarcodePreviewPanelCollapsed(!warehouseBarcodePreviewCollapsed, { userInitiated: true });
}

function setWarehouseBarcodeListExpanded(expanded) {
    warehouseBarcodeListExpanded = expanded === true;
    renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
    return warehouseBarcodeListExpanded;
}

function toggleWarehouseBarcodeList() {
    return setWarehouseBarcodeListExpanded(!warehouseBarcodeListExpanded);
}

function applyWarehouseBarcodePreviewPanelLayout(panel) {
    if (!panel?.style) {
        return;
    }

    panel.style.width = warehouseBarcodePreviewCollapsed ? '260px' : '340px';
    panel.style.maxHeight = warehouseBarcodePreviewCollapsed ? 'none' : '70vh';
    panel.style.overflow = warehouseBarcodePreviewCollapsed ? 'hidden' : 'auto';
    panel.style.padding = warehouseBarcodePreviewCollapsed ? '10px 12px' : '14px';
}

function renderWarehouseBarcodePreviewHeader(panel, viewModel = {}) {
    const header = createWarehousePreviewElement('div', {
        attributes: {
            role: 'button',
            tabindex: '0',
            'aria-label': warehouseBarcodePreviewCollapsed ? 'Развернуть tab_wanderer Ozon barcodes' : 'Свернуть tab_wanderer Ozon barcodes',
            'aria-expanded': warehouseBarcodePreviewCollapsed ? 'false' : 'true',
            'data-tab-wanderer-action': WAREHOUSE_BARCODE_PREVIEW_TOGGLE_ACTION
        },
        styles: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            cursor: 'pointer',
            userSelect: 'none'
        }
    });

    appendWarehousePreviewText(header, 'div', viewModel.title || 'tab_wanderer · Ozon barcodes', {
        fontWeight: '700'
    });
    appendWarehousePreviewText(header, 'div', warehouseBarcodePreviewCollapsed ? 'Развернуть' : 'Свернуть', {
        color: '#005bff',
        fontSize: '12px',
        fontWeight: '700',
        whiteSpace: 'nowrap'
    });

    panel?.appendChild?.(header);
    return header;
}

function ensureWarehouseStockPanel() {
    if (typeof document.getElementById !== 'function' || typeof document.createElement !== 'function') {
        return null;
    }

    if (warehouseStockPanelElement?.parentNode || warehouseStockPanelElement?.isConnected === true) {
        return warehouseStockPanelElement;
    }

    const existing = document.getElementById(WAREHOUSE_STOCK_PANEL_ID);
    if (existing?.parentNode?.removeChild) {
        existing.parentNode.removeChild(existing);
    }

    const panel = createWarehousePreviewElement('div', {
        id: WAREHOUSE_STOCK_PANEL_ID,
        styles: {
            position: 'fixed',
            right: '16px',
            bottom: '16px',
            width: '360px',
            maxHeight: '60vh',
            overflow: 'auto',
            zIndex: '2147483647',
            pointerEvents: 'auto',
            isolation: 'isolate',
            contain: 'layout style paint',
            transform: 'translateZ(0)',
            padding: '14px',
            border: '1px solid #d4d9e2',
            borderRadius: '12px',
            background: '#ffffff',
            color: '#172133',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)',
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: '13px',
            lineHeight: '18px'
        }
    });

    const target = document.body || document.documentElement;
    if (!panel || !target?.appendChild) return null;

    target.appendChild(panel);
    warehouseStockPanelElement = panel;
    return panel;
}

function renderWarehouseStockPanel(viewModel = lastWarehouseStockViewModel) {
    if (!isWarehouseIncomePerformPageUrl()) {
        removeWarehouseStockPanel();
        return false;
    }

    const panel = ensureWarehouseStockPanel();
    if (!panel) return false;

    clearWarehousePreviewPanel(panel);

    appendWarehousePreviewText(panel, 'div', 'Остатки товара', {
        fontWeight: '700',
        fontSize: '14px'
    });

    const viewModels = Array.isArray(viewModel) ? viewModel : (viewModel ? [viewModel] : []);
    if (!viewModels.length) {
        const hasSelectedProducts = warehouseStockObservedProductIdsSignature !== '';
        appendWarehousePreviewText(panel, 'div', hasSelectedProducts
            ? 'Получаем остатки и места хранения...'
            : 'Выберите товар для оприходования.', {
            color: '#667685',
            marginTop: '6px'
        });
        return true;
    }

    viewModels.forEach((model, modelIndex) => {
        if (modelIndex > 0) {
            appendWarehousePreviewText(panel, 'div', '', { marginTop: '10px', borderTop: '1px solid #e2e6ed' });
        }

        if (model.productTitle) {
            appendWarehousePreviewText(panel, 'div', model.productTitle, {
                marginTop: modelIndex ? '10px' : '6px',
                fontWeight: '700'
            });
            appendWarehousePreviewText(panel, 'div', `ID ${model.productId}`, {
                marginTop: '1px',
                color: '#667685',
                fontWeight: '600'
            });
        } else {
            appendWarehousePreviewText(panel, 'div', `Товар ID ${model.productId}`, {
                marginTop: modelIndex ? '10px' : '6px',
                fontWeight: '700'
            });
        }

        appendWarehousePreviewText(panel, 'div', model.message || '', {
            color: model.rows?.length ? '#177245' : '#667685',
            marginTop: '4px',
            marginBottom: '8px',
            fontWeight: '600'
        });

        if (!Array.isArray(model.rows) || !model.rows.length) return;

        const table = createWarehousePreviewElement('div', {
            styles: {
                display: 'grid',
                gridTemplateColumns: model.branch === 'default' ? '1fr 1.7fr auto' : '1fr auto',
                gap: '0',
                border: '1px solid #e2e6ed',
                borderRadius: '8px',
                overflow: 'hidden'
            }
        });

        const addCell = (text, styles = {}) => {
            const cell = createWarehousePreviewElement('div', {
                text,
                styles: {
                    padding: '7px 8px',
                    borderBottom: '1px solid #e8ebf0',
                    ...styles
                }
            });
            table.appendChild(cell);
            return cell;
        };

        if (model.branch === 'default') addCell('Город', { fontWeight: '700', background: '#f8fafc', color: '#667685' });
        addCell('Место', { fontWeight: '700', background: '#f8fafc', color: '#667685' });
        addCell('Кол-во', { fontWeight: '700', background: '#f8fafc', color: '#667685', textAlign: 'right' });

        model.rows.forEach((row, index) => {
            const bottom = index === model.rows.length - 1 ? 'none' : '1px solid #e8ebf0';
            if (model.branch === 'default') addCell(row.cityLabel, { borderBottom: bottom });
            addCell(row.location, { borderBottom: bottom });
            addCell(String(row.totalQuantity), { borderBottom: bottom, textAlign: 'right', fontWeight: '700' });
        });

        panel.appendChild(table);
        appendWarehousePreviewText(panel, 'div', `Всего: ${model.totalQuantity}`, {
            marginTop: '6px',
            fontWeight: '700',
            textAlign: 'right'
        });
    });

    return true;
}

function normalizeWarehouseIncomeProductTitleForContent(value = '') {
    const helper = globalThis.normalizeWarehouseIncomeProductTitle;
    if (typeof helper === 'function' && helper !== normalizeWarehouseIncomeProductTitleForContent) {
        return helper(value);
    }

    return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/^\s*Товар\s*:\s*/i, '')
        .trim();
}

function extractWarehouseIncomeProductTitleFromCard(card) {
    if (!card) return '';

    try {
        const productLinks = Array.from(card.querySelectorAll?.('a[href*="/products/"]') || [])
            .map(link => normalizeWarehouseIncomeProductTitleForContent(link?.textContent || link?.innerText || ''))
            .filter(Boolean);

        if (productLinks.length) {
            return productLinks[0];
        }
    } catch {}

    try {
        const nodes = Array.from(card.querySelectorAll?.('p.ng-binding, p, div, span') || []);
        for (const node of nodes) {
            const text = String(node?.textContent || node?.innerText || '').replace(/\s+/g, ' ').trim();
            const idMatch = text.match(/\bID\s*:\s*(\d{5,})\b/i);
            if (!idMatch) continue;

            const helper = globalThis.extractWarehouseIncomeProductTitleFromCardText;
            const title = typeof helper === 'function'
                ? helper(text)
                : normalizeWarehouseIncomeProductTitleForContent(
                    (text.split(/\bID\s*:\s*\d{5,}\b/i)[0] || '')
                        .split(/(?:Поставщик|Артикул)\s*:/i)[0]
                );

            if (title) return title;
        }
    } catch {}

    // Some WH3 builds expose the product name and ID as sibling nodes but
    // provide no useful querySelectorAll result to the isolated world.
    // Build the card text from direct children as a final DOM fallback.
    try {
        const childTexts = Array.from(card.children || [])
            .map(node => String(node?.textContent || node?.innerText || '').trim())
            .filter(Boolean);

        if (childTexts.length) {
            const helper = globalThis.extractWarehouseIncomeProductTitleFromCardText;
            const combinedText = childTexts.join(' ');
            const title = typeof helper === 'function'
                ? helper(combinedText)
                : normalizeWarehouseIncomeProductTitleForContent(
                    (combinedText.split(/\bID\s*:\s*\d{5,}\b/i)[0] || '')
                        .split(/(?:Поставщик|Артикул)\s*:/i)[0]
                );

            if (title) return title;
        }
    } catch {}

    return '';
}

function getWarehouseIncomeProductSelections() {
    if (!isWarehouseIncomePerformPageUrl()) return [];

    const selectedCards = [];
    const collectSelectionFromCard = card => {
        if (!card) return null;

        const title = extractWarehouseIncomeProductTitleFromCard(card);
        const paragraphs = card.querySelectorAll?.('p.ng-binding, p') || [];
        let productId = '';

        for (const paragraph of paragraphs) {
            const text = String(paragraph?.textContent || paragraph?.innerText || '')
                .replace(/\s+/g, ' ')
                .trim();
            const match = text.match(/\bID\s*:\s*(\d{5,})\b/i);
            if (match) {
                productId = normalizeWarehouseBridgeId(match[1]);
                break;
            }
        }

        if (!productId) {
            const cardText = String(card?.textContent || card?.innerText || '')
                .replace(/\s+/g, ' ')
                .trim();
            const match = cardText.match(/\bID\s*:\s*(\d{5,})\b/i);
            if (match) productId = normalizeWarehouseBridgeId(match[1]);
        }

        if (!productId) return null;

        return { card, productId, title };
    };

    try {
        const cards = Array.from(document.querySelectorAll?.('.panel-body') || []);

        for (const card of cards) {
            const inlineOpacity = String(card?.style?.opacity || '').trim();
            let selected = inlineOpacity === '1';

            if (!selected && typeof getComputedStyle === 'function') {
                try {
                    selected = String(getComputedStyle(card).opacity || '').trim() === '1';
                } catch {}
            }

            if (!selected) continue;

            const selection = collectSelectionFromCard(card);
            if (selection) selectedCards.push(selection);
        }
    } catch {}

    // WH3 can briefly leave both the old and the new card with opacity 1
    // while replacing a product. There is only one product being edited on
    // this income form, so the last selected card in DOM order is the active
    // one. Never return both cards: that would resurrect stale stock.
    const activeSelection = selectedCards.at(-1) || null;

    if (!activeSelection) {
        warehouseStockSelectedCardElement = null;
        return [];
    }

    warehouseStockSelectedCardElement = activeSelection.card;
    return [{
        productId: activeSelection.productId,
        title: normalizeWarehouseIncomeProductTitleForContent(activeSelection.title)
    }];
}

function getWarehouseIncomeProductIds() {
    return getWarehouseIncomeProductSelections().map(selection => selection.productId);
}

function dispatchWarehouseStockSummaryRequest(productId) {
    const normalizedProductId = normalizeWarehouseBridgeId(productId);
    if (!normalizedProductId) return false;

    window.dispatchEvent(new CustomEvent(WAREHOUSE_STOCK_SUMMARY_REQUEST_EVENT, {
        detail: { productId: normalizedProductId }
    }));
    return true;
}

function renderWarehouseStockPayloads() {
    const viewModels = Array.from(warehouseStockPayloads.values())
        .map(entry => createWarehouseStockViewModel(
            entry.payload,
            warehouseStockBranch,
            entry.productId,
            warehouseStockProductMeta.get(entry.productId)?.title || ''
        ));

    lastWarehouseStockViewModel = viewModels;
    renderWarehouseStockPanel(viewModels);
    return viewModels;
}

function clearWarehouseStockProductState() {
    warehouseStockPayloads.clear();
    warehouseStockRequestInFlight.clear();
    warehouseStockProductMeta.clear();
    lastWarehouseStockPayload = null;
    lastWarehouseStockViewModel = null;
}

function applyWarehouseIncomeProductSelection(productId, title = '') {
    const normalizedProductId = normalizeWarehouseBridgeId(productId);
    const normalizedTitle = normalizeWarehouseIncomeProductTitleForContent(title);

    if (normalizedProductId === warehouseStockCurrentProductId) {
        if (normalizedTitle) {
            warehouseStockCurrentProductTitle = normalizedTitle;
            warehouseStockProductMeta.set(normalizedProductId, { title: normalizedTitle });
        }
        return false;
    }

    warehouseStockCurrentProductId = normalizedProductId;
    warehouseStockCurrentProductTitle = normalizedTitle;
    warehouseStockObservedProductIdsSignature = normalizedProductId;
    clearWarehouseStockProductState();

    if (!normalizedProductId) {
        warehouseStockSelectedCardElement = null;
        renderWarehouseStockPayloads();
        return true;
    }

    warehouseStockProductMeta.set(normalizedProductId, { title: normalizedTitle });
    renderWarehouseStockPayloads();

    if (!warehouseStockRequestInFlight.has(normalizedProductId)) {
        warehouseStockRequestInFlight.add(normalizedProductId);
        dispatchWarehouseStockSummaryRequest(normalizedProductId);
    }

    return true;
}

function syncWarehouseIncomeProducts() {
    if (!isWarehouseIncomePerformPageUrl()) return false;

    const selections = getWarehouseIncomeProductSelections();
    const activeSelection = selections[0] || null;
    const productId = normalizeWarehouseBridgeId(activeSelection?.productId || '');
    const title = normalizeWarehouseIncomeProductTitleForContent(activeSelection?.title || '');
    const previousSelectedCard = warehouseStockSelectedCardElement;
    warehouseStockSelectedCardElement = activeSelection?.card || null;

    if (!productId) {
        const hadState = warehouseStockCurrentProductId !== ''
            || warehouseStockPayloads.size > 0
            || warehouseStockRequestInFlight.size > 0
            || warehouseStockProductMeta.size > 0;
        applyWarehouseIncomeProductSelection('', '');
        return hadState;
    }

    const selectedCardChanged = previousSelectedCard !== warehouseStockSelectedCardElement;
    const productChanged = productId !== warehouseStockCurrentProductId;

    if (productChanged || selectedCardChanged) {
        applyWarehouseIncomeProductSelection(productId, title);
        return true;
    }

    if (title) {
        warehouseStockCurrentProductTitle = title;
        warehouseStockProductMeta.set(productId, { title });
    }

    // The income form represents one product. Never retain payloads for any
    // other product, even if WH3 briefly keeps stale DOM cards alive.
    for (const staleProductId of Array.from(warehouseStockPayloads.keys())) {
        if (staleProductId !== warehouseStockCurrentProductId) {
            warehouseStockPayloads.delete(staleProductId);
        }
    }
    for (const staleProductId of Array.from(warehouseStockRequestInFlight)) {
        if (staleProductId !== warehouseStockCurrentProductId) {
            warehouseStockRequestInFlight.delete(staleProductId);
        }
    }
    for (const staleProductId of Array.from(warehouseStockProductMeta.keys())) {
        if (staleProductId !== warehouseStockCurrentProductId) {
            warehouseStockProductMeta.delete(staleProductId);
        }
    }

    renderWarehouseStockPayloads();
    return false;
}

function scheduleWarehouseIncomeProductSync() {
    if (!isWarehouseIncomePerformPageUrl() || typeof setTimeout !== 'function') return false;
    if (warehouseStockProductSyncTimer) return true;

    warehouseStockProductSyncTimer = setTimeout(() => {
        warehouseStockProductSyncTimer = null;
        syncWarehouseIncomeProducts();
    }, 80);
    return true;
}

function stopWarehouseIncomeProductObserver() {
    if (warehouseStockProductSyncTimer && typeof clearTimeout === 'function') {
        clearTimeout(warehouseStockProductSyncTimer);
    }
    warehouseStockProductSyncTimer = null;

    if (warehouseStockProductPollTimer && typeof clearInterval === 'function') {
        clearInterval(warehouseStockProductPollTimer);
    }
    warehouseStockProductPollTimer = null;

    if (warehouseStockProductObserver?.disconnect) {
        try { warehouseStockProductObserver.disconnect(); } catch {}
    }
    warehouseStockProductObserver = null;
    warehouseStockObservedProductIdsSignature = '';
    warehouseStockCurrentProductId = '';
    warehouseStockCurrentProductTitle = '';
}

function ensureWarehouseIncomeProductObserver() {
    if (!isWarehouseIncomePerformPageUrl()) return false;
    if (warehouseStockProductObserver) {
        scheduleWarehouseIncomeProductSync();
        return true;
    }

    const observeTarget = document.body || document.documentElement;

    if (typeof MutationObserver === 'function' && observeTarget) {
        try {
            warehouseStockProductObserver = new MutationObserver(() => scheduleWarehouseIncomeProductSync());
            warehouseStockProductObserver.observe(observeTarget, { childList: true, subtree: true, characterData: true });
        } catch {
            warehouseStockProductObserver = null;
        }
    }

    // Render immediately when possible. If Angular has not attached <body>
    // yet, the route watcher/poll below will retry on the next pass.
    renderWarehouseStockPayloads();
    syncWarehouseIncomeProducts();

    // Angular can update the selected-product card without producing a DOM
    // mutation that is visible to the observer (especially during digest
    // updates). A lightweight poll closes that race; unchanged product
    // signatures are ignored, so it does not repeat API requests.
    if (!warehouseStockProductPollTimer && typeof setInterval === 'function') {
        warehouseStockProductPollTimer = setInterval(() => {
            if (!isWarehouseIncomePerformPageUrl()) {
                stopWarehouseIncomeProductObserver();
                return;
            }
            renderWarehouseStockPayloads();
            syncWarehouseIncomeProducts();
        }, 500);
    }

    return true;
}

function removeWarehouseStockPanel() {
    stopWarehouseIncomeProductObserver();

    const panel = warehouseStockPanelElement
        || (typeof document.getElementById === 'function' ? document.getElementById(WAREHOUSE_STOCK_PANEL_ID) : null);

    if (panel?.parentNode?.removeChild) {
        panel.parentNode.removeChild(panel);
    }

    warehouseStockPanelElement = null;
    lastWarehouseStockViewModel = null;
    lastWarehouseStockPayload = null;
    warehouseStockPayloads = new Map();
    warehouseStockRequestInFlight = new Set();
    warehouseStockProductMeta = new Map();
    warehouseStockSelectedCardElement = null;
    warehouseStockObservedProductIdsSignature = '';
    warehouseStockCurrentProductId = '';
    warehouseStockCurrentProductTitle = '';
}

function applyWarehouseStockBranch(value, { render = true } = {}) {
    const previousBranch = warehouseStockBranch;
    const nextBranch = normalizeWarehouseStockBranch(value);
    cityDebug('apply:branch', {
        previousBranch,
        nextBranch,
        render,
        configRevision: warehouseStockBranchConfigRevision
    });
    warehouseStockBranch = nextBranch;
    if (render) renderWarehouseStockPayloads();
    return warehouseStockBranch;
}

function handleWarehouseStockSummaryResponse(event) {
    const detail = event?.detail || {};
    const productId = normalizeWarehouseBridgeId(detail.productId);
    if (!productId || !isWarehouseIncomePerformPageUrl()) return false;

    warehouseStockRequestInFlight.delete(productId);

    // Validate against the product that was current when the latest
    // selection was observed, not by rescanning a transient WH3 DOM. The
    // latter can briefly show the removed card again while Angular replaces
    // the form and could resurrect stale API responses.
    if (productId !== warehouseStockCurrentProductId) {
        warehouseStockPayloads.delete(productId);
        renderWarehouseStockPayloads();
        return false;
    }

    if (!detail.ok || !detail.payload) {
        warehouseStockPayloads.delete(productId);
        renderWarehouseStockPayloads();
        return false;
    }

    if (!warehouseStockProductMeta.has(productId)) {
        warehouseStockProductMeta.set(productId, { title: '' });
    }

    warehouseStockPayloads.set(productId, { payload: detail.payload, productId });
    lastWarehouseStockPayload = { payload: detail.payload, productId };
    renderWarehouseStockPayloads();
    return true;
}

function ensureWarehouseStockListener() {
    if (warehouseStockListenerInitialized) return true;
    window.addEventListener?.(WAREHOUSE_STOCK_SUMMARY_RESPONSE_EVENT, handleWarehouseStockSummaryResponse);
    window.addEventListener?.(WAREHOUSE_INCOME_SELECTION_EVENT, event => {
        if (!isWarehouseIncomePerformPageUrl()) return;
        applyWarehouseIncomeProductSelection(event?.detail?.productId, event?.detail?.title);
    });
    window.addEventListener?.('message', event => {
        const detail = event?.data?.type === WAREHOUSE_STOCK_SUMMARY_RESPONSE_EVENT
            ? event?.data?.detail
            : null;
        if (!detail) return;
        handleWarehouseStockSummaryResponse({ detail });
    });
    warehouseStockListenerInitialized = true;
    return true;
}

const WAREHOUSE_STOCK_BRANCH_CONFIG_MAX_ATTEMPTS = 5;
const WAREHOUSE_STOCK_BRANCH_CONFIG_RETRY_MS = 500;

function clearWarehouseStockBranchConfigRetryTimer() {
    if (warehouseStockBranchConfigRetryTimer) {
        clearTimeout(warehouseStockBranchConfigRetryTimer);
        warehouseStockBranchConfigRetryTimer = null;
    }
}

function requestWarehouseStockConfig({ resetAttempts = true } = {}) {
    if (resetAttempts) {
        warehouseStockBranchConfigRequestAttempt = 0;
        clearWarehouseStockBranchConfigRetryTimer();
    }

    const requestRevision = warehouseStockBranchConfigRevision;
    warehouseStockBranchConfigRequestAttempt += 1;

    cityDebug('config:request', {
        attempt: warehouseStockBranchConfigRequestAttempt,
        requestRevision,
        localBranch: warehouseStockBranch
    });

    try {
        chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
            const runtimeError = chrome.runtime.lastError;

            cityDebug('config:response', {
                attempt: warehouseStockBranchConfigRequestAttempt,
                requestRevision,
                currentRevision: warehouseStockBranchConfigRevision,
                runtimeError: runtimeError?.message || null,
                ok: response?.ok === true,
                responseBranch: response?.userConfig?.warehouseStockBranch,
                localBranch: warehouseStockBranch
            });

            if (runtimeError || !response?.ok || requestRevision !== warehouseStockBranchConfigRevision) {
                if (requestRevision !== warehouseStockBranchConfigRevision) {
                    return;
                }

                if (warehouseStockBranchConfigRequestAttempt < WAREHOUSE_STOCK_BRANCH_CONFIG_MAX_ATTEMPTS) {
                    clearWarehouseStockBranchConfigRetryTimer();
                    warehouseStockBranchConfigRetryTimer = setTimeout(() => {
                        warehouseStockBranchConfigRetryTimer = null;
                        requestWarehouseStockConfig({ resetAttempts: false });
                    }, WAREHOUSE_STOCK_BRANCH_CONFIG_RETRY_MS);
                }

                return;
            }

            clearWarehouseStockBranchConfigRetryTimer();
            warehouseStockBranchConfigRequestAttempt = 0;
            applyWarehouseStockBranch(response.userConfig?.warehouseStockBranch, { render: true });
        });
    } catch {
        if (warehouseStockBranchConfigRequestAttempt < WAREHOUSE_STOCK_BRANCH_CONFIG_MAX_ATTEMPTS) {
            clearWarehouseStockBranchConfigRetryTimer();
            warehouseStockBranchConfigRetryTimer = setTimeout(() => {
                warehouseStockBranchConfigRetryTimer = null;
                requestWarehouseStockConfig({ resetAttempts: false });
            }, WAREHOUSE_STOCK_BRANCH_CONFIG_RETRY_MS);
        }
    }
}

function removeWarehouseBarcodePreviewPanel() {
    const panel = warehouseBarcodePreviewPanelElement
        || (typeof document.getElementById === 'function'
            ? document.getElementById(WAREHOUSE_BARCODE_PREVIEW_PANEL_ID)
            : null);

    if (panel?.parentNode?.removeChild) {
        panel.parentNode.removeChild(panel);
    }

    warehouseBarcodePreviewPanelElement = null;
}

function isElementInsideWarehousePreviewPanel(element) {
    const panel = warehouseBarcodePreviewPanelElement;

    if (!panel || !element) {
        return false;
    }

    if (element === panel) {
        return true;
    }

    if (typeof panel.contains === 'function') {
        try {
            return panel.contains(element);
        } catch {}
    }

    let current = element;
    while (current) {
        if (current === panel) {
            return true;
        }
        current = current.parentNode || null;
    }

    return false;
}

function getWarehousePreviewActionTarget(target) {
    const actionTarget = target?.closest?.(`#${WAREHOUSE_BARCODE_PREVIEW_REFRESH_BUTTON_ID}, #${WAREHOUSE_OZON_RESOLVE_BUTTON_ID}, #${WAREHOUSE_OZON_APPLY_BUTTON_ID}, [data-tab-wanderer-action]`) || null;

    return isElementInsideWarehousePreviewPanel(actionTarget) ? actionTarget : null;
}

function isWarehousePreviewActionTarget(target) {
    return !!getWarehousePreviewActionTarget(target);
}

function handleWarehousePreviewActionEvent(event) {
    const actionTarget = getWarehousePreviewActionTarget(event?.target);

    if (!actionTarget) {
        return;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    if (actionTarget.getAttribute?.('aria-disabled') === 'true') {
        return;
    }

    const action = actionTarget.getAttribute?.('data-tab-wanderer-action');

    if (action === WAREHOUSE_BARCODE_PREVIEW_TOGGLE_ACTION) {
        toggleWarehouseBarcodePreviewPanel();
        return;
    }

    if (action === WAREHOUSE_BARCODE_LIST_TOGGLE_ACTION || action === 'barcode-list') {
        setWarehouseBarcodePreviewPanelCollapsed(false, { userInitiated: true });
        toggleWarehouseBarcodeList();
        return;
    }

    if (action === 'ozon-resolve') {
        requestWarehouseOzonResolvePreview();
        return;
    }

    if (action === 'ozon-sold-compare-log') {
        if (event?.isTrusted !== true) return;
        const orderId = getWarehouseOrderIdFromUrl();
        if (!orderId) return;
        sendRuntimeMessage({type:'GET_WAREHOUSE_SOLD_COMPARE_LOG',orderId}, response => {
            if (response?.ok !== true || !Array.isArray(response.events)) {
                log('WARN','WAREHOUSE_OZON','Cannot download barcode comparison log',response?.error || 'No response');
                return;
            }
            try {
                const blob = new Blob([JSON.stringify({
                    version:response.version, orderId:response.orderId,
                    exportedAt:response.exportedAt, retainedLogTruncated:response.retainedLogTruncated,
                    events:response.events
                },null,2)],{type:'application/json'});
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `tw-ozon-sold-compare-${orderId}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
                link.click();
                setTimeout(()=>URL.revokeObjectURL(url),1000);
            } catch (error) {
                log('WARN','WAREHOUSE_OZON','Unable to generate comparison log',String(error?.message||error));
            }
        },'WAREHOUSE_OZON');
        return;
    }

    if (action === 'ozon-sold-delete') {
        if (event?.isTrusted !== true || warehouseSoldCleanupState !== 'ready') return;
        warehouseSoldCleanupState = 'deleting';
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
        sendRuntimeMessage({type:'OZON_WAREHOUSE_SOLD_DELETE_REQUEST',orderId:getWarehouseOrderIdFromUrl()}, result => {
            if (result?.ok !== true) {
                warehouseSoldCleanupState = 'error';
                log('WARN','WAREHOUSE_OZON','manual sold cleanup rejected',result?.error || 'unknown error');
                renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
            }
        }, 'WAREHOUSE_OZON');
        return;
    }

    if (action === 'ozon-ui-apply') {
        if (event?.isTrusted !== true) {
            log('WARN', 'WAREHOUSE_OZON', 'blocked untrusted Ozon write action');
            return;
        }

        requestWarehouseOzonUiApply();
        return;
    }

    requestWarehouseShopOrderSnapshot();
}

function handleWarehousePreviewKeyboardEvent(event) {
    if (!isWarehousePreviewActionTarget(event?.target)) {
        return;
    }

    if (event.key !== 'Enter' && event.key !== ' ') {
        return;
    }

    handleWarehousePreviewActionEvent(event);
}

function ensureWarehousePreviewActionListeners() {
    if (warehousePreviewActionListenersInitialized) {
        return;
    }

    const target = document;

    target.addEventListener?.('click', handleWarehousePreviewActionEvent, true);
    target.addEventListener?.('keydown', handleWarehousePreviewKeyboardEvent, true);

    warehousePreviewActionListenersInitialized = true;
}


function renderWarehouseGroupedBarcodeList(panel, products = [], title = 'Список штрихкодов') {
    const listProducts = products.filter(product => product.barcodes.length > 0 || product.skippedBarcodes.length > 0);

    if (!listProducts.length) {
        return null;
    }

    const wrapper = createWarehousePreviewElement('div', {
        styles: {
            marginTop: '10px',
            marginBottom: '10px',
            padding: '8px',
            border: '1px solid #d4d9e2',
            borderRadius: '8px',
            background: '#f8fafc',
            userSelect: 'text',
            cursor: 'text'
        }
    });

    appendWarehousePreviewText(wrapper, 'div', title, {
        fontWeight: '700',
        marginBottom: '6px',
        userSelect: 'text'
    });

    listProducts.forEach(product => {
        const item = createWarehousePreviewElement('div', {
            styles: {
                paddingTop: '6px',
                marginTop: '6px',
                borderTop: '1px solid #e6e9ef',
                userSelect: 'text'
            }
        });

        appendWarehousePreviewText(
            item,
            'div',
            `${product.productId}${product.productTitle ? ` · ${product.productTitle}` : ''}`,
            { fontWeight: '600', userSelect: 'text' }
        );

        if (product.barcodes.length) {
            appendWarehousePreviewText(item, 'div', 'Штрихкоды:', {
                color: '#667685',
                fontSize: '12px',
                marginTop: '4px',
                userSelect: 'text'
            });
            appendWarehousePreviewText(item, 'div', product.barcodes.join('\n'), {
                whiteSpace: 'pre-wrap',
                fontFamily: 'Consolas, "Courier New", monospace',
                fontSize: '12px',
                lineHeight: '18px',
                userSelect: 'text'
            });
        }

        if (Array.isArray(product.skippedBarcodeGroups) && product.skippedBarcodeGroups.length) {
            product.skippedBarcodeGroups.forEach(group => {
                appendWarehousePreviewText(item, 'div', `${group.label} (${group.count}):`, {
                    color: '#667685',
                    fontSize: '12px',
                    marginTop: '4px',
                    userSelect: 'text'
                });

                if (group.barcodes.length) {
                    appendWarehousePreviewText(item, 'div', group.barcodes.join('\n'), {
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'Consolas, "Courier New", monospace',
                        fontSize: '12px',
                        lineHeight: '18px',
                        userSelect: 'text'
                    });
                }
            });
        }

        wrapper?.appendChild?.(item);
    });

    panel?.appendChild?.(wrapper);
    return wrapper;
}

function renderWarehouseBarcodeListDropdown(panel, products = []) {
    if (!warehouseBarcodeListExpanded) return null;
    return renderWarehouseGroupedBarcodeList(panel, products);
}

function renderWarehouseBarcodePreviewPanel(preview = lastWarehouseBarcodePreview) {
    // Assembly helper must never appear on the disassembly route, including
    // late callbacks from order-kind and Ozon verification requests.
    if (isWarehouseDisassemblyPageUrl()) {
        removeWarehouseBarcodePreviewPanel();
        return false;
    }
    // The Ozon barcode helper has no role on income/receiving pages. Keep this
    // guard at the renderer boundary because late async Ozon responses can
    // otherwise recreate the panel after route cleanup.
    if (isWarehouseIncomePerformPageUrl()) {
        removeWarehouseBarcodePreviewPanel();
        return false;
    }

    const panel = ensureWarehouseBarcodePreviewPanel();

    if (!panel) {
        return false;
    }

    const viewModel = createWarehouseBarcodePreviewViewModel(preview);
    if (preview?.partialConfirmed) {
        // Incomplete panel data is informational, never a manual Ozon write plan.
        viewModel.actions = (viewModel.actions || []).filter(action =>
            !['ozon-ui-apply', 'ozon-resolve'].includes(action.id));
    }

    clearWarehousePreviewPanel(panel);
    applyWarehouseBarcodePreviewPanelLayout(panel);
    renderWarehouseBarcodePreviewHeader(panel, viewModel);
    if (preview?.partialConfirmed) {
        appendWarehousePreviewText(panel, 'div', preview.partialMessage, {
            color: '#805b19', marginTop: '5px', fontSize: '12px', whiteSpace: 'normal'
        });
    }

    const orderKindDisplay = getWarehouseOrderKindDisplay();
    appendWarehousePreviewText(panel, 'div', orderKindDisplay.text, {
        color: orderKindDisplay.color,
        marginTop: '6px',
        fontSize: '12px',
        fontWeight: '700'
    });

    if (warehouseBarcodePreviewCollapsed) {
        appendWarehousePreviewText(panel, 'div', viewModel.message, {
            color: viewModel.status === 'error' ? '#db2919' : '#667685',
            marginTop: '2px',
            fontSize: '12px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
        });
        ensureWarehousePreviewActionListeners();
        return true;
    }

    appendWarehousePreviewText(panel, 'div', viewModel.message, {
        color: viewModel.status === 'error' ? '#db2919' : '#667685',
        marginTop: '4px',
        marginBottom: '10px'
    });

    if (viewModel.metrics.length) {
        const metrics = createWarehousePreviewElement('div', {
            styles: {
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '6px',
                marginBottom: '10px'
            }
        });

        viewModel.metrics.forEach(metric => {
            const item = createWarehousePreviewElement('div', {
                styles: {
                    padding: '6px 8px',
                    borderRadius: '8px',
                    background: '#f5f7fa'
                }
            });

            appendWarehousePreviewText(item, 'div', metric.label, {
                color: '#667685',
                fontSize: '11px'
            });
            appendWarehousePreviewText(item, 'div', metric.value, {
                fontWeight: '700'
            });

            metrics?.appendChild?.(item);
        });

        panel.appendChild?.(metrics);
    }

    if (viewModel.products.length) {
        appendWarehousePreviewText(panel, 'div', 'Товары', {
            fontWeight: '700',
            marginBottom: '6px'
        });

        const list = createWarehousePreviewElement('div', {
            styles: {
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                marginBottom: '10px'
            }
        });

        viewModel.products.slice(0, 5).forEach(product => {
            const item = createWarehousePreviewElement('div', {
                styles: {
                    padding: '6px 8px',
                    border: '1px solid #eceff2',
                    borderRadius: '8px'
                }
            });

            appendWarehousePreviewText(
                item,
                'div',
                `${product.productId}${product.productTitle ? ` · ${product.productTitle}` : ''}`,
                { fontWeight: '600' }
            );
            const productSummaryText = createWarehouseBarcodeProductSummaryText(product);

            if (productSummaryText) {
                appendWarehousePreviewText(
                    item,
                    'div',
                    productSummaryText,
                    { color: '#667685', fontSize: '12px' }
                );
            }

            const ozonApplyText = createWarehouseOzonApplyProductText(product);
            const ozonResolveText = ozonApplyText ? '' : createWarehouseOzonResolveProductText(product);

            if (ozonResolveText) {
                appendWarehousePreviewText(
                    item,
                    'div',
                    ozonResolveText,
                    { color: product.ozonStatus === 'error' ? '#db2919' : '#667685', fontSize: '12px' }
                );
            }

            if (ozonApplyText) {
                appendWarehousePreviewText(
                    item,
                    'div',
                    ozonApplyText,
                    { color: product.ozonApplyHasProblem ? '#db2919' : '#667685', fontSize: '12px' }
                );
            }

            list?.appendChild?.(item);
        });

        if (viewModel.products.length > 5) {
            appendWarehousePreviewText(
                list,
                'div',
                `Еще товаров: ${viewModel.products.length - 5}`,
                { color: '#667685', fontSize: '12px' }
            );
        }

        panel.appendChild?.(list);
    }

    if (orderKindDisplay.kind === 'ozon' || orderKindDisplay.text?.toLowerCase().includes('ozon')) {
        const count = warehouseSoldCleanupPreview.reduce((sum,row)=>sum+(Number(row.count)||0),0);
        const status = warehouseSoldCleanupState === 'ready'
            ? `Проданные ШК в Ozon: ${count}`
            : warehouseSoldCleanupState === 'deleting' ? 'Удаляем проданные ШК…'
            : warehouseSoldCleanupState === 'removed' ? `Проданные ШК успешно удалены из Ozon: ${warehouseSoldCleanupRemovedCount}`
            : warehouseSoldCleanupState === 'error' ? 'Не удалось удалить ШК. См. диагностику.'
            : 'Проданные ШК в Ozon не найдены';
        appendWarehousePreviewText(panel,'div',status,{
            marginBottom:'8px',fontSize:'12px',fontWeight:'700',
            color:warehouseSoldCleanupState==='error'?'#db2919':'#42607a'
        });
        if (warehouseSoldCleanupPreview.length && warehouseSoldCleanupState === 'ready') {
            const details = createWarehousePreviewElement('details', {
                styles: { marginBottom: '10px', border: '1px solid #d9e0e7',
                    borderRadius: '8px', padding: '7px 9px', fontSize: '12px' }
            });
            details.open = warehouseSoldCleanupListExpanded;
            details.addEventListener?.('toggle', () => {
                warehouseSoldCleanupListExpanded = details.open;
            });
            const summary = createWarehousePreviewElement('summary', {
                text: `ШК на удаление (${count})`,
                styles: { cursor: 'pointer', fontWeight: '700', color: '#42607a' }
            });
            details.appendChild?.(summary);
            const list = createWarehousePreviewElement('div', {
                styles: { maxHeight: '260px', overflowY: 'auto', marginTop: '8px',
                    display: 'flex', flexDirection: 'column', gap: '8px' }
            });
            for (const product of warehouseSoldCleanupPreview) {
                const group = createWarehousePreviewElement('div');
                appendWarehousePreviewText(group, 'div', `Артикул ${product.productId} · ${product.count} ШК`, {
                    fontWeight: '700', marginBottom: '3px'
                });
                for (const item of product.entries || []) {
                    appendWarehousePreviewText(group, 'div',
                        `${item.barcode} · заказ ${item.orderNumber || 'не указан'}`, {
                            fontFamily: 'monospace', padding: '2px 0', overflowWrap: 'anywhere'
                        });
                }
                list.appendChild?.(group);
            }
            details.appendChild?.(list);
            panel.appendChild?.(details);
        }
        if (warehouseSoldCleanupFailedProducts && warehouseSoldCleanupState === 'ready') {
            appendWarehousePreviewText(panel,'div',`Не проверено артикулов: ${warehouseSoldCleanupFailedProducts}`,
                {color:'#b26a00',fontSize:'12px',marginBottom:'8px'});
        }
        if (warehouseSoldCleanupState === 'ready') {
            const button = createWarehousePreviewElement('div',{
                id:WAREHOUSE_SOLD_DELETE_BUTTON_ID,text:'Удалить проданные ШК',
                attributes:{role:'button',tabindex:'0','aria-disabled':'false',
                    'data-tab-wanderer-action':'ozon-sold-delete'},
                styles:{padding:'8px 10px',marginBottom:'10px',borderRadius:'8px',
                    background:'#db2919',color:'#fff',textAlign:'center',
                    cursor:'pointer',fontWeight:'700'}
            });
            panel.appendChild?.(button);
        }
    }

    if (orderKindDisplay.kind === 'ozon' || orderKindDisplay.text?.toLowerCase().includes('ozon')) {
        const diagnosticButton = createWarehousePreviewElement('div', {
            id: WAREHOUSE_SOLD_COMPARE_LOG_BUTTON_ID,
            text: 'Скачать лог сверки ШК',
            attributes: {role:'button',tabindex:'0','data-tab-wanderer-action':'ozon-sold-compare-log'},
            styles: {fontSize:'12px',color:'#005bff',cursor:'pointer',marginBottom:'10px',textDecoration:'underline'}
        });
        panel.appendChild?.(diagnosticButton);
    }

    const actionList = Array.isArray(viewModel.actions) && viewModel.actions.length
        ? viewModel.actions
        : [];

    actionList.forEach(action => {
        const variant = action.variant || 'primary';
        const isSecondary = variant === 'secondary';
        const disabled = action.disabled === true;
        const backgroundByVariant = {
            primary: '#005bff',
            success: '#169c46',
            danger: '#db2919',
            loading: '#667685'
        };
        const buttonBackground = isSecondary ? '#ffffff' : backgroundByVariant[variant] || backgroundByVariant.primary;
        const buttonColor = isSecondary ? '#005bff' : '#ffffff';
        const buttonBorder = isSecondary ? '1px solid #005bff' : '0';
        const button = createWarehousePreviewElement('div', {
            id: action.id === 'ozon-resolve' ? WAREHOUSE_OZON_RESOLVE_BUTTON_ID : action.id === 'ozon-ui-apply' ? WAREHOUSE_OZON_APPLY_BUTTON_ID : action.id === 'barcode-list' ? WAREHOUSE_BARCODE_LIST_BUTTON_ID : WAREHOUSE_BARCODE_PREVIEW_REFRESH_BUTTON_ID,
            text: action.label,
            attributes: {
                role: 'button',
                tabindex: disabled ? '-1' : '0',
                'aria-label': action.label,
                'aria-disabled': disabled ? 'true' : 'false',
                'data-tab-wanderer-action': action.id
            },
            styles: {
                width: '100%',
                padding: '8px 10px',
                border: buttonBorder,
                borderRadius: '8px',
                background: buttonBackground,
                color: buttonColor,
                cursor: disabled ? 'default' : 'pointer',
                fontWeight: '700',
                pointerEvents: 'auto',
                opacity: disabled && variant !== 'success' ? '0.65' : '1',
                textAlign: 'center',
                boxSizing: 'border-box',
                userSelect: 'none',
                marginTop: actionList.indexOf(action) === 0 ? '0' : '8px'
            }
        });

        panel.appendChild?.(button);
    });

    renderWarehouseBarcodeListDropdown(panel, viewModel.products);
    ensureWarehousePreviewActionListeners();

    return true;
}



function getWarehouseOzonResolveRequestPayload() {
    const preview = lastWarehouseBarcodePreview;

    if (!preview?.ok || !preview.extraction) {
        return null;
    }

    return {
        orderId: getWarehouseBarcodePreviewOrderId(preview),
        warehouseExtraction: preview.extraction
    };
}



function requestWarehouseOzonUiApply(options = {}) {
    const confirmedExtraction = options?.warehouseExtraction;
    const payload = confirmedExtraction
        ? { orderId: confirmedExtraction.orderId, warehouseExtraction: confirmedExtraction }
        : getWarehouseOzonResolveRequestPayload();
    const trigger = options.trigger === 'automatic' ? 'automatic' : 'manual';
    const actionId = trigger === 'automatic'
        ? String(options.actionId || '').slice(0, 160)
        : '';

    function getMatchingAutoApplyIntent() {
        if (trigger !== 'automatic' || !actionId) {
            return null;
        }

        return warehouseAutoApplyIntent?.actionId === actionId
            ? warehouseAutoApplyIntent
            : null;
    }

    if (!payload) {
        lastWarehouseOzonUiApply = createWarehouseOzonUiApplyError('Сначала прочитай штрихкоды склада.');
        const matchingIntent = getMatchingAutoApplyIntent();
        if (matchingIntent) {
            matchingIntent.status = 'failed';
            matchingIntent.error = 'warehouse barcode preview unavailable';
        }
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
        return false;
    }

    lastWarehouseOzonUiApply = createWarehouseOzonUiApplyLoading();
    renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);

    const sent = sendRuntimeMessage({
        type: 'OZON_UI_APPLY_REQUEST',
        trigger,
        actionId,
        documentInstanceId: WAREHOUSE_DOCUMENT_INSTANCE_ID,
        ...payload
    }, (response) => {
        const runtimeError = getRuntimeLastError();
        const matchingIntent = getMatchingAutoApplyIntent();

        if (runtimeError) {
            if (!handleRuntimeMessagingError('WAREHOUSE_OZON', runtimeError)) {
                lastWarehouseOzonUiApply = createWarehouseOzonUiApplyError(runtimeError.message || 'Ozon worker unavailable');
                if (matchingIntent) {
                    matchingIntent.status = 'failed';
                    matchingIntent.error = runtimeError.message || 'Ozon worker unavailable';
                }
                renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
                log('WARN', 'WAREHOUSE_OZON', 'ozon UI apply request failed', runtimeError.message);
            }
            return;
        }

        const responseOrderId = normalizeAmperkotOrderId(response?.orderId);
        if (responseOrderId && responseOrderId !== getWarehouseOrderIdFromUrl()) {
            return;
        }

        if (!response?.ok) {
            lastWarehouseOzonUiApply = createWarehouseOzonUiApplyError(response?.error || 'Ozon UI apply request failed');
            if (matchingIntent) {
                matchingIntent.status = 'failed';
                matchingIntent.error = response?.error || 'Ozon UI apply request failed';
            }
            renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
            return;
        }

        if (matchingIntent) {
            matchingIntent.status = 'started';
        }
        log('INFO', 'WAREHOUSE_OZON', 'ozon UI apply started', { ...response, trigger });
    }, 'WAREHOUSE_OZON');

    if (!sent) {
        lastWarehouseOzonUiApply = createWarehouseOzonUiApplyError('Не удалось отправить запрос в background.');
        const matchingIntent = getMatchingAutoApplyIntent();
        if (matchingIntent) {
            matchingIntent.status = 'failed';
            matchingIntent.error = 'background request was not sent';
        }
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
        return false;
    }

    return true;
}

function requestWarehouseOzonResolvePreview(options = {}) {
    const payload = getWarehouseOzonResolveRequestPayload();
    const trigger = options.trigger === 'automatic-on-open'
        ? 'automatic-on-open'
        : 'manual';
    const requestOrderId = normalizeAmperkotOrderId(payload?.orderId || getWarehouseOrderIdFromUrl());
    const requestDocumentInstanceId = WAREHOUSE_DOCUMENT_INSTANCE_ID;

    if (trigger === 'manual') {
        clearWarehouseAutoResolveCheckTimer();
        const state = warehouseAutoResolveCheckState || createWarehouseAutoResolveCheckState();
        if (!['started', 'completed'].includes(state.status)) {
            state.status = 'manual';
            state.reason = 'manual-check';
            warehouseAutoResolveCheckState = state;
        }
    }

    if (!payload) {
        lastWarehouseOzonResolvePreview = createWarehouseOzonResolveError('Сначала прочитай штрихкоды склада.');
        if (trigger === 'automatic-on-open' && warehouseAutoResolveCheckState) {
            warehouseAutoResolveCheckState.status = 'failed';
            warehouseAutoResolveCheckState.completedAt = Date.now();
            warehouseAutoResolveCheckState.reason = 'warehouse-preview-unavailable';
        }
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
        return false;
    }

    lastWarehouseOzonResolvePreview = createWarehouseOzonResolveLoading();
    renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);

    sendRuntimeMessage({
        type: 'OZON_RESOLVE_PREVIEW_REQUEST',
        trigger,
        documentInstanceId: requestDocumentInstanceId,
        ...payload
    }, (response) => {
        const runtimeError = getRuntimeLastError();
        const currentState = warehouseAutoResolveCheckState;
        const requestIsCurrent = requestOrderId === getWarehouseOrderIdFromUrl()
            && requestDocumentInstanceId === WAREHOUSE_DOCUMENT_INSTANCE_ID
            && (trigger !== 'automatic-on-open'
                || !currentState
                || (currentState.orderId === requestOrderId
                    && currentState.documentInstanceId === requestDocumentInstanceId));

        if (!requestIsCurrent) {
            return;
        }

        if (runtimeError) {
            if (!handleRuntimeMessagingError('WAREHOUSE_OZON', runtimeError)) {
                lastWarehouseOzonResolvePreview = createWarehouseOzonResolveError(runtimeError.message || 'Ozon worker unavailable');
                if (trigger === 'automatic-on-open' && warehouseAutoResolveCheckState) {
                    warehouseAutoResolveCheckState.status = 'failed';
                    warehouseAutoResolveCheckState.completedAt = Date.now();
                    warehouseAutoResolveCheckState.reason = runtimeError.message || 'runtime-error';
                }
                renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
                log('WARN', 'WAREHOUSE_OZON', 'ozon resolve request failed', runtimeError.message);
            }
            return;
        }

        const responseOrderId = normalizeAmperkotOrderId(response?.orderId);
        if (responseOrderId && responseOrderId !== getWarehouseOrderIdFromUrl()) {
            return;
        }

        if (!response?.ok) {
            lastWarehouseOzonResolvePreview = createWarehouseOzonResolveError(response?.error || 'Ozon resolve request failed');
            if (trigger === 'automatic-on-open' && warehouseAutoResolveCheckState) {
                warehouseAutoResolveCheckState.status = 'failed';
                warehouseAutoResolveCheckState.completedAt = Date.now();
                warehouseAutoResolveCheckState.reason = response?.error || 'request-rejected';
            }
            renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
            return;
        }

        if (response.skipped === true && response.reason === 'auto-sold-check-disabled') {
            if (trigger === 'automatic-on-open' && warehouseAutoResolveCheckState) {
                warehouseAutoResolveCheckState.status = 'completed';
                warehouseAutoResolveCheckState.completedAt = Date.now();
                warehouseAutoResolveCheckState.reason = 'disabled-in-settings';
            }
            return;
        }

        if (response.plan) {
            lastWarehouseOzonResolvePreview = createWarehouseOzonResolveReady(response.plan);
            if (trigger === 'automatic-on-open' && warehouseAutoResolveCheckState) {
                warehouseAutoResolveCheckState.status = 'completed';
                warehouseAutoResolveCheckState.completedAt = Date.now();
                warehouseAutoResolveCheckState.reason = 'completed-without-worker';
            }
            renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
            return;
        }

        if (response.queued) {
            if (trigger === 'automatic-on-open' && warehouseAutoResolveCheckState) {
                warehouseAutoResolveCheckState.status = 'queued';
                warehouseAutoResolveCheckState.reason = `queued-behind-${response.activeOperation || 'operation'}`;
                scheduleWarehouseAutoResolveQueueRetry();
            }
            log('INFO', 'WAREHOUSE_OZON', 'ozon resolve queued', { ...response, trigger });
            return;
        }

        if (trigger === 'automatic-on-open' && warehouseAutoResolveCheckState && response.started) {
            clearWarehouseAutoResolveCheckTimer();
            warehouseAutoResolveCheckState.status = 'started';
            warehouseAutoResolveCheckState.reason = response.alreadyActive
                ? 'already-active'
                : 'worker-started';
        }

        log('INFO', 'WAREHOUSE_OZON', 'ozon resolve started', { ...response, trigger });
    }, 'WAREHOUSE_OZON');

    return true;
}

const WAREHOUSE_DISASSEMBLY_SELECTION_REQUEST_EVENT = 'tab_wanderer:warehouse-disassembly-selection-request';
const WAREHOUSE_DISASSEMBLY_SELECTION_RESPONSE_EVENT = 'tab_wanderer:warehouse-disassembly-selection-response';
const WAREHOUSE_DISASSEMBLY_PANEL_ID = 'tw-ozon-disassembly-panel';
const warehouseDisassemblyPanelState = {
    orderId: '', selected: [], assembled: [], skipped: 0, confirmed: [], actionId: '',
    expanded: true, listExpanded: false, assembledListExpanded: false, busy: false, status: '',
    isError: false, verification: null, pendingVerification: false, ozonFromAngular: false,
    removalCompleted: false
};
let warehouseDisassemblySelectionTimer = null;
let warehouseDisassemblySelectionListenerInstalled = false;

function resetWarehouseDisassemblyPanel(orderId = '') {
    const state = warehouseDisassemblyPanelState;
    state.orderId = orderId;
    state.selected = [];
    state.assembled = [];
    state.confirmed = [];
    state.skipped = 0;
    state.actionId = '';
    state.busy = false;
    state.status = '';
    state.isError = false;
    state.verification = null;
    state.pendingVerification = false;
    state.ozonFromAngular = false;
    state.removalCompleted = false;
}

function getWarehouseDisassemblyPanelButton(label, action, disabled = false, variant = 'primary') {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.twDisassemblyAction = action;
    button.disabled = disabled;
    button.textContent = label;
    button.style.cssText = 'display:block;width:100%;padding:9px 10px;margin-top:8px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;';
    button.style.border = variant === 'secondary' ? '1px solid #005bff' : '0';
    button.style.background = variant === 'secondary' ? '#fff' : variant === 'danger' ? '#db2919' : '#005bff';
    button.style.color = variant === 'secondary' ? '#005bff' : '#fff';
    if (disabled) { button.style.opacity = '0.5'; button.style.cursor = 'default'; }
    return button;
}

function appendWarehouseDisassemblyText(parent, text, css = '') {
    const element = document.createElement('div');
    element.textContent = text;
    element.style.cssText = css;
    parent.appendChild(element);
    return element;
}

function getWarehouseDisassemblyPanelRows() {
    const state = warehouseDisassemblyPanelState;
    return state.confirmed.length ? state.confirmed : state.selected;
}

function getWarehouseDisassemblyAssembledRows() {
    return warehouseDisassemblyPanelState.assembled;
}

// Adapt warehouse disassembly rows to the exact same grouped view used on
// the assembly page. The two lists remain independent: this is display only.
function groupWarehouseDisassemblyBarcodes(rows = []) {
    const groups = new Map();
    for (const row of rows) {
        const productId = String(row.productId || '').trim();
        const barcode = String(row.barcode || '').trim();
        if (!productId || !barcode) continue;
        let product = groups.get(productId);
        if (!product) {
            product = { productId, productTitle: String(row.title || ''), barcodes: [],
                skippedBarcodes: [], skippedBarcodeGroups: [] };
            groups.set(productId, product);
        }
        if (!product.productTitle && row.title) product.productTitle = String(row.title);
        if (Number(row.type) === 1) {
            let multi = product.skippedBarcodeGroups.find(group => group.label === 'Мультиштрихкоды');
            if (!multi) {
                multi = { label: 'Мультиштрихкоды', count: 0, barcodes: [] };
                product.skippedBarcodeGroups.push(multi);
            }
            if (!multi.barcodes.includes(barcode)) {
                multi.barcodes.push(barcode);
                multi.count += 1;
                product.skippedBarcodes.push(barcode);
            }
        } else if (!product.barcodes.includes(barcode)) {
            product.barcodes.push(barcode);
        }
    }
    return Array.from(groups.values());
}

function appendWarehouseDisassemblyBarcodeList(panel, rows, title) {
    return renderWarehouseGroupedBarcodeList(panel, groupWarehouseDisassemblyBarcodes(rows), title);
}

function renderWarehouseDisassemblyPanel() {
    const existing = document.getElementById?.(WAREHOUSE_DISASSEMBLY_PANEL_ID);
    if (!isWarehouseDisassemblyPageUrl() || (warehouseOrderKindRecord?.kind === 'regular'
        && !warehouseDisassemblyPanelState.ozonFromAngular)) {
        existing?.remove?.();
        return;
    }
    // On pages where the order source isn't known yet, don't claim Ozon status.
    // Show the disassembly helper immediately, even while classification is
    // pending. Unknown source stays read-only until Warehouse confirms Ozon.
    let panel = existing;
    if (!panel) {
        panel = document.createElement('section');
        panel.id = WAREHOUSE_DISASSEMBLY_PANEL_ID;
        panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;max-width:calc(100vw - 32px);padding:14px;border:1px solid #d4d9e2;border-radius:12px;background:#fff;color:#172133;box-shadow:0 8px 24px #0003;font:13px/18px Arial,Helvetica,sans-serif;box-sizing:border-box;';
        panel.addEventListener('click', handleWarehouseDisassemblyPanelAction);
        (document.body || document.documentElement).appendChild(panel);
    }
    panel.style.maxHeight = warehouseDisassemblyPanelState.expanded ? '72vh' : 'none';
    panel.style.overflowY = warehouseDisassemblyPanelState.expanded ? 'auto' : 'hidden';
    panel.replaceChildren();
    const state = warehouseDisassemblyPanelState;
    const knownOzon = warehouseOrderKindRecord?.kind === 'ozon' || state.ozonFromAngular;
    const header = getWarehouseDisassemblyPanelButton(
        `tab_wanderer · ${knownOzon ? 'Ozon: ' : ''}разборка  ${state.expanded ? '▴' : '▾'}`, 'toggle', false, 'secondary');
    header.style.marginTop = '0';
    header.style.textAlign = 'left';
    panel.appendChild(header);
    if (!state.expanded) {
        appendWarehouseDisassemblyText(panel, state.status || 'Проверка штрихкодов разборки', 'margin-top:6px;color:#667685;font-size:12px;');
        return;
    }
    const rows = getWarehouseDisassemblyPanelRows();
    const hasConfirmed = state.confirmed.length > 0;
    const ozonConfirmed = warehouseOrderKindRecord?.kind === 'ozon' || state.ozonFromAngular;
    if (!ozonConfirmed) appendWarehouseDisassemblyText(panel,
        'Проверяем источник заказа. Действия с Ozon недоступны до подтверждения.',
        'margin:8px 0;color:#b26a00;font-size:12px;');
    appendWarehouseDisassemblyText(panel, hasConfirmed
        ? `Подтверждено складом: ${state.confirmed.length} шт.`
        : `Выбрано для разборки: ${state.selected.length} шт.`, 'font-weight:700;margin:12px 0 4px;');
    appendWarehouseDisassemblyText(panel, hasConfirmed
        ? 'Ручное удаление доступно только для подтверждённых штрихкодов.'
        : 'До подтверждения складом доступны только чтение и проверка.',
        'font-size:12px;color:#667685;margin-bottom:8px;');
    if (state.skipped) appendWarehouseDisassemblyText(panel,
        `Не подходят для поштучного удаления: ${state.skipped}`, 'color:#b26a00;font-size:12px;margin-bottom:6px;');
    if (state.status) appendWarehouseDisassemblyText(panel, state.status,
        `margin:8px 0;padding:8px;border-radius:7px;white-space:pre-wrap;background:${state.isError ? '#fff2f2' : '#edf4ff'};color:${state.isError ? '#a62d38' : '#2458d3'};`);
    if (state.verification && Array.isArray(state.verification.productPlans)) {
        const present = state.verification.productPlans.reduce((n, row) => n + (row.alreadyExists?.length || 0), 0);
        const absent = state.verification.productPlans.reduce((n, row) => n + (row.toAdd?.length || 0), 0);
        const errors = state.verification.productPlans.filter(row => row.status === 'error').length;
        appendWarehouseDisassemblyText(panel, `Проверка Ozon: присутствует ${present}, отсутствует ${absent}${errors ? `, ошибок товаров ${errors}` : ''}`,
            'font-size:12px;font-weight:700;padding:7px;background:#f5f7fa;border-radius:7px;');
    }
    panel.appendChild(getWarehouseDisassemblyPanelButton(state.pendingVerification ? 'Проверяем в Ozon…' : 'Проверить в Ozon', 'verify',
        !ozonConfirmed || !rows.length || state.busy || state.pendingVerification, 'secondary'));
    panel.appendChild(getWarehouseDisassemblyPanelButton('Обновить список штрихкодов', 'refresh', state.busy, 'secondary'));
    panel.appendChild(getWarehouseDisassemblyPanelButton('Удалить подтверждённые в Ozon вручную', 'remove',
        !ozonConfirmed || !hasConfirmed || state.removalCompleted || state.busy || state.pendingVerification, 'danger'));
    const assembled = getWarehouseDisassemblyAssembledRows();
    appendWarehouseDisassemblyText(panel, 'Уже укомплектованные штрихкоды', 'font-weight:700;margin:12px 0 4px;');
    panel.appendChild(getWarehouseDisassemblyPanelButton(
        state.assembledListExpanded ? 'Скрыть укомплектованные ШК' : `Укомплектованные ШК (${assembled.length})`,
        'assembled-list', assembled.length === 0, 'secondary'));
    if (state.assembledListExpanded) appendWarehouseDisassemblyBarcodeList(panel, assembled, 'Список штрихкодов');
    appendWarehouseDisassemblyText(panel, 'Штрихкоды на удаление из Ozon', 'font-weight:700;margin:12px 0 4px;');
    panel.appendChild(getWarehouseDisassemblyPanelButton(
        state.listExpanded ? 'Скрыть ШК на удаление' : `ШК на удаление (${rows.length})`,
        'list', rows.length === 0, 'secondary'));
    if (state.listExpanded) appendWarehouseDisassemblyBarcodeList(panel, rows, 'Штрихкоды на удаление');
}

function requestWarehouseDisassemblySelection() {
    if (!isWarehouseDisassemblyPageUrl()) return;
    window.dispatchEvent(new CustomEvent(WAREHOUSE_DISASSEMBLY_SELECTION_REQUEST_EVENT));
}

function makeWarehouseDisassemblyVerificationExtraction(rows) {
    const productsById = {};
    for (const row of rows) {
        if (!/^\d{5,}$/.test(String(row.productId)) || !/^[a-zA-Z0-9_-]{5,80}$/.test(String(row.barcode))) return null;
        const id = String(row.productId);
        if (!productsById[id]) productsById[id] = { productId: id, productTitle: row.title || '', eligibleBarcodes: [], skippedBarcodes: [] };
        productsById[id].eligibleBarcodes.push({ productId: id, barcode: row.barcode,
            itemType: 0, assemblyQuantity: 1, reservedQuantity: 1 });
    }
    return { orderId: getWarehouseOrderIdFromUrl(), productsById };
}

function handleWarehouseDisassemblyPanelAction(event) {
    const action = event?.target?.closest?.('[data-tw-disassembly-action]');
    if (!action || action.disabled || event.isTrusted !== true) return;
    const state = warehouseDisassemblyPanelState;
    const type = action.dataset.twDisassemblyAction;
    if (type === 'toggle') { state.expanded = !state.expanded; renderWarehouseDisassemblyPanel(); return; }
    if (type === 'list') { state.listExpanded = !state.listExpanded; renderWarehouseDisassemblyPanel(); return; }
    if (type === 'assembled-list') { state.assembledListExpanded = !state.assembledListExpanded; renderWarehouseDisassemblyPanel(); return; }
    if (type === 'refresh') { requestWarehouseDisassemblySelection(); return; }
    if (type === 'verify') {
        if (warehouseOrderKindRecord?.kind !== 'ozon' && !state.ozonFromAngular) return;
        const extraction = makeWarehouseDisassemblyVerificationExtraction(getWarehouseDisassemblyPanelRows());
        if (!extraction || Object.keys(extraction.productsById).length === 0) return;
        state.pendingVerification = true;
        state.verification = null;
        state.status = 'Проверяем выбранные штрихкоды в Ozon (без изменений карточки)…';
        state.isError = false;
        renderWarehouseDisassemblyPanel();
        sendRuntimeMessage({ type: 'OZON_RESOLVE_PREVIEW_REQUEST', trigger: 'manual',
            orderId: state.orderId, warehouseExtraction: extraction,
            documentInstanceId: WAREHOUSE_DOCUMENT_INSTANCE_ID }, response => {
            if (response?.ok) return;
            state.pendingVerification = false;
            state.isError = true;
            state.status = `Проверка не запущена: ${response?.error || 'нет ответа'}`;
            renderWarehouseDisassemblyPanel();
        }, 'OZON_DISASSEMBLY');
        return;
    }
    if (type === 'remove') {
        if (warehouseOrderKindRecord?.kind !== 'ozon' && !state.ozonFromAngular) return;
        if (!state.confirmed.length || !state.actionId || state.removalCompleted || state.busy || state.pendingVerification) return;
        if (!window.confirm?.(`Удалить в Ozon ${state.confirmed.length} штрихкод(ов), уже разобранных складом?`)) return;
        state.busy = true;
        state.status = 'Ручное удаление: ожидаем подтверждения Ozon…';
        state.isError = false;
        renderWarehouseDisassemblyPanel();
        sendRuntimeMessage({ type: 'OZON_DISASSEMBLY_MANUAL_REMOVE',
            confirmed: true, source: 'OZON', orderId: state.orderId,
            actionId: state.actionId, rows: state.confirmed.map(({ productId, productItemId, barcode, type }) =>
                ({ productId, productItemId, barcode, type })),
            documentInstanceId: WAREHOUSE_DOCUMENT_INSTANCE_ID }, response => {
            if (response?.ok && response?.started) return;
            state.busy = false;
            state.isError = true;
            state.status = `Ручное удаление не запущено: ${response?.error || 'нет ответа'}`;
            renderWarehouseDisassemblyPanel();
        }, 'OZON_DISASSEMBLY');
    }
}

function ensureWarehouseDisassemblySelectionListener() {
    if (warehouseDisassemblySelectionListenerInstalled) return;
    warehouseDisassemblySelectionListenerInstalled = true;
    window.addEventListener(WAREHOUSE_DISASSEMBLY_SELECTION_RESPONSE_EVENT, event => {
        if (!isWarehouseDisassemblyPageUrl()) return;
        const detail = event?.detail || {};
        if (normalizeAmperkotOrderId(detail.orderId) !== getWarehouseOrderIdFromUrl()) return;
        if (detail.source && detail.source !== 'OZON') return;
        if (!Array.isArray(detail.rows) || detail.rows.length > 1000) return;
        const rows = detail.rows.filter(row => /^\d{5,}$/.test(String(row.productId))
            && /^\d+$/.test(String(row.productItemId)) && /^[a-zA-Z0-9_-]{5,80}$/.test(String(row.barcode))
            && row.type === 0);
        const state = warehouseDisassemblyPanelState;
        if (state.orderId !== detail.orderId) resetWarehouseDisassemblyPanel(detail.orderId);
        if (detail.source === 'OZON') state.ozonFromAngular = true;
        const assembled = Array.isArray(detail.assembled) ? detail.assembled.filter(row =>
            /^\d{5,}$/.test(String(row.productId))
            && /^[a-zA-Z0-9_-]{5,80}$/.test(String(row.barcode))
            && (row.type === 0 || row.type === 1)).slice(0, 2000) : [];
        const signature = JSON.stringify(rows);
        if (JSON.stringify(state.selected) === signature && state.skipped === detail.skipped
            && JSON.stringify(state.assembled) === JSON.stringify(assembled)) return;
        state.assembled = assembled;
        state.selected = rows;
        state.skipped = Math.max(0, Number(detail.skipped) || 0);
        if (!state.confirmed.length) state.verification = null;
        renderWarehouseDisassemblyPanel();
    });
    if (warehouseDisassemblySelectionTimer === null) {
        warehouseDisassemblySelectionTimer = setInterval(() => {
            if (isWarehouseDisassemblyPageUrl()) requestWarehouseDisassemblySelection();
        }, 1500);
    }
}

// A successful Warehouse POST supplies exact newly assembled barcodes, but
// the resulting Angular shopOrder often has no assembly rows until a reload.
// Preserve only those confirmed rows as a clearly marked PARTIAL panel view.
// Do not pass this view to Ozon's automatic write/resolve pipelines.
function createWarehouseConfirmedPanelPreview(detail, currentPreview = null) {
    const orderId = normalizeAmperkotOrderId(detail?.orderId);
    if (!orderId || !Array.isArray(detail?.rows) || !detail.rows.length
        || detail.rows.length > 2000) return null;
    const entries = new Map();
    const currentOrderId = normalizeAmperkotOrderId(currentPreview?.shopOrder?.number
        || currentPreview?.shopOrder?.id || currentPreview?.extraction?.orderId);
    if (currentOrderId === orderId) {
        for (const row of currentPreview?.shopOrder?.assembly || []) {
            const id = normalizeWarehouseBridgeId(row?.product_item?.product_id);
            const barcode = normalizeWarehouseBridgeId(row?.product_item?.barcode);
            if (/^\d{5,}$/.test(id) && /^[a-zA-Z0-9_-]{5,80}$/.test(barcode)) {
                entries.set(`${id}:${barcode}`, row);
            }
        }
    }
    for (const row of detail.rows) {
        const productId = normalizeWarehouseBridgeId(row?.productId);
        const barcode = normalizeWarehouseBridgeId(row?.barcode);
        if (!/^\d{5,}$/.test(productId) || !/^[a-zA-Z0-9_-]{5,80}$/.test(barcode)
            || Number(row?.type) !== 0) return null;
        entries.set(`${productId}:${barcode}`, {
            quantity: 1,
            product_item: {
                id: normalizeWarehouseBridgeId(row.productItemId),
                product_id: productId,
                barcode,
                type: 0,
                reserved_quantity: 1,
                product: { id: productId, title: String(row.title || '').slice(0, 160) }
            },
            order_item: { item_id: productId, title: String(row.title || '').slice(0, 160) }
        });
    }
    const preview = createWarehouseBarcodePreviewFromShopOrder({
        id: orderId, number: orderId, assembly: Array.from(entries.values())
    });
    preview.partialConfirmed = true;
    preview.partialMessage = 'Показаны подтверждённые ШК текущей сборки. Полный список склада пока недоступен.';
    return preview;
}

function shouldPreserveWarehouseConfirmedPanelPreview(incomingPreview, orderId) {
    if (!warehouseConfirmedPanelSnapshot || !isWarehouseAssemblyPageUrl()) return false;
    if (normalizeAmperkotOrderId(orderId) !== warehouseConfirmedPanelSnapshot.orderId
        || getWarehouseOrderIdFromUrl() !== warehouseConfirmedPanelSnapshot.orderId) return false;
    const incoming = incomingPreview?.summary || {};
    // A nonempty authoritative read can replace the partial view; an empty
    // Angular shell or an unrelated API payload must not erase it.
    return Number(incoming.eligibleCount || 0) + Number(incoming.skippedCount || 0) === 0;
}

// The Warehouse POST confirms precise item IDs, but its response does not
// include barcodes. Use the Angular selection captured synchronously at send().
const WAREHOUSE_ASSEMBLY_CONFIRMED_EVENT = 'tab_wanderer:warehouse-assembly-confirmed';
let warehouseAssemblyConfirmationListenerInstalled = false;
let lastWarehouseAssemblyConfirmedSignature = '';

function ensureWarehouseAssemblyConfirmationListener() {
    if (warehouseAssemblyConfirmationListenerInstalled) return;
    warehouseAssemblyConfirmationListenerInstalled = true;
    window.addEventListener?.(WAREHOUSE_ASSEMBLY_CONFIRMED_EVENT, event => {
        if (!isWarehouseAssemblyPageUrl()) return;
        const detail = event?.detail || {};
        if (detail.confirmed !== true || detail.source !== 'OZON'
            || normalizeAmperkotOrderId(detail.orderId) !== getWarehouseOrderIdFromUrl()
            || !Array.isArray(detail.rows) || !detail.rows.length) return;
        const panelPreview = createWarehouseConfirmedPanelPreview(detail,
            warehouseConfirmedPanelSnapshot?.preview || lastWarehouseBarcodePreview);
        if (panelPreview) {
            warehouseConfirmedPanelSnapshot = { orderId: detail.orderId, preview: panelPreview };
            lastWarehouseBarcodePreview = panelPreview;
            lastWarehouseBarcodePreviewSource = 'warehouse-confirmed-panel-only';
            renderWarehouseBarcodePreviewPanel(panelPreview);
            log('INFO', 'WAREHOUSE_OZON', 'panel updated from confirmed Warehouse POST', {
                orderId: detail.orderId, summary: panelPreview.summary
            });
        }
        // Panel updates must work even when Ozon automatic writes are disabled.
        // Only the original intent-authorized branch below may write to Ozon.
        const intent = warehouseAutoApplyIntent;
        if (warehouseAutoBarcodeApplyEnabled !== true || !intent || intent.status !== 'waiting'
            || intent.orderId !== detail.orderId) return;
        const signature = `${detail.orderId}:${detail.actionId}:${detail.rows.map(row => row.productItemId).sort().join(',')}`;
        if (signature === lastWarehouseAssemblyConfirmedSignature) return;
        const productsById = {};
        for (const row of detail.rows) {
            const productId = normalizeWarehouseBridgeId(row.productId);
            const barcode = normalizeWarehouseBridgeId(row.barcode);
            if (!/^\d{5,}$/.test(productId) || !/^[a-zA-Z0-9_-]{5,80}$/.test(barcode)
                || Number(row.type) !== 0) return;
            if (!productsById[productId]) productsById[productId] = {
                productId, productTitle: row.title || '', eligibleBarcodes: [], skippedBarcodes: []
            };
            productsById[productId].eligibleBarcodes.push({
                productId, barcode, itemType: 0, assemblyQuantity: 1, reservedQuantity: 1
            });
        }
        if (!Object.keys(productsById).length) return;
        lastWarehouseAssemblyConfirmedSignature = signature;
        clearWarehouseAssemblyActionRefreshTimers('confirmed Warehouse POST');
        const extraction = { orderId: detail.orderId, productsById };
        log('INFO', 'WAREHOUSE_AUTO_APPLY', 'assembly POST confirmed exact barcodes', {
            orderId: detail.orderId, actionId: detail.actionId, barcodeCount: detail.rows.length
        });
        requestWarehouseOzonUiApply({ trigger: 'automatic', actionId: intent.actionId,
            warehouseExtraction: extraction });
        // Ozon writes are independent of the panel. The confirmed POST may
        // arrive before Angular's SPA view is ready, so resume read-only panel
        // refreshes after confirmation rather than leaving the loading state.
        requestWarehouseShopOrderSnapshot({ resetAttempts: false, reason: 'post-confirmation-panel' });
    });
}

const WAREHOUSE_DISASSEMBLY_CONFIRMED_EVENT = 'tab_wanderer:warehouse-disassembly-confirmed';
let warehouseDisassemblyListenerInstalled = false;
let lastWarehouseDisassemblySignature = '';

function showWarehouseDisassemblyStatus(message, isError = false) {
    log(isError ? 'WARN' : 'INFO', 'OZON_DISASSEMBLY', message);
    if (isWarehouseDisassemblyPageUrl()) {
        warehouseDisassemblyPanelState.status = message;
        warehouseDisassemblyPanelState.isError = isError;
        renderWarehouseDisassemblyPanel();
        return;
    }
    const root = document.querySelector?.('#content') || document.body;
    if (!root?.appendChild || !document.createElement) return;
    let status = document.getElementById?.('tw-ozon-disassembly-status');
    if (!status) {
        status = document.createElement('div');
        status.id = 'tw-ozon-disassembly-status';
        status.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:99999;max-width:440px;padding:14px 18px;color:#fff;border-radius:8px;font-weight:600;box-shadow:0 3px 14px #0003;background:#2458d3;';
        root.appendChild(status);
    }
    status.style.background = isError ? '#a62d38' : '#2458d3';
    status.textContent = message;
}

function ensureWarehouseDisassemblyListener() {
    if (warehouseDisassemblyListenerInstalled) return;
    warehouseDisassemblyListenerInstalled = true;
    window.addEventListener?.(WAREHOUSE_DISASSEMBLY_CONFIRMED_EVENT, event => {
        if (!isWarehouseDisassemblyPageUrl()) return;
        const detail = event?.detail || {};
        if (detail.confirmed !== true || detail.source !== 'OZON'
            || normalizeAmperkotOrderId(detail.orderId) !== getWarehouseOrderIdFromUrl()
            || !Array.isArray(detail.rows) || !detail.rows.length) return;
        const signature = `${detail.orderId}:${detail.actionId}:${detail.rows.map(row => row.productItemId).sort().join(',')}`;
        if (lastWarehouseDisassemblySignature === signature) return;
        lastWarehouseDisassemblySignature = signature;
        const state = warehouseDisassemblyPanelState;
        state.orderId = detail.orderId;
        state.ozonFromAngular = true;
        state.actionId = String(detail.actionId);
        state.confirmed = detail.rows.map(row => ({ ...row }));
        state.removalCompleted = false;
        state.verification = null;
        state.busy = true;
        showWarehouseDisassemblyStatus(`Разборка подтверждена. Ozon: проверяем ${detail.rows.length} штрихкод(ов)…`);
        sendRuntimeMessage({
            type: 'OZON_DISASSEMBLY_CONFIRMED',
            ...detail,
            documentInstanceId: WAREHOUSE_DOCUMENT_INSTANCE_ID
        }, response => {
            if (response?.ok && response?.started) return;
            if (response?.ok && response?.disabled) {
                warehouseDisassemblyPanelState.busy = false;
                showWarehouseDisassemblyStatus('Разборка подтверждена. Автоудаление штрихкодов Ozon отключено в настройках.');
                return;
            }
            warehouseDisassemblyPanelState.busy = false;
            showWarehouseDisassemblyStatus(`Удаление в Ozon не запущено: ${response?.error || 'нет подтверждения расширения'}. Проверьте статус и повторите вручную при необходимости.`, true);
        }, 'OZON_DISASSEMBLY');
    });
}

function isWarehouseDisassemblyRemovalSatisfied(result, confirmedCount) {
    const total = Number(confirmedCount);
    const removed = Number(result?.removedCount);
    const alreadyMissing = Number(result?.alreadyMissingCount);
    return result?.ok === true
        && Number.isSafeInteger(total) && total > 0
        && Number.isSafeInteger(removed) && removed >= 0
        && Number.isSafeInteger(alreadyMissing) && alreadyMissing >= 0
        && removed + alreadyMissing === total;
}

function handleWarehouseRuntimeMessage(msg, _sender, sendResponse) {
    if (msg?.type === 'OZON_DISASSEMBLY_REMOVE_RESULT') {
        if (normalizeAmperkotOrderId(msg.orderId) === getWarehouseOrderIdFromUrl()
            && String(msg.actionId || '') === warehouseDisassemblyPanelState.actionId) {
            const state = warehouseDisassemblyPanelState;
            const count = Number(msg.removedCount) || 0;
            const alreadyMissing = Number(msg.alreadyMissingCount) || 0;
            state.busy = false;
            // A successful result means each confirmed barcode was verified absent.
            // `alreadyMissingCount` covers safe, idempotent retries.
            state.removalCompleted = isWarehouseDisassemblyRemovalSatisfied(msg, state.confirmed.length);
            showWarehouseDisassemblyStatus(state.removalCompleted
                ? `Ozon: удалено ${count}, уже отсутствовало ${alreadyMissing} штрихкод(ов). Проверено, остальные сохранены.`
                : `Ozon: ${msg.error || 'удаление не завершено'}; подтверждено удалений: ${count}. Проверьте ЛК Ozon.`, !state.removalCompleted);
        }
        if (typeof sendResponse === 'function') sendResponse({ ok: true });
        return true;
    }

    if (msg?.type === 'WAREHOUSE_STOCK_BRANCH_CONFIG_UPDATED') {
        warehouseStockBranchConfigRevision += 1;
        applyWarehouseStockBranch(msg.branch);
        if (typeof sendResponse === 'function') sendResponse({ ok: true });
        return true;
    }

    if (msg?.type === 'WAREHOUSE_AUTO_APPLY_CONFIG_UPDATED') {
        applyWarehouseAutoBarcodeApplyEnabled(msg.enabled === true);

        if (typeof sendResponse === 'function') {
            sendResponse({ ok: true });
        }

        return true;
    }

    if (msg?.type === 'ORDER_KIND_UPDATED') {
        const currentOrderId = getWarehouseOrderIdFromUrl();
        if (normalizeAmperkotOrderId(msg?.orderKind?.orderId) === currentOrderId) {
            applyWarehouseOrderKindRecord(msg.orderKind);
        }

        if (typeof sendResponse === 'function') {
            sendResponse({ ok: true });
        }

        return true;
    }

    if (msg?.type === 'OZON_RESOLVE_PREVIEW_RESULT' && isWarehouseDisassemblyPageUrl()) {
        if (normalizeAmperkotOrderId(msg.orderId) === getWarehouseOrderIdFromUrl()
            && (!msg.documentInstanceId || String(msg.documentInstanceId) === WAREHOUSE_DOCUMENT_INSTANCE_ID)
            && warehouseDisassemblyPanelState.pendingVerification) {
            const state = warehouseDisassemblyPanelState;
            state.pendingVerification = false;
            state.verification = msg.ok && msg.plan ? msg.plan : null;
            state.isError = !msg.ok;
            state.status = msg.ok ? 'Проверка Ozon завершена. Сверьте наличие штрихкодов в списке.'
                : `Ошибка проверки Ozon: ${msg.error || 'нет данных'}`;
            renderWarehouseDisassemblyPanel();
        }
        if (typeof sendResponse === 'function') sendResponse({ ok: true });
        return true;
    }

    if (msg?.type === 'OZON_RESOLVE_PREVIEW_RESULT') {
        if (normalizeAmperkotOrderId(msg.orderId) !== getWarehouseOrderIdFromUrl()) {
            if (typeof sendResponse === 'function') {
                sendResponse({ ok: true, ignored: true });
            }
            return true;
        }

        if (msg.documentInstanceId
            && String(msg.documentInstanceId) !== WAREHOUSE_DOCUMENT_INSTANCE_ID) {
            if (typeof sendResponse === 'function') {
                sendResponse({ ok: true, ignored: true });
            }
            return true;
        }

        if (msg.ok && msg.plan) {
            warehouseSoldCleanupPreview = Array.isArray(msg.plan.soldCleanup) ? msg.plan.soldCleanup : [];
            warehouseSoldCleanupFailedProducts = Number(msg.plan.soldCleanupFailedProducts) || 0;
            warehouseSoldCleanupState = warehouseSoldCleanupPreview.length ? 'ready' : warehouseSoldCleanupFailedProducts ? 'error' : 'empty';
            lastWarehouseOzonResolvePreview = createWarehouseOzonResolveReady(msg.plan);
            lastWarehouseOzonUiApply = reconcileWarehouseOzonUiApplyWithResolvePlan(
                lastWarehouseOzonUiApply,
                lastWarehouseOzonResolvePreview
            );
            log('INFO', 'WAREHOUSE_OZON', 'ozon resolve preview ready', msg.plan.summary);
        } else {
            warehouseSoldCleanupPreview = [];
            warehouseSoldCleanupFailedProducts = 0;
            warehouseSoldCleanupState = 'error';
            lastWarehouseOzonResolvePreview = createWarehouseOzonResolveError(msg.error || 'Ozon resolve failed');
            log('WARN', 'WAREHOUSE_OZON', 'ozon resolve preview failed', lastWarehouseOzonResolvePreview.error);
        }

        if (msg.trigger === 'automatic-on-open' && warehouseAutoResolveCheckState) {
            clearWarehouseAutoResolveCheckTimer();
            warehouseAutoResolveCheckState.status = msg.ok && msg.plan ? 'completed' : 'failed';
            warehouseAutoResolveCheckState.completedAt = Date.now();
            warehouseAutoResolveCheckState.reason = msg.ok && msg.plan
                ? 'completed'
                : (msg.error || 'resolve-failed');
        }

        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);

        if (typeof sendResponse === 'function') {
            sendResponse({ ok: true });
        }

        return true;
    }

    if (msg?.type === 'OZON_WAREHOUSE_SOLD_DELETE_RESULT') {
        if (normalizeAmperkotOrderId(msg.orderId) !== getWarehouseOrderIdFromUrl()) {
            sendResponse?.({ok:true,ignored:true});return true;
        }
        warehouseSoldCleanupState = msg.ok ? 'removed' : 'error';
        if (msg.ok) {
            warehouseSoldCleanupRemovedCount = Math.max(0, Number(msg.removed) || 0);
            warehouseSoldCleanupPreview = [];
        }
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
        sendResponse?.({ok:true});return true;
    }

    if (msg?.type === 'OZON_UI_APPLY_RESULT') {
        if (normalizeAmperkotOrderId(msg.orderId) !== getWarehouseOrderIdFromUrl()) {
            if (typeof sendResponse === 'function') {
                sendResponse({ ok: true, ignored: true });
            }
            return true;
        }

        // The automatic delete happens before add in the same Ozon operation.
        // Update the sold panel only from the verified cleanup outcome; this
        // must also work if adding the new barcode subsequently fails.
        if (msg.soldCleanup?.attempted === true) {
            if (msg.soldCleanup.ok === true
                && Number(msg.soldCleanup.removed) === Number(msg.soldCleanup.matched)
                && Number(msg.soldCleanup.removed) > 0) {
                warehouseSoldCleanupRemovedCount = Number(msg.soldCleanup.removed);
                warehouseSoldCleanupPreview = [];
                warehouseSoldCleanupFailedProducts = 0;
                warehouseSoldCleanupState = 'removed';
                warehouseSoldCleanupListExpanded = false;
            } else {
                // Partially completed / unverified writes must not leave an
                // actionable stale list. A fresh page-open check is required.
                warehouseSoldCleanupState = 'error';
                log('WARN', 'WAREHOUSE_OZON', 'automatic sold cleanup unverified',
                    msg.soldCleanup.error || 'Partial or unverified deletion');
            }
        }

        const resultActionId = String(msg.actionId || '');
        const matchingAutoIntent = resultActionId
            && warehouseAutoApplyIntent?.actionId === resultActionId
            ? warehouseAutoApplyIntent
            : null;

        if (msg.ok) {
            lastWarehouseOzonUiApply = createWarehouseOzonUiApplyReady(msg);
            if (matchingAutoIntent?.status === 'started') {
                matchingAutoIntent.status = 'completed';
                matchingAutoIntent.completedAt = Date.now();
            }
            log('INFO', 'WAREHOUSE_OZON', 'ozon UI apply ready', {
                productId: lastWarehouseOzonUiApply.productId,
                addedCount: lastWarehouseOzonUiApply.addedCount
            });
        } else {
            lastWarehouseOzonUiApply = createWarehouseOzonUiApplyError(msg.error || 'Ozon UI apply failed', msg.productId);
            if (matchingAutoIntent?.status === 'started') {
                matchingAutoIntent.status = 'failed';
                matchingAutoIntent.error = msg.error || 'Ozon UI apply failed';
            }
            log('WARN', 'WAREHOUSE_OZON', 'ozon UI apply failed', lastWarehouseOzonUiApply.error);
        }

        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);

        if (typeof sendResponse === 'function') {
            sendResponse({ ok: true });
        }

        return true;
    }

    return false;
}

function ensureWarehouseRuntimeMessageListener() {
    if (typeof chrome?.runtime?.onMessage?.addListener !== 'function') {
        return false;
    }

    if (ensureWarehouseRuntimeMessageListener.initialized) {
        return true;
    }

    chrome.runtime.onMessage.addListener(handleWarehouseRuntimeMessage);
    ensureWarehouseRuntimeMessageListener.initialized = true;
    return true;
}

function getWarehouseBarcodeBridgeScriptUrl() {
    try {
        if (chrome?.runtime?.getURL) {
            return chrome.runtime.getURL('warehouse-barcode-bridge.js');
        }
    } catch {}

    return '';
}

function dispatchWarehouseShopOrderRequest() {
    window.dispatchEvent(new CustomEvent(WAREHOUSE_SHOP_ORDER_REQUEST_EVENT));
}

function markWarehouseBridgeInjectionError(errorMessage = 'warehouse bridge injection failed') {
    clearWarehouseShopOrderRetryTimer();
    lastWarehouseBarcodePreview = createWarehouseBarcodePreviewError(errorMessage);
    renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
    log('WARN', 'WAREHOUSE_OZON', lastWarehouseBarcodePreview.error);
}

function injectWarehouseBarcodeBridgeScript({ requestSnapshotOnLoad = false } = {}) {
    if (requestSnapshotOnLoad) {
        warehouseBridgeSnapshotRequestedOnLoad = true;
    }

    const existing = document.getElementById?.(WAREHOUSE_BRIDGE_SCRIPT_ID);

    if (existing) {
        return existing.dataset?.installed === 'true' ? 'ready' : 'loading';
    }

    const scriptUrl = getWarehouseBarcodeBridgeScriptUrl();

    if (!scriptUrl) {
        return false;
    }

    const script = document.createElement?.('script');

    if (!script) {
        return false;
    }

    script.id = WAREHOUSE_BRIDGE_SCRIPT_ID;
    script.src = scriptUrl;
    script.async = false;
    script.dataset.installed = 'false';

    script.addEventListener?.('load', () => {
        script.dataset.installed = 'true';
        if (isWarehouseIncomePerformPageUrl()) {
            // The income page may have been scanned before the injected bridge
            // finished loading. Such a request was recorded as in-flight, but
            // there was no listener to receive it yet. Re-arm those requests
            // now that the bridge is definitely ready.
            warehouseStockRequestInFlight.clear();
            syncWarehouseIncomeProducts();
            renderWarehouseStockPayloads();
        } else if (warehouseBridgeSnapshotRequestedOnLoad || isWarehouseAssemblyPageUrl()) {
            warehouseBridgeSnapshotRequestedOnLoad = false;
            dispatchWarehouseShopOrderRequest();
        }
    });

    script.addEventListener?.('error', () => {
        markWarehouseBridgeInjectionError('warehouse bridge external script failed to load');
    });

    const target = document.documentElement || document.head || document.body;

    if (!target?.appendChild) {
        return false;
    }

    target.appendChild(script);

    return 'loading';
}

function scheduleWarehouseShopOrderRetry(errorMessage = 'warehouse shopOrder not found') {
    if (!isWarehouseAssemblyPageUrl()) {
        return false;
    }

    if (warehouseShopOrderReadAttempt >= WAREHOUSE_SHOP_ORDER_MAX_READ_ATTEMPTS) {
        clearWarehouseShopOrderRetryTimer();
        lastWarehouseBarcodePreview = createWarehouseBarcodePreviewError(errorMessage);
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
        log('WARN', 'WAREHOUSE_OZON', 'shopOrder not found after retries', {
            attempts: warehouseShopOrderReadAttempt,
            error: lastWarehouseBarcodePreview.error
        });
        return false;
    }

    const nextAttempt = warehouseShopOrderReadAttempt + 1;
    setWarehouseBarcodePreviewLoading(
        `Ждём данные сборки на странице склада. Попытка ${nextAttempt}/${WAREHOUSE_SHOP_ORDER_MAX_READ_ATTEMPTS}. Ozon не изменяем.`
    );

    clearWarehouseShopOrderRetryTimer();

    if (typeof setTimeout !== 'function') {
        return false;
    }

    warehouseShopOrderRetryTimer = setTimeout(() => {
        warehouseShopOrderRetryTimer = null;
        warehouseShopOrderReadAttempt = nextAttempt;
        requestWarehouseShopOrderSnapshot({ resetAttempts: false, reason: warehouseShopOrderReadReason });
    }, WAREHOUSE_SHOP_ORDER_RETRY_DELAY_MS);

    return true;
}

function getWarehouseSnapshotSourcePriority(source = '') {
    switch (source) {
        case 'warehouse-api-response':
            return 3;
        case 'warehouse-dom-visible':
            return 2;
        case 'angular-snapshot':
            return 1;
        default:
            return 0;
    }
}

function shouldIgnoreLowerPriorityWarehouseSnapshot(responseSource, summary = {}) {
    const currentPriority = getWarehouseSnapshotSourcePriority(responseSource);
    const lastSource = warehouseAssemblyActionDebug?.lastResponseSource || '';
    const lastSummary = warehouseAssemblyActionDebug?.lastSummary || {};
    const lastPriority = getWarehouseSnapshotSourcePriority(lastSource);
    const lastHadBarcodes = Number(lastSummary.eligibleCount) > 0 || Number(lastSummary.skippedCount) > 0;
    const currentHasBarcodes = Number(summary.eligibleCount) > 0 || Number(summary.skippedCount) > 0;

    return lastHadBarcodes
        && currentHasBarcodes
        && lastPriority > currentPriority;
}

function handleWarehouseShopOrderBridgeResponse(event) {
    const detail = event?.detail || {};

    if (!detail.ok || !detail.shopOrder) {
        if (warehouseConfirmedPanelSnapshot
            && warehouseConfirmedPanelSnapshot.orderId === getWarehouseOrderIdFromUrl()
            && isWarehouseAssemblyPageUrl()) {
            clearWarehouseShopOrderRetryTimer();
            return lastWarehouseBarcodePreview;
        }
        const errorMessage = detail.error || 'warehouse shopOrder not found';

        if (scheduleWarehouseShopOrderRetry(errorMessage)) {
            return lastWarehouseBarcodePreview;
        }

        if (!lastWarehouseBarcodePreview || lastWarehouseBarcodePreview.ok !== false) {
            lastWarehouseBarcodePreview = createWarehouseBarcodePreviewError(errorMessage);
            renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
            log('WARN', 'WAREHOUSE_OZON', 'shopOrder not found', lastWarehouseBarcodePreview.error);
        }

        return lastWarehouseBarcodePreview;
    }

    const previousFingerprint = getWarehouseBarcodePreviewFingerprint(lastWarehouseBarcodePreview);
    const nextWarehouseBarcodePreview = createWarehouseBarcodePreviewFromShopOrder(detail.shopOrder);

    const summary = nextWarehouseBarcodePreview.summary || nextWarehouseBarcodePreview.extraction?.summary || {};
    const responseSource = detail.source || 'angular-snapshot';
    const hasFreshBarcodeSnapshot = Number(summary.eligibleCount) > 0 || Number(summary.skippedCount) > 0;

    if (shouldPreserveWarehouseConfirmedPanelPreview(nextWarehouseBarcodePreview,
        detail.shopOrder?.number || detail.shopOrder?.id)) {
        updateWarehouseAssemblyActionDebug({
            lastBridgeResult: 'empty Angular shell ignored; confirmed panel retained'
        });
        clearWarehouseShopOrderRetryTimer();
        return lastWarehouseBarcodePreview;
    }
    if (hasFreshBarcodeSnapshot && warehouseConfirmedPanelSnapshot
        && normalizeAmperkotOrderId(detail.shopOrder?.number || detail.shopOrder?.id)
            === warehouseConfirmedPanelSnapshot.orderId) {
        warehouseConfirmedPanelSnapshot = null;
    }

    if (!hasFreshBarcodeSnapshot
        && Number(nextWarehouseBarcodePreview.summary?.productCount || 0) === 0
        && warehouseShopOrderReadReason !== 'assembly-action'
        && scheduleWarehouseShopOrderRetry('warehouse article identities not found')) {
        return lastWarehouseBarcodePreview;
    }

    clearWarehouseShopOrderRetryTimer();
    warehouseShopOrderReadAttempt = 0;

    const changedDuringAssembly = warehouseAutoApplyIntent?.status === 'waiting'
        && warehouseAutoApplyIntent.baselineKnown === true
        && getWarehouseBarcodePreviewFingerprint(nextWarehouseBarcodePreview) !== warehouseAutoApplyIntent.baselineFingerprint;
    if (!changedDuringAssembly && shouldIgnoreLowerPriorityWarehouseSnapshot(responseSource, summary)) {
        log('INFO', 'WAREHOUSE_OZON', 'ignored lower priority barcode snapshot', {
            responseSource,
            previousSource: warehouseAssemblyActionDebug?.lastResponseSource || '',
            summary
        });
        return lastWarehouseBarcodePreview;
    }

    lastWarehouseBarcodePreview = nextWarehouseBarcodePreview;
    lastWarehouseBarcodePreviewSource = responseSource;
    const nextFingerprint = getWarehouseBarcodePreviewFingerprint(lastWarehouseBarcodePreview);

    updateWarehouseAssemblyActionDebug({
        lastResponseSource: responseSource,
        lastSummary: {
            productCount: Number(summary.productCount) || 0,
            eligibleCount: Number(summary.eligibleCount) || 0,
            skippedCount: Number(summary.skippedCount) || 0
        },
        lastBridgeResult: detail.debug?.lastResult || '',
        lastBridgeApiResult: detail.debug?.lastApiResult || '',
        lastBridgeApiResponseCount: Number(detail.debug?.lastApiResponseCount) || 0,
        lastBridgeApiCandidateUrl: detail.debug?.lastApiCandidateUrl || '',
        lastBridgeApiMatchedUrl: detail.debug?.lastApiMatchedUrl || ''
    });

    const waitingForNewAssembly = warehouseAutoApplyIntent?.status === 'waiting'
        && warehouseAutoApplyIntent.baselineKnown === true
        && getWarehouseBarcodePreviewFingerprint(nextWarehouseBarcodePreview) === warehouseAutoApplyIntent.baselineFingerprint;
    if (!warehouseAssemblyActionRefreshTimers.length
        || (hasFreshBarcodeSnapshot && !waitingForNewAssembly)) {
        clearWarehouseAssemblyActionRefreshTimers(hasFreshBarcodeSnapshot ? `${responseSource} barcode snapshot` : 'normal snapshot');
    } else {
        updateWarehouseAssemblyActionDebug({
            reloadTimerState: 'scheduled',
            reloadTimerClearReason: '',
            reloadFallbackReason: `${responseSource} had no barcode candidates yet`
        });
    }

    if (previousFingerprint !== nextFingerprint) {
        lastWarehouseOzonResolvePreview = null;
        lastWarehouseOzonUiApply = null;
    }
    const autoApplyStarted = maybeStartWarehouseAutoApply(lastWarehouseBarcodePreview, responseSource);
    const autoResolveScheduled = autoApplyStarted
        ? false
        : maybeScheduleWarehouseAutoResolveCheck(lastWarehouseBarcodePreview, responseSource);
    renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);

    log(lastWarehouseBarcodePreview.ok ? 'INFO' : 'WARN', 'WAREHOUSE_OZON', 'barcode preview ready', {
        summary: lastWarehouseBarcodePreview.summary,
        warehouseRefresh: getWarehouseAssemblyActionDebugPublicSnapshot(),
        autoApplyStarted,
        autoResolveScheduled
    });

    return lastWarehouseBarcodePreview;
}

function requestWarehouseShopOrderSnapshot({ resetAttempts = true, reason = 'initial' } = {}) {
    warehouseShopOrderReadReason = reason;

    if (resetAttempts) {
        clearWarehouseShopOrderRetryTimer();
        warehouseShopOrderReadAttempt = 1;
        setWarehouseBarcodePreviewLoading();
    }

    const injected = injectWarehouseBarcodeBridgeScript({ requestSnapshotOnLoad: true });

    if (!injected) {
        markWarehouseBridgeInjectionError('warehouse bridge injection failed');
        return false;
    }

    if (injected === 'ready') {
        dispatchWarehouseShopOrderRequest();
    }

    return true;
}

function initWarehouseBarcodeBridge() {
    cityDebug('init:warehouse-bridge', {
        url: String(location?.href || ''),
        isIncomePerform: isWarehouseIncomePerformPageUrl(),
        branchAtInit: warehouseStockBranch,
        configRevision: warehouseStockBranchConfigRevision
    });

    // The income route is also classified as a Warehouse order workflow
    // route. Handle it first, otherwise the generic workflow guard returns
    // before the persisted branch configuration is requested.
    if (isWarehouseIncomePerformPageUrl()) {
        clearWarehouseShopOrderRetryTimer();
        clearWarehouseAssemblyActionRefreshTimers();
        removeWarehouseBarcodePreviewPanel();
        ensureWarehouseRuntimeMessageListener();
        ensureWarehouseStockListener();
        requestWarehouseStockConfig();
        cityDebug('init:income-after-config-request', {
            branch: warehouseStockBranch,
            configRevision: warehouseStockBranchConfigRevision
        });
        const injected = injectWarehouseBarcodeBridgeScript({ requestSnapshotOnLoad: false });
        // The bridge script survives SPA navigation. If it was already
        // installed on an earlier Warehouse route, no script load event
        // fires here, so re-arm stock requests explicitly.
        if (injected === 'ready') {
            warehouseStockRequestInFlight.clear();
        }
        ensureWarehouseIncomeProductObserver();
        if (injected === 'ready') {
            syncWarehouseIncomeProducts();
        }
        if (!lastWarehouseStockViewModel) renderWarehouseStockPanel(null);
        return true;
    }
    if (!isWarehouseOrderWorkflowPageUrl()) {
        return false;
    }

    ensureWarehouseAssemblyConfirmationListener();
    if (isWarehouseDisassemblyPageUrl()) {
        ensureWarehouseRuntimeMessageListener();
        ensureWarehouseDisassemblyListener();
        ensureWarehouseDisassemblySelectionListener();
        requestWarehouseOrderKind();
        removeWarehouseBarcodePreviewPanel();
        injectWarehouseBarcodeBridgeScript({ requestSnapshotOnLoad: false });
        requestWarehouseDisassemblySelection();
        renderWarehouseDisassemblyPanel();
        return true;
    }

    if (!warehouseBarcodeBridgeInitialized) {
        window.addEventListener?.(WAREHOUSE_SHOP_ORDER_RESPONSE_EVENT, handleWarehouseShopOrderBridgeResponse);
        ensureWarehouseRuntimeMessageListener();
        ensureWarehouseAssemblyActionListeners();
        ensureWarehouseStockListener();
        warehouseBarcodeBridgeInitialized = true;
    }

    injectWarehouseBarcodeBridgeScript({ requestSnapshotOnLoad: isWarehouseAssemblyPageUrl() });
    requestWarehouseOrderKind({ force: warehouseOrderKindRecord?.kind === 'unknown' });
    requestWarehouseAutoApplyIntent();

    if (isWarehouseAssemblyPageUrl()) {
        requestWarehouseShopOrderSnapshot({
            reason: warehouseAutoApplyIntent?.status === 'waiting' ? 'assembly-action' : 'initial'
        });
    } else {
        if (!lastWarehouseBarcodePreview) {
            lastWarehouseBarcodePreview = createWarehouseBarcodePreviewLoading(
                'Ожидаем нажатие «Собрать заказ». Ozon не изменяем.'
            );
        }
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
    }

    return true;
}

function handleWarehouseRouteStateChanged({ force = false } = {}) {
    const href = window.location.href;

    if (!force && href === lastWarehouseRouteHref) {
        return false;
    }

    const previousHref = lastWarehouseRouteHref;
    const previousOrderId = getWarehouseOrderIdFromUrl(previousHref);
    const nextOrderId = getWarehouseOrderIdFromUrl(href);
    const previousRouteKind = getWarehouseOrderRouteKind(previousHref);
    const nextRouteKind = getWarehouseOrderRouteKind(href);
    const orderChanged = previousOrderId !== nextOrderId;
    lastWarehouseRouteHref = href;

    if (nextRouteKind !== 'disassembly' || orderChanged) {
        document.getElementById?.(WAREHOUSE_DISASSEMBLY_PANEL_ID)?.remove?.();
        resetWarehouseDisassemblyPanel(nextOrderId);
    }
    if (nextRouteKind) {
        if (nextRouteKind === 'income-perform') {
            removeWarehouseBarcodePreviewPanel();
        } else {
            removeWarehouseStockPanel();
        }
        if (orderChanged && previousOrderId) {
            resetWarehouseOrderContext();
        } else if (!warehouseOrderKindRecord) {
            resetWarehouseOrderContext();
        }

        if (previousRouteKind === 'actions'
            && nextRouteKind === 'assembly'
            && previousOrderId === nextOrderId
            && warehouseAutoApplyIntent?.status === 'waiting') {
            warehouseAutoApplyIntent.routeTransitionedAt = Date.now();
        }

        return initWarehouseBarcodeBridge();
    }

    clearWarehouseShopOrderRetryTimer();
    clearWarehouseAssemblyActionRefreshTimers();
    warehouseShopOrderReadAttempt = 0;
    lastWarehouseBarcodePreview = null;
    lastWarehouseOzonResolvePreview = null;
    lastWarehouseOzonUiApply = null;
    resetWarehouseOrderContext();
    removeWarehouseBarcodePreviewPanel();
    removeWarehouseStockPanel();
    return false;
}

function startWarehouseBarcodeRouteWatcher() {
    if (!isWarehouseAppPageUrl()) {
        return false;
    }

    if (warehouseRouteWatcherInitialized) {
        return true;
    }
    warehouseRouteWatcherInitialized = true;

    window.addEventListener?.('hashchange', () => handleWarehouseRouteStateChanged({ force: true }));
    window.addEventListener?.('popstate', () => handleWarehouseRouteStateChanged({ force: true }));

    if (!warehouseRouteWatcherTimer && typeof setInterval === 'function') {
        warehouseRouteWatcherTimer = setInterval(() => handleWarehouseRouteStateChanged(), WAREHOUSE_ROUTE_WATCH_INTERVAL_MS);
    }

    handleWarehouseRouteStateChanged({ force: true });
    return true;
}


// ---------- OZON PRODUCT RESOLVE WORKER ----------
function isOzonProductWorkerPageUrl(href = window.location.href) {
    try {
        const url = new URL(href);

        return url.hostname === 'seller.ozon.ru'
            && url.pathname.startsWith('/app/products')
            && !!normalizeWarehouseBridgeId(url.searchParams.get('search'));
    } catch {
        return false;
    }
}

function getOzonProductIdFromUrl(href = window.location.href) {
    try {
        return normalizeWarehouseBridgeId(new URL(href).searchParams.get('search'));
    } catch {
        return '';
    }
}

function getOzonProductBridgeScriptUrl() {
    try {
        if (chrome?.runtime?.getURL) {
            return chrome.runtime.getURL('ozon-product-page-bridge.js');
        }
    } catch {}

    return '';
}

function sanitizeOzonResolvedProduct(product = null) {
    if (!product || typeof product !== 'object') {
        return null;
    }

    return {
        offerId: normalizeWarehouseBridgeId(product.offerId),
        ozonSku: normalizeWarehouseBridgeId(product.ozonSku),
        internalItemId: normalizeWarehouseBridgeId(product.internalItemId),
        title: normalizeWarehouseBridgeText(product.title),
        existingBarcodes: Array.isArray(product.existingBarcodes)
            ? product.existingBarcodes.map(normalizeWarehouseBridgeId).filter(Boolean)
            : []
    };
}

function sendOzonProductResolveResult(productId, result = {}) {
    const safeProduct = sanitizeOzonResolvedProduct(result.product);

    sendRuntimeMessage({
        type: 'OZON_PRODUCT_RESOLVE_RESULT',
        productId,
        sellerId: ozonResolvedSellerId,
        result: {
            ok: result.ok === true,
            error: result.error || null,
            productId,
            product: safeProduct,
            confirmedAbsent: result.confirmedAbsent === true,
            catalogueDiagnostic: result.catalogueDiagnostic || null,
            itemCount: Array.isArray(result.items) ? result.items.length : 0
        }
    }, () => {
        const runtimeError = getRuntimeLastError();

        if (runtimeError && !handleRuntimeMessagingError('OZON_PRODUCT', runtimeError)) {
            log('WARN', 'OZON_PRODUCT', 'resolve result failed', runtimeError.message);
        }
    }, 'OZON_PRODUCT');
}


function sendOzonProductWorkerReady(productId) {
    const normalizedProductId = normalizeWarehouseBridgeId(productId);

    if (!normalizedProductId || ozonWorkerReadyProductId === normalizedProductId) {
        return false;
    }

    if (ozonWorkerReadyTimer && typeof clearTimeout === 'function') {
        clearTimeout(ozonWorkerReadyTimer);
    }

    ozonWorkerReadyTimer = null;
    ozonWorkerReadyProductId = normalizedProductId;

    sendRuntimeMessage({
        type: 'OZON_PRODUCT_WORKER_READY',
        productId: normalizedProductId
    }, () => {
        const runtimeError = getRuntimeLastError();

        if (runtimeError && !handleRuntimeMessagingError('OZON_PRODUCT', runtimeError)) {
            log('WARN', 'OZON_PRODUCT', 'worker ready message failed', runtimeError.message);
        }
    }, 'OZON_PRODUCT');

    return true;
}

function scheduleOzonProductWorkerReadyFallback(productId) {
    const normalizedProductId = normalizeWarehouseBridgeId(productId);

    if (!normalizedProductId || ozonWorkerReadyProductId === normalizedProductId || typeof setTimeout !== 'function') {
        return false;
    }

    if (ozonWorkerReadyTimer && typeof clearTimeout === 'function') {
        clearTimeout(ozonWorkerReadyTimer);
    }

    ozonWorkerReadyTimer = setTimeout(() => {
        ozonWorkerReadyTimer = null;
        sendOzonProductWorkerReady(normalizedProductId);
    }, OZON_WORKER_READY_FALLBACK_MS);

    return true;
}

function dispatchOzonUiApplyRequest(productId, barcodes = []) {
    const normalizedProductId = normalizeWarehouseBridgeId(productId);
    const normalizedBarcodes = Array.isArray(barcodes)
        ? barcodes.map(normalizeWarehouseBridgeId).filter(Boolean)
        : [];
    const isolatedApi = window?.[OZON_ISOLATED_API_KEY];

    if (!isolatedApi || typeof isolatedApi.applyOzonBarcodesWithFallback !== 'function') {
        sendOzonUiApplyResult(normalizedProductId, {
            ok: false,
            productId: normalizedProductId,
            barcodes: normalizedBarcodes,
            error: 'isolated Ozon apply bridge unavailable'
        });
        return false;
    }

    Promise.resolve(isolatedApi.applyOzonBarcodesWithFallback({
        productId: normalizedProductId,
        barcodes: normalizedBarcodes,
        sellerId: ozonResolvedSellerId
    })).then(result => {
        sendOzonUiApplyResult(normalizedProductId, result || {});
        log(result?.ok ? 'INFO' : 'WARN', 'OZON_PRODUCT', 'isolated UI apply complete', {
            productId: normalizedProductId,
            addedCount: Number(result?.addedCount) || 0,
            error: result?.error || null
        });
    }).catch(error => {
        sendOzonUiApplyResult(normalizedProductId, {
            ok: false,
            productId: normalizedProductId,
            barcodes: normalizedBarcodes,
            error: error?.message || 'isolated Ozon UI apply failed'
        });
    });

    return true;
}

function sendOzonUiApplyResult(productId, result = {}) {
    sendRuntimeMessage({
        type: 'OZON_UI_APPLY_RESULT',
        productId: normalizeWarehouseBridgeId(productId),
        ok: result.ok === true,
        error: result.error || null,
        barcodes: Array.isArray(result.barcodes) ? result.barcodes.map(normalizeWarehouseBridgeId).filter(Boolean) : [],
        addedCount: Number(result.addedCount) || 0,
        verifiedCount: Number(result.verifiedCount) || 0,
        missingBarcodes: Array.isArray(result.missingBarcodes) ? result.missingBarcodes.map(normalizeWarehouseBridgeId).filter(Boolean) : [],
        details: result.details || null,
        soldCleanup: result.soldCleanup || null
    }, () => {
        const runtimeError = getRuntimeLastError();

        if (runtimeError && !handleRuntimeMessagingError('OZON_PRODUCT', runtimeError)) {
            log('WARN', 'OZON_PRODUCT', 'UI apply result failed', runtimeError.message);
        }
    }, 'OZON_PRODUCT');
}


function dispatchOzonUiRemoveRequest(productId, barcodes = [], ozonSku = '', sellerId = '') {
    const normalizedProductId = normalizeWarehouseBridgeId(productId);
    const normalizedBarcodes = Array.isArray(barcodes)
        ? barcodes.map(normalizeWarehouseBridgeId).filter(Boolean) : [];
    const isolatedApi = window?.[OZON_ISOLATED_API_KEY];
    if (!isolatedApi || typeof isolatedApi.removeConfirmedOzonBarcodes !== 'function') {
        sendOzonUiRemoveResult(normalizedProductId, { ok: false, error: 'isolated Ozon remove bridge unavailable' });
        return false;
    }
    Promise.resolve(isolatedApi.removeConfirmedOzonBarcodes({
        productId: normalizedProductId,
        barcodes: normalizedBarcodes,
        ozonSku: normalizeWarehouseBridgeId(ozonSku),
        sellerId: normalizeWarehouseBridgeId(sellerId)
    })).then(result => {
        sendOzonUiRemoveResult(normalizedProductId, result || {});
    }).catch(error => {
        sendOzonUiRemoveResult(normalizedProductId, { ok: false, error: error?.message || 'Ozon removal failed' });
    });
    return true;
}

function sendOzonUiRemoveResult(productId, result = {}) {
    sendRuntimeMessage({
        type: 'OZON_UI_REMOVE_RESULT',
        productId: normalizeWarehouseBridgeId(productId),
        ok: result.ok === true,
        error: result.error || null,
        removedCount: Number(result.removedCount) || 0,
        alreadyMissingCount: Number(result.alreadyMissingCount) || 0,
        verifiedCount: Number(result.verifiedCount) || 0
    }, () => {
        const runtimeError = getRuntimeLastError();
        if (runtimeError && !handleRuntimeMessagingError('OZON_PRODUCT', runtimeError)) {
            log('WARN', 'OZON_PRODUCT', 'remove result failed', runtimeError.message);
        }
    }, 'OZON_PRODUCT');
}


// Single isolated-worker sequence: read existing sold barcodes, delete the
// verified intersection, then proceed with the current assembly barcodes.
// A failed cleanup is reported and never automatically retried as a write.
function dispatchOzonApplyWithSoldCleanup(productId, barcodes, soldBarcodes, ozonSku, sellerId, preverified = false) {
    const api = window?.[OZON_ISOLATED_API_KEY];
    const cleanup = { matched: 0, removed: 0, error: '' };
    if (typeof api?.inspectSoldOzonBarcodes !== 'function'
        || typeof api?.removeConfirmedOzonBarcodes !== 'function'
        || typeof api?.applyOzonBarcodesWithFallback !== 'function') {
        sendOzonUiApplyResult(productId, {ok:false,error:'Ozon isolated automation bridge unavailable'});
        return;
    }
    Promise.resolve().then(async () => {
        const selected = [...new Set(soldBarcodes)].filter(code => !barcodes.includes(code));
        try {
            const present = [];
            // Ozon inspection validates at most 500 inputs per call. Read in
            // bounded chunks, then issue only one mutating delete per article.
            for (let offset = 0; !preverified && offset < selected.length; offset += 500) {
                const batch = selected.slice(offset, offset + 500);
                const inspect = await api.inspectSoldOzonBarcodes({productId,barcodes:batch,ozonSku,sellerId});
                if (inspect?.ok !== true || inspect.checkedCount !== batch.length
                    || !Array.isArray(inspect.present)
                    || new Set(inspect.present).size !== inspect.present.length
                    || inspect.present.some(code => !batch.includes(code))) {
                    throw new Error(inspect?.error || 'Ozon sale barcode comparison not verified');
                }
                present.push(...inspect.present);
            }
            const targets = preverified ? selected : present;
            cleanup.matched = targets.length;
            if (targets.length) {
                const removed = await api.removeConfirmedOzonBarcodes({
                    productId,barcodes:targets,ozonSku,sellerId,confirmedSoldInspection:true
                });
                cleanup.removed = Number(removed?.removedCount) || 0;
                if (removed?.ok !== true || removed.verifiedCount !== targets.length
                    || removed.removedCount !== targets.length) {
                    throw new Error(removed?.error || 'Ozon sold deletion unconfirmed');
                }
            }
        } catch(error) {
            cleanup.error = String(error?.message || error).slice(0,180);
        }
        // Even if cleanup fails, do not lose a confirmed warehouse assembly.
        const addition = await api.applyOzonBarcodesWithFallback({productId,barcodes,sellerId});
        sendOzonUiApplyResult(productId, {...(addition || {}), soldCleanup: cleanup});
    }).catch(error => sendOzonUiApplyResult(productId, {
        ok:false,error:String(error?.message || error),soldCleanup:cleanup
    }));
}

function dispatchSoldOzonDelete(productId, barcodes, ozonSku, sellerId, operationId) {
    const api = window?.[OZON_ISOLATED_API_KEY];
    const reply = result => sendRuntimeMessage({
        type: 'SOLD_OZON_DELETE_RESULT', operationId, productId,
        ok: result?.ok === true, error: result?.error || null,
        removedCount: Number(result?.removedCount) || 0,
        verifiedCount: Number(result?.verifiedCount) || 0,
        stillPresent: Array.isArray(result?.stillPresent) ? result.stillPresent : []
    }, () => {}, 'OZON_PRODUCT');
    if (typeof api?.removeConfirmedOzonBarcodes !== 'function') {
        reply({ok:false,error:'Sold cleanup isolated bridge unavailable'});return;
    }
    Promise.resolve(api.removeConfirmedOzonBarcodes({productId,barcodes,ozonSku,sellerId,confirmedSoldInspection:true}))
        .then(reply).catch(error => reply({ok:false,error:error?.message || 'Ozon deletion failed'}));
}

function dispatchSoldOzonInspect(productId, barcodes, ozonSku, sellerId, operationId) {
    const isolatedApi = window?.[OZON_ISOLATED_API_KEY];
    const reply = result => sendRuntimeMessage({
        type: 'SOLD_OZON_INSPECT_RESULT', operationId, productId,
        ok: result?.ok === true, error: result?.error || null,
        present: Array.isArray(result?.present) ? result.present : [],
        checkedCount: Number(result?.checkedCount) || 0
    }, () => {}, 'OZON_PRODUCT');
    if (typeof isolatedApi?.inspectSoldOzonBarcodes !== 'function') {
        reply({ ok: false, error: 'Ozon read-only bridge unavailable' }); return;
    }
    Promise.resolve(isolatedApi.inspectSoldOzonBarcodes({ productId, barcodes, ozonSku, sellerId }))
        .then(reply).catch(error => reply({ ok: false, error: error?.message || 'Ozon inspection failed' }));
}

function handleOzonRuntimeMessage(msg, _sender, sendResponse) {
    if (msg?.type !== 'OZON_UI_APPLY_IN_WORKER' && msg?.type !== 'OZON_UI_APPLY_WITH_SOLD_CLEANUP_IN_WORKER' && msg?.type !== 'OZON_UI_REMOVE_IN_WORKER' && msg?.type !== 'SOLD_OZON_INSPECT_IN_WORKER' && msg?.type !== 'SOLD_OZON_DELETE_IN_WORKER') {
        return false;
    }

    const productId = normalizeWarehouseBridgeId(msg.productId || getOzonProductIdFromUrl());
    const barcodes = Array.isArray(msg.barcodes) ? msg.barcodes.map(normalizeWarehouseBridgeId).filter(Boolean) : [];

    if (!productId || productId !== getOzonProductIdFromUrl() || !barcodes.length) {
        if (msg.type === 'OZON_UI_REMOVE_IN_WORKER') {
            sendOzonUiRemoveResult(productId, { ok: false, error: 'productId mismatch or barcodes missing' });
        } else {
            sendOzonUiApplyResult(productId, { ok: false, error: 'productId or barcodes missing' });
        }
        if (typeof sendResponse === 'function') {
            sendResponse({ ok: false, error: 'productId or barcodes missing' });
        }
        return true;
    }

    if (msg.type === 'OZON_UI_APPLY_WITH_SOLD_CLEANUP_IN_WORKER') {
        const sellerId = normalizeWarehouseBridgeId(msg.sellerId);
        const ozonSku = normalizeWarehouseBridgeId(msg.ozonSku);
        const soldBarcodes = Array.isArray(msg.soldBarcodes)
            ? [...new Set(msg.soldBarcodes.map(normalizeWarehouseBridgeId).filter(Boolean))] : [];
        if (!/^\d{3,}$/.test(sellerId) || !/^\d{6,}$/.test(ozonSku)
            || (ozonResolvedSellerId && ozonResolvedSellerId !== sellerId)
            || !soldBarcodes.length || soldBarcodes.length > 2000
            || soldBarcodes.some(code => !/^\d{5,80}$/.test(code))) {
            sendResponse?.({ok:false,error:'Ozon sold cleanup identity or barcode validation failed'});
            return true;
        }
        if (msg.preverified !== true) { sendResponse?.({ok:false,error:'Missing saved on-open verification'});return true; }
        dispatchOzonApplyWithSoldCleanup(productId,barcodes,soldBarcodes,ozonSku,sellerId,true);
        sendResponse?.({ok:true});
        return true;
    }
    if (msg.type === 'SOLD_OZON_DELETE_IN_WORKER') {
        const sellerId = normalizeWarehouseBridgeId(msg.sellerId);
        const ozonSku = normalizeWarehouseBridgeId(msg.ozonSku);
        const operationId = String(msg.operationId || '');
        if (!operationId || !/^\d{3,}$/.test(sellerId) || !/^\d{6,}$/.test(ozonSku)
            || (ozonResolvedSellerId && ozonResolvedSellerId !== sellerId)) {
            sendResponse?.({ok:false,error:'Ozon deletion identity mismatch'});return true;
        }
        dispatchSoldOzonDelete(productId,barcodes,ozonSku,sellerId,operationId);
        sendResponse?.({ok:true});return true;
    }
    if (msg.type === 'SOLD_OZON_INSPECT_IN_WORKER') {
        const sellerId = normalizeWarehouseBridgeId(msg.sellerId);
        const ozonSku = normalizeWarehouseBridgeId(msg.ozonSku);
        const operationId = String(msg.operationId || '');
        if (!operationId || !/^\d{3,}$/.test(sellerId) || !/^\d{6,}$/.test(ozonSku)
            || (ozonResolvedSellerId && ozonResolvedSellerId !== sellerId)) {
            sendResponse?.({ ok: false, error: 'Ozon inspection identity mismatch' });
            return true;
        }
        dispatchSoldOzonInspect(productId, barcodes, ozonSku, sellerId, operationId);
        sendResponse?.({ ok: true });
        return true;
    }
    if (msg.type === 'OZON_UI_REMOVE_IN_WORKER') {
        const sellerId = normalizeWarehouseBridgeId(msg.sellerId);
        const ozonSku = normalizeWarehouseBridgeId(msg.ozonSku);
        if (!/^\d{3,}$/.test(sellerId) || !/^\d{6,}$/.test(ozonSku)
            || (ozonResolvedSellerId && ozonResolvedSellerId !== sellerId)) {
            sendOzonUiRemoveResult(productId, { ok: false, error: 'Ozon resolved SKU or seller ID missing/mismatched' });
            if (typeof sendResponse === 'function') sendResponse({ ok: false, error: 'Ozon removal identity missing/mismatched' });
            return true;
        }
        dispatchOzonUiRemoveRequest(productId, barcodes, ozonSku, sellerId);
    } else {
        dispatchOzonUiApplyRequest(productId, barcodes);
    }

    if (typeof sendResponse === 'function') {
        sendResponse({ ok: true });
    }

    return true;
}

function ensureOzonRuntimeMessageListener() {
    if (ozonRuntimeMessageListenerInitialized) {
        return true;
    }

    if (typeof chrome?.runtime?.onMessage?.addListener !== 'function') {
        return false;
    }

    chrome.runtime.onMessage.addListener(handleOzonRuntimeMessage);
    ozonRuntimeMessageListenerInitialized = true;
    return true;
}

function handleOzonProductBridgeResponse(event) {
    const detail = event?.detail || {};
    const productId = normalizeWarehouseBridgeId(detail.productId || getOzonProductIdFromUrl());
    const sellerId = normalizeWarehouseBridgeId(detail.sellerId);

    if (/^\d{3,}$/.test(sellerId)) {
        ozonResolvedSellerId = sellerId;
    }

    sendOzonProductWorkerReady(productId);

    if (!productId) {
        sendOzonProductResolveResult('', { ok: false, error: 'productIdMissing' });
        return false;
    }

    if (!detail.ok || !detail.source) {
        sendOzonProductResolveResult(productId, { ok: false, error: detail.error || 'ozonProductSourceMissing', confirmedAbsent: detail.confirmedAbsent === true, catalogueDiagnostic: detail.catalogueDiagnostic || null });
        return false;
    }

    if (typeof resolveOzonProductSearchResult !== 'function') {
        sendOzonProductResolveResult(productId, { ok: false, error: 'ozon product resolver unavailable' });
        return false;
    }

    const result = resolveOzonProductSearchResult(detail.source, productId);
    sendOzonProductResolveResult(productId, result);
    log(result.ok ? 'INFO' : 'WARN', 'OZON_PRODUCT', 'resolve complete', {
        productId,
        error: result.error || null,
        itemCount: Array.isArray(result.items) ? result.items.length : 0
    });

    return true;
}

function dispatchOzonProductRequest() {
    const productId = getOzonProductIdFromUrl();

    window.dispatchEvent(new CustomEvent(OZON_PRODUCT_REQUEST_EVENT, {
        detail: { productId }
    }));
}

function injectOzonProductBridgeScript() {
    const existing = document.getElementById?.(OZON_PRODUCT_BRIDGE_SCRIPT_ID);

    if (existing) {
        return existing.dataset?.installed === 'true' ? 'ready' : 'loading';
    }

    const scriptUrl = getOzonProductBridgeScriptUrl();

    if (!scriptUrl) {
        return false;
    }

    const script = document.createElement?.('script');

    if (!script) {
        return false;
    }

    script.id = OZON_PRODUCT_BRIDGE_SCRIPT_ID;
    script.src = scriptUrl;
    script.async = false;
    script.dataset.installed = 'false';

    script.addEventListener?.('load', () => {
        script.dataset.installed = 'true';
        const productId = getOzonProductIdFromUrl();
        dispatchOzonProductRequest();
        scheduleOzonProductWorkerReadyFallback(productId);
    });

    script.addEventListener?.('error', () => {
        sendOzonProductResolveResult(getOzonProductIdFromUrl(), { ok: false, error: 'ozon bridge external script failed to load' });
    });

    const target = document.documentElement || document.head || document.body;

    if (!target?.appendChild) {
        return false;
    }

    target.appendChild(script);

    return 'loading';
}

function initOzonProductResolveWorker() {
    if (!isOzonProductWorkerPageUrl()) {
        return false;
    }

    if (!ozonProductBridgeInitialized) {
        window.addEventListener?.(OZON_PRODUCT_RESPONSE_EVENT, handleOzonProductBridgeResponse);
        ozonProductBridgeInitialized = true;
    }

    ensureOzonRuntimeMessageListener();

    const injected = injectOzonProductBridgeScript();

    if (!injected) {
        sendOzonProductResolveResult(getOzonProductIdFromUrl(), { ok: false, error: 'ozon bridge injection failed' });
        return false;
    }

    if (injected === 'ready') {
        const productId = getOzonProductIdFromUrl();
        dispatchOzonProductRequest();
        scheduleOzonProductWorkerReadyFallback(productId);
    }

    return true;
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
    if (isWarehouseAppPageUrl()) {
        startWarehouseBarcodeRouteWatcher();
        return;
    }

    if (isOzonProductWorkerPageUrl()) {
        initOzonProductResolveWorker();
        return;
    }

    initOrderKindObservation();

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
