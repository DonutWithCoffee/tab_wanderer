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
const OZON_PRODUCT_BRIDGE_SCRIPT_ID = 'tab-wanderer-ozon-product-bridge';
const OZON_PRODUCT_REQUEST_EVENT = 'tab_wanderer:ozon-product-request';
const OZON_PRODUCT_RESPONSE_EVENT = 'tab_wanderer:ozon-product-response';
const OZON_ISOLATED_API_KEY = '__TAB_WANDERER_OZON_ISOLATED_API__';
const OZON_WORKER_MARK = '#tab_wanderer_ozon_worker=1';
const WAREHOUSE_ROUTE_WATCH_INTERVAL_MS = 1000;
const OZON_WORKER_READY_FALLBACK_MS = 3000;
const WAREHOUSE_SHOP_ORDER_MAX_READ_ATTEMPTS = 8;
const WAREHOUSE_SHOP_ORDER_RETRY_DELAY_MS = 500;
const WAREHOUSE_ASSEMBLY_ACTION_REFRESH_DELAYS_MS = [350, 1200, 2500];
const WAREHOUSE_API_CAPTURE_WINDOW_MS = 12000;
const WAREHOUSE_ASSEMBLY_ACTION_DEBUG_STORAGE_KEY = 'tab_wanderer_warehouse_action_debug_v1';
const WAREHOUSE_AUTO_APPLY_TIMEOUT_MS = 10 * 60 * 1000;

let lastWarehouseBarcodePreview = null;
let lastWarehouseOzonResolvePreview = null;
let lastWarehouseOzonUiApply = null;
let warehouseBarcodeBridgeInitialized = false;
let warehouseRouteWatcherTimer = null;
let warehousePreviewActionListenersInitialized = false;
let warehouseBarcodePreviewCollapsed = true;
let warehouseBarcodePreviewCollapseTouched = false;
let warehouseOrderKindRecord = null;
let warehouseOrderKindRequestId = '';
let warehouseAutoApplyIntent = null;
let warehouseAutoApplySequence = 0;
let warehouseBarcodeListExpanded = false;
let warehouseBarcodePreviewPanelElement = null;
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

function isWarehouseAppPageUrl(href = window.location.href) {
    try {
        const url = new URL(href);

        return url.hostname === 'amperkot.ru'
            && url.pathname.startsWith('/web-apps/wh3/');
    } catch {
        return false;
    }
}

function isWarehouseAssemblyPageUrl(href = window.location.href) {
    try {
        const url = new URL(href);

        return isWarehouseAppPageUrl(href)
            && url.hash.includes('/wh/shop-orders/assembly/');
    } catch {
        return false;
    }
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
            text: 'OZON · автозапись после сборки',
            color: '#169c46'
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
        text: 'Тип не определён — обновите карточку заказа',
        color: '#b26a00'
    };
}

function getWarehouseOrderKindRecord() {
    return warehouseOrderKindRecord || createUnknownWarehouseOrderKindRecord();
}

function getWarehouseAutoApplyIntent() {
    return warehouseAutoApplyIntent ? { ...warehouseAutoApplyIntent } : null;
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

    if (render) {
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
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
    lastWarehouseAssemblyActionSignature = '';
    lastWarehouseAssemblyActionAt = 0;
}

function normalizeWarehouseBridgeText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeWarehouseBridgeId(value) {
    return String(value || '')
        .replace(/\s+/g, '')
        .trim();
}

function normalizeWarehouseBridgeNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
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

    return {
        id: normalizeWarehouseBridgeId(productItem.id || productItem.item_id || productItem.itemId),
        barcode: normalizeWarehouseBridgeId(productItem.barcode || productItem.bar_code || productItem.code),
        type: normalizeWarehouseBridgeNumber(productItem.type),
        quantity: normalizeWarehouseBridgeNumber(productItem.quantity),
        reserved_quantity: normalizeWarehouseBridgeNumber(productItem.reserved_quantity || productItem.reservedQuantity),
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

    return {
        id: normalizeWarehouseBridgeId(entry.id || entry.assembly_id || entry.assemblyId),
        quantity: normalizeWarehouseBridgeNumber(entry.quantity || entry.assembly_quantity || entry.assemblyQuantity),
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
        assembled_quantity: normalizeWarehouseBridgeNumber(item.assembled_quantity || item.assembledQuantity),
        assemble_status: normalizeWarehouseBridgeText(item.assemble_status || item.assembleStatus || item.status)
    };
}

function sanitizeWarehouseShopOrderForBarcodeBridge(shopOrder = {}) {
    const safeOrder = shopOrder && typeof shopOrder === 'object' ? shopOrder : {};

    return {
        id: normalizeWarehouseBridgeText(safeOrder.number || safeOrder.id || safeOrder.order_id || safeOrder.orderId),
        internalId: normalizeWarehouseBridgeId(safeOrder.id || safeOrder.internalId),
        number: normalizeWarehouseBridgeText(safeOrder.number || safeOrder.order_number || safeOrder.orderNumber),
        total_quantity: normalizeWarehouseBridgeNumber(safeOrder.total_quantity || safeOrder.totalQuantity),
        assembled_quantity: normalizeWarehouseBridgeNumber(safeOrder.assembled_quantity || safeOrder.assembledQuantity),
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

function isWarehouseAssemblyActionControl(control) {
    if (!control || control.disabled || control.getAttribute?.('aria-disabled') === 'true') {
        return false;
    }

    const text = getWarehouseAssemblyActionControlText(control);

    return !!text && /(?:собрать(?:\s+заказ)?|завершить\s+сборку|подтвердить\s+сборку)/i.test(text);
}

function isWarehouseAutoApplyActionControl(control) {
    if (!isWarehouseAssemblyActionControl(control)) {
        return false;
    }

    const text = getWarehouseAssemblyActionControlText(control);
    return /^(?:собрать\s+заказ|завершить\s+сборку|подтвердить\s+сборку)$/i.test(text);
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
    const barcodes = Array.isArray(preview?.extraction?.eligibleBarcodes)
        ? preview.extraction.eligibleBarcodes
            .map(entry => normalizeWarehouseBridgeId(entry?.barcode))
            .filter(Boolean)
            .sort()
        : [];

    return barcodes.join('|');
}

function startWarehouseAutoApplyIntent(control = null, now = Date.now()) {
    const orderId = getWarehouseOrderIdFromUrl();
    const kind = warehouseOrderKindRecord?.kind || 'unknown';

    if (!orderId || kind !== 'ozon') {
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
        status: 'waiting',
        trigger: 'warehouse-assembly-action'
    };

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

    if (responseSource === 'warehouse-api-response') {
        return true;
    }

    if (intent.baselineKnown !== true) {
        return false;
    }

    const nextFingerprint = getWarehouseBarcodePreviewFingerprint(preview);
    return Boolean(nextFingerprint && nextFingerprint !== intent.baselineFingerprint);
}

function maybeStartWarehouseAutoApply(preview = {}, responseSource = '', now = Date.now()) {
    const intent = warehouseAutoApplyIntent;
    if (!intent) {
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
    if (!isWarehouseAssemblyPageUrl()) {
        return false;
    }

    const actionText = getWarehouseAssemblyActionControlText(control);
    clearWarehouseAssemblyActionRefreshTimers('new assembly action');
    const apiCaptureArmed = dispatchWarehouseApiCaptureArm();

    updateWarehouseAssemblyActionDebug({
        actionDetected: true,
        actionText,
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

    setWarehouseBarcodePreviewLoading('Ждём ответ склада после сборки. Ozon не изменяем.');

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
    const actionSignature = `${getWarehouseOrderIdFromUrl()}|${getWarehouseAssemblyActionControlText(control)}`;
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


function renderWarehouseBarcodeListDropdown(panel, products = []) {
    const listProducts = products.filter(product => product.barcodes.length > 0 || product.skippedBarcodes.length > 0);

    if (!warehouseBarcodeListExpanded || !listProducts.length) {
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

    appendWarehousePreviewText(wrapper, 'div', 'Список штрихкодов', {
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

function renderWarehouseBarcodePreviewPanel(preview = lastWarehouseBarcodePreview) {
    const panel = ensureWarehouseBarcodePreviewPanel();

    if (!panel) {
        return false;
    }

    const viewModel = createWarehouseBarcodePreviewViewModel(preview);

    clearWarehousePreviewPanel(panel);
    applyWarehouseBarcodePreviewPanelLayout(panel);
    renderWarehouseBarcodePreviewHeader(panel, viewModel);

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
    const payload = getWarehouseOzonResolveRequestPayload();
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

function requestWarehouseOzonResolvePreview() {
    const payload = getWarehouseOzonResolveRequestPayload();

    if (!payload) {
        lastWarehouseOzonResolvePreview = createWarehouseOzonResolveError('Сначала прочитай штрихкоды склада.');
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
        return false;
    }

    lastWarehouseOzonResolvePreview = createWarehouseOzonResolveLoading();
    renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);

    sendRuntimeMessage({
        type: 'OZON_RESOLVE_PREVIEW_REQUEST',
        ...payload
    }, (response) => {
        const runtimeError = getRuntimeLastError();

        if (runtimeError) {
            if (!handleRuntimeMessagingError('WAREHOUSE_OZON', runtimeError)) {
                lastWarehouseOzonResolvePreview = createWarehouseOzonResolveError(runtimeError.message || 'Ozon worker unavailable');
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
            renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
            return;
        }

        if (response.plan) {
            lastWarehouseOzonResolvePreview = createWarehouseOzonResolveReady(response.plan);
            renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
            return;
        }

        log('INFO', 'WAREHOUSE_OZON', 'ozon resolve started', response);
    }, 'WAREHOUSE_OZON');

    return true;
}

function handleWarehouseRuntimeMessage(msg, _sender, sendResponse) {
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

    if (msg?.type === 'OZON_RESOLVE_PREVIEW_RESULT') {
        if (normalizeAmperkotOrderId(msg.orderId) !== getWarehouseOrderIdFromUrl()) {
            if (typeof sendResponse === 'function') {
                sendResponse({ ok: true, ignored: true });
            }
            return true;
        }

        if (msg.ok && msg.plan) {
            lastWarehouseOzonResolvePreview = createWarehouseOzonResolveReady(msg.plan);
            lastWarehouseOzonUiApply = reconcileWarehouseOzonUiApplyWithResolvePlan(
                lastWarehouseOzonUiApply,
                lastWarehouseOzonResolvePreview
            );
            log('INFO', 'WAREHOUSE_OZON', 'ozon resolve preview ready', msg.plan.summary);
        } else {
            lastWarehouseOzonResolvePreview = createWarehouseOzonResolveError(msg.error || 'Ozon resolve failed');
            log('WARN', 'WAREHOUSE_OZON', 'ozon resolve preview failed', lastWarehouseOzonResolvePreview.error);
        }

        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);

        if (typeof sendResponse === 'function') {
            sendResponse({ ok: true });
        }

        return true;
    }

    if (msg?.type === 'OZON_UI_APPLY_RESULT') {
        if (normalizeAmperkotOrderId(msg.orderId) !== getWarehouseOrderIdFromUrl()) {
            if (typeof sendResponse === 'function') {
                sendResponse({ ok: true, ignored: true });
            }
            return true;
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

function injectWarehouseBarcodeBridgeScript() {
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
        dispatchWarehouseShopOrderRequest();
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

    const nextWarehouseBarcodePreview = createWarehouseBarcodePreviewFromShopOrder(detail.shopOrder);

    const summary = nextWarehouseBarcodePreview.summary || nextWarehouseBarcodePreview.extraction?.summary || {};
    const responseSource = detail.source || 'angular-snapshot';
    const hasFreshBarcodeSnapshot = Number(summary.eligibleCount) > 0 || Number(summary.skippedCount) > 0;

    if (!hasFreshBarcodeSnapshot
        && warehouseShopOrderReadReason !== 'assembly-action'
        && scheduleWarehouseShopOrderRetry('warehouse barcode candidates not found')) {
        return lastWarehouseBarcodePreview;
    }

    clearWarehouseShopOrderRetryTimer();
    warehouseShopOrderReadAttempt = 0;

    if (shouldIgnoreLowerPriorityWarehouseSnapshot(responseSource, summary)) {
        log('INFO', 'WAREHOUSE_OZON', 'ignored lower priority barcode snapshot', {
            responseSource,
            previousSource: warehouseAssemblyActionDebug?.lastResponseSource || '',
            summary
        });
        return lastWarehouseBarcodePreview;
    }

    lastWarehouseBarcodePreview = nextWarehouseBarcodePreview;

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

    if (!warehouseAssemblyActionRefreshTimers.length
        || hasFreshBarcodeSnapshot) {
        clearWarehouseAssemblyActionRefreshTimers(hasFreshBarcodeSnapshot ? `${responseSource} barcode snapshot` : 'normal snapshot');
    } else {
        updateWarehouseAssemblyActionDebug({
            reloadTimerState: 'scheduled',
            reloadTimerClearReason: '',
            reloadFallbackReason: `${responseSource} had no barcode candidates yet`
        });
    }

    lastWarehouseOzonResolvePreview = null;
    lastWarehouseOzonUiApply = null;
    const autoApplyStarted = maybeStartWarehouseAutoApply(lastWarehouseBarcodePreview, responseSource);
    renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);

    log(lastWarehouseBarcodePreview.ok ? 'INFO' : 'WARN', 'WAREHOUSE_OZON', 'barcode preview ready', {
        summary: lastWarehouseBarcodePreview.summary,
        warehouseRefresh: getWarehouseAssemblyActionDebugPublicSnapshot(),
        autoApplyStarted
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

    const injected = injectWarehouseBarcodeBridgeScript();

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
    if (!isWarehouseAssemblyPageUrl()) {
        return false;
    }

    if (!warehouseBarcodeBridgeInitialized) {
        window.addEventListener?.(WAREHOUSE_SHOP_ORDER_RESPONSE_EVENT, handleWarehouseShopOrderBridgeResponse);
        ensureWarehouseRuntimeMessageListener();
        ensureWarehouseAssemblyActionListeners();
        warehouseBarcodeBridgeInitialized = true;
    }

    requestWarehouseOrderKind({ force: warehouseOrderKindRecord?.kind === 'unknown' });
    requestWarehouseShopOrderSnapshot();

    return true;
}

function handleWarehouseRouteStateChanged({ force = false } = {}) {
    const href = window.location.href;

    if (!force && href === lastWarehouseRouteHref) {
        return false;
    }

    const previousOrderId = getWarehouseOrderIdFromUrl(lastWarehouseRouteHref);
    const nextOrderId = getWarehouseOrderIdFromUrl(href);
    const orderChanged = previousOrderId !== nextOrderId;
    lastWarehouseRouteHref = href;

    if (isWarehouseAssemblyPageUrl(href)) {
        if (orderChanged || !warehouseOrderKindRecord) {
            resetWarehouseOrderContext();
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
    return false;
}

function startWarehouseBarcodeRouteWatcher() {
    if (!isWarehouseAppPageUrl()) {
        return false;
    }

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
        result: {
            ok: result.ok === true,
            error: result.error || null,
            productId,
            product: safeProduct,
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
        details: result.details || null
    }, () => {
        const runtimeError = getRuntimeLastError();

        if (runtimeError && !handleRuntimeMessagingError('OZON_PRODUCT', runtimeError)) {
            log('WARN', 'OZON_PRODUCT', 'UI apply result failed', runtimeError.message);
        }
    }, 'OZON_PRODUCT');
}

function handleOzonRuntimeMessage(msg, _sender, sendResponse) {
    if (msg?.type !== 'OZON_UI_APPLY_IN_WORKER') {
        return false;
    }

    const productId = normalizeWarehouseBridgeId(msg.productId || getOzonProductIdFromUrl());
    const barcodes = Array.isArray(msg.barcodes) ? msg.barcodes.map(normalizeWarehouseBridgeId).filter(Boolean) : [];

    if (!productId || !barcodes.length) {
        sendOzonUiApplyResult(productId, { ok: false, error: 'productId or barcodes missing' });
        if (typeof sendResponse === 'function') {
            sendResponse({ ok: false, error: 'productId or barcodes missing' });
        }
        return true;
    }

    dispatchOzonUiApplyRequest(productId, barcodes);

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
        sendOzonProductResolveResult(productId, { ok: false, error: detail.error || 'ozonProductSourceMissing' });
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
