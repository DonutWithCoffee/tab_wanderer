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


// ---------- WAREHOUSE OZON BARCODE BRIDGE ----------
const WAREHOUSE_BRIDGE_SCRIPT_ID = 'tab-wanderer-warehouse-barcode-bridge';
const WAREHOUSE_SHOP_ORDER_REQUEST_EVENT = 'tab_wanderer:warehouse-shop-order-request';
const WAREHOUSE_SHOP_ORDER_RESPONSE_EVENT = 'tab_wanderer:warehouse-shop-order-response';
const WAREHOUSE_BARCODE_PREVIEW_PANEL_ID = 'tab-wanderer-warehouse-barcode-preview';
const WAREHOUSE_BARCODE_PREVIEW_REFRESH_BUTTON_ID = 'tab-wanderer-warehouse-barcode-preview-refresh';
const WAREHOUSE_OZON_RESOLVE_BUTTON_ID = 'tab-wanderer-warehouse-ozon-resolve';
const WAREHOUSE_OZON_APPLY_BUTTON_ID = 'tab-wanderer-warehouse-ozon-apply';
const OZON_PRODUCT_BRIDGE_SCRIPT_ID = 'tab-wanderer-ozon-product-bridge';
const OZON_PRODUCT_REQUEST_EVENT = 'tab_wanderer:ozon-product-request';
const OZON_PRODUCT_RESPONSE_EVENT = 'tab_wanderer:ozon-product-response';
const OZON_UI_APPLY_REQUEST_EVENT = 'tab_wanderer:ozon-ui-apply-request';
const OZON_UI_APPLY_RESPONSE_EVENT = 'tab_wanderer:ozon-ui-apply-response';
const OZON_WORKER_MARK = '#tab_wanderer_ozon_worker=1';
const WAREHOUSE_ROUTE_WATCH_INTERVAL_MS = 1000;
const WAREHOUSE_SHOP_ORDER_MAX_READ_ATTEMPTS = 8;
const WAREHOUSE_SHOP_ORDER_RETRY_DELAY_MS = 500;

let lastWarehouseBarcodePreview = null;
let lastWarehouseOzonResolvePreview = null;
let lastWarehouseOzonUiApply = null;
let warehouseBarcodeBridgeInitialized = false;
let warehouseRouteWatcherTimer = null;
let warehousePreviewActionListenersInitialized = false;
let lastWarehouseRouteHref = '';
let warehouseShopOrderReadAttempt = 0;
let warehouseShopOrderRetryTimer = null;
let ozonProductBridgeInitialized = false;
let ozonRuntimeMessageListenerInitialized = false;

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

function clearWarehouseShopOrderRetryTimer() {
    if (!warehouseShopOrderRetryTimer || typeof clearTimeout !== 'function') {
        warehouseShopOrderRetryTimer = null;
        return;
    }

    clearTimeout(warehouseShopOrderRetryTimer);
    warehouseShopOrderRetryTimer = null;
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

function formatWarehouseBarcodePreviewCount(value) {
    const number = Number(value);

    return Number.isFinite(number) && number >= 0 ? String(number) : '0';
}

function getWarehouseBarcodePreviewOrderId(preview = {}) {
    return normalizeWarehouseBridgeText(
        preview?.shopOrder?.id
        || preview?.shopOrder?.number
        || preview?.extraction?.orderId
        || ''
    );
}

function getWarehouseOzonResolvePlanByProductId(resolvePreview = lastWarehouseOzonResolvePreview) {
    const plans = resolvePreview?.plan?.productPlans;

    if (!Array.isArray(plans)) {
        return {};
    }

    return plans.reduce((map, plan) => {
        const productId = normalizeWarehouseBridgeId(plan?.productId);

        if (productId) {
            map[productId] = plan;
        }

        return map;
    }, {});
}

function createWarehouseBarcodePreviewProductRows(productsById = {}, resolvePreview = lastWarehouseOzonResolvePreview) {
    const ozonPlansByProductId = getWarehouseOzonResolvePlanByProductId(resolvePreview);
    const applyResult = lastWarehouseOzonUiApply || null;

    return Object.values(productsById || {})
        .filter(group => group && group.productId && group.productId !== '__unknown__')
        .map(group => {
            const productId = normalizeWarehouseBridgeId(group.productId);
            const ozonPlan = ozonPlansByProductId[productId] || null;

            return {
                productId,
                productTitle: normalizeWarehouseBridgeText(group.productTitle),
                eligibleCount: Array.isArray(group.eligibleBarcodes) ? group.eligibleBarcodes.length : 0,
                skippedCount: Array.isArray(group.skippedBarcodes) ? group.skippedBarcodes.length : 0,
                ozonStatus: ozonPlan?.status || '',
                ozonReason: ozonPlan?.reason || '',
                ozonSku: normalizeWarehouseBridgeId(ozonPlan?.ozonSku),
                ozonToAddCount: Array.isArray(ozonPlan?.toAdd) ? ozonPlan.toAdd.length : 0,
                ozonAlreadyExistsCount: Array.isArray(ozonPlan?.alreadyExists) ? ozonPlan.alreadyExists.length : 0,
                ozonExistingCount: Array.isArray(ozonPlan?.existingBarcodes) ? ozonPlan.existingBarcodes.length : 0,
                ozonApplyStatus: applyResult?.productId === productId ? applyResult.status : '',
                ozonApplyError: applyResult?.productId === productId ? applyResult.error || '' : '',
                ozonApplyAddedCount: applyResult?.productId === productId ? Number(applyResult.addedCount) || 0 : 0
            };
        })
        .sort((a, b) => a.productId.localeCompare(b.productId));
}

function createWarehouseBarcodePreviewViewModel(preview = lastWarehouseBarcodePreview) {
    const base = {
        title: 'tab_wanderer · Ozon barcodes',
        actionLabel: 'Проверить штрихкоды',
        actions: [
            { id: 'warehouse-refresh', label: 'Проверить штрихкоды', variant: 'primary' }
        ],
        status: 'loading',
        message: 'Ищем данные сборки на странице склада. Ozon не изменяем.',
        metrics: [],
        products: [],
        ozon: lastWarehouseOzonResolvePreview || null,
        ozonApply: lastWarehouseOzonUiApply || null
    };

    if (!preview) {
        return base;
    }

    if (preview.status === 'loading' || preview.ok === null) {
        return {
            ...base,
            status: 'loading',
            message: preview.message || base.message
        };
    }

    if (!preview.ok) {
        return {
            ...base,
            status: 'error',
            message: preview.error || 'Не удалось прочитать данные сборки.'
        };
    }

    const summary = preview.summary || preview.extraction?.summary || {};
    const orderId = getWarehouseBarcodePreviewOrderId(preview) || '—';
    const ozon = lastWarehouseOzonResolvePreview || null;
    const ozonApply = lastWarehouseOzonUiApply || null;
    const ozonSummary = ozon?.plan?.summary || {};
    const products = createWarehouseBarcodePreviewProductRows(preview.extraction?.productsById || {}, ozon);
    const hasEligibleBarcodes = Number(summary.eligibleCount) > 0;
    const isOzonBusy = ozon?.status === 'loading' || ozonApply?.status === 'loading';
    const actions = hasEligibleBarcodes
        ? [
            {
                id: 'ozon-resolve',
                label: ozon?.status === 'loading' ? 'Проверяем штрихкоды...' : 'Проверить штрихкоды',
                variant: 'primary',
                disabled: isOzonBusy
            },
            {
                id: 'ozon-ui-apply',
                label: ozonApply?.status === 'loading' ? 'Добавляем в Ozon...' : 'Добавить в Ozon',
                variant: 'secondary',
                disabled: isOzonBusy
            },
            {
                id: 'warehouse-refresh',
                label: 'Обновить склад',
                variant: 'secondary',
                disabled: isOzonBusy
            }
        ]
        : [
            { id: 'warehouse-refresh', label: 'Обновить склад', variant: 'primary' }
        ];

    const metrics = [
        { label: 'Заказ', value: orderId },
        { label: 'Товаров', value: formatWarehouseBarcodePreviewCount(summary.productCount) },
        { label: 'Кандидатов', value: formatWarehouseBarcodePreviewCount(summary.eligibleCount) },
        { label: 'Пропущено', value: formatWarehouseBarcodePreviewCount(summary.skippedCount) }
    ];

    if (ozon?.status === 'ready') {
        metrics.push(
            { label: 'Добавить', value: formatWarehouseBarcodePreviewCount(ozonSummary.toAddCount) },
            { label: 'Уже есть', value: formatWarehouseBarcodePreviewCount(ozonSummary.alreadyExistsCount) }
        );
    }

    if (ozonApply?.status === 'ready') {
        metrics.push({ label: 'Записано', value: formatWarehouseBarcodePreviewCount(ozonApply.addedCount) });
    }

    const ozonMessage = ozonApply?.status === 'loading'
        ? 'Добавляем штрихкоды через интерфейс Ozon. Не закрывай Ozon worker tab.'
        : ozonApply?.status === 'error'
            ? `Ozon: ${ozonApply.error || 'ошибка записи'}`
            : ozonApply?.status === 'ready'
                ? `Ozon: добавлено ${formatWarehouseBarcodePreviewCount(ozonApply.addedCount)}.`
                : ozon?.status === 'loading'
                    ? 'Проверяем карточки Ozon. Записи нет.'
                    : ozon?.status === 'error'
                        ? `Ozon: ${ozon.error || 'ошибка проверки'}`
                        : ozon?.status === 'ready'
                            ? 'Ozon проверен. Записи пока нет.'
                            : 'Локальный предпросмотр. Записи в Ozon пока нет.';

    return {
        ...base,
        status: ozonApply?.status === 'error' || ozon?.status === 'error' ? 'error' : 'ready',
        message: ozonMessage,
        actions,
        metrics,
        products,
        ozon,
        ozonApply
    };
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

    let panel = document.getElementById(WAREHOUSE_BARCODE_PREVIEW_PANEL_ID);

    if (panel) {
        return panel;
    }

    panel = createWarehousePreviewElement('div', {
        id: WAREHOUSE_BARCODE_PREVIEW_PANEL_ID,
        styles: {
            position: 'fixed',
            right: '16px',
            bottom: '16px',
            width: '340px',
            maxHeight: '70vh',
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

    panel.setAttribute?.('data-tab-wanderer-panel', 'warehouse-barcode-preview');

    const target = document.body || document.documentElement;

    if (!panel || !target?.appendChild) {
        return null;
    }

    target.appendChild(panel);
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

function removeWarehouseBarcodePreviewPanel() {
    const panel = typeof document.getElementById === 'function'
        ? document.getElementById(WAREHOUSE_BARCODE_PREVIEW_PANEL_ID)
        : null;

    if (panel?.parentNode?.removeChild) {
        panel.parentNode.removeChild(panel);
    }
}

function getWarehousePreviewActionTarget(target) {
    return target?.closest?.(`#${WAREHOUSE_BARCODE_PREVIEW_REFRESH_BUTTON_ID}, #${WAREHOUSE_OZON_RESOLVE_BUTTON_ID}, #${WAREHOUSE_OZON_APPLY_BUTTON_ID}, [data-tab-wanderer-action]`) || null;
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

    if (action === 'ozon-resolve') {
        requestWarehouseOzonResolvePreview();
        return;
    }

    if (action === 'ozon-ui-apply') {
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

    target.addEventListener?.('pointerdown', handleWarehousePreviewActionEvent, true);
    target.addEventListener?.('click', handleWarehousePreviewActionEvent, true);
    target.addEventListener?.('keydown', handleWarehousePreviewKeyboardEvent, true);

    warehousePreviewActionListenersInitialized = true;
}

function renderWarehouseBarcodePreviewPanel(preview = lastWarehouseBarcodePreview) {
    const panel = ensureWarehouseBarcodePreviewPanel();

    if (!panel) {
        return false;
    }

    const viewModel = createWarehouseBarcodePreviewViewModel(preview);

    clearWarehousePreviewPanel(panel);

    appendWarehousePreviewText(panel, 'div', viewModel.title, {
        fontWeight: '700',
        marginBottom: '6px'
    });

    appendWarehousePreviewText(panel, 'div', viewModel.message, {
        color: viewModel.status === 'error' ? '#db2919' : '#667685',
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
            appendWarehousePreviewText(
                item,
                'div',
                `кандидатов: ${product.eligibleCount}, пропущено: ${product.skippedCount}`,
                { color: '#667685', fontSize: '12px' }
            );

            if (product.ozonStatus) {
                appendWarehousePreviewText(
                    item,
                    'div',
                    `Ozon: добавить ${product.ozonToAddCount}, уже есть ${product.ozonAlreadyExistsCount}${product.ozonReason ? `, ${product.ozonReason}` : ''}`,
                    { color: product.ozonStatus === 'error' ? '#db2919' : '#667685', fontSize: '12px' }
                );
            }

            if (product.ozonApplyStatus) {
                const applyText = product.ozonApplyStatus === 'ready'
                    ? `Ozon UI: добавлено ${product.ozonApplyAddedCount}`
                    : product.ozonApplyStatus === 'loading'
                        ? 'Ozon UI: добавляем...'
                        : `Ozon UI: ${product.ozonApplyError || 'ошибка записи'}`;

                appendWarehousePreviewText(
                    item,
                    'div',
                    applyText,
                    { color: product.ozonApplyStatus === 'error' ? '#db2919' : '#667685', fontSize: '12px' }
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
        : [{ id: 'warehouse-refresh', label: viewModel.actionLabel, variant: 'primary' }];

    actionList.forEach(action => {
        const isPrimary = action.variant !== 'secondary';
        const disabled = action.disabled === true;
        const button = createWarehousePreviewElement('div', {
            id: action.id === 'ozon-resolve' ? WAREHOUSE_OZON_RESOLVE_BUTTON_ID : action.id === 'ozon-ui-apply' ? WAREHOUSE_OZON_APPLY_BUTTON_ID : WAREHOUSE_BARCODE_PREVIEW_REFRESH_BUTTON_ID,
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
                border: isPrimary ? '0' : '1px solid #005bff',
                borderRadius: '8px',
                background: isPrimary ? '#005bff' : '#ffffff',
                color: isPrimary ? '#ffffff' : '#005bff',
                cursor: disabled ? 'default' : 'pointer',
                fontWeight: '700',
                pointerEvents: 'auto',
                opacity: disabled ? '0.65' : '1',
                textAlign: 'center',
                boxSizing: 'border-box',
                userSelect: 'none',
                marginTop: action.id === 'warehouse-refresh' ? '0' : '8px'
            }
        });

        panel.appendChild?.(button);
    });
    ensureWarehousePreviewActionListeners();

    return true;
}


function createWarehouseOzonResolveLoading(message = 'Проверяем Ozon. Записи нет.') {
    return {
        status: 'loading',
        message
    };
}

function createWarehouseOzonResolveError(errorMessage = 'ozon resolve failed') {
    return {
        status: 'error',
        error: errorMessage
    };
}

function createWarehouseOzonResolveReady(plan = {}) {
    return {
        status: 'ready',
        plan
    };
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


function createWarehouseOzonUiApplyLoading(message = 'Добавляем штрихкоды через интерфейс Ozon.') {
    return {
        status: 'loading',
        message
    };
}

function createWarehouseOzonUiApplyError(errorMessage = 'ozon UI apply failed', productId = '') {
    return {
        status: 'error',
        error: errorMessage,
        productId: normalizeWarehouseBridgeId(productId),
        addedCount: 0
    };
}

function createWarehouseOzonUiApplyReady(result = {}) {
    return {
        status: 'ready',
        productId: normalizeWarehouseBridgeId(result.productId),
        barcodes: Array.isArray(result.barcodes) ? result.barcodes.map(normalizeWarehouseBridgeId).filter(Boolean) : [],
        addedCount: Number(result.addedCount) || 0,
        details: result.details || null
    };
}

function requestWarehouseOzonUiApply() {
    const payload = getWarehouseOzonResolveRequestPayload();

    if (!payload) {
        lastWarehouseOzonUiApply = createWarehouseOzonUiApplyError('Сначала прочитай штрихкоды склада.');
        renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
        return false;
    }

    lastWarehouseOzonUiApply = createWarehouseOzonUiApplyLoading();
    renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);

    sendRuntimeMessage({
        type: 'OZON_UI_APPLY_REQUEST',
        ...payload
    }, (response) => {
        const runtimeError = getRuntimeLastError();

        if (runtimeError) {
            if (!handleRuntimeMessagingError('WAREHOUSE_OZON', runtimeError)) {
                lastWarehouseOzonUiApply = createWarehouseOzonUiApplyError(runtimeError.message || 'Ozon worker unavailable');
                renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
                log('WARN', 'WAREHOUSE_OZON', 'ozon UI apply request failed', runtimeError.message);
            }
            return;
        }

        if (!response?.ok) {
            lastWarehouseOzonUiApply = createWarehouseOzonUiApplyError(response?.error || 'Ozon UI apply request failed');
            renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);
            return;
        }

        log('INFO', 'WAREHOUSE_OZON', 'ozon UI apply started', response);
    }, 'WAREHOUSE_OZON');

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
    if (msg?.type === 'OZON_RESOLVE_PREVIEW_RESULT') {
        if (msg.ok && msg.plan) {
            lastWarehouseOzonResolvePreview = createWarehouseOzonResolveReady(msg.plan);
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
        if (msg.ok) {
            lastWarehouseOzonUiApply = createWarehouseOzonUiApplyReady(msg);
            log('INFO', 'WAREHOUSE_OZON', 'ozon UI apply ready', {
                productId: lastWarehouseOzonUiApply.productId,
                addedCount: lastWarehouseOzonUiApply.addedCount
            });
        } else {
            lastWarehouseOzonUiApply = createWarehouseOzonUiApplyError(msg.error || 'Ozon UI apply failed', msg.productId);
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
        requestWarehouseShopOrderSnapshot({ resetAttempts: false });
    }, WAREHOUSE_SHOP_ORDER_RETRY_DELAY_MS);

    return true;
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

    clearWarehouseShopOrderRetryTimer();
    warehouseShopOrderReadAttempt = 0;
    lastWarehouseBarcodePreview = createWarehouseBarcodePreviewFromShopOrder(detail.shopOrder);
    lastWarehouseOzonResolvePreview = null;
    lastWarehouseOzonUiApply = null;
    renderWarehouseBarcodePreviewPanel(lastWarehouseBarcodePreview);

    log(lastWarehouseBarcodePreview.ok ? 'INFO' : 'WARN', 'WAREHOUSE_OZON', 'barcode preview ready', lastWarehouseBarcodePreview.summary);

    return lastWarehouseBarcodePreview;
}

function requestWarehouseShopOrderSnapshot({ resetAttempts = true } = {}) {
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
        warehouseBarcodeBridgeInitialized = true;
    }

    requestWarehouseShopOrderSnapshot();

    return true;
}

function handleWarehouseRouteStateChanged({ force = false } = {}) {
    const href = window.location.href;

    if (!force && href === lastWarehouseRouteHref) {
        return false;
    }

    lastWarehouseRouteHref = href;

    if (isWarehouseAssemblyPageUrl(href)) {
        return initWarehouseBarcodeBridge();
    }

    clearWarehouseShopOrderRetryTimer();
    warehouseShopOrderReadAttempt = 0;
    lastWarehouseBarcodePreview = null;
    lastWarehouseOzonResolvePreview = null;
    lastWarehouseOzonUiApply = null;
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
            return chrome.runtime.getURL('ozon-product-bridge.js');
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
    sendRuntimeMessage({
        type: 'OZON_PRODUCT_WORKER_READY',
        productId
    }, () => {
        const runtimeError = getRuntimeLastError();

        if (runtimeError && !handleRuntimeMessagingError('OZON_PRODUCT', runtimeError)) {
            log('WARN', 'OZON_PRODUCT', 'worker ready message failed', runtimeError.message);
        }
    }, 'OZON_PRODUCT');
}

function dispatchOzonUiApplyRequest(productId, barcodes = []) {
    window.dispatchEvent(new CustomEvent(OZON_UI_APPLY_REQUEST_EVENT, {
        detail: {
            productId: normalizeWarehouseBridgeId(productId),
            barcodes: Array.isArray(barcodes) ? barcodes.map(normalizeWarehouseBridgeId).filter(Boolean) : []
        }
    }));
}

function sendOzonUiApplyResult(productId, result = {}) {
    sendRuntimeMessage({
        type: 'OZON_UI_APPLY_RESULT',
        productId: normalizeWarehouseBridgeId(productId),
        ok: result.ok === true,
        error: result.error || null,
        barcodes: Array.isArray(result.barcodes) ? result.barcodes.map(normalizeWarehouseBridgeId).filter(Boolean) : [],
        addedCount: Number(result.addedCount) || 0,
        details: result.details || null
    }, () => {
        const runtimeError = getRuntimeLastError();

        if (runtimeError && !handleRuntimeMessagingError('OZON_PRODUCT', runtimeError)) {
            log('WARN', 'OZON_PRODUCT', 'UI apply result failed', runtimeError.message);
        }
    }, 'OZON_PRODUCT');
}

function handleOzonUiApplyBridgeResponse(event) {
    const detail = event?.detail || {};
    const productId = normalizeWarehouseBridgeId(detail.productId || getOzonProductIdFromUrl());

    sendOzonUiApplyResult(productId, detail);
    log(detail.ok ? 'INFO' : 'WARN', 'OZON_PRODUCT', 'UI apply complete', {
        productId,
        addedCount: Number(detail.addedCount) || 0,
        error: detail.error || null
    });

    return true;
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
        dispatchOzonProductRequest();
        sendOzonProductWorkerReady(getOzonProductIdFromUrl());
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
        window.addEventListener?.(OZON_UI_APPLY_RESPONSE_EVENT, handleOzonUiApplyBridgeResponse);
        ozonProductBridgeInitialized = true;
    }

    ensureOzonRuntimeMessageListener();

    const injected = injectOzonProductBridgeScript();

    if (!injected) {
        sendOzonProductResolveResult(getOzonProductIdFromUrl(), { ok: false, error: 'ozon bridge injection failed' });
        return false;
    }

    if (injected === 'ready') {
        dispatchOzonProductRequest();
        sendOzonProductWorkerReady(getOzonProductIdFromUrl());
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