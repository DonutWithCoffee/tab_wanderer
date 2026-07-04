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
    constructor(id = '') {
        super();
        this.id = id;
        this.innerText = '';
        this.textContent = '';
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.href = '';
        this.download = '';
        this.clicked = false;
        this.style = {};
        this.children = [];
        this.className = '';
        this.type = '';
    }

    appendChild(child) {
        this.children.push(child);
        return child;
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
        const element = new FakeElement(id);
        this.elements.set(id, element);
        return element;
    }

    getElementById(id) {
        return this.elements.get(id) || null;
    }

    createElement(tagName) {
        const element = new FakeElement(String(tagName || '').toLowerCase());
        element.tagName = String(tagName || '').toUpperCase();
        this.createdElements.push(element);
        return element;
    }
}

function readOptionsHtml() {
    return fs.readFileSync(
        path.join(__dirname, '..', 'options.html'),
        'utf8'
    );
}

function createOptionsDom() {
    const document = new FakeDocument();

    for (const id of [
        'optionsSettingsSaveStatus',
        'optionsLoadStatus',
        'optionsMonitorMode',
        'optionsDeepSyncSummary',
        'optionsScopeSummary',
        'optionsNotificationSummary',
        'optionsMonitorModeSelect',
        'optionsDeepSyncMaxPages',
        'optionsNotifyNewOrders',
        'optionsNotifyChangedOrders',
        'optionsNotifyFieldStatus',
        'optionsNotifyFieldDelivery',
        'optionsNotifyFieldPayment',
        'optionsNotifyFieldCity',
        'optionsSuppressLegalEntityPayment',
        'optionsSuppressOzon',
        'optionsScopeDictionaryStatus',
        'optionsScopeDictionaryDelivery',
        'optionsScopeDictionaryPayment',
        'optionsScopeDictionaryStore',
        'optionsScopeStatusList',
        'optionsScopeDeliveryList',
        'optionsScopePaymentList',
        'optionsScopeStoreList',
        'optionsScopeHint',
        'optionsOpenOrdersPage',
        'optionsWatchedOrdersSummary',
        'optionsDiagnosticsRuntime',
        'optionsDiagnosticsWorker',
        'optionsDiagnosticsOrders',
        'optionsDiagnosticsJournal',
        'optionsDiagnosticsSync',
        'optionsDiagnosticsCollection',
        'optionsRefreshDiagnostics',
        'optionsDiagnosticsStatus',
        'optionsRefreshDiagnosticLog',
        'optionsCopyDiagnosticLog',
        'optionsDownloadDiagnosticLog',
        'optionsClearDiagnosticLog',
        'optionsDiagnosticLogStatus',
        'optionsDiagnosticLogPreview'
    ]) {
        document.registerElement(id);
    }

    return document;
}

function loadOptionsContext(overrides = {}) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'options.js'),
        'utf8'
    );

    const sentMessages = [];
    const defaultConfig = {
        monitorMode: 'windowed',
        deepSyncMaxPages: 50,
        notificationTriggers: {
            newOrders: true,
            changedOrders: true,
            changedFields: {
                status: true,
                delivery: true,
                payment: true,
                city: true
            }
        },
        notificationSuppressors: {
            ignoreLegalEntityPayment: false,
            ignoreOzon: false
        },
        monitorScope: {
            status: ['6806'],
            delivery: ['9797'],
            payment: ['9791'],
            orderFlags: ['1'],
            store: [],
            reserve: [],
            assemblyStatus: []
        },
        watchedOrders: {
            items: [
                {
                    id: '1000-300326',
                    status: 'active',
                    addedAt: 1700000000000,
                    lastCheckedAt: null,
                    lastEventAt: null,
                    lastError: null
                }
            ]
        }
    };
    const defaultDictionaries = {
        status: [
            { id: '6806', label: 'Ожидает оплаты' }
        ],
        delivery: [
            { id: '9797', label: 'Самовывоз' }
        ],
        payment: [
            { id: '9791', label: 'Наличными в офисе' },
            { id: '9793', label: 'Безналичный расчёт' }
        ],
        orderFlags: [
            { id: '1', label: 'Срочный' },
            { id: '2', label: 'Проблемный' }
        ],
        store: [
            { id: '4', label: 'Основной склад' }
        ],
        reserve: [
            { id: '1', label: 'В резерве' }
        ],
        assemblyStatus: [
            { id: 'yes', label: 'Скомплектован' }
        ]
    };
    const defaultMonitorStatus = {
        isRunning: true,
        monitorState: 'active',
        monitorMode: 'windowed',
        deepSyncMaxPages: 50,
        workerTabId: 77,
        hasWorkerTab: true,
        pendingRebaseline: false,
        pendingSyncReason: null,
        knownOrdersCount: 12,
        knownHashesCount: 12,
        windowOrdersCount: 10,
        windowHashesCount: 10,
        notificationTargetsCount: 1,
        eventJournalCount: 4,
        diagnosticLogCount: 2,
        lastBaselineDate: 'Wed Jun 10 2026',
        lastDeepSyncAt: 1700000000000,
        lastCollectionMetadata: {
            syncReason: 'normal',
            pagesCollected: 2,
            ordersCollected: 10,
            maxPages: 50,
            isComplete: true
        },
        collectionSession: {
            mode: 'deep',
            ordersCount: 3,
            currentPage: 2,
            lastCollectedPage: 2,
            nextPage: 3,
            advanceAttempts: 1
        }
    };
    const defaultDiagnosticLog = {
        ok: true,
        storedTotal: 2,
        total: 2,
        returned: 2,
        limit: 100,
        entries: [
            {
                createdAt: 1700000001000,
                level: 'WARN',
                scope: 'WATCHDOG',
                message: 'worker dead restarting',
                details: { tabId: 77 }
            },
            {
                createdAt: 1700000000000,
                level: 'INFO',
                scope: 'CONTROL',
                message: 'START',
                details: { syncReason: 'manual-start' }
            }
        ]
    };
    const document = createOptionsDom();
    const pendingTimers = [];
    const runPendingTimers = () => {
        const timersToRun = pendingTimers.splice(0, pendingTimers.length);

        for (const timer of timersToRun) {
            if (!timer.cleared) {
                timer.fn();
            }
        }
    };
    const setTimeoutMock = (fn, delay) => {
        const timer = { fn, delay, cleared: false };
        pendingTimers.push(timer);
        return timer;
    };
    const clearTimeoutMock = (timer) => {
        if (timer) {
            timer.cleared = true;
        }
    };
    const getConfigResponse = overrides.getConfigResponse || (() => ({
        ok: true,
        userConfig: JSON.parse(JSON.stringify(defaultConfig)),
        monitorDictionaries: JSON.parse(JSON.stringify(defaultDictionaries))
    }));
    const getMonitorStatusResponse = overrides.getMonitorStatusResponse || (() => ({
        ok: true,
        status: JSON.parse(JSON.stringify(defaultMonitorStatus))
    }));
    const getDiagnosticLogResponse = overrides.getDiagnosticLogResponse || ((msg) => {
        const response = JSON.parse(JSON.stringify(defaultDiagnosticLog));

        if (msg.options?.mode === 'full') {
            response.mode = 'full';
            response.retainedTotal = response.storedTotal || response.total || response.returned || 0;
            response.retention = response.retention || {
                maxEntries: 5000,
                maxBytes: 2000000,
                droppedEntries: 0
            };
        }

        return response;
    });
    const clearDiagnosticLogResponse = overrides.clearDiagnosticLogResponse || (() => ({ ok: true }));
    const clipboardWrites = [];
    const navigator = overrides.navigator || {
        clipboard: {
            writeText: (text) => {
                clipboardWrites.push(text);
                return Promise.resolve();
            }
        }
    };

    const context = {
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        document,
        window: {},
        navigator,
        setTimeout: overrides.setTimeout || setTimeoutMock,
        clearTimeout: overrides.clearTimeout || clearTimeoutMock,
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
                sendMessage: (msg, callback) => {
                    sentMessages.push(msg);

                    let response = { ok: true };

                    if (msg.type === 'GET_CONFIG') {
                        response = getConfigResponse(msg);
                    }

                    if (msg.type === 'UPDATE_CONFIG') {
                        response = {
                            ok: true,
                            userConfig: JSON.parse(JSON.stringify(msg.userConfig))
                        };
                    }

                    if (msg.type === 'GET_MONITOR_STATUS') {
                        response = getMonitorStatusResponse(msg);
                    }

                    if (msg.type === 'GET_DIAGNOSTIC_LOG') {
                        response = getDiagnosticLogResponse(msg);
                    }

                    if (msg.type === 'CLEAR_DIAGNOSTIC_LOG') {
                        response = clearDiagnosticLogResponse(msg);
                    }

                    if (typeof callback === 'function') {
                        callback(response);
                    }
                }
            }
        },
        __test: {
            sentMessages,
            document,
            clipboardWrites,
            defaultConfig,
            defaultDictionaries,
            pendingTimers,
            runPendingTimers
        }
    };

    context.globalThis = context;
    context.window = context;

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'options.js' });

    document.dispatchEvent({ type: 'DOMContentLoaded' });

    return context;
}

function getSentMessagesByType(context, type) {
    return context.__test.sentMessages.filter((msg) => msg.type === type);
}

function findCreatedInput(context, id) {
    return context.__test.document.createdElements.slice().reverse().find((element) => element.id === id) || null;
}

test('options page contains autosave settings and support diagnostics sections', () => {
    const html = readOptionsHtml();

    assert.match(html, /id="optionsSettingsSaveStatus"/);
    assert.match(html, /id="optionsMonitorModeSelect"/);
    assert.match(html, /id="optionsDeepSyncMaxPages"/);
    assert.match(html, /id="optionsNotifyNewOrders"/);
    assert.match(html, /id="optionsNotifyChangedOrders"/);
    assert.match(html, /id="optionsSuppressLegalEntityPayment"/);
    assert.match(html, /id="optionsSuppressOzon"/);
    assert.match(html, /id="optionsScopeStatusList"/);
    assert.match(html, /id="optionsScopeDeliveryList"/);
    assert.match(html, /id="optionsScopePaymentList"/);
    assert.doesNotMatch(html, /id="optionsScopeOrderFlagsList"/);
    assert.doesNotMatch(html, /id="optionsScopeReserveList"/);
    assert.doesNotMatch(html, /id="optionsScopeAssemblyStatusList"/);
    assert.doesNotMatch(html, /Флаги заказа/);
    assert.doesNotMatch(html, /<h3>Резерв<\/h3>/);
    assert.doesNotMatch(html, /<h3>Комплектация<\/h3>/);
    assert.match(html, /id="optionsScopeHint"/);
    assert.match(html, /id="optionsOpenOrdersPage"/);
    assert.match(html, /Открыть страницу “Отслеживание”/);
    assert.match(html, /id="optionsWatchedOrdersSummary"/);
    assert.doesNotMatch(html, /id="optionsWatchedOrderInput"/);
    assert.doesNotMatch(html, /id="optionsAddWatchedOrder"/);
    assert.doesNotMatch(html, /id="optionsWatchedOrdersList"/);
    assert.match(html, /id="optionsDiagnosticLogDetails"/);
    assert.match(html, /Настройки мониторинга/);
    assert.match(html, /Общий: первая страница \+ глубокая синхронизация/);
    assert.match(html, /Не уведомлять о/);
    assert.match(html, /Обновить диагностику/);
    assert.doesNotMatch(html, /Поиск заказа, список отслеживаемых заказов/);
    assert.doesNotMatch(html, /локальной истории заказа/);
    assert.doesNotMatch(html, /id="optionsApplyMonitorMode"/);
    assert.doesNotMatch(html, /id="optionsResetMonitorMode"/);
    assert.doesNotMatch(html, /id="optionsApplyNotificationTriggers"/);
    assert.doesNotMatch(html, /id="optionsResetNotificationTriggers"/);
});

test('options page loads current config and diagnostics without updating config', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;

    assert.equal(getSentMessagesByType(context, 'GET_CONFIG').length, 1);
    assert.equal(getSentMessagesByType(context, 'GET_MONITOR_STATUS').length, 1);
    assert.equal(getSentMessagesByType(context, 'GET_DIAGNOSTIC_LOG').length, 1);
    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(document.getElementById('optionsMonitorModeSelect').value, 'windowed');
    assert.equal(document.getElementById('optionsDeepSyncMaxPages').value, '50');
    assert.equal(document.getElementById('optionsNotifyNewOrders').checked, true);
    assert.equal(document.getElementById('optionsNotifyFieldStatus').checked, true);
    assert.equal(document.getElementById('optionsSuppressLegalEntityPayment').checked, false);
    assert.equal(document.getElementById('optionsSuppressOzon').checked, false);
    assert.equal(document.getElementById('optionsSettingsSaveStatus').innerText, 'Настройки загружены. Изменения сохраняются автоматически.');
    assert.equal(document.getElementById('optionsMonitorMode').innerText, 'Общий: первая страница + глубокая синхронизация');
    assert.equal(document.getElementById('optionsDeepSyncSummary').innerText, '50 страниц');
    assert.equal(document.getElementById('optionsScopeSummary').innerText, 'Статус: Ожидает оплаты; Доставка: Самовывоз; Оплата: Наличными в офисе; Склад: все');
    assert.equal(document.getElementById('optionsScopeHint').innerText, 'Пустой выбор в группе означает “все”. Изменения сохраняются автоматически.');
    assert.equal(document.getElementById('optionsNotificationSummary').innerText, 'Новые заказы: включены; Изменения заказов: включены; Поля изменений: 4 включено; Юрики: уведомляются; ОЗОН: уведомляется');
    assert.equal(document.getElementById('optionsWatchedOrdersSummary').innerText, '1 заказ');
    assert.match(document.getElementById('optionsDiagnosticsRuntime').innerText, /глубина: 50 страниц/);
});


test('options page links watched orders management to watched orders page', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;

    document.getElementById('optionsOpenOrdersPage').dispatchEvent({
        type: 'click',
        target: document.getElementById('optionsOpenOrdersPage')
    });

    assert.deepEqual(JSON.parse(JSON.stringify(context.chrome.tabs.createdTabs)), [
        {
            url: 'chrome-extension://tab-wanderer/history.html',
            active: true
        }
    ]);
    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
});

test('options page autosaves monitor mode changes', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const select = document.getElementById('optionsMonitorModeSelect');

    select.value = 'active';
    select.dispatchEvent({ type: 'change', target: select });

    const updateMessages = getSentMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.equal(updateMessages[0].userConfig.monitorMode, 'active');
    assert.equal(updateMessages[0].userConfig.deepSyncMaxPages, 50);
    assert.deepEqual(JSON.parse(JSON.stringify(updateMessages[0].userConfig.monitorScope.status)), ['6806']);
    assert.equal(document.getElementById('optionsMonitorMode').innerText, 'Быстрый: только первая страница');
    assert.equal(document.getElementById('optionsSettingsSaveStatus').innerText, 'Режим мониторинга сохранён.');
});

test('options page debounces monitor scope changes and keeps empty group as all', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const selectedStatus = findCreatedInput(context, 'optionsScope_status_0');
    const initialSecondPayment = findCreatedInput(context, 'optionsScope_payment_1');

    assert.equal(selectedStatus.checked, true);
    assert.equal(initialSecondPayment.checked, false);

    selectedStatus.checked = false;
    selectedStatus.dispatchEvent({ type: 'change', target: selectedStatus });

    const secondPayment = findCreatedInput(context, 'optionsScope_payment_1');

    secondPayment.checked = true;
    secondPayment.dispatchEvent({ type: 'change', target: secondPayment });

    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(context.__test.pendingTimers.length, 2);
    assert.equal(context.__test.pendingTimers[0].cleared, true);
    assert.equal(context.__test.pendingTimers[1].delay, 700);
    assert.equal(document.getElementById('optionsSettingsSaveStatus').innerText, 'Область мониторинга изменена. Сохраняем после завершения выбора...');
    assert.equal(document.getElementById('optionsScopeSummary').innerText, 'Статус: все; Доставка: Самовывоз; Оплата: Наличными в офисе, Безналичный расчёт; Склад: все');

    context.__test.runPendingTimers();

    const updateMessages = getSentMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(updateMessages[0].userConfig.monitorScope.status)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(updateMessages[0].userConfig.monitorScope.payment)), ['9791', '9793']);
    assert.equal(Object.prototype.hasOwnProperty.call(updateMessages[0].userConfig.monitorScope, 'orderFlags'), false);
    assert.equal(document.getElementById('optionsScopeSummary').innerText, 'Статус: все; Доставка: Самовывоз; Оплата: Наличными в офисе, Безналичный расчёт; Склад: все');
    assert.equal(document.getElementById('optionsSettingsSaveStatus').innerText, 'Область мониторинга сохранена. Будет выполнена безопасная перебазировка без потока уведомлений.');
});

test('options page autosaves and clamps deep sync max pages', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const input = document.getElementById('optionsDeepSyncMaxPages');

    input.value = '999';
    input.dispatchEvent({ type: 'change', target: input });

    const updateMessages = getSentMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.equal(updateMessages[0].userConfig.deepSyncMaxPages, 50);
    assert.equal(document.getElementById('optionsDeepSyncMaxPages').value, '50');
    assert.equal(document.getElementById('optionsDeepSyncSummary').innerText, '50 страниц');
    assert.equal(document.getElementById('optionsSettingsSaveStatus').innerText, 'Глубина синхронизации сохранена.');
});

test('options page autosaves notification trigger settings', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const newOrders = document.getElementById('optionsNotifyNewOrders');
    const paymentField = document.getElementById('optionsNotifyFieldPayment');

    newOrders.checked = false;
    newOrders.dispatchEvent({ type: 'change', target: newOrders });
    paymentField.checked = false;
    paymentField.dispatchEvent({ type: 'change', target: paymentField });

    const updateMessages = getSentMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 2);
    assert.equal(updateMessages[0].userConfig.notificationTriggers.newOrders, false);
    assert.equal(updateMessages[1].userConfig.notificationTriggers.changedFields.payment, false);
    assert.equal(document.getElementById('optionsNotificationSummary').innerText, 'Новые заказы: выключены; Изменения заказов: включены; Поля изменений: 3 включено; Юрики: уведомляются; ОЗОН: уведомляется');
    assert.equal(document.getElementById('optionsSettingsSaveStatus').innerText, 'Настройки уведомлений сохранены.');
});



test('options page autosaves quick notification suppressors', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const legalToggle = document.getElementById('optionsSuppressLegalEntityPayment');
    const ozonToggle = document.getElementById('optionsSuppressOzon');

    legalToggle.checked = true;
    legalToggle.dispatchEvent({ type: 'change', target: legalToggle });
    ozonToggle.checked = true;
    ozonToggle.dispatchEvent({ type: 'change', target: ozonToggle });

    const updateMessages = getSentMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 2);
    assert.equal(updateMessages[0].userConfig.notificationSuppressors.ignoreLegalEntityPayment, true);
    assert.equal(updateMessages[0].userConfig.notificationSuppressors.ignoreOzon, false);
    assert.equal(updateMessages[1].userConfig.notificationSuppressors.ignoreLegalEntityPayment, true);
    assert.equal(updateMessages[1].userConfig.notificationSuppressors.ignoreOzon, true);
    assert.equal(document.getElementById('optionsSettingsSaveStatus').innerText, 'Подавления уведомлений сохранены.');
    assert.equal(document.getElementById('optionsNotificationSummary').innerText, 'Новые заказы: включены; Изменения заказов: включены; Поля изменений: 4 включено; Юрики: игнорируются; ОЗОН: игнорируется');
});

test('options page disables changed field controls when changed order trigger is off', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const changedOrders = document.getElementById('optionsNotifyChangedOrders');
    const statusField = document.getElementById('optionsNotifyFieldStatus');

    changedOrders.checked = false;
    changedOrders.dispatchEvent({ type: 'change', target: changedOrders });

    assert.equal(statusField.disabled, true);
    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 1);
});

test('options page refreshes monitor diagnostics on demand', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;

    document.getElementById('optionsRefreshDiagnostics').dispatchEvent({
        type: 'click',
        target: document.getElementById('optionsRefreshDiagnostics')
    });

    assert.equal(getSentMessagesByType(context, 'GET_MONITOR_STATUS').length, 2);
    assert.equal(document.getElementById('optionsDiagnosticsStatus').innerText, 'Диагностика загружена.');
    assert.match(document.getElementById('optionsDiagnosticsCollection').innerText, /лимит: 50/);
});

test('options page shows diagnostics load error when GET_MONITOR_STATUS fails', () => {
    const context = loadOptionsContext({
        getMonitorStatusResponse: () => ({ ok: false })
    });

    assert.equal(
        context.__test.document.getElementById('optionsDiagnosticsStatus').innerText,
        'Не удалось загрузить диагностику.'
    );
});

test('options page refreshes diagnostic log on demand', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;

    document.getElementById('optionsRefreshDiagnosticLog').dispatchEvent({
        type: 'click',
        target: document.getElementById('optionsRefreshDiagnosticLog')
    });

    assert.equal(getSentMessagesByType(context, 'GET_DIAGNOSTIC_LOG').length, 2);
    assert.match(document.getElementById('optionsDiagnosticLogPreview').innerText, /Диагностический лог tab_wanderer/);
    assert.match(document.getElementById('optionsDiagnosticLogPreview').innerText, /CONTROL START/);
});

test('options page clears diagnostic log and reloads diagnostics', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;

    document.getElementById('optionsClearDiagnosticLog').dispatchEvent({
        type: 'click',
        target: document.getElementById('optionsClearDiagnosticLog')
    });

    assert.equal(getSentMessagesByType(context, 'CLEAR_DIAGNOSTIC_LOG').length, 1);
    assert.equal(getSentMessagesByType(context, 'GET_DIAGNOSTIC_LOG').length, 2);
    assert.equal(getSentMessagesByType(context, 'GET_MONITOR_STATUS').length, 2);
});

test('options page prepares diagnostic log txt download', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;

    document.getElementById('optionsDownloadDiagnosticLog').dispatchEvent({
        type: 'click',
        target: document.getElementById('optionsDownloadDiagnosticLog')
    });

    const logMessages = getSentMessagesByType(context, 'GET_DIAGNOSTIC_LOG');
    const createdLinks = document.createdElements.filter((element) => element.tagName === 'A');

    assert.equal(logMessages.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(logMessages[1].options)), {
        mode: 'full',
        order: 'oldest-first'
    });
    assert.equal(createdLinks.length, 1);
    assert.match(createdLinks[0].download, /^tab_wanderer-diagnostic-log-/);
    assert.match(decodeURIComponent(createdLinks[0].href), /Диагностический лог tab_wanderer/);
    assert.match(decodeURIComponent(createdLinks[0].href), /Экспорт: режим=полный/);
    assert.equal(document.getElementById('optionsDiagnosticLogStatus').innerText, 'Полный файл лога подготовлен для скачивания.');
});

test('options page copies diagnostic log when clipboard is available', async () => {
    const context = loadOptionsContext();
    const document = context.__test.document;

    document.getElementById('optionsCopyDiagnosticLog').dispatchEvent({
        type: 'click',
        target: document.getElementById('optionsCopyDiagnosticLog')
    });

    await Promise.resolve();

    assert.equal(context.__test.clipboardWrites.length, 1);
    assert.match(context.__test.clipboardWrites[0], /Диагностический лог tab_wanderer/);
    assert.equal(document.getElementById('optionsDiagnosticLogStatus').innerText, 'Лог скопирован в буфер обмена.');
});

test('options page shows diagnostic log load error when GET_DIAGNOSTIC_LOG fails', () => {
    const context = loadOptionsContext({
        getDiagnosticLogResponse: () => ({ ok: false })
    });

    assert.equal(
        context.__test.document.getElementById('optionsDiagnosticLogStatus').innerText,
        'Не удалось загрузить диагностический лог.'
    );
});

test('options page shows load error when GET_CONFIG fails', () => {
    const context = loadOptionsContext({
        getConfigResponse: () => ({ ok: false })
    });

    assert.equal(getSentMessagesByType(context, 'GET_CONFIG').length, 1);
    assert.equal(
        context.__test.document.getElementById('optionsLoadStatus').innerText,
        'Не удалось загрузить текущие настройки.'
    );
    assert.equal(
        context.__test.document.getElementById('optionsSettingsSaveStatus').innerText,
        'Ошибка загрузки настроек.'
    );
});
