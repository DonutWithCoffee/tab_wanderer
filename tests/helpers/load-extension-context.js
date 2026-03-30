const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createChromeStub() {
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
            create: (_options, callback) => {
                if (typeof callback === 'function') {
                    callback('notification-id');
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

function createBaseContext(overrides = {}) {
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
        chrome: createChromeStub(),
        self: {},
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

module.exports = {
    loadRulesContext,
    loadBackgroundContext
};