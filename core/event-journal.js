const JOURNAL_EVENT_KINDS = {
    LIVE: 'live',
    CATCH_UP: 'catch-up',
    SCOPE_CATCH_UP: 'scope-catch-up'
};

const DEFAULT_EVENT_JOURNAL_LIMIT = 500;

const EVENT_JOURNAL_CONTEXT_FIELDS = [
    'id',
    'orderUrl',
    'date',
    'phoneNormalized',
    'totalAmount',
    'productsDone',
    'productsTotal',
    'manager',
    'contractor',
    'city'
];

function getJournalEventKind(syncReason) {
    const reason = typeof normalizeSyncReason === 'function'
        ? normalizeSyncReason(syncReason)
        : String(syncReason || 'normal');

    if (reason === SYNC_REASONS.SCOPE_CHANGE || reason === SYNC_REASONS.MODE_CHANGE) {
        return JOURNAL_EVENT_KINDS.SCOPE_CATCH_UP;
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
    const eventType = safeContext.eventType || (safeContext.isNewOrder ? 'new-order' : 'order-changed');
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

function appendEventJournalEntry(journal, entry, limit = DEFAULT_EVENT_JOURNAL_LIMIT) {
    const safeLimit = Math.max(1, Number(limit) || DEFAULT_EVENT_JOURNAL_LIMIT);
    const nextJournal = Array.isArray(journal) ? journal.slice() : [];

    nextJournal.push(entry);

    if (nextJournal.length <= safeLimit) {
        return nextJournal;
    }

    return nextJournal.slice(nextJournal.length - safeLimit);
}

globalThis.JOURNAL_EVENT_KINDS = JOURNAL_EVENT_KINDS;
globalThis.DEFAULT_EVENT_JOURNAL_LIMIT = DEFAULT_EVENT_JOURNAL_LIMIT;
globalThis.EVENT_JOURNAL_CONTEXT_FIELDS = EVENT_JOURNAL_CONTEXT_FIELDS;
globalThis.getJournalEventKind = getJournalEventKind;
globalThis.pickOrderContext = pickOrderContext;
globalThis.buildChangedFieldDiff = buildChangedFieldDiff;
globalThis.buildEventJournalEntryId = buildEventJournalEntryId;
globalThis.createNotificationJournalSnapshot = createNotificationJournalSnapshot;
globalThis.createEventJournalEntry = createEventJournalEntry;
globalThis.appendEventJournalEntry = appendEventJournalEntry;
