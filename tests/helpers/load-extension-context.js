const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createChromeStub(notificationStore = []) {
    return {
        tabs: {
            query: async () => [],
            remove: async () => {},
            update: async () => {},
            create: async () => ({ id: 1 }),
            onRemoved: {
                addListener: () => {}
            }
        },
        windows: {
            getAll: async () => [{ id: 1 }]
        },
        storage: {
            local: {
                set: async () => {},
                get: async () => ({})
            }
        },
        notifications: {
            create: (options, callback) => {
                notificationStore.push(options);

                if (typeof callback === 'function') {
                    callback(`notification-${notificationStore.length}`);
                }
            },
            clear: () => {},
            onClicked: {
                addListener: () => {}
            },
            onClosed: {
                addListener: () => {}
            }
        },
        runtime: {
            lastError: null,
            onMessage: {
                addListener: () => {}
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
    const notifications = [];
    const context = {
        URL,
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        importScripts: () => {},
        setTimeout: () => 0,
        clearTimeout: () => {},
        setInterval: () => 0,
        clearInterval: () => {},
        chrome: createChromeStub(notifications),
        self: {},
        __testNotifications: notifications,
        ...overrides
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

function setBackgroundState(context, state = {}) {
    context.__testState = state;

    runExpression(context, `
        ordersDB = __testState.ordersDB || {};
        ordersHashDB = __testState.ordersHashDB || {};
        notificationTargets = __testState.notificationTargets || {};
        workerTabId = __testState.workerTabId ?? null;
        lastBaselineDate = __testState.lastBaselineDate ?? null;
        isRunning = __testState.isRunning ?? false;
        userConfig = __testState.userConfig ?? getEffectiveUserConfig({});
        pendingRebaseline = __testState.pendingRebaseline ?? false;
    `);

    delete context.__testState;
}

function getBackgroundState(context) {
    const snapshot = runExpression(context, `JSON.stringify({
        ordersDB,
        ordersHashDB,
        notificationTargets,
        workerTabId,
        lastBaselineDate,
        isRunning,
        userConfig,
        pendingRebaseline
    })`);

    return JSON.parse(snapshot);
}

module.exports = {
    loadRulesContext,
    loadBackgroundContext,
    runExpression,
    setBackgroundState,
    getBackgroundState
};