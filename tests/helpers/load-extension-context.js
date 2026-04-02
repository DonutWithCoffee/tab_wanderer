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
                    testState.storageSetCalls.push(payload);
                },
                get: async () => ({})
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
        runtime: {
            lastError: null,
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
    const testState = {
        notifications: [],
        createdTabs: [],
        tabUpdates: [],
        removedTabs: [],
        storageSetCalls: [],
        tabsQueryResult: [],
        windowsResult: [{ id: 1 }],
        nextTabId: 1,
        runtimeMessageListener: null,
        tabsOnRemovedListener: null,
        notificationClickListener: null,
        notificationCloseListener: null
    };

    const activeTimeouts = [];
    const activeIntervals = [];

    const context = {
        URL,
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
        ...overrides
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
    runScript('notification-rules.js', context);
    return context;
}

function loadBackgroundContext(overrides = {}) {
    const context = createBaseContext(overrides);
    runScript('version.js', context);
    runScript('notification-rules.js', context);
    runScript('background.js', context);
    return context;
}

async function settleBackgroundContext() {
    await Promise.resolve();
    await Promise.resolve();
}

function setBackgroundState(context, state = {}) {
    context.__testState = state;

    runExpression(context, `
        knownOrdersDB = __testState.knownOrdersDB || {};
        knownOrdersHashDB = __testState.knownOrdersHashDB || {};
        windowOrdersDB = __testState.windowOrdersDB || {};
        windowOrdersHashDB = __testState.windowOrdersHashDB || {};
        notificationTargets = __testState.notificationTargets || {};
        workerTabId = __testState.workerTabId ?? null;
        lastBaselineDate = __testState.lastBaselineDate ?? null;
        isRunning = __testState.isRunning ?? false;
        monitorState = __testState.monitorState ?? 'uninitialized';
        lastDeepSyncAt = __testState.lastDeepSyncAt ?? 0;
        userConfig = __testState.userConfig ?? getEffectiveUserConfig({});
        pendingRebaseline = __testState.pendingRebaseline ?? false;
        collectionSession = __testState.collectionSession ?? null;
        monitorDictionaries = __testState.monitorDictionaries ?? null;
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
        workerTabId,
        lastBaselineDate,
        isRunning,
        monitorState,
        lastDeepSyncAt,
        userConfig,
        pendingRebaseline,
        collectionSession,
        monitorDictionaries
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