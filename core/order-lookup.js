const ORDER_LOOKUP_QUERY_TYPES = Object.freeze({
    EMPTY: 'empty',
    SHORT: 'short',
    FULL: 'full',
    INVALID: 'invalid'
});

const ORDER_LOOKUP_DEFAULT_LIMIT = 100;

function normalizeOrderLookupQuery(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
}

function normalizeOrderLookupId(value) {
    return normalizeOrderLookupQuery(value);
}

function getShortOrderNumber(orderId) {
    const normalized = normalizeOrderLookupId(orderId);
    const match = normalized.match(/^(\d{4})-/);

    return match ? match[1] : '';
}

function getOrderLookupQueryType(query) {
    const normalized = normalizeOrderLookupQuery(query);

    if (!normalized) {
        return ORDER_LOOKUP_QUERY_TYPES.EMPTY;
    }

    if (/^\d{4}$/.test(normalized)) {
        return ORDER_LOOKUP_QUERY_TYPES.SHORT;
    }

    if (/^\d{4}-\d{4,}$/.test(normalized)) {
        return ORDER_LOOKUP_QUERY_TYPES.FULL;
    }

    return ORDER_LOOKUP_QUERY_TYPES.INVALID;
}

function cloneOrderLookupValue(value) {
    if (Array.isArray(value)) {
        return value.map(item => cloneOrderLookupValue(item));
    }

    if (value && typeof value === 'object') {
        return JSON.parse(JSON.stringify(value));
    }

    return value;
}

function getOrderContextFromJournalEntry(entry = {}) {
    const context = entry.context && typeof entry.context === 'object'
        ? cloneOrderLookupValue(entry.context)
        : {};

    const diff = Array.isArray(entry.diff) ? entry.diff : [];

    for (const item of diff) {
        const field = String(item?.field || '');

        if (!field || field.startsWith('scope.')) {
            continue;
        }

        if (item?.after !== undefined) {
            context[field] = cloneOrderLookupValue(item.after);
        }
    }

    return context;
}

function mergeOrderLookupContext(base = {}, next = {}) {
    const result = { ...base };

    for (const [key, value] of Object.entries(next || {})) {
        if (value === undefined || value === null || value === '') {
            continue;
        }

        if (Array.isArray(value) && !value.length) {
            continue;
        }

        result[key] = cloneOrderLookupValue(value);
    }

    return result;
}

function updateOrderLookupCandidate(candidates, orderId, patch = {}) {
    const normalizedId = normalizeOrderLookupId(orderId);

    if (!normalizedId) {
        return;
    }

    const existing = candidates.get(normalizedId) || {
        orderId: normalizedId,
        shortOrderNumber: getShortOrderNumber(normalizedId),
        orderUrl: '',
        context: {},
        isWatched: false,
        watchStatus: '',
        lastSeenAt: 0,
        lastEventAt: 0,
        lastCheckedAt: 0,
        eventCount: 0
    };

    const lastSeenAt = Math.max(
        Number(existing.lastSeenAt) || 0,
        Number(patch.lastSeenAt) || 0,
        Number(patch.lastEventAt) || 0,
        Number(patch.lastCheckedAt) || 0
    );

    candidates.set(normalizedId, {
        ...existing,
        ...patch,
        orderId: normalizedId,
        shortOrderNumber: getShortOrderNumber(normalizedId),
        orderUrl: patch.orderUrl || existing.orderUrl || '',
        context: mergeOrderLookupContext(existing.context, patch.context),
        isWatched: existing.isWatched || patch.isWatched === true,
        eventCount: (Number(existing.eventCount) || 0) + (Number(patch.eventCountDelta) || 0),
        lastSeenAt,
        lastEventAt: Math.max(Number(existing.lastEventAt) || 0, Number(patch.lastEventAt) || 0),
        lastCheckedAt: Math.max(Number(existing.lastCheckedAt) || 0, Number(patch.lastCheckedAt) || 0)
    });
}

function collectOrderLookupCandidates({ knownOrdersDB, eventJournal, watchedOrders } = {}) {
    const candidates = new Map();

    for (const order of Object.values(knownOrdersDB || {})) {
        const orderId = normalizeOrderLookupId(order?.id);

        if (!orderId) {
            continue;
        }

        updateOrderLookupCandidate(candidates, orderId, {
            orderUrl: String(order?.orderUrl || ''),
            context: cloneOrderLookupValue(order || {}),
            lastSeenAt: Number(order?.updatedAt || order?.createdAt || 0) || 0
        });
    }

    for (const entry of Array.isArray(eventJournal) ? eventJournal : []) {
        const orderId = normalizeOrderLookupId(entry?.orderId);

        if (!orderId) {
            continue;
        }

        updateOrderLookupCandidate(candidates, orderId, {
            orderUrl: String(entry?.orderUrl || ''),
            context: getOrderContextFromJournalEntry(entry),
            lastSeenAt: Number(entry?.createdAt) || 0,
            lastEventAt: Number(entry?.createdAt) || 0,
            eventCountDelta: 1
        });
    }

    const normalizedWatched = typeof normalizeWatchedOrdersConfig === 'function'
        ? normalizeWatchedOrdersConfig(watchedOrders)
        : { items: [] };

    for (const item of Array.isArray(normalizedWatched.items) ? normalizedWatched.items : []) {
        const orderId = normalizeOrderLookupId(item?.id);

        if (!orderId) {
            continue;
        }

        updateOrderLookupCandidate(candidates, orderId, {
            isWatched: true,
            watchStatus: String(item?.status || ''),
            lastCheckedAt: Number(item?.lastCheckedAt) || 0,
            lastSeenAt: Number(item?.lastCheckedAt || item?.lastEventAt || item?.lastBaselineAt || item?.addedAt || 0) || 0
        });
    }

    return Array.from(candidates.values())
        .sort((a, b) => {
            const timeDiff = (Number(b.lastSeenAt) || 0) - (Number(a.lastSeenAt) || 0);

            if (timeDiff) {
                return timeDiff;
            }

            return String(b.orderId || '').localeCompare(String(a.orderId || ''));
        });
}

function normalizeOrderLookupLimit(value, fallback = ORDER_LOOKUP_DEFAULT_LIMIT) {
    const numeric = Number(value);
    const safeFallback = Math.max(1, Number(fallback) || ORDER_LOOKUP_DEFAULT_LIMIT);

    if (!Number.isFinite(numeric) || numeric <= 0) {
        return safeFallback;
    }

    return Math.min(Math.floor(numeric), 500);
}

function getOrderSpecificEntries(eventJournal, selectedOrderId, limit = ORDER_LOOKUP_DEFAULT_LIMIT) {
    const normalizedId = normalizeOrderLookupId(selectedOrderId);
    const safeLimit = normalizeOrderLookupLimit(limit);

    if (!normalizedId) {
        return [];
    }

    return (Array.isArray(eventJournal) ? eventJournal : [])
        .filter(entry => normalizeOrderLookupId(entry?.orderId) === normalizedId)
        .slice(-safeLimit)
        .reverse()
        .map(entry => cloneOrderLookupValue(entry));
}

function getOrderLookupSnapshot({ knownOrdersDB, eventJournal, watchedOrders } = {}, options = {}) {
    const query = normalizeOrderLookupQuery(options.query || options.orderQuery || options.orderId || '');
    const queryType = getOrderLookupQueryType(query);
    const limit = normalizeOrderLookupLimit(options.limit);
    const droppedEntries = typeof normalizeEventJournalDroppedEntries === 'function'
        ? normalizeEventJournalDroppedEntries(options.droppedEntries)
        : Math.max(0, Math.floor(Number(options.droppedEntries) || 0));
    const allCandidates = collectOrderLookupCandidates({ knownOrdersDB, eventJournal, watchedOrders });
    let candidates = [];
    let selectedOrderId = '';
    let status = 'idle';

    if (queryType === ORDER_LOOKUP_QUERY_TYPES.EMPTY) {
        return {
            query,
            queryType,
            status,
            candidates: [],
            selectedOrderId: '',
            order: null,
            entries: [],
            total: 0,
            returned: 0,
            storedTotal: Array.isArray(eventJournal) ? eventJournal.length : 0,
            droppedEntries,
            limit
        };
    }

    if (queryType === ORDER_LOOKUP_QUERY_TYPES.INVALID) {
        return {
            query,
            queryType,
            status: 'invalid-query',
            candidates: [],
            selectedOrderId: '',
            order: null,
            entries: [],
            total: 0,
            returned: 0,
            storedTotal: Array.isArray(eventJournal) ? eventJournal.length : 0,
            droppedEntries,
            limit
        };
    }

    if (queryType === ORDER_LOOKUP_QUERY_TYPES.FULL) {
        candidates = allCandidates.filter(candidate => candidate.orderId === query);
    } else if (queryType === ORDER_LOOKUP_QUERY_TYPES.SHORT) {
        candidates = allCandidates.filter(candidate => candidate.shortOrderNumber === query);
    }

    if (!candidates.length) {
        status = 'not-found';
    } else if (queryType === ORDER_LOOKUP_QUERY_TYPES.FULL || candidates.length === 1) {
        selectedOrderId = candidates[0].orderId;
        status = 'selected';
    } else {
        status = 'multiple-candidates';
    }

    const entries = selectedOrderId
        ? getOrderSpecificEntries(eventJournal, selectedOrderId, limit)
        : [];
    const order = selectedOrderId
        ? candidates.find(candidate => candidate.orderId === selectedOrderId) || null
        : null;

    return {
        query,
        queryType,
        status,
        candidates: candidates.map(candidate => cloneOrderLookupValue(candidate)),
        selectedOrderId,
        order: order ? cloneOrderLookupValue(order) : null,
        entries,
        total: entries.length,
        returned: entries.length,
        storedTotal: Array.isArray(eventJournal) ? eventJournal.length : 0,
        droppedEntries,
        limit
    };
}

globalThis.ORDER_LOOKUP_QUERY_TYPES = ORDER_LOOKUP_QUERY_TYPES;
globalThis.ORDER_LOOKUP_DEFAULT_LIMIT = ORDER_LOOKUP_DEFAULT_LIMIT;
globalThis.normalizeOrderLookupQuery = normalizeOrderLookupQuery;
globalThis.normalizeOrderLookupId = normalizeOrderLookupId;
globalThis.getShortOrderNumber = getShortOrderNumber;
globalThis.getOrderLookupQueryType = getOrderLookupQueryType;
globalThis.collectOrderLookupCandidates = collectOrderLookupCandidates;
globalThis.getOrderSpecificEntries = getOrderSpecificEntries;
globalThis.getOrderLookupSnapshot = getOrderLookupSnapshot;
