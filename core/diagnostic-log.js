const DIAGNOSTIC_LOG_LEVELS = {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
};

const DEFAULT_DIAGNOSTIC_LOG_LIMIT = 5000;
const DEFAULT_DIAGNOSTIC_LOG_READ_LIMIT = 100;
const DEFAULT_DIAGNOSTIC_LOG_MAX_BYTES = 2000000;
const DIAGNOSTIC_LOG_MAX_STRING_LENGTH = 300;
const DIAGNOSTIC_LOG_MAX_ARRAY_ITEMS = 20;
const DIAGNOSTIC_LOG_MAX_OBJECT_KEYS = 30;

const DIAGNOSTIC_LOG_SENSITIVE_KEYS = [
    'authorization',
    'cookie',
    'cookies',
    'customer',
    'customerName',
    'dom',
    'html',
    'knownOrdersDB',
    'order',
    'orders',
    'password',
    'phone',
    'phoneNormalized',
    'rawHtml',
    'token',
    'user',
    'windowOrdersDB'
];

function normalizeDiagnosticLogLevel(level) {
    const normalized = String(level || DIAGNOSTIC_LOG_LEVELS.INFO).toUpperCase();

    return Object.prototype.hasOwnProperty.call(DIAGNOSTIC_LOG_LEVELS, normalized)
        ? normalized
        : DIAGNOSTIC_LOG_LEVELS.INFO;
}

function shouldPersistDiagnosticLogLevel(level) {
    const normalized = normalizeDiagnosticLogLevel(level);

    return normalized === DIAGNOSTIC_LOG_LEVELS.INFO
        || normalized === DIAGNOSTIC_LOG_LEVELS.WARN
        || normalized === DIAGNOSTIC_LOG_LEVELS.ERROR;
}

function isSensitiveDiagnosticLogKey(key) {
    const normalized = String(key || '').trim();

    return DIAGNOSTIC_LOG_SENSITIVE_KEYS.includes(normalized);
}

function truncateDiagnosticLogString(value) {
    const text = String(value || '');

    if (text.length <= DIAGNOSTIC_LOG_MAX_STRING_LENGTH) {
        return text;
    }

    return `${text.slice(0, DIAGNOSTIC_LOG_MAX_STRING_LENGTH)}…`;
}

function sanitizeDiagnosticLogDetails(value, key = '') {
    if (isSensitiveDiagnosticLogKey(key)) {
        return '[redacted]';
    }

    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === 'string') {
        return truncateDiagnosticLogString(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        const items = value
            .slice(0, DIAGNOSTIC_LOG_MAX_ARRAY_ITEMS)
            .map(item => sanitizeDiagnosticLogDetails(item));

        if (value.length > DIAGNOSTIC_LOG_MAX_ARRAY_ITEMS) {
            items.push(`[truncated ${value.length - DIAGNOSTIC_LOG_MAX_ARRAY_ITEMS} items]`);
        }

        return items;
    }

    if (typeof value === 'object') {
        const result = {};
        const entries = Object.entries(value).slice(0, DIAGNOSTIC_LOG_MAX_OBJECT_KEYS);

        for (const [entryKey, entryValue] of entries) {
            result[entryKey] = sanitizeDiagnosticLogDetails(entryValue, entryKey);
        }

        const totalKeys = Object.keys(value).length;

        if (totalKeys > DIAGNOSTIC_LOG_MAX_OBJECT_KEYS) {
            result.__truncatedKeys = totalKeys - DIAGNOSTIC_LOG_MAX_OBJECT_KEYS;
        }

        return result;
    }

    return truncateDiagnosticLogString(value);
}

function cloneDiagnosticLogValue(value) {
    return sanitizeDiagnosticLogDetails(value);
}

function normalizeDiagnosticLogLimit(value, fallback = DEFAULT_DIAGNOSTIC_LOG_READ_LIMIT) {
    const numeric = Number(value);
    const safeFallback = Math.max(1, Number(fallback) || DEFAULT_DIAGNOSTIC_LOG_READ_LIMIT);

    if (!Number.isFinite(numeric) || numeric <= 0) {
        return Math.min(safeFallback, DEFAULT_DIAGNOSTIC_LOG_LIMIT);
    }

    return Math.min(Math.floor(numeric), DEFAULT_DIAGNOSTIC_LOG_LIMIT);
}

function buildDiagnosticLogEntryId({ createdAt, level, scope, message } = {}) {
    return [
        Number(createdAt) || Date.now(),
        normalizeDiagnosticLogLevel(level),
        String(scope || 'GENERAL'),
        String(message || 'event')
    ]
        .join(':')
        .replace(/\s+/g, '_');
}

function createDiagnosticLogEntry({
    createdAt = Date.now(),
    level = DIAGNOSTIC_LOG_LEVELS.INFO,
    scope = 'GENERAL',
    message = '',
    details = null
} = {}) {
    const normalizedLevel = normalizeDiagnosticLogLevel(level);
    const safeScope = truncateDiagnosticLogString(String(scope || 'GENERAL'));
    const safeMessage = truncateDiagnosticLogString(String(message || ''));
    const safeDetails = details === null || details === undefined
        ? null
        : sanitizeDiagnosticLogDetails(details);

    return {
        id: buildDiagnosticLogEntryId({
            createdAt,
            level: normalizedLevel,
            scope: safeScope,
            message: safeMessage
        }),
        createdAt: Number(createdAt) || Date.now(),
        level: normalizedLevel,
        scope: safeScope,
        message: safeMessage,
        details: safeDetails
    };
}

function normalizeDiagnosticLogMaxBytes(value, fallback = DEFAULT_DIAGNOSTIC_LOG_MAX_BYTES) {
    const numeric = Number(value);
    const safeFallback = Math.max(1000, Number(fallback) || DEFAULT_DIAGNOSTIC_LOG_MAX_BYTES);

    if (!Number.isFinite(numeric) || numeric <= 0) {
        return safeFallback;
    }

    return Math.max(1000, Math.floor(numeric));
}

function getDiagnosticLogApproxBytes(log) {
    try {
        return JSON.stringify(Array.isArray(log) ? log : []).length;
    } catch (_err) {
        return DEFAULT_DIAGNOSTIC_LOG_MAX_BYTES + 1;
    }
}

function applyDiagnosticLogRetention(log, options = {}) {
    const safeLog = Array.isArray(log) ? log.filter(Boolean) : [];
    const safeLimit = normalizeDiagnosticLogLimit(
        options.maxEntries ?? options.limit,
        DEFAULT_DIAGNOSTIC_LOG_LIMIT
    );
    const safeMaxBytes = normalizeDiagnosticLogMaxBytes(
        options.maxBytes,
        DEFAULT_DIAGNOSTIC_LOG_MAX_BYTES
    );
    let entries = safeLog.map(entry => cloneDiagnosticLogValue(entry));
    let dropped = 0;

    if (entries.length > safeLimit) {
        dropped += entries.length - safeLimit;
        entries = entries.slice(entries.length - safeLimit);
    }

    while (entries.length > 0 && getDiagnosticLogApproxBytes(entries) > safeMaxBytes) {
        entries.shift();
        dropped += 1;
    }

    return {
        entries,
        dropped,
        maxEntries: safeLimit,
        maxBytes: safeMaxBytes,
        retainedBytes: getDiagnosticLogApproxBytes(entries)
    };
}

function normalizeDiagnosticLog(log, limit = DEFAULT_DIAGNOSTIC_LOG_LIMIT) {
    return applyDiagnosticLogRetention(log, { maxEntries: limit }).entries;
}

function appendDiagnosticLogEntryWithRetention(log, entry, options = {}) {
    const nextLog = Array.isArray(log) ? log.slice() : [];

    nextLog.push(cloneDiagnosticLogValue(entry));

    return applyDiagnosticLogRetention(nextLog, options);
}

function appendDiagnosticLogEntry(log, entry, limit = DEFAULT_DIAGNOSTIC_LOG_LIMIT) {
    return appendDiagnosticLogEntryWithRetention(log, entry, { maxEntries: limit }).entries;
}

function matchesDiagnosticLogFilter(entry, filters = {}) {
    if (filters.level !== undefined && normalizeDiagnosticLogLevel(entry.level) !== normalizeDiagnosticLogLevel(filters.level)) {
        return false;
    }

    if (filters.scope !== undefined && String(entry.scope || '') !== String(filters.scope)) {
        return false;
    }

    return true;
}

function normalizeDiagnosticLogDroppedEntries(value) {
    const numeric = Number(value);

    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function getDiagnosticLogSnapshot(log, options = {}) {
    const safeOptions = options || {};
    const retention = applyDiagnosticLogRetention(log, {
        maxEntries: safeOptions.maxEntries,
        maxBytes: safeOptions.maxBytes
    });
    const safeLog = retention.entries;
    const filtered = safeLog.filter(entry => matchesDiagnosticLogFilter(entry, safeOptions));
    const fullMode = safeOptions.mode === 'full' || safeOptions.full === true;
    const limit = fullMode
        ? filtered.length
        : normalizeDiagnosticLogLimit(safeOptions.limit, DEFAULT_DIAGNOSTIC_LOG_READ_LIMIT);
    const limitedEntries = fullMode
        ? filtered
        : filtered.slice(Math.max(0, filtered.length - limit));
    const orderedEntries = safeOptions.order === 'oldest-first'
        ? limitedEntries
        : limitedEntries.slice().reverse();
    const entries = orderedEntries.map(entry => cloneDiagnosticLogValue(entry));
    const externalDroppedEntries = normalizeDiagnosticLogDroppedEntries(safeOptions.droppedEntries);
    const droppedEntries = externalDroppedEntries + retention.dropped;

    return {
        storedTotal: safeLog.length,
        retainedTotal: safeLog.length,
        total: filtered.length,
        returned: entries.length,
        limit,
        previewLimit: DEFAULT_DIAGNOSTIC_LOG_READ_LIMIT,
        mode: fullMode ? 'full' : 'preview',
        order: safeOptions.order === 'oldest-first' ? 'oldest-first' : 'newest-first',
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


function getDiagnosticArrayCount(value) {
    return Array.isArray(value) ? value.length : 0;
}

function getMonitorScopeLogSummary(monitorScope = {}) {
    const safeScope = monitorScope || {};
    const summary = {
        statusCount: getDiagnosticArrayCount(safeScope.status),
        deliveryCount: getDiagnosticArrayCount(safeScope.delivery),
        paymentCount: getDiagnosticArrayCount(safeScope.payment),
        orderFlagsCount: getDiagnosticArrayCount(safeScope.orderFlags),
        storeCount: getDiagnosticArrayCount(safeScope.store),
        reserveCount: getDiagnosticArrayCount(safeScope.reserve),
        assemblyStatusCount: getDiagnosticArrayCount(safeScope.assemblyStatus)
    };

    const selectedTotal = Object.values(summary).reduce((total, count) => total + count, 0);

    return {
        scope: selectedTotal > 0 ? 'filtered' : 'all',
        ...summary
    };
}

function getNotificationTriggerLogSummary(notificationTriggers = {}) {
    const triggers = typeof normalizeNotificationTriggers === 'function'
        ? normalizeNotificationTriggers(notificationTriggers)
        : (notificationTriggers || {});
    const changedFields = triggers.changedFields || {};
    const enabledChangedFields = Object.entries(changedFields)
        .filter(([, enabled]) => enabled === true)
        .map(([field]) => field);

    return {
        newOrders: triggers.newOrders === true,
        changedOrders: triggers.changedOrders === true,
        enabledChangedFieldsCount: enabledChangedFields.length,
        enabledChangedFields
    };
}

function getConfigLogSummary(config = {}) {
    const safeConfig = config || {};
    const deepSyncMaxPages = typeof normalizeDeepSyncMaxPages === 'function'
        ? normalizeDeepSyncMaxPages(safeConfig.deepSyncMaxPages)
        : Number(safeConfig.deepSyncMaxPages) || 50;

    return {
        monitorMode: safeConfig.monitorMode === 'active' ? 'active' : 'windowed',
        deepSyncMaxPages,
        ozonAutoBarcodeApplyEnabled: safeConfig.ozonAutoBarcodeApplyEnabled !== false,
        monitorScope: getMonitorScopeLogSummary(safeConfig.monitorScope),
        notificationTriggers: getNotificationTriggerLogSummary(safeConfig.notificationTriggers)
    };
}

globalThis.DIAGNOSTIC_LOG_LEVELS = DIAGNOSTIC_LOG_LEVELS;
globalThis.DEFAULT_DIAGNOSTIC_LOG_LIMIT = DEFAULT_DIAGNOSTIC_LOG_LIMIT;
globalThis.DEFAULT_DIAGNOSTIC_LOG_READ_LIMIT = DEFAULT_DIAGNOSTIC_LOG_READ_LIMIT;
globalThis.DEFAULT_DIAGNOSTIC_LOG_MAX_BYTES = DEFAULT_DIAGNOSTIC_LOG_MAX_BYTES;
globalThis.DIAGNOSTIC_LOG_SENSITIVE_KEYS = DIAGNOSTIC_LOG_SENSITIVE_KEYS;
globalThis.normalizeDiagnosticLogLevel = normalizeDiagnosticLogLevel;
globalThis.shouldPersistDiagnosticLogLevel = shouldPersistDiagnosticLogLevel;
globalThis.sanitizeDiagnosticLogDetails = sanitizeDiagnosticLogDetails;
globalThis.cloneDiagnosticLogValue = cloneDiagnosticLogValue;
globalThis.normalizeDiagnosticLogLimit = normalizeDiagnosticLogLimit;
globalThis.buildDiagnosticLogEntryId = buildDiagnosticLogEntryId;
globalThis.createDiagnosticLogEntry = createDiagnosticLogEntry;
globalThis.normalizeDiagnosticLogMaxBytes = normalizeDiagnosticLogMaxBytes;
globalThis.getDiagnosticLogApproxBytes = getDiagnosticLogApproxBytes;
globalThis.applyDiagnosticLogRetention = applyDiagnosticLogRetention;
globalThis.normalizeDiagnosticLog = normalizeDiagnosticLog;
globalThis.appendDiagnosticLogEntryWithRetention = appendDiagnosticLogEntryWithRetention;
globalThis.appendDiagnosticLogEntry = appendDiagnosticLogEntry;
globalThis.matchesDiagnosticLogFilter = matchesDiagnosticLogFilter;
globalThis.normalizeDiagnosticLogDroppedEntries = normalizeDiagnosticLogDroppedEntries;
globalThis.getDiagnosticLogSnapshot = getDiagnosticLogSnapshot;
globalThis.getDiagnosticArrayCount = getDiagnosticArrayCount;
globalThis.getMonitorScopeLogSummary = getMonitorScopeLogSummary;
globalThis.getNotificationTriggerLogSummary = getNotificationTriggerLogSummary;
globalThis.getConfigLogSummary = getConfigLogSummary;
