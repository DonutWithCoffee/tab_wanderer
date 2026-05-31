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
        this.innerHTML = '';
        this.value = '';
        this.checked = false;
        this.disabled = false;
    }
}

class FakeDocument extends FakeEventTarget {
    constructor() {
        super();
        this.elements = new Map();
    }

    registerElement(id) {
        const element = new FakeElement(id);
        this.elements.set(id, element);
        return element;
    }

    getElementById(id) {
        return this.elements.get(id) || null;
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
        'optionsLoadStatus',
        'optionsMonitorMode',
        'optionsScopeSummary',
        'optionsNotificationSummary',
        'optionsMonitorModeSelect',
        'optionsApplyMonitorMode',
        'optionsResetMonitorMode',
        'optionsMonitorModeEditStatus',
        'optionsNotifyNewOrders',
        'optionsNotifyChangedOrders',
        'optionsNotifyFieldStatus',
        'optionsNotifyFieldDelivery',
        'optionsNotifyFieldPayment',
        'optionsNotifyFieldShipmentDateText',
        'optionsNotifyFieldHasOrderFlag',
        'optionsNotifyFieldHasAutoreserve',
        'optionsNotifyFieldTags',
        'optionsApplyNotificationTriggers',
        'optionsResetNotificationTriggers',
        'optionsNotificationEditStatus',
        'optionsScopeDictionaryStatus',
        'optionsScopeDictionaryDelivery',
        'optionsScopeDictionaryPayment',
        'optionsScopeDictionaryPayment',
        'optionsScopeStatusList',
        'optionsScopeDeliveryList',
        'optionsScopePaymentList',
        'optionsScopeStatus0',
        'optionsScopeDelivery0',
        'optionsScopePayment0',
        'optionsApplyMonitorScope',
        'optionsResetMonitorScope',
        'optionsMonitorScopeEditStatus'
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
        notificationTriggers: {
            newOrders: true,
            changedOrders: true,
            changedFields: {
                status: true,
                delivery: true,
                payment: true,
                contractor: false,
                date: false,
                shipmentDateText: true,
                hasOrderFlag: true,
                hasAutoreserve: true,
                tags: true
            }
        },
        monitorScope: {
            status: ['6806'],
            delivery: ['9797'],
            payment: ['9791']
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
            { id: '9791', label: 'Наличными в офисе' }
        ]
    };
    const document = createOptionsDom();
    const getConfigResponse = overrides.getConfigResponse || (() => ({
        ok: true,
        userConfig: JSON.parse(JSON.stringify(defaultConfig)),
        monitorDictionaries: JSON.parse(JSON.stringify(defaultDictionaries))
    }));

    const context = {
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        document,
        window: {},
        chrome: {
            runtime: {
                sendMessage: (msg, callback) => {
                    sentMessages.push(msg);

                    let response = { ok: true };

                    if (msg.type === 'GET_CONFIG') {
                        response = getConfigResponse(msg);
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
            defaultConfig,
            defaultDictionaries
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

test('options page contains readonly config summary placeholders', () => {
    const html = readOptionsHtml();

    assert.match(html, /id="optionsLoadStatus"/);
    assert.match(html, /id="optionsMonitorMode"/);
    assert.match(html, /id="optionsScopeSummary"/);
    assert.match(html, /id="optionsNotificationSummary"/);
    assert.match(html, /id="optionsMonitorModeSelect"/);
    assert.match(html, /id="optionsApplyMonitorMode"/);
    assert.match(html, /id="optionsResetMonitorMode"/);
    assert.match(html, /id="optionsMonitorModeEditStatus"/);
    assert.match(html, /id="optionsNotifyNewOrders"/);
    assert.match(html, /id="optionsNotifyChangedOrders"/);
    assert.match(html, /id="optionsNotifyFieldStatus"/);
    assert.match(html, /id="optionsNotifyFieldDelivery"/);
    assert.match(html, /id="optionsNotifyFieldPayment"/);
    assert.match(html, /id="optionsNotifyFieldShipmentDateText"/);
    assert.match(html, /id="optionsNotifyFieldHasOrderFlag"/);
    assert.match(html, /id="optionsNotifyFieldHasAutoreserve"/);
    assert.match(html, /id="optionsNotifyFieldTags"/);
    assert.match(html, /id="optionsApplyNotificationTriggers"/);
    assert.match(html, /id="optionsResetNotificationTriggers"/);
    assert.match(html, /id="optionsNotificationEditStatus"/);
    assert.match(html, /id="optionsScopeDictionaryStatus"/);
    assert.match(html, /id="optionsScopeDictionaryDelivery"/);
    assert.match(html, /id="optionsScopeDictionaryPayment"/);
    assert.match(html, /id="optionsScopeStatusList"/);
    assert.match(html, /id="optionsScopeDeliveryList"/);
    assert.match(html, /id="optionsScopePaymentList"/);
    assert.match(html, /id="optionsApplyMonitorScope"/);
    assert.match(html, /id="optionsResetMonitorScope"/);
    assert.match(html, /id="optionsMonitorScopeEditStatus"/);
    assert.match(html, /<script src="options\.js"><\/script>/);
});

test('options page loads current config summary without updating config', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;

    assert.equal(getSentMessagesByType(context, 'GET_CONFIG').length, 1);
    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
        assert.equal(
        document.getElementById('optionsMonitorModeSelect').value,
        'windowed'
    );
    assert.equal(
        document.getElementById('optionsMonitorModeEditStatus').innerText,
        'Изменений нет.'
    );
        assert.equal(
        document.getElementById('optionsNotifyNewOrders').checked,
        true
    );
    assert.equal(
        document.getElementById('optionsNotifyChangedOrders').checked,
        true
    );
    assert.equal(
        document.getElementById('optionsNotifyFieldStatus').checked,
        true
    );
    assert.equal(
        document.getElementById('optionsNotifyFieldPayment').checked,
        true
    );
    assert.equal(
        document.getElementById('optionsNotifyFieldStatus').disabled,
        false
    );
    assert.equal(
        document.getElementById('optionsNotificationEditStatus').innerText,
        'Изменений нет.'
    );
    assert.equal(
        document.getElementById('optionsLoadStatus').innerText,
        'Текущие настройки загружены.'
    );
    assert.equal(
        document.getElementById('optionsMonitorMode').innerText,
        'Windowed: первая страница + deep sync'
    );
    assert.equal(
        document.getElementById('optionsScopeSummary').innerText,
        'Статус: Ожидает оплаты; Доставка: Самовывоз; Оплата: Наличными в офисе'
    );
        assert.equal(
        document.getElementById('optionsScopeDictionaryStatus').innerText,
        'Статус: Ожидает оплаты'
    );
    assert.equal(
        document.getElementById('optionsScopeDictionaryDelivery').innerText,
        'Доставка: Самовывоз'
    );
    assert.equal(
        document.getElementById('optionsScopeDictionaryPayment').innerText,
        'Оплата: Наличными в офисе'
    );
        assert.equal(
        document.getElementById('optionsScopeStatus0').checked,
        true
    );
    assert.equal(
        document.getElementById('optionsScopeDelivery0').checked,
        true
    );
    assert.equal(
        document.getElementById('optionsScopePayment0').checked,
        true
    );
    assert.equal(
        document.getElementById('optionsMonitorScopeEditStatus').innerText,
        'Изменений нет.'
    );
    assert.equal(
        document.getElementById('optionsNotificationSummary').innerText,
        'Новые заказы: включены; Изменения заказов: включены; Поля изменений: 7 включено'
    );
});

test('options page shows unloaded scope dictionaries without updating config', () => {
    const emptyDictionariesConfig = {
        monitorMode: 'windowed',
        notificationTriggers: {
            newOrders: true,
            changedOrders: true,
            changedFields: {
                status: true,
                delivery: true,
                payment: true,
                contractor: false,
                date: false,
                shipmentDateText: true,
                hasOrderFlag: true,
                hasAutoreserve: true,
                tags: true
            }
        },
        monitorScope: {
            status: ['6806'],
            delivery: ['9797'],
            payment: ['9791']
        }
    };

    const context = loadOptionsContext({
        getConfigResponse: () => ({
            ok: true,
            userConfig: emptyDictionariesConfig,
            monitorDictionaries: {}
        })
    });
    const document = context.__test.document;

    assert.equal(getSentMessagesByType(context, 'GET_CONFIG').length, 1);
    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(
        document.getElementById('optionsScopeDictionaryStatus').innerText,
        'Статус: справочник не загружен'
    );
    assert.equal(
        document.getElementById('optionsScopeDictionaryDelivery').innerText,
        'Доставка: справочник не загружен'
    );
    assert.equal(
        document.getElementById('optionsScopeDictionaryPayment').innerText,
        'Оплата: справочник не загружен'
    );
});

test('options page changes monitor mode draft without live UPDATE_CONFIG', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const select = document.getElementById('optionsMonitorModeSelect');

    select.value = 'active';
    select.dispatchEvent({
        type: 'change',
        target: select
    });

    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(
        document.getElementById('optionsMonitorModeEditStatus').innerText,
        'Есть несохранённые изменения режима мониторинга.'
    );
});

test('options page applies monitor mode change', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const select = document.getElementById('optionsMonitorModeSelect');
    const applyBtn = document.getElementById('optionsApplyMonitorMode');

    select.value = 'active';
    select.dispatchEvent({
        type: 'change',
        target: select
    });
    applyBtn.dispatchEvent({
        type: 'click',
        target: applyBtn
    });

    const updateMessages = getSentMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.equal(updateMessages[0].config.monitorMode, 'active');
    assert.deepEqual(updateMessages[0].config.monitorScope.status, ['6806']);
    assert.equal(
        document.getElementById('optionsMonitorMode').innerText,
        'Active: только первая страница'
    );
    assert.equal(
        document.getElementById('optionsMonitorModeEditStatus').innerText,
        'Режим мониторинга сохранён.'
    );
});

test('options page resets monitor mode draft without updating config', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const select = document.getElementById('optionsMonitorModeSelect');
    const resetBtn = document.getElementById('optionsResetMonitorMode');

    select.value = 'active';
    select.dispatchEvent({
        type: 'change',
        target: select
    });
    resetBtn.dispatchEvent({
        type: 'click',
        target: resetBtn
    });

    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(select.value, 'windowed');
    assert.equal(
        document.getElementById('optionsMonitorModeEditStatus').innerText,
        'Изменений нет.'
    );
});

test('options page changes notification trigger draft without live UPDATE_CONFIG', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const newOrders = document.getElementById('optionsNotifyNewOrders');

    newOrders.checked = false;
    newOrders.dispatchEvent({
        type: 'change',
        target: newOrders
    });

    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(
        document.getElementById('optionsNotificationEditStatus').innerText,
        'Есть несохранённые изменения уведомлений.'
    );
});

test('options page disables changed field controls when changed order trigger is off', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const changedOrders = document.getElementById('optionsNotifyChangedOrders');
    const statusField = document.getElementById('optionsNotifyFieldStatus');

    changedOrders.checked = false;
    changedOrders.dispatchEvent({
        type: 'change',
        target: changedOrders
    });

    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(statusField.disabled, true);
    assert.equal(statusField.checked, true);

    changedOrders.checked = true;
    changedOrders.dispatchEvent({
        type: 'change',
        target: changedOrders
    });

    assert.equal(statusField.disabled, false);
});

test('options page applies notification trigger settings', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const newOrders = document.getElementById('optionsNotifyNewOrders');
    const paymentField = document.getElementById('optionsNotifyFieldPayment');
    const applyBtn = document.getElementById('optionsApplyNotificationTriggers');

    newOrders.checked = false;
    newOrders.dispatchEvent({
        type: 'change',
        target: newOrders
    });
    paymentField.checked = false;
    paymentField.dispatchEvent({
        type: 'change',
        target: paymentField
    });
    applyBtn.dispatchEvent({
        type: 'click',
        target: applyBtn
    });

    const updateMessages = getSentMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.equal(updateMessages[0].config.monitorMode, 'windowed');
    assert.deepEqual(updateMessages[0].config.monitorScope.status, ['6806']);
    assert.equal(updateMessages[0].config.notificationTriggers.newOrders, false);
    assert.equal(updateMessages[0].config.notificationTriggers.changedOrders, true);
    assert.equal(updateMessages[0].config.notificationTriggers.changedFields.payment, false);
    assert.equal(
        document.getElementById('optionsNotificationSummary').innerText,
        'Новые заказы: выключены; Изменения заказов: включены; Поля изменений: 6 включено'
    );
    assert.equal(
        document.getElementById('optionsNotificationEditStatus').innerText,
        'Настройки уведомлений сохранены.'
    );
});

test('options page resets notification trigger draft without updating config', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const newOrders = document.getElementById('optionsNotifyNewOrders');
    const changedOrders = document.getElementById('optionsNotifyChangedOrders');
    const statusField = document.getElementById('optionsNotifyFieldStatus');
    const resetBtn = document.getElementById('optionsResetNotificationTriggers');

    newOrders.checked = false;
    newOrders.dispatchEvent({
        type: 'change',
        target: newOrders
    });
    changedOrders.checked = false;
    changedOrders.dispatchEvent({
        type: 'change',
        target: changedOrders
    });
    resetBtn.dispatchEvent({
        type: 'click',
        target: resetBtn
    });

    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(newOrders.checked, true);
    assert.equal(changedOrders.checked, true);
    assert.equal(statusField.disabled, false);
    assert.equal(
        document.getElementById('optionsNotificationEditStatus').innerText,
        'Изменений нет.'
    );
});

test('options page changes monitor scope draft without live UPDATE_CONFIG', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const status = document.getElementById('optionsScopeStatus0');

    status.checked = false;
    status.dispatchEvent({
        type: 'change',
        target: status
    });

    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(
        document.getElementById('optionsMonitorScopeEditStatus').innerText,
        'Есть несохранённые изменения области мониторинга.'
    );
});

test('options page applies monitor scope settings', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const status = document.getElementById('optionsScopeStatus0');
    const payment = document.getElementById('optionsScopePayment0');
    const applyBtn = document.getElementById('optionsApplyMonitorScope');

    status.checked = false;
    status.dispatchEvent({
        type: 'change',
        target: status
    });
    payment.checked = false;
    payment.dispatchEvent({
        type: 'change',
        target: payment
    });
    applyBtn.dispatchEvent({
        type: 'click',
        target: applyBtn
    });

    const updateMessages = getSentMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.equal(updateMessages[0].config.monitorMode, 'windowed');
    assert.equal(updateMessages[0].config.notificationTriggers.newOrders, true);
    assert.deepEqual(updateMessages[0].config.monitorScope.status, []);
    assert.deepEqual(updateMessages[0].config.monitorScope.delivery, ['9797']);
    assert.deepEqual(updateMessages[0].config.monitorScope.payment, []);
    assert.equal(
        document.getElementById('optionsScopeSummary').innerText,
        'Статус: все; Доставка: Самовывоз; Оплата: все'
    );
    assert.equal(
        document.getElementById('optionsMonitorScopeEditStatus').innerText,
        'Область мониторинга сохранена.'
    );
});

test('options page resets monitor scope draft without updating config', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;
    const status = document.getElementById('optionsScopeStatus0');
    const delivery = document.getElementById('optionsScopeDelivery0');
    const resetBtn = document.getElementById('optionsResetMonitorScope');

    status.checked = false;
    status.dispatchEvent({
        type: 'change',
        target: status
    });
    delivery.checked = false;
    delivery.dispatchEvent({
        type: 'change',
        target: delivery
    });
    resetBtn.dispatchEvent({
        type: 'click',
        target: resetBtn
    });

    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(status.checked, true);
    assert.equal(delivery.checked, true);
    assert.equal(
        document.getElementById('optionsMonitorScopeEditStatus').innerText,
        'Изменений нет.'
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
});