const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeEventTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, handler) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }

        this.listeners.get(type).push(handler);
    }

    dispatchEvent(event) {
        const handlers = this.listeners.get(event.type) || [];

        for (const handler of handlers) {
            handler.call(this, event);
        }
    }
}

class FakeElement extends FakeEventTarget {
    constructor(tagName, id = '') {
        super();
        this.tagName = String(tagName || '').toUpperCase();
        this.id = id;
        this.innerText = '';
        this.textContent = '';
        this.value = '';
        this.checked = false;
        this.href = '';
        this.download = '';
        this.clicked = false;
        this.style = {};
        this.className = '';
        this.classList = {
            add: (...tokens) => {
                const current = new Set(this.className.split(/\s+/).filter(Boolean));
                tokens.forEach((token) => current.add(token));
                this.className = Array.from(current).join(' ');
            },
            remove: (...tokens) => {
                const removeSet = new Set(tokens);
                this.className = this.className
                    .split(/\s+/)
                    .filter((token) => token && !removeSet.has(token))
                    .join(' ');
            },
            contains: (token) => this.className.split(/\s+/).includes(token)
        };
    }

    click() {
        this.clicked = true;
        this.dispatchEvent({ type: 'click', target: this });
    }
}

class FakeDocument extends FakeEventTarget {
    constructor() {
        super();
        this.elements = new Map();
        this.createdElements = [];
        this.body = {
            appendChild: () => {},
            removeChild: () => {}
        };
    }

    registerElement(id) {
        const element = new FakeElement('div', id);
        this.elements.set(id, element);
        return element;
    }

    getElementById(id) {
        return this.elements.get(id) || null;
    }

    createElement(tagName) {
        const element = new FakeElement(tagName);
        this.createdElements.push(element);
        return element;
    }
}

function readPopupHtml() {
    return fs.readFileSync(
        path.join(__dirname, '..', 'popup.html'),
        'utf8'
    );
}

function createPopupDom() {
    const document = new FakeDocument();

    for (const id of [
        'version',
        'status',
        'statusDetails',
        'toggleMonitor',
        'openOptions',
        'openWatchedOrders',
        'downloadDiagnosticLog',
        'popupIgnoreLegalEntityPayment',
        'popupIgnoreOzon',
        'quickSuppressStatus',
        'popupWatchedOrderInput',
        'popupAddWatchedOrder',
        'popupWatchedOrderStatus',
        'popupWatchedOrderNote',
        'diagnosticLogStatus'
    ]) {
        document.registerElement(id);
    }

    return document;
}

function loadPopupContext(overrides = {}) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'popup.js'),
        'utf8'
    );

    const sentMessages = [];
    const document = createPopupDom();
    const monitorStatus = overrides.monitorStatus || {
        isRunning: true,
        monitorState: 'active',
        monitorMode: 'windowed',
        hasWorkerTab: true,
        workerTabId: 77,
        knownOrdersCount: 12,
        knownHashesCount: 12,
        windowOrdersCount: 10,
        windowHashesCount: 10,
        diagnosticLogCount: 2,
        eventJournalCount: 1
    };
    const popupConfig = overrides.userConfig || {
        monitorMode: 'windowed',
        notificationSuppressors: {
            ignoreLegalEntityPayment: false,
            ignoreOzon: false
        },
        watchedOrders: {
            items: []
        }
    };
    const diagnosticLog = overrides.diagnosticLog || {
        ok: true,
        storedTotal: 2,
        total: 2,
        returned: 2,
        entries: [
            { createdAt: 1700000000000, level: 'INFO', scope: 'CONTROL', message: 'START' },
            { createdAt: 1700000001000, level: 'WARN', scope: 'WATCHDOG', message: 'worker dead restarting' }
        ]
    };

    const context = {
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        document,
        window: {},
        chrome: {
            tabs: {
                createdTabs: [],
                create: (createInfo) => {
                    context.chrome.tabs.createdTabs.push(createInfo);
                }
            },
            runtime: {
                getManifest: () => ({ version: '0.9.8-test' }),
                getURL: (page) => `chrome-extension://tab-wanderer/${page}`,
                openOptionsPageCalled: false,
                openOptionsPage: () => {
                    context.chrome.runtime.openOptionsPageCalled = true;
                },
                sendMessage: (msg, callback) => {
                    sentMessages.push(msg);

                    let response = { ok: true };

                    if (msg.type === 'GET_MONITOR_STATUS') {
                        response = { ok: true, status: JSON.parse(JSON.stringify(monitorStatus)) };
                    }

                    if (msg.type === 'GET_CONFIG') {
                        response = { ok: true, userConfig: JSON.parse(JSON.stringify(popupConfig)) };
                    }

                    if (msg.type === 'UPDATE_CONFIG') {
                        Object.assign(popupConfig, JSON.parse(JSON.stringify(msg.userConfig || {})));
                        response = { ok: true, userConfig: JSON.parse(JSON.stringify(popupConfig)) };
                    }

                    if (msg.type === 'ADD_WATCHED_ORDER') {
                        popupConfig.watchedOrders = popupConfig.watchedOrders || { items: [] };
                        popupConfig.watchedOrders.items.push({
                            id: String(msg.orderId || '').trim(),
                            status: 'active',
                            note: String(msg.note || '').trim(),
                            addedAt: 1700000000000,
                            lastCheckedAt: 1700000001000,
                            lastBaselineAt: 1700000001000,
                            lastEventAt: null,
                            lastError: null
                        });
                        response = { ok: true, added: true, validated: true, userConfig: JSON.parse(JSON.stringify(popupConfig)) };
                    }

                    if (msg.type === 'GET_DIAGNOSTIC_LOG') {
                        response = JSON.parse(JSON.stringify(diagnosticLog));

                        if (msg.options?.mode === 'full') {
                            response.mode = 'full';
                            response.retainedTotal = response.storedTotal || response.total || response.returned || 0;
                            response.retention = response.retention || {
                                maxEntries: 5000,
                                maxBytes: 2000000,
                                droppedEntries: 0
                            };
                        }
                    }

                    if (msg.type === 'START' || msg.type === 'STOP') {
                        response = { ok: true };
                    }

                    if (typeof callback === 'function') {
                        callback(response);
                    }
                }
            }
        },
        __test: {
            sentMessages,
            document
        }
    };

    context.globalThis = context;
    context.window = context;

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'popup.js' });

    document.dispatchEvent({ type: 'DOMContentLoaded' });

    return context;
}

function getSentMessagesByType(context, type) {
    return context.__test.sentMessages.filter((msg) => msg.type === type);
}

test('popup is quick-control only and contains no settings form controls', () => {
    const html = readPopupHtml();

    assert.match(html, /id="toggleMonitor"/);
    assert.match(html, /id="openOptions"/);
    assert.match(html, /id="openWatchedOrders"/);
    assert.match(html, /Отслеживаемые заказы/);
    assert.match(html, /id="downloadDiagnosticLog"/);
    assert.match(html, /id="statusDetails"/);
    assert.match(html, /id="popupIgnoreLegalEntityPayment"/);
    assert.match(html, /id="popupIgnoreOzon"/);
    assert.match(html, /id="popupWatchedOrderInput"/);
    assert.match(html, /id="popupAddWatchedOrder"/);
    assert.doesNotMatch(html, /id="applyConfig"/);
    assert.doesNotMatch(html, /id="resetConfig"/);
    assert.doesNotMatch(html, /id="monitorModeWindowed"/);
    assert.doesNotMatch(html, /id="triggerNewOrders"/);
    assert.doesNotMatch(html, /id="scopeStatusOptions"/);
});

test('popup loads monitor status and toggles running state through one button', () => {
    const context = loadPopupContext();
    const document = context.__test.document;

    assert.equal(getSentMessagesByType(context, 'GET_MONITOR_STATUS').length, 1);
    assert.equal(getSentMessagesByType(context, 'GET_CONFIG').length, 1);
    assert.equal(document.getElementById('version').innerText, 'v0.9.8-test');
    assert.equal(document.getElementById('status').innerText, 'Статус: работает');
    assert.match(document.getElementById('statusDetails').innerText, /режим: по фильтрам админки/);
    assert.match(document.getElementById('statusDetails').innerText, /окно: 10/);
    assert.equal(document.getElementById('toggleMonitor').innerText, 'Остановить мониторинг');

    document.getElementById('toggleMonitor').dispatchEvent({
        type: 'click',
        target: document.getElementById('toggleMonitor')
    });

    assert.equal(getSentMessagesByType(context, 'STOP').length, 1);
    assert.equal(getSentMessagesByType(context, 'START').length, 0);
    assert.equal(getSentMessagesByType(context, 'GET_MONITOR_STATUS').length, 2);
});

test('popup starts monitoring when status is stopped', () => {
    const context = loadPopupContext({
        monitorStatus: {
            isRunning: false,
            monitorState: 'uninitialized',
            monitorMode: 'windowed'
        }
    });
    const document = context.__test.document;

    assert.equal(document.getElementById('status').innerText, 'Статус: выключен');
    assert.equal(document.getElementById('statusDetails').innerText, 'Мониторинг остановлен. Уведомления не отправляются.');
    assert.equal(document.getElementById('toggleMonitor').innerText, 'Включить мониторинг');

    document.getElementById('toggleMonitor').dispatchEvent({
        type: 'click',
        target: document.getElementById('toggleMonitor')
    });

    assert.equal(getSentMessagesByType(context, 'START').length, 1);
});

test('popup opens options and watched orders page', () => {
    const context = loadPopupContext();
    const document = context.__test.document;

    document.getElementById('openOptions').dispatchEvent({
        type: 'click',
        target: document.getElementById('openOptions')
    });

    document.getElementById('openWatchedOrders').dispatchEvent({
        type: 'click',
        target: document.getElementById('openWatchedOrders')
    });

    assert.equal(context.chrome.runtime.openOptionsPageCalled, true);
    assert.deepEqual(JSON.parse(JSON.stringify(context.chrome.tabs.createdTabs)), [
        {
            url: 'chrome-extension://tab-wanderer/watched-orders.html',
            active: true
        }
    ]);
});



test('popup quick suppressor toggles update config only for notifications', () => {
    const context = loadPopupContext();
    const document = context.__test.document;
    const legalToggle = document.getElementById('popupIgnoreLegalEntityPayment');

    assert.equal(legalToggle.checked, false);
    assert.equal(document.getElementById('popupIgnoreOzon').checked, false);

    legalToggle.dispatchEvent({ type: 'change', target: legalToggle });

    const updateMessages = getSentMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(updateMessages[0].userConfig.notificationSuppressors)), {
        ignoreLegalEntityPayment: true,
        ignoreOzon: false
    });
    assert.equal(document.getElementById('quickSuppressStatus').innerText, 'Фильтры уведомлений сохранены.');
});

test('popup adds watched order by full order id only', () => {
    const context = loadPopupContext();
    const document = context.__test.document;
    const input = document.getElementById('popupWatchedOrderInput');
    const noteInput = document.getElementById('popupWatchedOrderNote');
    const addButton = document.getElementById('popupAddWatchedOrder');

    input.value = '1234';
    addButton.dispatchEvent({ type: 'click', target: addButton });

    assert.equal(getSentMessagesByType(context, 'ADD_WATCHED_ORDER').length, 0);
    assert.equal(document.getElementById('popupWatchedOrderStatus').innerText, 'Введите полный номер заказа в формате 1234-110626.');

    input.value = ' 1234-110626 ';
    noteInput.value = 'Проверить оплату';
    addButton.dispatchEvent({ type: 'click', target: addButton });

    const addMessages = getSentMessagesByType(context, 'ADD_WATCHED_ORDER');

    assert.equal(addMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(addMessages[0])), {
        type: 'ADD_WATCHED_ORDER',
        orderId: '1234-110626',
        note: 'Проверить оплату'
    });
    assert.equal(input.value, '');
    assert.equal(noteInput.value, '');
    assert.equal(document.getElementById('popupWatchedOrderStatus').innerText, 'Заказ №1234-110626 проверен и добавлен. Список — на странице “Отслеживаемые заказы”.');
});

test('popup downloads diagnostic log from quick action', () => {
    const context = loadPopupContext();
    const document = context.__test.document;

    document.getElementById('downloadDiagnosticLog').dispatchEvent({
        type: 'click',
        target: document.getElementById('downloadDiagnosticLog')
    });

    const logMessages = getSentMessagesByType(context, 'GET_DIAGNOSTIC_LOG');

    assert.equal(logMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(logMessages[0].options)), {
        mode: 'full',
        order: 'oldest-first'
    });

    const createdLinks = document.createdElements.filter((element) => element.tagName === 'A');

    assert.equal(createdLinks.length, 1);
    assert.match(createdLinks[0].download, /^tab_wanderer-diagnostic-log-/);
    assert.match(decodeURIComponent(createdLinks[0].href), /Диагностический лог tab_wanderer/);
    assert.match(decodeURIComponent(createdLinks[0].href), /Экспорт: режим=полный/);
    assert.match(decodeURIComponent(createdLinks[0].href), /CONTROL START/);
    assert.equal(document.getElementById('diagnosticLogStatus').innerText, 'Диагностический лог готов.');
});
