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
                eventCount: 3
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
            eventCount: 3
        },
        storedTotal: 3,
        total: 3,
        returned: 3,
        limit: 100,
        entries: [
            {
                id: 'event-3',
                createdAt: 1700000120000,
                orderId: '1001-300326',
                orderUrl: 'https://amperkot.ru/admin/orders/1001-300326/',
                eventType: 'order-changed',
                eventKind: 'direct-follow-up',
                syncReason: 'direct-follow-up',
                changedFields: ['delivery'],
                diff: [
                    {
                        field: 'delivery',
                        before: 'Самовывоз',
                        after: 'Курьер'
                    }
                ],
                notification: {
                    notify: false,
                    reason: 'direct follow-up notification suppressed'
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

                    if (message.type === 'SET_WATCHED_ORDER_REMINDER') {
                        const orderId = String(message.orderId || '').trim();
                        const item = userConfig.watchedOrders.items.find(candidate => candidate.id === orderId);

                        if (item) {
                            item.reminder = {
                                status: 'pending',
                                remindAt: Number(message.reminder?.remindAt),
                                note: String(message.reminder?.note || '').trim(),
                                createdAt: 1700001000000,
                                updatedAt: 1700001000000,
                                completedAt: null,
                                cancelledAt: null
                            };
                        }

                        response = {
                            ok: Boolean(item),
                            userConfig: JSON.parse(JSON.stringify(userConfig)),
                            item: item ? JSON.parse(JSON.stringify(item)) : null,
                            reminder: item?.reminder ? JSON.parse(JSON.stringify(item.reminder)) : null
                        };
                    }

                    if (message.type === 'CLEAR_WATCHED_ORDER_REMINDER') {
                        const orderId = String(message.orderId || '').trim();
                        const item = userConfig.watchedOrders.items.find(candidate => candidate.id === orderId);

                        if (item) {
                            item.reminder = null;
                        }

                        response = {
                            ok: Boolean(item),
                            userConfig: JSON.parse(JSON.stringify(userConfig)),
                            item: item ? JSON.parse(JSON.stringify(item)) : null,
                            reminder: null
                        };
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

test('orders page exposes watched orders and hides user-facing order lookup', () => {
    const html = readHistoryHtml();

    assert.match(html, /Отслеживаемые заказы/);
    assert.match(html, /id="ordersWatchedOrderInput"/);
    assert.match(html, /id="ordersWatchedList"/);
    assert.match(html, /Прямая проверка открывает конкретные карточки заказов/);
    assert.match(html, /одно активное напоминание/);
    assert.doesNotMatch(html, /Найти заказ/);
    assert.doesNotMatch(html, /id="historyOrderQuery"/);
    assert.doesNotMatch(html, /id="searchHistory"/);
    assert.doesNotMatch(html, /id="resetHistorySearch"/);
    assert.doesNotMatch(html, /id="historyCandidates"/);
    assert.doesNotMatch(html, /id="orderSummary"/);
    assert.doesNotMatch(html, /id="historyList"/);
    assert.doesNotMatch(html, /первым 4 цифрам|первые 4 цифры/);
    assert.doesNotMatch(html, /полная серверная история/);
    assert.doesNotMatch(html, /id="historyEventType"/);
    assert.doesNotMatch(html, /id="historyEventKind"/);
    assert.doesNotMatch(html, /id="historyChangedField"/);
    assert.doesNotMatch(html, /id="historyWatchedOnly"/);
});

test('hidden order lookup starts idle without loading broad event journal', () => {
    const context = loadHistoryContext();
    const document = context.__test.document;

    assert.equal(getMessagesByType(context, 'GET_ORDER_LOOKUP').length, 0);
    assert.equal(getMessagesByType(context, 'GET_CONFIG').length, 1);
    assert.equal(document.getElementById('historyStatus').innerText, 'Введите номер заказа для поиска');
    assert.equal(document.getElementById('historyList').innerHTML, '');
});

test('hidden order lookup requests order data and renders selected order changes', () => {
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

    assert.equal(document.getElementById('historyStatus').innerText, 'Заказ 1001-300326 найден · 3 события');
    assert.match(document.getElementById('orderSummary').innerHTML, /Заказ 1001-300326/);
    assert.match(document.getElementById('orderSummary').innerHTML, /Оплачен/);
    assert.match(document.getElementById('orderSummary').innerHTML, /ОЗОН/);
    assert.match(document.getElementById('orderSummary').innerHTML, /Это не полная серверная история заказа/);
    assert.match(document.getElementById('historyList').innerHTML, /Изменение заказа/);
    assert.match(document.getElementById('historyList').innerHTML, /Прямая проверка/);
    assert.match(document.getElementById('historyList').innerHTML, /Статус/);
    assert.match(document.getElementById('historyList').innerHTML, /Новый/);
    assert.match(document.getElementById('historyList').innerHTML, /Оплачен/);
    assert.match(document.getElementById('historyList').innerHTML, /Заказ впервые увиден/);
});

test('hidden order lookup renders multiple short-number candidates without showing global events', () => {
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

    assert.equal(document.getElementById('historyStatus').innerText, 'Найдено несколько заказов: 2. Выберите полный номер.');
    assert.match(document.getElementById('historyCandidates').innerHTML, /1001-300326/);
    assert.match(document.getElementById('historyCandidates').innerHTML, /1001-290326/);
    assert.equal(document.getElementById('orderSummary').innerHTML, '');
    assert.equal(document.getElementById('historyList').innerHTML, '');
});

test('hidden order lookup shows not-found and invalid states', () => {
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
        'Введите 4 цифры или полный номер заказа в формате 1234-110626'
    );
});

test('hidden order lookup reset clears current lookup without backend request', () => {
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
    assert.match(document.getElementById('orderSummary').innerHTML, /Включить прямую проверку/);

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

test('hidden order lookup shows order lookup load failure', () => {
    const context = loadHistoryContext({
        ok: false,
        error: 'failed'
    }, (document) => {
        document.getElementById('historyOrderQuery').value = '1001';
    });
    const document = context.__test.document;

    document.getElementById('searchHistory').dispatchEvent({ type: 'click' });

    assert.equal(document.getElementById('historyStatus').innerText, 'Не удалось загрузить данные по заказу');
    assert.equal(document.getElementById('historyList').innerHTML, '');
});


test('orders page sets and clears watched order reminder through runtime API', () => {
    const context = loadHistoryContext();
    const document = context.__test.document;
    const remindAtInput = document.registerElement('ordersReminderAt_1001_300326');
    const noteInput = document.registerElement('ordersReminderNote_1001_300326');

    remindAtInput.value = '2100-01-01T12:00';
    noteInput.value = 'Проверить оплату';

    document.getElementById('ordersWatchedList').dispatchEvent({
        type: 'click',
        target: {
            dataset: {
                watchAction: 'set-reminder',
                orderId: '1001-300326'
            }
        }
    });

    const setMessages = getMessagesByType(context, 'SET_WATCHED_ORDER_REMINDER');

    assert.equal(setMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(setMessages[0])), {
        type: 'SET_WATCHED_ORDER_REMINDER',
        orderId: '1001-300326',
        reminder: {
            remindAt: new Date('2100-01-01T12:00').getTime(),
            note: 'Проверить оплату'
        }
    });
    assert.equal(context.__test.userConfig.watchedOrders.items[0].reminder.status, 'pending');
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Напоминание/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Проверить оплату/);
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /сохранено/);

    document.getElementById('ordersWatchedList').dispatchEvent({
        type: 'click',
        target: {
            dataset: {
                watchAction: 'clear-reminder',
                orderId: '1001-300326'
            }
        }
    });

    const clearMessages = getMessagesByType(context, 'CLEAR_WATCHED_ORDER_REMINDER');

    assert.equal(clearMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(clearMessages[0])), {
        type: 'CLEAR_WATCHED_ORDER_REMINDER',
        orderId: '1001-300326'
    });
    assert.equal(context.__test.userConfig.watchedOrders.items[0].reminder, null);
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /удалено/);
});

test('orders page renders pending reminder and prevents duplicate reminder setup', () => {
    const context = loadHistoryContext(undefined, null, {
        watchedOrders: {
            items: [
                {
                    id: '1001-300326',
                    status: 'active',
                    addedAt: 1700000000000,
                    lastCheckedAt: 1700000060000,
                    lastBaselineAt: 1700000000000,
                    lastEventAt: 1700000060000,
                    lastError: null,
                    reminder: {
                        status: 'pending',
                        remindAt: 4102444800000,
                        note: 'Позвонить клиенту',
                        createdAt: 1700000000000,
                        updatedAt: 1700000000000,
                        completedAt: null,
                        cancelledAt: null
                    }
                }
            ]
        }
    });
    const document = context.__test.document;

    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Напоминание/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Позвонить клиенту/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Удалить напоминание/);
    assert.doesNotMatch(document.getElementById('ordersWatchedList').innerHTML, /data-watch-action="set-reminder"/);

    document.getElementById('ordersWatchedList').dispatchEvent({
        type: 'click',
        target: {
            dataset: {
                watchAction: 'set-reminder',
                orderId: '1001-300326'
            }
        }
    });

    assert.equal(getMessagesByType(context, 'SET_WATCHED_ORDER_REMINDER').length, 0);
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /уже есть активное напоминание/);
});
