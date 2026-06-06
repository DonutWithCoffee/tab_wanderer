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
        this._innerHTML = '';
    }

    set innerHTML(value) {
        this._innerHTML = String(value || '');
    }

    get innerHTML() {
        return this._innerHTML;
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

function createHistoryDom() {
    const document = new FakeDocument();

    [
        'refreshHistory',
        'historyStatus',
        'historyList'
    ].forEach((id) => document.registerElement(id));

    return document;
}

function loadHistoryContext(responseOverride) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'history.js'),
        'utf8'
    );

    const sentMessages = [];
    const document = createHistoryDom();

    const defaultResponse = {
        ok: true,
        storedTotal: 2,
        total: 2,
        returned: 2,
        limit: 50,
        entries: [
            {
                id: 'event-2',
                createdAt: 1700000060000,
                orderId: '1001-300326',
                orderUrl: 'https://amperkot.ru/admin/orders/1001-300326/',
                eventType: 'order-changed',
                eventKind: 'live',
                syncReason: 'normal',
                changedFields: ['status'],
                diff: [
                    {
                        field: 'status',
                        before: 'Новый',
                        after: 'Оплачен'
                    }
                ],
                notification: {
                    notify: false,
                    reason: 'No enabled changed fields matched: status'
                }
            },
            {
                id: 'event-1',
                createdAt: 1700000000000,
                orderId: '1000-300326',
                orderUrl: '',
                eventType: 'new-order',
                eventKind: 'catch-up',
                syncReason: 'manual-start',
                changedFields: [],
                diff: [],
                notification: {
                    notify: true
                }
            }
        ]
    };

    const context = {
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        document,
        chrome: {
            runtime: {
                sendMessage: (message, callback) => {
                    sentMessages.push(message);

                    if (typeof callback === 'function') {
                        callback(responseOverride || defaultResponse);
                    }
                }
            }
        },
        __test: {
            document,
            sentMessages
        }
    };

    context.globalThis = context;
    context.window = context;

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'history.js' });

    document.dispatchEvent({ type: 'DOMContentLoaded' });

    return context;
}

function readHistoryHtml() {
    return fs.readFileSync(
        path.join(__dirname, '..', 'history.html'),
        'utf8'
    );
}

test('history page html contains skeleton containers', () => {
    const html = readHistoryHtml();

    assert.match(html, /История изменений/);
    assert.match(html, /id="refreshHistory"/);
    assert.match(html, /id="historyStatus"/);
    assert.match(html, /id="historyList"/);
    assert.match(html, /технический скелет страницы истории/);
});

test('history page requests event journal and renders basic diff', () => {
    const context = loadHistoryContext();
    const document = context.__test.document;

    assert.equal(context.__test.sentMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.sentMessages[0])), {
        type: 'GET_EVENT_JOURNAL',
        options: {
            limit: 50
        }
    });

    assert.equal(document.getElementById('historyStatus').innerText, 'Events: 2, shown: 2');
    assert.match(document.getElementById('historyList').innerHTML, /Заказ №1001-300326/);
    assert.match(document.getElementById('historyList').innerHTML, /Изменение заказа/);
    assert.match(document.getElementById('historyList').innerHTML, /Статус/);
    assert.match(document.getElementById('historyList').innerHTML, /Новый/);
    assert.match(document.getElementById('historyList').innerHTML, /Оплачен/);
    assert.match(document.getElementById('historyList').innerHTML, /уведомление: нет/);
});

test('history page shows empty state', () => {
    const context = loadHistoryContext({
        ok: true,
        storedTotal: 0,
        total: 0,
        returned: 0,
        limit: 50,
        entries: []
    });

    const document = context.__test.document;

    assert.equal(document.getElementById('historyStatus').innerText, 'Events: 0, shown: 0');
    assert.match(document.getElementById('historyList').innerHTML, /История пока пуста/);
});

test('history page refresh button reloads journal', () => {
    const context = loadHistoryContext();
    const refreshBtn = context.__test.document.getElementById('refreshHistory');

    refreshBtn.dispatchEvent({
        type: 'click',
        target: refreshBtn
    });

    assert.equal(context.__test.sentMessages.length, 2);
    assert.equal(context.__test.sentMessages[1].type, 'GET_EVENT_JOURNAL');
});

test('history page shows load failure', () => {
    const context = loadHistoryContext({
        ok: false,
        error: 'failed'
    });

    const document = context.__test.document;

    assert.equal(document.getElementById('historyStatus').innerText, 'Failed to load history');
    assert.equal(document.getElementById('historyList').innerHTML, '');
});
