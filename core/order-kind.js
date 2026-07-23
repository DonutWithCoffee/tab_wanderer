const ORDER_KIND_OZON = 'ozon';
const ORDER_KIND_REGULAR = 'regular';
const ORDER_KIND_UNKNOWN = 'unknown';
const ORDER_KIND_VALUES = new Set([
    ORDER_KIND_OZON,
    ORDER_KIND_REGULAR,
    ORDER_KIND_UNKNOWN
]);

function normalizeOrderKindOrderId(value) {
    const normalized = String(value || '').trim();
    return /^\d{4}-\d{6}$/.test(normalized) ? normalized : '';
}

function normalizeOrderKindText(value, maxLength = 160) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/ё/gi, match => match === 'Ё' ? 'Е' : 'е')
        .replace(/[«»„“”"'()]/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .slice(0, Math.max(1, Number(maxLength) || 160));
}

function isOzonSourceText(value) {
    return normalizeOrderKindText(value) === 'ozon';
}

function isOzonContractorText(value) {
    const normalized = normalizeOrderKindText(value);
    return normalized === 'ozon'
        || normalized === 'озон'
        || normalized === 'ozon озон'
        || normalized === 'озон ozon';
}

function normalizeTrustedOzonShipActionUrl(value, expectedOrderId = '') {
    const orderId = normalizeOrderKindOrderId(expectedOrderId);
    if (!orderId) {
        return '';
    }

    try {
        const url = new URL(String(value || ''), 'https://amperkot.ru');
        const escapedOrderId = orderId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^/admin/_api/shop-orders/${escapedOrderId}/ozon/\\d+/posting/fbs/ship/?$`);

        if (url.protocol !== 'https:' || url.hostname !== 'amperkot.ru' || !pattern.test(url.pathname)) {
            return '';
        }

        url.hash = '';
        url.search = '';
        return url.toString();
    } catch {
        return '';
    }
}

function normalizeOrderKindEvidence(value = {}, expectedOrderId = '') {
    const orderId = normalizeOrderKindOrderId(value?.orderId || expectedOrderId);
    const source = String(value?.source || '').trim().slice(0, 160);
    const contractor = String(value?.contractor || '').trim().slice(0, 200);
    const ozonShipActionUrl = normalizeTrustedOzonShipActionUrl(value?.ozonShipActionUrl, orderId);
    const sourceOzon = isOzonSourceText(source);
    const contractorOzon = isOzonContractorText(contractor);
    const actionOzon = Boolean(ozonShipActionUrl);

    return {
        orderId,
        pageComplete: value?.pageComplete === true,
        sourceOzon,
        contractorOzon,
        actionOzon,
        ozonShipActionUrl
    };
}

function classifyOrderKind(value = {}, expectedOrderId = '') {
    const evidence = normalizeOrderKindEvidence(value, expectedOrderId);

    if (!evidence.orderId || !evidence.pageComplete) {
        return {
            kind: ORDER_KIND_UNKNOWN,
            reason: 'incomplete-order-page',
            evidence
        };
    }

    if (evidence.sourceOzon && evidence.actionOzon) {
        return {
            kind: ORDER_KIND_OZON,
            reason: evidence.contractorOzon
                ? 'source-action-contractor'
                : 'source-action',
            evidence
        };
    }

    if (!evidence.sourceOzon && !evidence.contractorOzon && !evidence.actionOzon) {
        return {
            kind: ORDER_KIND_REGULAR,
            reason: 'no-ozon-markers',
            evidence
        };
    }

    return {
        kind: ORDER_KIND_UNKNOWN,
        reason: 'conflicting-ozon-markers',
        evidence
    };
}

function normalizeOrderKindValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ORDER_KIND_VALUES.has(normalized) ? normalized : ORDER_KIND_UNKNOWN;
}
