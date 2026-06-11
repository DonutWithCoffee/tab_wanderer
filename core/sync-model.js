const SYNC_REASONS = {
    INITIAL: 'initial',
    MANUAL_START: 'manual-start',
    RECOVERY: 'recovery',
    STALE_RESUME: 'stale-resume',
    SCOPE_CHANGE: 'scope-change',
    MODE_CHANGE: 'mode-change',
    WINDOW_SYNC: 'window-sync',
    DIRECT_FOLLOW_UP: 'direct-follow-up',
    NORMAL: 'normal'
};

const PENDING_SYNC_ACTIONS = {
    BASELINE: 'baseline',
    CATCH_UP: 'catch-up'
};

const DEFAULT_STALE_RESUME_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function normalizeSyncReason(reason) {
    const value = String(reason || '').trim();

    return Object.values(SYNC_REASONS).includes(value)
        ? value
        : SYNC_REASONS.NORMAL;
}

function getStartSyncReason(hasKnownOrders) {
    return hasKnownOrders
        ? SYNC_REASONS.MANUAL_START
        : SYNC_REASONS.INITIAL;
}

function getStartRebaselineSyncReason({
    hasKnownOrders,
    pendingRebaseline,
    pendingSyncReason
} = {}) {
    if (pendingRebaseline === true) {
        const currentReason = normalizeSyncReason(pendingSyncReason);

        if (currentReason !== SYNC_REASONS.NORMAL) {
            return currentReason;
        }
    }

    return getStartSyncReason(hasKnownOrders);
}

function getRecoverySyncReason({
    hasKnownOrders,
    lastCollectionAt,
    now = Date.now(),
    staleThresholdMs = DEFAULT_STALE_RESUME_THRESHOLD_MS
} = {}) {
    if (!hasKnownOrders) {
        return SYNC_REASONS.INITIAL;
    }

    const lastSeenAt = Number(lastCollectionAt) || 0;
    const threshold = Number(staleThresholdMs) || DEFAULT_STALE_RESUME_THRESHOLD_MS;

    if (lastSeenAt > 0 && Number(now) - lastSeenAt >= threshold) {
        return SYNC_REASONS.STALE_RESUME;
    }

    return SYNC_REASONS.RECOVERY;
}

function getConfigChangeSyncReason({ scopeChanged, modeChanged } = {}) {
    if (scopeChanged) {
        return SYNC_REASONS.SCOPE_CHANGE;
    }

    if (modeChanged) {
        return SYNC_REASONS.MODE_CHANGE;
    }

    return null;
}

function getPendingSyncAction({ pendingRebaseline, syncReason, hasKnownOrders } = {}) {
    if (pendingRebaseline !== true) {
        return null;
    }

    const reason = normalizeSyncReason(syncReason);

    if (hasKnownOrders === true && reason === SYNC_REASONS.MANUAL_START) {
        return PENDING_SYNC_ACTIONS.CATCH_UP;
    }

    return PENDING_SYNC_ACTIONS.BASELINE;
}

function normalizeScopeList(values) {
    return Array.isArray(values)
        ? values.map(value => String(value)).filter(Boolean).sort()
        : [];
}

function normalizeMonitorScopeForSignature(scope = {}) {
    const safeScope = scope || {};
    const predicates = safeScope.predicates || {};

    return {
        status: normalizeScopeList(safeScope.status),
        delivery: normalizeScopeList(safeScope.delivery),
        payment: normalizeScopeList(safeScope.payment),
        orderFlags: normalizeScopeList(safeScope.orderFlags),
        store: normalizeScopeList(safeScope.store),
        reserve: normalizeScopeList(safeScope.reserve),
        assemblyStatus: normalizeScopeList(safeScope.assemblyStatus),
        predicates: {
            juridicalOnly: Boolean(predicates.juridicalOnly),
            ozonOnly: Boolean(predicates.ozonOnly)
        }
    };
}

function getMonitorScopeSignature(scope = {}) {
    return JSON.stringify(normalizeMonitorScopeForSignature(scope));
}

function normalizeMonitorModeForMetadata(mode) {
    return String(mode || 'windowed') === 'active'
        ? 'active'
        : 'windowed';
}

function buildCollectionCoverageMetadata({
    session,
    reason,
    monitorMode,
    monitorScope,
    maxPages,
    ordersCount,
    collectedAt = Date.now()
} = {}) {
    const safeSession = session || {};

    return {
        collectedAt,
        syncReason: normalizeSyncReason(reason),
        monitorMode: normalizeMonitorModeForMetadata(monitorMode),
        monitorScopeSignature: getMonitorScopeSignature(monitorScope),
        sessionMode: String(safeSession.mode || 'fast'),
        pagesCollected: Number(safeSession.lastCollectedPage) || 0,
        maxPages: Number(maxPages) || 0,
        ordersCollected: Number(ordersCount) || 0,
        completionReason: safeSession.completionReason || null,
        isComplete: safeSession.isComplete === true
    };
}

globalThis.SYNC_REASONS = SYNC_REASONS;
globalThis.PENDING_SYNC_ACTIONS = PENDING_SYNC_ACTIONS;
globalThis.DEFAULT_STALE_RESUME_THRESHOLD_MS = DEFAULT_STALE_RESUME_THRESHOLD_MS;
globalThis.normalizeSyncReason = normalizeSyncReason;
globalThis.getStartSyncReason = getStartSyncReason;
globalThis.getStartRebaselineSyncReason = getStartRebaselineSyncReason;
globalThis.getRecoverySyncReason = getRecoverySyncReason;
globalThis.getConfigChangeSyncReason = getConfigChangeSyncReason;
globalThis.getPendingSyncAction = getPendingSyncAction;
globalThis.normalizeMonitorScopeForSignature = normalizeMonitorScopeForSignature;
globalThis.getMonitorScopeSignature = getMonitorScopeSignature;
globalThis.buildCollectionCoverageMetadata = buildCollectionCoverageMetadata;
