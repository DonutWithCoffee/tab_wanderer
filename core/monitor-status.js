const DEFAULT_MONITOR_STATUS_STATE = {
    UNINITIALIZED: 'uninitialized'
};

function cloneMonitorStatusValue(value) {
    if (Array.isArray(value)) {
        return value.map(item => cloneMonitorStatusValue(item));
    }

    if (value && typeof value === 'object') {
        return JSON.parse(JSON.stringify(value));
    }

    return value;
}

function countObjectKeys(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return 0;
    }

    return Object.keys(value).length;
}

function normalizeMonitorStatusMode(userConfig = {}) {
    return userConfig?.monitorMode === 'active' ? 'active' : 'windowed';
}

function createCollectionSessionStatusSnapshot(session) {
    if (!session) {
        return null;
    }

    return {
        mode: session.mode || null,
        startedAt: Number(session.startedAt) || null,
        lastActivityAt: Number(session.lastActivityAt) || null,
        advanceAttempts: Number(session.advanceAttempts) || 0,
        ordersCount: countObjectKeys(session.orders),
        isComplete: session.isComplete === true,
        completionReason: session.completionReason || null,
        currentPage: Number(session.currentPage) || 1,
        lastCollectedPage: Number(session.lastCollectedPage) || 0,
        nextPage: Number(session.nextPage) || 1,
        seenKnownOrder: session.seenKnownOrder === true,
        processedPages: session.processedPages && typeof session.processedPages === 'object'
            ? Object.keys(session.processedPages).sort()
            : []
    };
}

function createMonitorStatusSnapshot(state = {}) {
    const userConfig = state.userConfig || {};
    const workerTabId = state.workerTabId ?? null;
    const eventJournal = Array.isArray(state.eventJournal) ? state.eventJournal : [];
    const diagnosticLog = Array.isArray(state.diagnosticLog) ? state.diagnosticLog : [];

    return {
        isRunning: state.isRunning === true,
        monitorState: String(state.monitorState || DEFAULT_MONITOR_STATUS_STATE.UNINITIALIZED),
        monitorMode: normalizeMonitorStatusMode(userConfig),
        workerTabId,
        hasWorkerTab: workerTabId !== null && workerTabId !== undefined,
        pendingRebaseline: state.pendingRebaseline === true,
        pendingSyncReason: state.pendingSyncReason || null,
        knownOrdersCount: countObjectKeys(state.knownOrdersDB),
        knownHashesCount: countObjectKeys(state.knownOrdersHashDB),
        windowOrdersCount: countObjectKeys(state.windowOrdersDB),
        windowHashesCount: countObjectKeys(state.windowOrdersHashDB),
        notificationTargetsCount: countObjectKeys(state.notificationTargets),
        eventJournalCount: eventJournal.length,
        diagnosticLogCount: diagnosticLog.length,
        lastBaselineDate: state.lastBaselineDate || null,
        lastDeepSyncAt: Number(state.lastDeepSyncAt) || 0,
        lastCollectionMetadata: state.lastCollectionMetadata
            ? cloneMonitorStatusValue(state.lastCollectionMetadata)
            : null,
        collectionSession: createCollectionSessionStatusSnapshot(state.collectionSession)
    };
}

globalThis.DEFAULT_MONITOR_STATUS_STATE = DEFAULT_MONITOR_STATUS_STATE;
globalThis.cloneMonitorStatusValue = cloneMonitorStatusValue;
globalThis.countObjectKeys = countObjectKeys;
globalThis.normalizeMonitorStatusMode = normalizeMonitorStatusMode;
globalThis.createCollectionSessionStatusSnapshot = createCollectionSessionStatusSnapshot;
globalThis.createMonitorStatusSnapshot = createMonitorStatusSnapshot;
