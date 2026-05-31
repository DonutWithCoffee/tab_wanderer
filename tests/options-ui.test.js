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
        'optionsNotificationSummary'
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
    assert.match(html, /<script src="options\.js"><\/script>/);
});

test('options page loads current config summary without updating config', () => {
    const context = loadOptionsContext();
    const document = context.__test.document;

    assert.equal(getSentMessagesByType(context, 'GET_CONFIG').length, 1);
    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(
        document.getElementById('optionsLoadStatus').innerText,
        'Текущие настройки загружены. Страница пока работает в режиме чтения.'
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
        document.getElementById('optionsNotificationSummary').innerText,
        'Новые заказы: включены; Изменения заказов: включены; Поля изменений: 7 включено'
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