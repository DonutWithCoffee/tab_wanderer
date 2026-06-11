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
        this.value = '';
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
        'historyOrderQuery',
        'historyEventType',
        'historyEventKind',
        'historyChangedField',
        'historyPeriod',
        'historyWatchedOnly',
        'refreshHistory',
        'resetHistoryFilters',
        'historyStatus',
        'historyList'
    ].forEach((id) => document.registerElement(id));

    document.getElementById('historyPeriod').value = 'all';
    document.getElementById('historyWatchedOnly').value = '';

    return document;
}

function loadHistoryContext(responseOverride, setupDocument) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'history.js'),
        'utf8'
    );

    const sentMessages = [];
    const document = createHistoryDom();

    if (typeof setupDocument === 'function') {
        setupDocument(document);
    }

    const defaultResponse = {
        ok: true,
        storedTotal: 3,
        total: 3,
        returned: 3,
        limit: 100,
        entries: [
            {
                id: 'scope-event',
                createdAt: 1700000120000,
                orderId: '',
                orderUrl: '',
                eventType: 'scope-changed',
                eventKind: 'scope-change',
                syncReason: 'scope-change',
                changedFields: ['scope.status'],
                diff: [
                    {
                        field: 'scope.status',
                        before: ['Все'],
                        after: ['Новый']
                    }
                ],
                notification: {
                    notify: false,
                    reason: 'Scope changes are recorded in history without user notifications'
                }
            },
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
                context: {
                    status: 'Новый',
                    delivery: 'Самовывоз',
                    payment: 'Наличными в офисе',
                    tags: ['ОЗОН']
                },
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

test('history page html contains filters and readable timeline containers', () => {
    const html = readHistoryHtml();

    assert.match(html, /История изменений/);
    assert.match(html, /id="historyOrderQuery"/);
    assert.match(html, /id="historyEventType"/);
    assert.match(html, /id="historyEventKind"/);
    assert.match(html, /id="historyChangedField"/);
    assert.match(html, /id="historyPeriod"/);
    assert.match(html, /id="historyWatchedOnly"/);
    assert.match(html, /id="resetHistoryFilters"/);
    assert.match(html, /id="refreshHistory"/);
    assert.match(html, /id="historyStatus"/);
    assert.match(html, /id="historyList"/);
    assert.match(html, /Смена области мониторинга/);
    assert.doesNotMatch(html, /технический скелет страницы истории/);
});

test('history page requests event journal and renders readable entries', () => {
    const context = loadHistoryContext();
    const document = context.__test.document;

    assert.equal(context.__test.sentMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.sentMessages[0])), {
        type: 'GET_EVENT_JOURNAL',
        options: {
            limit: 100
        }
    });

    assert.equal(
        document.getElementById('historyStatus').innerText,
        'Событий найдено: 3; показано: 3; всего сохранено: 3'
    );
    assert.match(document.getElementById('historyList').innerHTML, /Заказ №1001-300326/);
    assert.match(document.getElementById('historyList').innerHTML, /Изменение заказа/);
    assert.match(document.getElementById('historyList').innerHTML, /Живое наблюдение/);
    assert.match(document.getElementById('historyList').innerHTML, /Обычный цикл/);
    assert.match(document.getElementById('historyList').innerHTML, /Статус/);
    assert.match(document.getElementById('historyList').innerHTML, /Новый/);
    assert.match(document.getElementById('historyList').innerHTML, /Оплачен/);
    assert.match(document.getElementById('historyList').innerHTML, /Уведомление: нет/);
    assert.match(document.getElementById('historyList').innerHTML, /Область мониторинга/);
    assert.match(document.getElementById('historyList').innerHTML, /Область: статус/);
    assert.match(document.getElementById('historyList').innerHTML, /Самовывоз/);
});

test('history page sends selected filters to event journal request', () => {
    const context = loadHistoryContext();
    const document = context.__test.document;

    document.getElementById('historyOrderQuery').value = '1001';
    document.getElementById('historyEventType').value = 'order-changed';
    document.getElementById('historyEventKind').value = 'live';
    document.getElementById('historyChangedField').value = 'status';
    document.getElementById('historyPeriod').value = '7d';
    document.getElementById('historyWatchedOnly').value = '1';

    document.getElementById('refreshHistory').dispatchEvent({
        type: 'click',
        target: document.getElementById('refreshHistory')
    });

    assert.equal(context.__test.sentMessages.length, 2);
    assert.equal(context.__test.sentMessages[1].type, 'GET_EVENT_JOURNAL');
    assert.equal(context.__test.sentMessages[1].options.limit, 100);
    assert.equal(context.__test.sentMessages[1].options.orderQuery, '1001');
    assert.equal(context.__test.sentMessages[1].options.eventType, 'order-changed');
    assert.equal(context.__test.sentMessages[1].options.eventKind, 'live');
    assert.equal(context.__test.sentMessages[1].options.changedField, 'status');
    assert.equal(typeof context.__test.sentMessages[1].options.since, 'number');
    assert.equal(context.__test.sentMessages[1].options.watchedOnly, true);
});

test('history page reset filters clears controls and reloads journal', () => {
    const context = loadHistoryContext(undefined, (document) => {
        document.getElementById('historyOrderQuery').value = '1001';
        document.getElementById('historyEventType').value = 'order-changed';
        document.getElementById('historyPeriod').value = '24h';
        document.getElementById('historyWatchedOnly').value = '1';
    });
    const document = context.__test.document;

    document.getElementById('resetHistoryFilters').dispatchEvent({
        type: 'click',
        target: document.getElementById('resetHistoryFilters')
    });

    assert.equal(document.getElementById('historyOrderQuery').value, '');
    assert.equal(document.getElementById('historyEventType').value, '');
    assert.equal(document.getElementById('historyPeriod').value, 'all');
    assert.equal(document.getElementById('historyWatchedOnly').value, '');
    assert.equal(context.__test.sentMessages.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.sentMessages[1])), {
        type: 'GET_EVENT_JOURNAL',
        options: {
            limit: 100
        }
    });
});

test('history page shows empty state', () => {
    const context = loadHistoryContext({
        ok: true,
        storedTotal: 0,
        total: 0,
        returned: 0,
        limit: 100,
        entries: []
    });

    const document = context.__test.document;

    assert.equal(
        document.getElementById('historyStatus').innerText,
        'Событий найдено: 0; показано: 0; всего сохранено: 0'
    );
    assert.match(document.getElementById('historyList').innerHTML, /По выбранным фильтрам событий нет/);
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

    assert.equal(document.getElementById('historyStatus').innerText, 'Не удалось загрузить историю');
    assert.equal(document.getElementById('historyList').innerHTML, '');
});
