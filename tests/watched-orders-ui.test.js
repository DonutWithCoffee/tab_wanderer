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

function createWatchedOrdersDom() {
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
        'ordersWatchedOrderNoteInput',
        'ordersAddWatchedOrder',
        'ordersWatchedStatus',
        'ordersWatchedList',
        'ordersWatchedOrderFollowUpIntervalSelect'
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

function loadWatchedOrdersContext(responseOverride, setupDocument, configOverride, runtimeOverride = {}) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'watched-orders.js'),
        'utf8'
    );

    const sentMessages = [];
    const document = createWatchedOrdersDom();
    const userConfig = configOverride || {
        watchedOrderFollowUpIntervalMinutes: 2,
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
                    note: 'Важный заказ',
                    lastSnapshot: {
                        status: 'Оплачен',
                        delivery: 'Самовывоз',
                        payment: 'Наличными в офисе',
                        contractor: 'ООО Ромашка'
                    }
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
        setTimeout: runtimeOverride.immediateTimers ? ((callback) => callback()) : undefined,
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

                    if (message.type === 'GET_MONITOR_STATUS') {
                        response = {
                            ok: true,
                            status: JSON.parse(JSON.stringify(runtimeOverride.monitorStatus || {}))
                        };
                    }

                    if (message.type === 'ADD_WATCHED_ORDER') {
                        if (runtimeOverride.addWatchedOrderResponse) {
                            response = JSON.parse(JSON.stringify(runtimeOverride.addWatchedOrderResponse));
                        } else {
                            userConfig.watchedOrders = userConfig.watchedOrders || { items: [] };
                            userConfig.watchedOrders.items.push({
                                id: String(message.orderId || '').trim(),
                                status: 'active',
                                note: String(message.note || '').trim(),
                                addedAt: 1700000000000,
                                lastCheckedAt: 1700000001000,
                                lastBaselineAt: 1700000001000,
                                lastEventAt: null,
                                lastError: null
                            });
                            response = { ok: true, added: true, validated: true, userConfig: JSON.parse(JSON.stringify(userConfig)) };
                        }
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
    vm.runInContext(source, context, { filename: 'watched-orders.js' });

    document.dispatchEvent({ type: 'DOMContentLoaded' });

    return context;
}

function readWatchedOrdersHtml() {
    return fs.readFileSync(
        path.join(__dirname, '..', 'watched-orders.html'),
        'utf8'
    );
}

function getMessagesByType(context, type) {
    return context.__test.sentMessages.filter((message) => message.type === type);
}

test('orders page exposes watched orders and hides user-facing order lookup', () => {
    const html = readWatchedOrdersHtml();

    assert.match(html, /Отслеживаемые заказы/);
    assert.match(html, /id="ordersWatchedOrderInput" name="ordersWatchedOrderInput"/);
    assert.match(html, /id="ordersWatchedOrderNoteInput" name="ordersWatchedOrderNoteInput"/);
    assert.match(html, /id="ordersWatchedList"/);
    assert.match(html, /id="ordersWatchedOrderFollowUpIntervalSelect" name="ordersWatchedOrderFollowUpIntervalSelect" autocomplete="off"/);
    assert.match(html, /При включённом мониторинге расширение открывает карточки этих заказов отдельно/);
    assert.match(html, /одно напоминание/);
    assert.match(html, /За один раз проверяется один заказ/);
    assert.match(html, /Проверить и добавить/);
    assert.match(html, /Сначала проверим заказ в админке/);
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
    const context = loadWatchedOrdersContext();
    const document = context.__test.document;

    assert.equal(getMessagesByType(context, 'GET_ORDER_LOOKUP').length, 0);
    assert.equal(getMessagesByType(context, 'GET_CONFIG').length, 1);
    assert.equal(document.getElementById('historyStatus').innerText, 'Введите номер заказа для поиска');
    assert.equal(document.getElementById('historyList').innerHTML, '');
});

test('hidden order lookup requests order data and renders selected order changes', () => {
    const context = loadWatchedOrdersContext(undefined, (document) => {
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
    const context = loadWatchedOrdersContext({
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
    const notFound = loadWatchedOrdersContext({
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

    const invalid = loadWatchedOrdersContext({
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
    const context = loadWatchedOrdersContext(undefined, (document) => {
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
    const context = loadWatchedOrdersContext();
    const document = context.__test.document;

    assert.match(document.getElementById('ordersWatchedList').innerHTML, /1001-300326/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /watched-order-facts/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Оплачен/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Самовывоз/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Наличными в офисе/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /ООО Ромашка/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /watched-order-technical-details/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /watched-order-meta-grid/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Важный заказ/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Открыть в админке/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /name="ordersWatchedOrderNote_1001_300326"/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /autocomplete="off"/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /https:\/\/amperkot\.ru\/admin\/orders\/1001-300326\//);
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /Сохранено: 1; проверка включена: 1/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /проверка включена/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Отключить проверку/);
    assert.equal(document.getElementById('ordersWatchedOrderFollowUpIntervalSelect').value, '2');

    document.getElementById('ordersWatchedOrderInput').value = '2222-110626';
    document.getElementById('ordersWatchedOrderNoteInput').value = 'Связаться с клиентом';
    document.getElementById('ordersAddWatchedOrder').dispatchEvent({
        type: 'click',
        target: document.getElementById('ordersAddWatchedOrder')
    });

    const addMessages = getMessagesByType(context, 'ADD_WATCHED_ORDER');

    assert.equal(addMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(addMessages[0])), {
        type: 'ADD_WATCHED_ORDER',
        orderId: '2222-110626',
        note: 'Связаться с клиентом'
    });
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /2222-110626/);
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /проверен и добавлен/);
});



test('orders page keeps validating message for async watched order add', () => {
    const context = loadWatchedOrdersContext(null, null, {
        watchedOrderFollowUpIntervalMinutes: 2,
        watchedOrders: { items: [] }
    }, {
        addWatchedOrderResponse: {
            ok: true,
            accepted: true,
            validating: true,
            orderId: '3214-000000',
            userConfig: {
                watchedOrderFollowUpIntervalMinutes: 2,
                watchedOrders: { items: [] }
            }
        }
    });
    const document = context.__test.document;

    document.getElementById('ordersWatchedOrderInput').value = '3214-000000';
    document.getElementById('ordersAddWatchedOrder').dispatchEvent({
        type: 'click',
        target: document.getElementById('ordersAddWatchedOrder')
    });

    assert.equal(document.getElementById('ordersWatchedStatus').innerText, 'Проверяем заказ №3214-000000...');
    assert.equal(document.getElementById('ordersWatchedOrderInput').value, '3214-000000');
});



test('orders page shows rejected watched order result from first polling response', () => {
    const context = loadWatchedOrdersContext(null, null, {
        watchedOrderFollowUpIntervalMinutes: 2,
        watchedOrders: { items: [] }
    }, {
        immediateTimers: true,
        addWatchedOrderResponse: {
            ok: true,
            accepted: true,
            validating: true,
            orderId: '0000-000000',
            userConfig: {
                watchedOrderFollowUpIntervalMinutes: 2,
                watchedOrders: { items: [] }
            }
        },
        monitorStatus: {
            watchedOrderAddState: {
                pending: false,
                orderId: null,
                lastResult: {
                    ok: false,
                    orderId: '0000-000000',
                    error: 'direct order parse failed'
                }
            },
            directFollowUpState: {
                currentOrderId: null,
                lastError: 'direct order parse failed'
            }
        }
    });
    const document = context.__test.document;

    document.getElementById('ordersWatchedOrderInput').value = '0000-000000';
    document.getElementById('ordersAddWatchedOrder').dispatchEvent({
        type: 'click',
        target: document.getElementById('ordersAddWatchedOrder')
    });

    assert.match(document.getElementById('ordersWatchedStatus').innerText, /не найден/);
    assert.equal(document.getElementById('ordersWatchedOrderInput').value, '0000-000000');
});

test('orders page autosaves watched order follow-up interval', () => {
    const context = loadWatchedOrdersContext();
    const document = context.__test.document;
    const select = document.getElementById('ordersWatchedOrderFollowUpIntervalSelect');

    select.value = '15';
    select.dispatchEvent({ type: 'change', target: select });

    const updateMessages = getMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.equal(updateMessages[0].userConfig.watchedOrderFollowUpIntervalMinutes, 15);
    assert.equal(document.getElementById('ordersWatchedOrderFollowUpIntervalSelect').value, '15');
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /каждые 15 мин/);
});

test('orders page toggles selected order watch state from summary', () => {
    const response = getDefaultOrderLookupResponse();
    response.order.isWatched = false;
    response.candidates[0].isWatched = false;

    const context = loadWatchedOrdersContext(response, (document) => {
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

    const addMessages = getMessagesByType(context, 'ADD_WATCHED_ORDER');

    assert.equal(addMessages.length, 1);
    assert.equal(addMessages[0].orderId, '1001-300326');
});

test('hidden order lookup shows order lookup load failure', () => {
    const context = loadWatchedOrdersContext({
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





test('orders page toggles watched order follow-up without removing reminder data', () => {
    const context = loadWatchedOrdersContext(null, null, {
        watchedOrderFollowUpIntervalMinutes: 2,
        watchedOrders: {
            items: [
                {
                    id: '1001-300326',
                    status: 'active',
                    followUpEnabled: true,
                    note: 'Важный заказ',
                    addedAt: 1700000000000,
                    lastCheckedAt: 1700000060000,
                    lastBaselineAt: 1700000000000,
                    lastEventAt: 1700000060000,
                    lastError: null,
                    reminder: {
                        status: 'pending',
                        remindAt: 4102491600000,
                        note: 'Позвонить клиенту',
                        createdAt: 1700000000000,
                        updatedAt: 1700000000000
                    }
                }
            ]
        }
    });
    const document = context.__test.document;

    document.getElementById('ordersWatchedList').dispatchEvent({
        type: 'click',
        target: {
            dataset: {
                watchAction: 'toggle-follow-up',
                orderId: '1001-300326'
            }
        }
    });

    const updateMessages = getMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.equal(updateMessages[0].userConfig.watchedOrders.items[0].followUpEnabled, false);
    assert.equal(updateMessages[0].userConfig.watchedOrders.items[0].reminder.status, 'pending');
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /проверка выключена/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Включить проверку/);
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /Напоминания продолжают работать/);
});

test('orders page removes watched order from list', () => {
    const context = loadWatchedOrdersContext();
    const document = context.__test.document;

    assert.match(document.getElementById('ordersWatchedList').innerHTML, /1001-300326/);

    document.getElementById('ordersWatchedList').dispatchEvent({
        type: 'click',
        target: {
            dataset: {
                watchAction: 'remove',
                orderId: '1001-300326'
            }
        }
    });

    const updateMessages = getMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(updateMessages[0].userConfig.watchedOrders.items)), []);
    assert.doesNotMatch(document.getElementById('ordersWatchedList').innerHTML, /1001-300326/);
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /удалён/);
});

test('orders page saves watched order comment inline on enter', () => {
    const context = loadWatchedOrdersContext();
    const document = context.__test.document;
    const noteInput = document.registerElement('ordersWatchedOrderNote_1001_300326');

    noteInput.dataset = {
        watchAction: 'note-input',
        orderId: '1001-300326'
    };

    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Важный заказ/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /data-watch-action="edit-note"/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /data-watch-action="note-input"/);
    assert.match(document.getElementById('ordersWatchedList').innerHTML, /Изменить/);
    assert.doesNotMatch(document.getElementById('ordersWatchedList').innerHTML, /Нажмите на этот блок/);

    noteInput.value = '  Нужно проверить документы  ';

    document.getElementById('ordersWatchedList').dispatchEvent({
        type: 'keydown',
        key: 'Enter',
        preventDefault: () => {},
        target: noteInput
    });

    const updateMessages = getMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.equal(updateMessages[0].userConfig.watchedOrders.items[0].note, 'Нужно проверить документы');
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /Комментарий/);
});

test('orders page clears watched order comment inline on blur', () => {
    const context = loadWatchedOrdersContext();
    const document = context.__test.document;
    const noteInput = document.registerElement('ordersWatchedOrderNote_1001_300326');

    noteInput.dataset = {
        watchAction: 'note-input',
        orderId: '1001-300326'
    };
    noteInput.value = '';

    document.getElementById('ordersWatchedList').dispatchEvent({
        type: 'focusout',
        target: noteInput
    });

    const updateMessages = getMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateMessages.length, 1);
    assert.equal(updateMessages[0].userConfig.watchedOrders.items[0].note, '');
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /удалён/);
});

test('orders page starts inline note editing when clicking inside comment block', () => {
    const context = loadWatchedOrdersContext();
    const document = context.__test.document;
    const noteInput = document.registerElement('ordersWatchedOrderNote_1001_300326');
    const noteContainer = {
        edited: false,
        classList: {
            add(className) {
                if (className === 'is-editing') {
                    noteContainer.edited = true;
                }
            }
        }
    };
    let focused = false;
    let selected = false;

    noteInput.closest = (selector) => selector === '.watched-order-note' ? noteContainer : null;
    noteInput.focus = () => { focused = true; };
    noteInput.select = () => { selected = true; };

    document.getElementById('ordersWatchedList').dispatchEvent({
        type: 'click',
        target: {
            dataset: {},
            closest: (selector) => selector === '[data-watch-action]'
                ? {
                    dataset: {
                        watchAction: 'edit-note',
                        orderId: '1001-300326'
                    }
                }
                : null
        }
    });

    assert.equal(noteContainer.edited, true);
    assert.equal(focused, true);
    assert.equal(selected, true);
});

test('orders page sets and clears watched order reminder through runtime API', () => {
    const context = loadWatchedOrdersContext();
    const document = context.__test.document;
    const remindAtInput = document.registerElement('ordersReminderAt_1001_300326');
    const noteInput = document.registerElement('ordersReminderNote_1001_300326');

    assert.match(document.getElementById('ordersWatchedList').innerHTML, /<summary>Поставить напоминание<\/summary>/);

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
    const context = loadWatchedOrdersContext(undefined, null, {
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
    assert.match(document.getElementById('ordersWatchedStatus').innerText, /уже есть напоминание/);
});
