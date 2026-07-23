const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createChromeStub(testState) {
    return {
        tabs: {
            query: async () => testState.tabsQueryResult || [],
            remove: async (tabId) => {
                testState.removedTabs.push(tabId);
            },
            update: async (tabId, updateInfo) => {
                testState.tabUpdates.push({ tabId, updateInfo });
                return { id: tabId, ...updateInfo };
            },
            create: async (createInfo) => {
                testState.createdTabs.push(createInfo);
                return { id: testState.nextTabId++, ...createInfo };
            },
            sendMessage: async (tabId, message) => {
                testState.tabMessages.push({ tabId, message });
                return { ok: true };
            },
            onRemoved: {
                addListener: (listener) => {
                    testState.tabsOnRemovedListener = listener;
                }
            }
        },
        windows: {
            getAll: async () => testState.windowsResult || [{ id: 1 }]
        },
        storage: {
            local: {
                set: async (payload) => {
                    testState.storageSetConcurrent += 1;
                    testState.storageSetMaxConcurrent = Math.max(testState.storageSetMaxConcurrent, testState.storageSetConcurrent);
                    testState.storageSetCalls.push(payload);

                    try {
                        if (typeof testState.storageSetHook === 'function') {
                            await testState.storageSetHook(payload, testState.storageSetCalls.length);
                        }
                    } finally {
                        testState.storageSetConcurrent -= 1;
                    }
                },
                get: async (keys) => {
                    if (typeof testState.storageGetHook === 'function') {
                        return await testState.storageGetHook(keys);
                    }

                    return { ...(testState.storageGetResult || {}) };
                },
                getBytesInUse: async (keys) => {
                    testState.storageGetBytesInUseCalls.push(keys);
                    return Number(testState.storageBytesInUse) || 0;
                },
                setAccessLevel: async (options) => {
                    testState.storageAccessLevelCalls.push(options);
                    if (typeof testState.storageAccessLevelHook === 'function') {
                        return await testState.storageAccessLevelHook(options);
                    }
                    return undefined;
                }
            }
        },
        notifications: {
            create: (options, callback) => {
                testState.notifications.push(options);

                if (typeof callback === 'function') {
                    callback(`notification-${testState.notifications.length}`);
                }
            },
            clear: () => {},
            onClicked: {
                addListener: (listener) => {
                    testState.notificationClickListener = listener;
                }
            },
            onClosed: {
                addListener: (listener) => {
                    testState.notificationCloseListener = listener;
                }
            }
        },
        alarms: {
            create: async (name, alarmInfo) => {
                testState.alarmCreateCalls.push({ name, alarmInfo });
                testState.alarms[name] = { name, ...alarmInfo };
            },
            clear: async (name) => {
                testState.alarmClearCalls.push(name);
                const existed = Object.prototype.hasOwnProperty.call(testState.alarms, name);
                delete testState.alarms[name];
                return existed;
            },
            getAll: async () => Object.values(testState.alarms),
            onAlarm: {
                addListener: (listener) => {
                    testState.alarmListener = listener;
                }
            }
        },
        runtime: {
            lastError: null,
            reload: () => {
                testState.runtimeReloadCalls += 1;
            },
            onUpdateAvailable: {
                addListener: (listener) => {
                    testState.runtimeOnUpdateAvailableListener = listener;
                }
            },
            onMessage: {
                addListener: (listener) => {
                    testState.runtimeMessageListener = listener;
                }
            }
        }
    };
}

function runScript(filename, context) {
    const filepath = path.join(__dirname, '..', '..', filename);
    const source = fs.readFileSync(filepath, 'utf8');
    vm.runInContext(source, context, { filename });
}

function runExpression(context, expression) {
    return vm.runInContext(expression, context);
}

function createBaseContext(overrides = {}) {
    const configureTestState = typeof overrides.configureTestState === 'function'
        ? overrides.configureTestState
        : null;
    const safeOverrides = { ...overrides };
    delete safeOverrides.configureTestState;

    const testState = {
        notifications: [],
        createdTabs: [],
        tabUpdates: [],
        removedTabs: [],
        storageSetCalls: [],
        tabMessages: [],
        tabsQueryResult: [],
        windowsResult: [{ id: 1 }],
        nextTabId: 1,
        runtimeMessageListener: null,
        tabsOnRemovedListener: null,
        notificationClickListener: null,
        notificationCloseListener: null,
        alarmListener: null,
        alarmCreateCalls: [],
        alarmClearCalls: [],
        alarms: {},
        storageGetResult: {},
        runtimeOnUpdateAvailableListener: null,
        runtimeReloadCalls: 0,
        storageSetHook: null,
        storageGetHook: null,
        storageAccessLevelHook: null,
        storageSetConcurrent: 0,
        storageSetMaxConcurrent: 0,
        storageGetBytesInUseCalls: [],
        storageAccessLevelCalls: [],
        storageBytesInUse: 0
    };

    if (configureTestState) {
        configureTestState(testState);
    }

    const activeTimeouts = [];
    const activeIntervals = [];

    const context = {
        URL,
        URLSearchParams,
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        importScripts: () => {},
        setTimeout: (fn, _ms) => {
            const id = activeTimeouts.length + 1;
            activeTimeouts.push(id);

            queueMicrotask(() => {
                const index = activeTimeouts.indexOf(id);

                if (index !== -1) {
                    activeTimeouts.splice(index, 1);

                    if (typeof fn === 'function') {
                        fn();
                    }
                }
            });

            return id;
        },
        clearTimeout: (id) => {
            const index = activeTimeouts.indexOf(id);

            if (index !== -1) {
                activeTimeouts.splice(index, 1);
            }
        },
        setInterval: (_fn, _ms) => {
            const id = activeIntervals.length + 1;
            activeIntervals.push(id);
            return id;
        },
        clearInterval: (id) => {
            const index = activeIntervals.indexOf(id);

            if (index !== -1) {
                activeIntervals.splice(index, 1);
            }
        },
        chrome: createChromeStub(testState),
        self: {},
        __test: testState,
        ...safeOverrides
    };

    context.__cleanup = () => {
        activeTimeouts.length = 0;
        activeIntervals.length = 0;
    };

    context.globalThis = context;

    vm.createContext(context);

    return context;
}

function loadRulesContext(overrides = {}) {
    const context = createBaseContext(overrides);
    runScript('core/watched-orders.js', context);
    runScript('core/direct-follow-up.js', context);
    runScript('notification-rules.js', context);
    return context;
}

function loadBackgroundContext(overrides = {}) {
    const context = createBaseContext(overrides);
    runScript('version.js', context);
    runScript('core/order-kind.js', context);
    runScript('core/watched-orders.js', context);
    runScript('core/direct-follow-up.js', context);
    runScript('notification-rules.js', context);
    runScript('core/order-model.js', context);
    runScript('core/collection-model.js', context);
    runScript('core/sync-model.js', context);
    runScript('core/event-journal.js', context);
    runScript('core/monitor-status.js', context);
    runScript('core/diagnostic-log.js', context);
    runScript('core/notification-message.js', context);
    runScript('core/order-lookup.js', context);
    runScript('core/runtime-api.js', context);
    runScript('core/ozon-product-search.js', context);
    runScript('core/ozon-barcode-binding.js', context);
    runScript('core/ozon-ui-apply-result.js', context);
    runScript('core/ozon-session-utils.js', context);
    runScript('core/ozon-session-messaging.js', context);
    runScript('background.js', context);
    return context;
}

async function settleBackgroundContext() {
    for (let index = 0; index < 64; index += 1) {
        await Promise.resolve();
    }
}

function setBackgroundState(context, state = {}) {
    context.__testState = state;

    runExpression(context, `
        knownOrdersDB = __testState.knownOrdersDB || {};
        knownOrdersHashDB = __testState.knownOrdersHashDB || {};
        windowOrdersDB = __testState.windowOrdersDB || {};
        windowOrdersHashDB = __testState.windowOrdersHashDB || {};
        notificationTargets = __testState.notificationTargets || {};
        orderKindsDB = __testState.orderKindsDB || {};
        workerTabId = __testState.workerTabId ?? null;
        directWorkerTabId = __testState.directWorkerTabId ?? null;
        ozonWorkerTabId = __testState.ozonWorkerTabId ?? null;
        ozonResolveSession = __testState.ozonResolveSession ?? null;
        ozonUiApplySession = __testState.ozonUiApplySession ?? null;
        directFollowUpState = __testState.directFollowUpState ?? normalizeDirectFollowUpState();
        directFollowUpOrdersDB = __testState.directFollowUpOrdersDB || {};
        directFollowUpHashDB = __testState.directFollowUpHashDB || {};
        lastBaselineDate = __testState.lastBaselineDate ?? null;
        isRunning = __testState.isRunning ?? false;
        monitorState = __testState.monitorState ?? 'uninitialized';
        lastDeepSyncAt = __testState.lastDeepSyncAt ?? 0;
        userConfig = __testState.userConfig ?? getEffectiveUserConfig({});
        pendingRebaseline = __testState.pendingRebaseline ?? false;
        pendingSyncReason = __testState.pendingSyncReason ?? null;
        collectionSession = __testState.collectionSession ?? null;
        monitorDictionaries = __testState.monitorDictionaries ?? null;
        lastCollectionMetadata = __testState.lastCollectionMetadata ?? null;
        eventJournal = Array.isArray(__testState.eventJournal) ? __testState.eventJournal : [];
        diagnosticLog = Array.isArray(__testState.diagnosticLog) ? __testState.diagnosticLog : [];
        diagnosticLogDroppedEntries = __testState.diagnosticLogDroppedEntries ?? 0;
        isDiagnosticLogReady = __testState.isDiagnosticLogReady ?? true;
        pendingWatchedOrderAdd = __testState.pendingWatchedOrderAdd ?? null;
        pendingExtensionUpdate = __testState.pendingExtensionUpdate ?? null;
        storageDiagnostics = __testState.storageDiagnostics ?? storageDiagnostics;
    `);

    delete context.__testState;
}

function getBackgroundState(context) {
    const snapshot = runExpression(context, `JSON.stringify({
        knownOrdersDB,
        knownOrdersHashDB,
        windowOrdersDB,
        windowOrdersHashDB,
        notificationTargets,
        orderKindsDB,
        workerTabId,
        directWorkerTabId,
        ozonWorkerTabId,
        ozonResolveSession,
        ozonUiApplySession,
        directFollowUpState,
        directFollowUpOrdersDB,
        directFollowUpHashDB,
        lastBaselineDate,
        isRunning,
        monitorState,
        lastDeepSyncAt,
        userConfig,
        pendingRebaseline,
        pendingSyncReason,
        collectionSession,
        monitorDictionaries,
        lastCollectionMetadata,
        eventJournal,
        diagnosticLog,
        diagnosticLogDroppedEntries,
        pendingWatchedOrderAdd,
        pendingExtensionUpdate,
        storageDiagnostics
    })`);

    return JSON.parse(snapshot);
}

async function sendRuntimeMessage(context, message, sender = {}) {
    const listener = context.__test.runtimeMessageListener;

    if (typeof listener !== 'function') {
        throw new Error('runtime message listener is not registered');
    }

    return await new Promise((resolve, reject) => {
        let settled = false;

        const sendResponse = (response) => {
            settled = true;
            resolve(response);
        };

        try {
            const maybeAsync = listener(message, sender, sendResponse);

            if (maybeAsync !== true && !settled) {
                resolve(undefined);
            }
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = {
    loadRulesContext,
    loadBackgroundContext,
    settleBackgroundContext,
    runExpression,
    setBackgroundState,
    getBackgroundState,
    sendRuntimeMessage
};