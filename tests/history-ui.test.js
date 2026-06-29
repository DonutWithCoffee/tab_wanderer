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
        this.dataset = {};
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
        'searchHistory',
        'resetHistorySearch',
        'historyStatus',
        'historyCandidates',
        'orderSummary',
        'historyList',
        'ordersWatchedOrderInput',
        'ordersAddWatchedOrder',
        'ordersWatchedStatus',
        'ordersWatchedList'
    ].forEach((id) => document.registerElement(id));

    return document;
}

function getDefaultOrderLookupResponse() {
    return {
        ok: true,
        query: '1001',
        queryType: 'short',
        status: 'selected',
        selectedOrderId: '1001-300326',
        candidates: [
            {
                orderId: '1001-300326',
                shortOrderNumber: '1001',
                orderUrl: 'https://amperkot.ru/admin/orders/1001-300326/',
                context: {
                    status: 'Оплачен',
                    delivery: 'Самовывоз',
                    payment: 'Наличными в офисе',
                    tags: ['ОЗОН']
                },
                isWatched: true,
                lastSeenAt: 1700000060000,
                eventCount: 2
            }
        ],
        order: {
            orderId: '1001-300326',
            shortOrderNumber: '1001',
            orderUrl: 'https://amperkot.ru/admin/orders/1001-300326/',
            context: {
                status: 'Оплачен',
                delivery: 'Самовывоз',
                payment: 'Наличными в офисе',
                tags: ['ОЗОН']
            },
            isWatched: true,
            lastSeenAt: 1700000060000,
            eventCount: 2
        },
        storedTotal: 3,
        total: 2,
        returned: 2,
        limit: 100,
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
                    notify: true
                }
            },
            {
                id: 'event-1',
                createdAt: 1700000000000,
                orderId: '1001-300326',
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
                    notify: false,
                    reason: 'new order trigger disabled'
                }
            }
        ]
    };
}

function loadHistoryContext(responseOverride, setupDocument, configOverride) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'history.js'),
        'utf8'
    );

    const sentMessages = [];
    const document = createHistoryDom();
    const userConfig = configOverride || {
        watchedOrders: {
            items: [
                {
                    id: '1001-300326',
                    status: 'active',
                    addedAt: 1700000000000,
                    lastCheckedAt: 1700000060000,
                    lastBaselineAt: 1700000000000,
                    lastEventAt: 1700000060000,
                    lastError: null
                }
            ]
        }
    };

    if (typeof setupDocument === 'function') {
        setupDocument(document);
    }

    const context = {
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        document,
        Date,
        chrome: {
            runtime: {
                sendMessage: (message, callback) => {
                    sentMessages.push(message);

                    let response = responseOverride || getDefaultOrderLookupResponse();

                    if (message.type === 'GET_CONFIG') {
                        response = { ok: true, userConfig: JSON.parse(JSON.stringify(userConfig)) };
                    }

                    if (message.type === 'UPDATE_CONFIG') {
                        Object.assign(userConfig, JSON.parse(JSON.stringify(message.userConfig || {})));
                        response = { ok: true, userConfig: JSON.parse(JSON.stringify(userConfig)) };
                    }

                    if (message.type === 'GET_ORDER_LOOKUP') {
                        response = responseOverride || getDefaultOrderLookupResponse();
                    }

                    if (typeof callback === 'function') {
                        callback(response);
                    }
                }
            }
        },
        __test: {
            document,
            sentMessages,
            userConfig
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

function getMessagesByType(context, type) {
    return context.__test.sentMessages.filter((message) => message.type === type);
}

test('history page is order lookup, not full event timeline', () => {
    const html = readHistoryHtml();

    assert.match(html, /Заказы/);
    assert.match(html, /Поиск изменений по заказу/);
    assert.match(html, /id="historyOrderQuery"/);
    assert.match(html, /id="searchHistory"/);
    assert.match(html, /id="resetHistorySearch"/);
    assert.match(html, /id="historyCandidates"/);
    assert.match(html, /id="orderSummary"/);
    assert.match(html, /id="historyList"/);
    assert.match(html, /id="ordersWatchedOrderInput"/);
    assert.match(html, /id="ordersWatchedList"/);
    assert.match(html, /первым 4 цифрам|первые 4 цифры/);
    assert.match(html, /Это не полная серверная история заказа/);
    assert.doesNotMatch(html, /id="historyEventType"/);
    assert.doesNotMatch(html, /id="historyEventKind"/);
    assert.doesNotMatch(html, /id="historyChangedField"/);
    assert.doesNotMatch(html, /id="historyWatchedOnly"/);
});

test('history page starts idle without loading broad event journal', () => {
    const context = loadHistoryContext();
    const document = context.__test.document;

    assert.equal(getMessagesByType(context, 'GET_ORDER_LOOKUP').length, 0);
    assert.equal(getMessagesByType(context, 'GET_CONFIG').length, 1);
    assert.equal(document.getElementById('historyStatus').innerText, 'Введите номер заказа для поиска');
    assert.equal(document.getElementById('historyList').innerHTML, '');
});

test('history page requests order lookup and renders selected order changes', () => {
    const context = loadHistoryContext(undefined, (document) => {
        document.getElementById('historyOrderQuery').value = '1001';
    });
    const document = context.__test.document;

    document.getElementById('searchHistory').dispatchEvent({
        type: 'click',
        target: document.getElementById('searchHistory')
    });

    assert.equal(getMessagesByType(context, 'GET_ORDER_LOOKUP').length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(getMessagesByType(context, 'GET_ORDER_LOOKUP')[0])), {
        type: 'GET_ORDER_LOOKUP',
        options: {
            query: '1001',
            limit: 100
        }
    });

    assert.equal(document.getElementById('historyStatus').innerText, 'Заказ найден: 1001-300326. Событий: 2');
    assert.match(document.getElementById('orderSummary').innerHTML, /Заказ 1001-300326/);
    assert.match(document.getElementById('orderSummary').innerHTML, /Оплачен/);
    assert.match(document.getElementById('orderSummary').innerHTML, /ОЗОН/);
    assert.match(document.getElementById('orderSummary').innerHTML, /Это не полная серверная история заказа/);
    assert.match(document.getElementById('historyList').innerHTML, /Изменение заказа/);
    assert.match(document.getElementById('historyList').innerHTML, /Статус/);
    assert.match(document.getElementById('historyList').innerHTML, /Новый/);
    assert.match(document.getElementById('historyList').innerHTML, /Оплачен/);
    assert.match(document.getElementById('historyList').innerHTML, /Первое обнаружение заказа/);
});

test('history page renders multiple short-number candidates without showing global events', () => {
    const context = loadHistoryContext({
        ok: true,
        query: '1001',
        queryType: 'short',
        status: 'multiple-candidates',
        selectedOrderId: '',
        candidates: [
            {
                orderId: '1001-300326',
                context: { status: 'Оплачен' },
                lastSeenAt: 1700000060000
            },
            {
                orderId: '1001-290326',
                context: { status: 'Завершен' },
                lastSeenAt: 1699990000000
            }
        ],
        order: null,
        entries: [],
        total: 0,
        returned: 0,
        storedTotal: 10,
        limit: 100
    }, (document) => {
        document.getElementById('historyOrderQuery').value = '1001';
    });
    const document = context.__test.document;

    document.getElementById('searchHistory').dispatchEvent({ type: 'click' });

    assert.equal(document.getElementById('historyStatus').innerText, 'Найдено несколько заказов: 2');
    assert.match(document.getElementById('historyCandidates').innerHTML, /1001-300326/);
    assert.match(document.getElementById('historyCandidates').innerHTML, /1001-290326/);
    assert.equal(document.getElementById('orderSummary').innerHTML, '');
    assert.equal(document.getElementById('historyList').innerHTML, '');
});

test('history page shows not-found and invalid lookup states', () => {
    const notFound = loadHistoryContext({
        ok: true,
        query: '9999',
        queryType: 'short',
        status: 'not-found',
        candidates: [],
        selectedOrderId: '',
        order: null,
        entries: [],
        total: 0,
        returned: 0,
        storedTotal: 0,
        limit: 100
    }, (document) => {
        document.getElementById('historyOrderQuery').value = '9999';
    });

    notFound.__test.document.getElementById('searchHistory').dispatchEvent({ type: 'click' });
    assert.match(notFound.__test.document.getElementById('historyStatus').innerText, /не найден/);
    assert.match(notFound.__test.document.getElementById('historyList').innerHTML, /Плагин показывает только заказы/);

    const invalid = loadHistoryContext({
        ok: true,
        query: 'abc',
        queryType: 'invalid',
        status: 'invalid-query',
        candidates: [],
        selectedOrderId: '',
        order: null,
        entries: [],
        total: 0,
        returned: 0,
        storedTotal: 0,
        limit: 100
    }, (document) => {
        document.getElementById('historyOrderQuery').value = 'abc';
    });

    invalid.__test.document.getElementById('searchHistory').dispatchEvent({ type: 'click' });
    assert.equal(
        invalid.__test.document.getElementById('historyStatus').innerText,
        'Введите полный номер заказа или первые 4 цифры до дефиса'
    );
});

test('history page reset clears current lookup without backend request', () => {
    const context = loadHistoryContext(undefined, (document) => {
        document.getElementById('historyOrderQuery').value = '1001';
    });
    const document = context.__test.document;

    document.getElementById('resetHistorySearch').dispatchEvent({
        type: 'click',
        target: document.getElementById('resetHistorySearch')
    });

    assert.equal(document.getElementById('historyOrderQuery').value, '');
    assert.equal(getMessagesByType(context, 'GET_ORDER_LOOKUP').length, 0);
    assert.equal(getMessagesByType(context, 'GET_CONFIG').length, 1);
    assert.equal(document.getElementById('historyStatus').innerText, 'Введите номер заказа для поиска');
    assert.equal(document.getElementById('historyList').innerHTML, '');
});

test('orders page renders and manages watched orders', () => {
    const context = loadHistoryContext();
    const document = context.__test.document;

    assert.match(document.getElementById('ordersWatchedList').innerHTML, /1001-300326/);

    document.getElementById('ordersWatchedOrderInput').value = '2222-110626';
    document.getElementById('ordersAddWatchedOrder').dispatchEvent({
        type: 'click',
        target: document.getElementById('ordersAddWatchedOrder')
    });

    const updateMessages = getMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(updateMessages[0].userConfig.watchedOrders.items.map(item => item.id))), [
        '1001-300326',
        '2222-110626'
    ]);
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /2222-110626/);
});

test('orders page toggles selected order watch state from summary', () => {
    const response = getDefaultOrderLookupResponse();
    response.order.isWatched = false;
    response.candidates[0].isWatched = false;

    const context = loadHistoryContext(response, (document) => {
        document.getElementById('historyOrderQuery').value = '1001';
    }, {
        watchedOrders: { items: [] }
    });
    const document = context.__test.document;

    document.getElementById('searchHistory').dispatchEvent({ type: 'click' });
    assert.match(document.getElementById('orderSummary').innerHTML, /Отслеживать/);

    const summaryButtonTarget = {
        dataset: {
            watchAction: 'add',
            orderId: '1001-300326'
        }
    };

    document.getElementById('orderSummary').dispatchEvent({ type: 'click', target: summaryButtonTarget });

    const updateMessages = getMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.equal(updateMessages[0].userConfig.watchedOrders.items[0].id, '1001-300326');
});

test('history page shows order lookup load failure', () => {
    const context = loadHistoryContext({
        ok: false,
        error: 'failed'
    }, (document) => {
        document.getElementById('historyOrderQuery').value = '1001';
    });
    const document = context.__test.document;

    document.getElementById('searchHistory').dispatchEvent({ type: 'click' });

    assert.equal(document.getElementById('historyStatus').innerText, 'Не удалось загрузить изменения по заказу');
    assert.equal(document.getElementById('historyList').innerHTML, '');
});
