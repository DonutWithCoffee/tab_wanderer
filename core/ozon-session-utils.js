function normalizeOzonSessionOrderId(value) {
    if (typeof normalizeOrderKindOrderId === 'function') {
        return normalizeOrderKindOrderId(value);
    }

    const normalized = String(value || '').trim();
    return /^\d{4}-\d{6}$/.test(normalized) ? normalized : '';
}

function normalizeOzonResolveId(value) {
    return String(value || '')
        .replace(/\s+/g, '')
        .trim();
}

function isWarehouseOzonResolveSender(senderTab = {}) {
    try {
        const url = new URL(String(senderTab?.url || ''));
        return url.protocol === 'https:'
            && url.hostname === 'amperkot.ru'
            && url.pathname.startsWith('/web-apps/wh3/');
    } catch {
        return false;
    }
}

function getOzonResolveProductGroups(warehouseExtraction = {}) {
    if (typeof getOzonBindingProductGroups === 'function') {
        return getOzonBindingProductGroups(warehouseExtraction);
    }

    return Object.values(warehouseExtraction?.productsById || {})
        .filter(group => group && group.productId && group.productId !== '__unknown__');
}

function getOzonResolveProductIds(warehouseExtraction = {}) {
    return getOzonResolveProductGroups(warehouseExtraction)
        .filter(group => Array.isArray(group.eligibleBarcodes) && group.eligibleBarcodes.length > 0)
        .map(group => normalizeOzonResolveId(group.productId))
        .filter(Boolean);
}

function buildOzonResolveWorkerUrl(productId, options = {}) {
    const productsUrl = options.productsUrl || OZON_PRODUCTS_URL;
    const workerMark = options.workerMark || OZON_WORKER_MARK;
    const url = new URL(buildOzonProductSearchUrl(productId, productsUrl));
    url.hash = String(workerMark || '').replace('#', '');
    return url.toString();
}

function createOzonResolveSessionState({ warehouseTabId, orderId = '', warehouseExtraction = {}, productIds = [], now = Date.now() } = {}) {
    return {
        warehouseTabId,
        orderId: normalizeOzonSessionOrderId(orderId),
        warehouseExtraction,
        productIds,
        index: 0,
        ozonProductsByProductId: {},
        startedAt: now
    };
}

function getCurrentOzonUiApplyProductRequest(session = ozonUiApplySession) {
    return session?.productRequests?.[session.index] || null;
}

function buildOzonUiApplyWorkerUrl(productId, options = {}) {
    return buildOzonProductSearchUrl(productId, options.productsUrl || OZON_PRODUCTS_URL);
}

function createOzonUiApplySessionState({
    warehouseTabId,
    orderId = '',
    productRequests = [],
    trigger = 'manual',
    actionId = '',
    now = Date.now()
} = {}) {
    return {
        warehouseTabId,
        orderId: normalizeOzonSessionOrderId(orderId),
        productRequests,
        index: 0,
        results: [],
        status: 'opening',
        trigger: trigger === 'automatic' ? 'automatic' : 'manual',
        actionId: String(actionId || '').slice(0, 160),
        startedAt: now
    };
}
