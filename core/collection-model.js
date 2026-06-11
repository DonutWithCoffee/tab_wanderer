const COLLECTION_SESSION_MODES = {
    FAST: 'fast',
    DEEP: 'deep'
};

const COLLECTION_COMPLETION_REASONS = {
    FAST_PAGE_1: 'fast-page-1',
    DEEP_SYNC_PAGE_LIMIT: 'deep-sync-page-limit',
    EXPLICIT_COMPLETE: 'explicit-complete',
    LEGACY_SINGLE_PAGE: 'legacy-single-page'
};

function normalizeCollectionSessionMode(mode) {
    return String(mode || COLLECTION_SESSION_MODES.FAST) === COLLECTION_SESSION_MODES.DEEP
        ? COLLECTION_SESSION_MODES.DEEP
        : COLLECTION_SESSION_MODES.FAST;
}

function normalizeCollectionPage(page) {
    const numeric = Number(page);

    return Number.isInteger(numeric) && numeric > 0 ? numeric : 1;
}

function createCollectionSession(mode = COLLECTION_SESSION_MODES.FAST, now = Date.now()) {
    const timestamp = Number(now) || Date.now();

    return {
        mode: normalizeCollectionSessionMode(mode),
        startedAt: timestamp,
        lastActivityAt: timestamp,
        advanceAttempts: 0,
        orders: {},
        isComplete: false,
        completionReason: null,
        currentPage: 1,
        lastCollectedPage: 0,
        nextPage: 2,
        seenKnownOrder: false,
        processedPages: {}
    };
}

function normalizeOrdersMessageMeta(msg = {}) {
    const page = normalizeCollectionPage(msg.page);
    const hasCompletionFlag = typeof msg.isComplete === 'boolean';
    const isComplete = hasCompletionFlag ? msg.isComplete : true;
    const completionReason = typeof msg.completionReason === 'string' && msg.completionReason.trim()
        ? msg.completionReason.trim()
        : (hasCompletionFlag && msg.isComplete
            ? COLLECTION_COMPLETION_REASONS.EXPLICIT_COMPLETE
            : COLLECTION_COMPLETION_REASONS.LEGACY_SINGLE_PAGE);

    return {
        page,
        isComplete,
        completionReason
    };
}

function collectPageIntoCollectionSession(session, orders = [], options = {}) {
    if (!session) {
        return false;
    }

    const page = normalizeCollectionPage(options.page);
    const knownOrdersDB = options.knownOrdersDB && typeof options.knownOrdersDB === 'object'
        ? options.knownOrdersDB
        : {};
    const now = Number(options.now) || Date.now();

    session.processedPages = session.processedPages || {};

    if (session.processedPages[page]) {
        return false;
    }

    session.processedPages[page] = true;
    session.lastActivityAt = now;
    session.currentPage = page;

    if (page > session.lastCollectedPage) {
        session.lastCollectedPage = page;
    }

    session.nextPage = page + 1;

    const safeOrders = Array.isArray(orders) ? orders : [];

    safeOrders.forEach(order => {
        if (!order?.id) return;

        session.orders[order.id] = order;

        if (knownOrdersDB[order.id]) {
            session.seenKnownOrder = true;
        }
    });

    return true;
}

function shouldCompleteCollectionSession(session, meta = {}, policy = {}) {
    if (!session) {
        return {
            complete: false,
            reason: null
        };
    }

    if (session.mode === COLLECTION_SESSION_MODES.FAST) {
        return {
            complete: true,
            reason: COLLECTION_COMPLETION_REASONS.FAST_PAGE_1
        };
    }

    const maxPages = Number(policy.maxPages) || 1;

    if (Number(session.lastCollectedPage) >= maxPages) {
        return {
            complete: true,
            reason: COLLECTION_COMPLETION_REASONS.DEEP_SYNC_PAGE_LIMIT
        };
    }

    if (meta.isComplete) {
        return {
            complete: true,
            reason: meta.completionReason || COLLECTION_COMPLETION_REASONS.EXPLICIT_COMPLETE
        };
    }

    return {
        complete: false,
        reason: null
    };
}

function finalizeCollectionSession(session) {
    return Object.values(session?.orders || {});
}

function completeCollectionSession(session, reason = COLLECTION_COMPLETION_REASONS.LEGACY_SINGLE_PAGE) {
    if (!session) {
        return [];
    }

    session.isComplete = true;
    session.completionReason = reason;

    return finalizeCollectionSession(session);
}

function isFastCollectionPageMismatch(sessionMode, page) {
    return normalizeCollectionSessionMode(sessionMode) === COLLECTION_SESSION_MODES.FAST
        && normalizeCollectionPage(page) !== 1;
}

function createCollectionSessionLogDetails(session, orders = []) {
    return {
        mode: session?.mode || null,
        pagesCollected: Number(session?.lastCollectedPage) || 0,
        ordersCount: Array.isArray(orders) ? orders.length : 0,
        completionReason: session?.completionReason || null,
        isComplete: session?.isComplete === true
    };
}

globalThis.COLLECTION_SESSION_MODES = COLLECTION_SESSION_MODES;
globalThis.COLLECTION_COMPLETION_REASONS = COLLECTION_COMPLETION_REASONS;
globalThis.normalizeCollectionSessionMode = normalizeCollectionSessionMode;
globalThis.normalizeCollectionPage = normalizeCollectionPage;
globalThis.createCollectionSession = createCollectionSession;
globalThis.normalizeOrdersMessageMeta = normalizeOrdersMessageMeta;
globalThis.collectPageIntoCollectionSession = collectPageIntoCollectionSession;
globalThis.shouldCompleteCollectionSession = shouldCompleteCollectionSession;
globalThis.finalizeCollectionSession = finalizeCollectionSession;
globalThis.completeCollectionSession = completeCollectionSession;
globalThis.isFastCollectionPageMismatch = isFastCollectionPageMismatch;
globalThis.createCollectionSessionLogDetails = createCollectionSessionLogDetails;
