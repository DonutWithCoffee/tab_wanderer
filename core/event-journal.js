const JOURNAL_EVENT_TYPES = {
    NEW_ORDER: 'new-order',
    ORDER_CHANGED: 'order-changed',
    SCOPE_CHANGED: 'scope-changed',
    DIRECT_FOLLOW_UP: 'direct-follow-up'
};

const JOURNAL_EVENT_KINDS = {
    LIVE: 'live',
    CATCH_UP: 'catch-up',
    SCOPE_CATCH_UP: 'scope-catch-up',
    SCOPE_CHANGE: 'scope-change',
    DIRECT_FOLLOW_UP: 'direct-follow-up'
};

const DEFAULT_EVENT_JOURNAL_LIMIT = 5000;
const DEFAULT_EVENT_JOURNAL_READ_LIMIT = 100;
const DEFAULT_EVENT_JOURNAL_MAX_BYTES = 2000000;

const EVENT_JOURNAL_CONTEXT_FIELDS = [
    'id',
    'orderUrl',
    'status',
    'delivery',
    'payment',
    'city',
    'tags',
    'date',
    'phoneNormalized',
    'totalAmount',
    'productsDone',
    'productsTotal',
    'manager',
    'contractor'
];

const MONITOR_SCOPE_JOURNAL_FIELDS = [
    { key: 'status', field: 'scope.status', label: 'Статус', dictionaryKey: 'status' },
    { key: 'delivery', field: 'scope.delivery', label: 'Доставка', dictionaryKey: 'delivery' },
    { key: 'payment', field: 'scope.payment', label: 'Оплата', dictionaryKey: 'payment' },
    { key: 'orderFlags', field: 'scope.orderFlags', label: 'Флаги', dictionaryKey: 'orderFlags' },
    { key: 'store', field: 'scope.store', label: 'Склад', dictionaryKey: 'store' },
    { key: 'reserve', field: 'scope.reserve', label: 'Резерв', dictionaryKey: 'reserve' },
    { key: 'assemblyStatus', field: 'scope.assemblyStatus', label: 'Комплектация', dictionaryKey: 'assemblyStatus' }
];

function getJournalEventKind(syncReason) {
    const reason = typeof normalizeSyncReason === 'function'
        ? normalizeSyncReason(syncReason)
        : String(syncReason || 'normal');

    if (reason === SYNC_REASONS.SCOPE_CHANGE || reason === SYNC_REASONS.MODE_CHANGE) {
        return JOURNAL_EVENT_KINDS.SCOPE_CATCH_UP;
    }

    if (reason === SYNC_REASONS.DIRECT_FOLLOW_UP) {
        return JOURNAL_EVENT_KINDS.DIRECT_FOLLOW_UP;
    }

    if (
        reason === SYNC_REASONS.INITIAL ||
        reason === SYNC_REASONS.MANUAL_START ||
        reason === SYNC_REASONS.RECOVERY ||
        reason === SYNC_REASONS.STALE_RESUME
    ) {
        return JOURNAL_EVENT_KINDS.CATCH_UP;
    }

    return JOURNAL_EVENT_KINDS.LIVE;
}

function cloneJournalValue(value) {
    if (Array.isArray(value)) {
        return value.map(item => cloneJournalValue(item));
    }

    if (value && typeof value === 'object') {
        return JSON.parse(JSON.stringify(value));
    }

    return value;
}

function pickOrderContext(order = {}) {
    const context = {};

    for (const field of EVENT_JOURNAL_CONTEXT_FIELDS) {
        if (order[field] !== undefined) {
            context[field] = cloneJournalValue(order[field]);
        }
    }

    return context;
}

function buildChangedFieldDiff(prevOrder, nextOrder, changedFields = []) {
    const safeChangedFields = Array.isArray(changedFields)
        ? changedFields.map(field => String(field)).filter(Boolean)
        : [];

    return safeChangedFields.map(field => ({
        field,
        before: cloneJournalValue(prevOrder?.[field]),
        after: cloneJournalValue(nextOrder?.[field])
    }));
}

function buildEventJournalEntryId({ createdAt, orderId, eventType, newHash } = {}) {
    return [
        Number(createdAt) || Date.now(),
        String(orderId || 'unknown-order'),
        String(eventType || 'unknown-event'),
        String(newHash || 'no-hash')
    ]
        .join(':')
        .replace(/\s+/g, '_');
}

function createNotificationJournalSnapshot(decision = {}) {
    return {
        notify: decision.notify === true,
        action: decision.action || null,
        ruleId: decision.ruleId || null,
        reason: decision.reason || null,
        matchedFields: Array.isArray(decision.matchedFields)
            ? decision.matchedFields.map(field => String(field))
            : []
    };
}

function createEventJournalEntry({
    order,
    eventContext,
    notificationDecision,
    syncReason = SYNC_REASONS.NORMAL,
    monitorMode,
    monitorScope,
    coverageMetadata,
    createdAt = Date.now()
} = {}) {
    const safeOrder = order || {};
    const safeContext = eventContext || {};
    const eventType = safeContext.eventType || (safeContext.isNewOrder ? JOURNAL_EVENT_TYPES.NEW_ORDER : JOURNAL_EVENT_TYPES.ORDER_CHANGED);
    const changedFields = Array.isArray(safeContext.changedFields)
        ? safeContext.changedFields.map(field => String(field))
        : [];
    const normalizedSyncReason = normalizeSyncReason(syncReason);

    return {
        id: buildEventJournalEntryId({
            createdAt,
            orderId: safeOrder.id,
            eventType,
            newHash: safeContext.newHash
        }),
        createdAt,
        orderId: String(safeOrder.id || ''),
        orderUrl: String(safeOrder.orderUrl || ''),
        eventType,
        eventKind: getJournalEventKind(normalizedSyncReason),
        syncReason: normalizedSyncReason,
        changedFields,
        diff: buildChangedFieldDiff(safeContext.prevOrder, safeOrder, changedFields),
        context: pickOrderContext(safeOrder),
        prevHash: safeContext.prevHash || null,
        newHash: safeContext.newHash || null,
        monitorMode: typeof normalizeMonitorModeForMetadata === 'function'
            ? normalizeMonitorModeForMetadata(monitorMode)
            : String(monitorMode || 'windowed'),
        monitorScopeSignature: typeof getMonitorScopeSignature === 'function'
            ? getMonitorScopeSignature(monitorScope)
            : '',
        coverage: coverageMetadata ? cloneJournalValue(coverageMetadata) : null,
        notification: createNotificationJournalSnapshot(notificationDecision)
    };
}

function normalizeScopeListForJournal(values) {
    return Array.isArray(values)
        ? values.map(value => String(value)).filter(Boolean).sort()
        : [];
}

function getDictionaryLabelForScopeValue(dictionaries, dictionaryKey, value) {
    const list = Array.isArray(dictionaries?.[dictionaryKey]) ? dictionaries[dictionaryKey] : [];
    const match = list.find(item => String(item?.id || '') === String(value));

    return match?.label || String(value);
}

function formatScopeListForJournal(scope, dictionaries, descriptor) {
    const values = normalizeScopeListForJournal(scope?.[descriptor.key]);

    if (!values.length) {
        return ['Все'];
    }

    return values.map(value => getDictionaryLabelForScopeValue(dictionaries, descriptor.dictionaryKey, value));
}

function createScopeChangeDiff(prevScope = {}, nextScope = {}, dictionaries = {}) {
    const diff = [];

    for (const descriptor of MONITOR_SCOPE_JOURNAL_FIELDS) {
        const beforeRaw = normalizeScopeListForJournal(prevScope?.[descriptor.key]);
        const afterRaw = normalizeScopeListForJournal(nextScope?.[descriptor.key]);

        if (JSON.stringify(beforeRaw) === JSON.stringify(afterRaw)) {
            continue;
        }

        diff.push({
            field: descriptor.field,
            before: formatScopeListForJournal(prevScope, dictionaries, descriptor),
            after: formatScopeListForJournal(nextScope, dictionaries, descriptor)
        });
    }

    return diff;
}

function createScopeChangeJournalEntry({
    prevScope,
    nextScope,
    monitorDictionaries,
    monitorMode,
    createdAt = Date.now()
} = {}) {
    const safeNextScope = nextScope || {};
    const diff = createScopeChangeDiff(prevScope, safeNextScope, monitorDictionaries);
    const changedFields = diff.map(item => item.field);

    return {
        id: buildEventJournalEntryId({
            createdAt,
            orderId: 'monitor-scope',
            eventType: JOURNAL_EVENT_TYPES.SCOPE_CHANGED,
            newHash: typeof getMonitorScopeSignature === 'function'
                ? getMonitorScopeSignature(safeNextScope)
                : JSON.stringify(safeNextScope)
        }),
        createdAt,
        orderId: '',
        orderUrl: '',
        eventType: JOURNAL_EVENT_TYPES.SCOPE_CHANGED,
        eventKind: JOURNAL_EVENT_KINDS.SCOPE_CHANGE,
        syncReason: SYNC_REASONS.SCOPE_CHANGE,
        changedFields,
        diff,
        context: {
            monitorScope: {
                before: cloneJournalValue(prevScope || {}),
                after: cloneJournalValue(safeNextScope)
            }
        },
        prevHash: null,
        newHash: null,
        monitorMode: typeof normalizeMonitorModeForMetadata === 'function'
            ? normalizeMonitorModeForMetadata(monitorMode)
            : String(monitorMode || 'windowed'),
        monitorScopeSignature: typeof getMonitorScopeSignature === 'function'
            ? getMonitorScopeSignature(safeNextScope)
            : '',
        coverage: null,
        notification: createNotificationJournalSnapshot({
            notify: false,
            action: 'suppress',
            ruleId: 'scope-change-no-notification',
            reason: 'Scope changes are recorded in history without user notifications',
            matchedFields: []
        })
    };
}

function normalizeJournalLimit(value, fallback = DEFAULT_EVENT_JOURNAL_READ_LIMIT) {
    const numeric = Number(value);
    const safeFallback = Math.max(1, Number(fallback) || DEFAULT_EVENT_JOURNAL_READ_LIMIT);

    if (!Number.isFinite(numeric) || numeric <= 0) {
        return Math.min(safeFallback, DEFAULT_EVENT_JOURNAL_LIMIT);
    }

    return Math.min(Math.floor(numeric), DEFAULT_EVENT_JOURNAL_LIMIT);
}

function normalizeEventJournalMaxBytes(value, fallback = DEFAULT_EVENT_JOURNAL_MAX_BYTES) {
    const numeric = Number(value);
    const safeFallback = Math.max(1000, Number(fallback) || DEFAULT_EVENT_JOURNAL_MAX_BYTES);

    if (!Number.isFinite(numeric) || numeric <= 0) {
        return safeFallback;
    }

    return Math.max(1000, Math.floor(numeric));
}

function getEventJournalApproxBytes(journal) {
    try {
        return JSON.stringify(Array.isArray(journal) ? journal : []).length;
    } catch (_err) {
        return DEFAULT_EVENT_JOURNAL_MAX_BYTES + 1;
    }
}

function applyEventJournalRetention(journal, options = {}) {
    const safeJournal = Array.isArray(journal) ? journal.filter(Boolean) : [];
    const safeLimit = normalizeJournalLimit(
        options.maxEntries ?? options.limit,
        DEFAULT_EVENT_JOURNAL_LIMIT
    );
    const safeMaxBytes = normalizeEventJournalMaxBytes(
        options.maxBytes,
        DEFAULT_EVENT_JOURNAL_MAX_BYTES
    );
    let entries = safeJournal.map(entry => cloneJournalValue(entry));
    let dropped = 0;

    if (entries.length > safeLimit) {
        dropped += entries.length - safeLimit;
        entries = entries.slice(entries.length - safeLimit);
    }

    while (entries.length > 0 && getEventJournalApproxBytes(entries) > safeMaxBytes) {
        entries.shift();
        dropped += 1;
    }

    return {
        entries,
        dropped,
        maxEntries: safeLimit,
        maxBytes: safeMaxBytes,
        retainedBytes: getEventJournalApproxBytes(entries)
    };
}

function normalizeEventJournal(journal, limit = DEFAULT_EVENT_JOURNAL_LIMIT) {
    return applyEventJournalRetention(journal, { maxEntries: limit }).entries;
}

function normalizeJournalFilterText(value) {
    return String(value || '').trim().toLowerCase();
}

function matchesJournalChangedField(entry, changedField) {
    const filter = String(changedField || '').trim();

    if (!filter) {
        return true;
    }

    const fields = Array.isArray(entry.changedFields)
        ? entry.changedFields.map(field => String(field))
        : [];

    if (filter === 'scope') {
        return fields.some(field => field.startsWith('scope.'));
    }

    return fields.includes(filter);
}

function matchesJournalFilter(entry, filters = {}) {
    if (filters.orderId !== undefined && String(entry.orderId || '') !== String(filters.orderId)) {
        return false;
    }

    const orderQuery = normalizeJournalFilterText(filters.orderQuery || filters.query);

    if (orderQuery) {
        const orderId = normalizeJournalFilterText(entry.orderId);

        if (!orderId.includes(orderQuery)) {
            return false;
        }
    }

    if (filters.eventType !== undefined && String(entry.eventType || '') !== String(filters.eventType)) {
        return false;
    }

    if (filters.eventKind !== undefined && String(entry.eventKind || '') !== String(filters.eventKind)) {
        return false;
    }

    if (filters.watchedOnly === true) {
        const watchedSet = new Set((Array.isArray(filters.watchedOrderIds) ? filters.watchedOrderIds : [])
            .map(id => typeof normalizeWatchedOrderId === 'function' ? normalizeWatchedOrderId(id) : String(id || '').trim())
            .filter(Boolean));
        const orderId = typeof normalizeWatchedOrderId === 'function'
            ? normalizeWatchedOrderId(entry.orderId)
            : String(entry.orderId || '').trim();

        if (!watchedSet.size || !orderId || !watchedSet.has(orderId)) {
            return false;
        }
    }

    if (!matchesJournalChangedField(entry, filters.changedField)) {
        return false;
    }

    const since = Number(filters.since);

    if (Number.isFinite(since) && since > 0 && Number(entry.createdAt || 0) < since) {
        return false;
    }

    return true;
}

function normalizeEventJournalDroppedEntries(value) {
    const numeric = Number(value);

    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function getEventJournalSnapshot(journal, options = {}) {
    const safeOptions = options || {};
    const retention = applyEventJournalRetention(journal, {
        maxEntries: safeOptions.maxEntries,
        maxBytes: safeOptions.maxBytes
    });
    const safeJournal = retention.entries;
    const filtered = safeJournal.filter(entry => matchesJournalFilter(entry, safeOptions));
    const limit = normalizeJournalLimit(safeOptions.limit, DEFAULT_EVENT_JOURNAL_READ_LIMIT);
    const entries = filtered
        .slice(Math.max(0, filtered.length - limit))
        .reverse()
        .map(entry => cloneJournalValue(entry));
    const externalDroppedEntries = normalizeEventJournalDroppedEntries(safeOptions.droppedEntries);
    const droppedEntries = externalDroppedEntries + retention.dropped;

    return {
        storedTotal: safeJournal.length,
        retainedTotal: safeJournal.length,
        total: filtered.length,
        returned: entries.length,
        limit,
        droppedEntries,
        retention: {
            maxEntries: retention.maxEntries,
            maxBytes: retention.maxBytes,
            retainedBytes: retention.retainedBytes,
            droppedEntries
        },
        entries
    };
}

function appendEventJournalEntryWithRetention(journal, entry, options = {}) {
    const nextJournal = Array.isArray(journal) ? journal.slice() : [];

    nextJournal.push(cloneJournalValue(entry));

    return applyEventJournalRetention(nextJournal, options);
}

function appendEventJournalEntry(journal, entry, limit = DEFAULT_EVENT_JOURNAL_LIMIT) {
    return appendEventJournalEntryWithRetention(journal, entry, { maxEntries: limit }).entries;
}

globalThis.JOURNAL_EVENT_TYPES = JOURNAL_EVENT_TYPES;
globalThis.JOURNAL_EVENT_KINDS = JOURNAL_EVENT_KINDS;
globalThis.DEFAULT_EVENT_JOURNAL_LIMIT = DEFAULT_EVENT_JOURNAL_LIMIT;
globalThis.DEFAULT_EVENT_JOURNAL_READ_LIMIT = DEFAULT_EVENT_JOURNAL_READ_LIMIT;
globalThis.DEFAULT_EVENT_JOURNAL_MAX_BYTES = DEFAULT_EVENT_JOURNAL_MAX_BYTES;
globalThis.EVENT_JOURNAL_CONTEXT_FIELDS = EVENT_JOURNAL_CONTEXT_FIELDS;
globalThis.MONITOR_SCOPE_JOURNAL_FIELDS = MONITOR_SCOPE_JOURNAL_FIELDS;
globalThis.getJournalEventKind = getJournalEventKind;
globalThis.pickOrderContext = pickOrderContext;
globalThis.buildChangedFieldDiff = buildChangedFieldDiff;
globalThis.buildEventJournalEntryId = buildEventJournalEntryId;
globalThis.createNotificationJournalSnapshot = createNotificationJournalSnapshot;
globalThis.createEventJournalEntry = createEventJournalEntry;
globalThis.createScopeChangeDiff = createScopeChangeDiff;
globalThis.createScopeChangeJournalEntry = createScopeChangeJournalEntry;
globalThis.normalizeJournalLimit = normalizeJournalLimit;
globalThis.normalizeEventJournalMaxBytes = normalizeEventJournalMaxBytes;
globalThis.getEventJournalApproxBytes = getEventJournalApproxBytes;
globalThis.applyEventJournalRetention = applyEventJournalRetention;
globalThis.normalizeEventJournal = normalizeEventJournal;
globalThis.matchesJournalFilter = matchesJournalFilter;
globalThis.normalizeEventJournalDroppedEntries = normalizeEventJournalDroppedEntries;
globalThis.getEventJournalSnapshot = getEventJournalSnapshot;
globalThis.appendEventJournalEntryWithRetention = appendEventJournalEntryWithRetention;
globalThis.appendEventJournalEntry = appendEventJournalEntry;
