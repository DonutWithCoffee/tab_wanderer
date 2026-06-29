const RUNTIME_RESPONSE_STATUSES = Object.freeze({
    OK: true,
    FAIL: false
});

function createRuntimeOkResponse(payload = {}) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};

    return {
        ok: RUNTIME_RESPONSE_STATUSES.OK,
        ...safePayload
    };
}

function createRuntimeFailureResponse(payload = {}) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};

    return {
        ok: RUNTIME_RESPONSE_STATUSES.FAIL,
        ...safePayload
    };
}

function createRuntimeErrorResponse(error) {
    return createRuntimeFailureResponse({
        error: String(error?.message || error || 'Unknown error')
    });
}

function createRuntimeIgnoredResponse(payload = {}) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};

    return {
        ignored: true,
        ...safePayload
    };
}

function createWorkerCheckResponse({ isWorker = false, isRunning = false } = {}) {
    return {
        isWorker: isWorker === true,
        isRunning: isRunning === true
    };
}

function createRuntimeConfigResponse(userConfig, monitorDictionaries) {
    return createRuntimeOkResponse({
        userConfig,
        monitorDictionaries
    });
}

function createRuntimeEventJournalResponse(eventJournal, options = {}, droppedEntries = 0) {
    return createRuntimeOkResponse(
        getEventJournalSnapshot(eventJournal, {
            ...(options || {}),
            droppedEntries
        })
    );
}

function createRuntimeOrderLookupResponse(sources = {}, options = {}, droppedEntries = 0) {
    return createRuntimeOkResponse(
        getOrderLookupSnapshot(sources || {}, {
            ...(options || {}),
            droppedEntries
        })
    );
}

function createRuntimeMonitorStatusResponse(status) {
    return createRuntimeOkResponse({ status });
}

function createRuntimeDiagnosticLogResponse(diagnosticLog, options = {}, droppedEntries = 0) {
    return createRuntimeOkResponse(
        getDiagnosticLogSnapshot(diagnosticLog, {
            ...(options || {}),
            droppedEntries
        })
    );
}

function createRuntimeUpdateConfigResponse(userConfig) {
    return createRuntimeOkResponse({ userConfig });
}

function createRuntimeCollectionResponse(payload = {}) {
    return createRuntimeOkResponse(payload);
}

globalThis.createRuntimeOrderLookupResponse = createRuntimeOrderLookupResponse;
