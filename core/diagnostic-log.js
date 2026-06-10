const DIAGNOSTIC_LOG_LEVELS = {
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
};

const DEFAULT_DIAGNOSTIC_LOG_LIMIT = 500;
const DEFAULT_DIAGNOSTIC_LOG_READ_LIMIT = 100;
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

function normalizeDiagnosticLog(log, limit = DEFAULT_DIAGNOSTIC_LOG_LIMIT) {
    const safeLog = Array.isArray(log) ? log.filter(Boolean) : [];
    const safeLimit = normalizeDiagnosticLogLimit(limit, DEFAULT_DIAGNOSTIC_LOG_LIMIT);
    const trimmed = safeLog.length <= safeLimit
        ? safeLog
        : safeLog.slice(safeLog.length - safeLimit);

    return trimmed.map(entry => cloneDiagnosticLogValue(entry));
}

function appendDiagnosticLogEntry(log, entry, limit = DEFAULT_DIAGNOSTIC_LOG_LIMIT) {
    const safeLimit = normalizeDiagnosticLogLimit(limit, DEFAULT_DIAGNOSTIC_LOG_LIMIT);
    const nextLog = Array.isArray(log) ? log.slice() : [];

    nextLog.push(cloneDiagnosticLogValue(entry));

    if (nextLog.length <= safeLimit) {
        return nextLog;
    }

    return nextLog.slice(nextLog.length - safeLimit);
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

function getDiagnosticLogSnapshot(log, options = {}) {
    const safeOptions = options || {};
    const safeLog = normalizeDiagnosticLog(log, DEFAULT_DIAGNOSTIC_LOG_LIMIT);
    const filtered = safeLog.filter(entry => matchesDiagnosticLogFilter(entry, safeOptions));
    const limit = normalizeDiagnosticLogLimit(safeOptions.limit, DEFAULT_DIAGNOSTIC_LOG_READ_LIMIT);
    const entries = filtered
        .slice(Math.max(0, filtered.length - limit))
        .reverse()
        .map(entry => cloneDiagnosticLogValue(entry));

    return {
        storedTotal: safeLog.length,
        total: filtered.length,
        returned: entries.length,
        limit,
        entries
    };
}

globalThis.DIAGNOSTIC_LOG_LEVELS = DIAGNOSTIC_LOG_LEVELS;
globalThis.DEFAULT_DIAGNOSTIC_LOG_LIMIT = DEFAULT_DIAGNOSTIC_LOG_LIMIT;
globalThis.DEFAULT_DIAGNOSTIC_LOG_READ_LIMIT = DEFAULT_DIAGNOSTIC_LOG_READ_LIMIT;
globalThis.DIAGNOSTIC_LOG_SENSITIVE_KEYS = DIAGNOSTIC_LOG_SENSITIVE_KEYS;
globalThis.normalizeDiagnosticLogLevel = normalizeDiagnosticLogLevel;
globalThis.shouldPersistDiagnosticLogLevel = shouldPersistDiagnosticLogLevel;
globalThis.sanitizeDiagnosticLogDetails = sanitizeDiagnosticLogDetails;
globalThis.cloneDiagnosticLogValue = cloneDiagnosticLogValue;
globalThis.normalizeDiagnosticLogLimit = normalizeDiagnosticLogLimit;
globalThis.buildDiagnosticLogEntryId = buildDiagnosticLogEntryId;
globalThis.createDiagnosticLogEntry = createDiagnosticLogEntry;
globalThis.normalizeDiagnosticLog = normalizeDiagnosticLog;
globalThis.appendDiagnosticLogEntry = appendDiagnosticLogEntry;
globalThis.matchesDiagnosticLogFilter = matchesDiagnosticLogFilter;
globalThis.getDiagnosticLogSnapshot = getDiagnosticLogSnapshot;
