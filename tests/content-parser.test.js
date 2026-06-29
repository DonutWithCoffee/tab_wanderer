const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDocumentStub } = require('./helpers/content-dom-stub');

function loadContentContext(documentStub, overrides = {}) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'content.js'),
        'utf8'
    );

    const runtime = overrides.runtime || {
        lastError: null,
        sendMessage: (_payload, callback) => {
            if (typeof callback === 'function') {
                callback({ isWorker: false, isRunning: false });
            }
        }
    };

    const context = {
        URL,
        console: overrides.console || {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        chrome: {
            runtime
        },
        document: documentStub,
        window: {
            location: overrides.windowLocation || {
                origin: 'https://amperkot.ru',
                href: 'https://amperkot.ru/admin/orders/1000-300326/'
            }
        },
        location: {
            reload: overrides.reload || (() => {})
        },
        setTimeout: overrides.setTimeout || (() => 0),
        clearTimeout: overrides.clearTimeout || (() => {}),
        setInterval: overrides.setInterval || (() => 0),
        clearInterval: overrides.clearInterval || (() => {})
    };

    context.globalThis = context;

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'content.js' });

    return context;
}

test('getColumnMap finds required order columns', () => {
    const context = loadContentContext(
        createDocumentStub({
            headers: [
                '№',
                'Дата',
                'Телефон',
                'Товаров',
                'Сумма',
                'Статус',
                'Менеджер',
                'Город',
                'Доставка',
                'Оплата',
                'Контрагент'
            ]
        })
    );

    const map = context.getColumnMap();

    assert.deepEqual(JSON.parse(JSON.stringify(map)), {
        date: 1,
        phone: 2,
        products: 3,
        totalAmount: 4,
        status: 5,
        manager: 6,
        city: 7,
        delivery: 8,
        payment: 9,
        contractor: 10
    });
});

test('extractPrimaryDate keeps only first line', () => {
    const context = loadContentContext(
        createDocumentStub({
            headers: []
        })
    );

    const value = context.extractPrimaryDate('30 мар. 2026 10:00\nобновлено 10:15');

    assert.equal(value, '30 мар. 2026 10:00');
});

test('extractPrimaryDateFromCell prefers normalized order date link text', () => {
    const context = loadContentContext(
        createDocumentStub({
            headers: []
        })
    );

    const value = context.extractPrimaryDateFromCell({
        innerText: '31 мая\n2026 09:36\nОтгр.:\n31 мая, 11:00\n00420706-0111-1',
        querySelector(selector) {
            if (selector !== 'a[href*="/admin/orders/"]') return null;

            return {
                innerText: '31 мая\n2026 09:36'
            };
        }
    });

    assert.equal(value, '31 мая 2026 09:36');
});

test('parseOrders extracts normalized order payload from table', () => {
    const context = loadContentContext(
        createDocumentStub({
            headers: [
                '№',
                'Дата',
                'Телефон',
                'Товаров',
                'Сумма',
                'Статус',
                'Менеджер',
                'Город',
                'Доставка',
                'Оплата',
                'Контрагент'
            ],
            rows: [
                {
                    internalId: '1000',
                    displayId: '1000-300326',
                    href: '/admin/orders/1000-300326/',
                    cells: [
                        '1000-300326',
                        {
                            innerText: '30 мар.\n2026 10:00\nобновлено 10:15',
                            orderDateText: '30 мар.\n2026 10:00'
                        },
                        '+7 (921) 324-15-66',
                        '0 / 10',
                        '12 350',
                        'Новый',
                        'Иванов',
                        'Москва',
                        'Пункт самовывоза СДЭК',
                        'Оплата онлайн',
                        'ООО "Ромашка"'
                    ]
                }
            ]
        })
    );

    const orders = context.parseOrders();

    assert.deepEqual(JSON.parse(JSON.stringify(orders)), [
        {
            id: '1000-300326',
            internalId: '1000',
            status: 'Новый',
            delivery: 'Пункт самовывоза СДЭК',
            payment: 'Оплата онлайн',
            date: '30 мар. 2026 10:00',
            phoneNormalized: '79213241566',
            totalAmount: 12350,
            productsDone: 0,
            productsTotal: 10,
            manager: 'Иванов',
            city: 'Москва',
            contractor: 'ООО "Ромашка"',
            orderUrl: 'https://amperkot.ru/admin/orders/1000-300326/',
            hasAutoreserve: false,
            tags: []
        }
    ]);
});

test('parseOrders keeps date tags out of primary date', () => {
    const context = loadContentContext(
        createDocumentStub({
            headers: [
                '№',
                'Дата',
                'Телефон',
                'Товаров',
                'Сумма',
                'Статус',
                'Менеджер',
                'Город',
                'Доставка',
                'Оплата',
                'Контрагент'
            ],
            rows: [
                {
                    internalId: '3000',
                    displayId: '3000-300326',
                    href: '/admin/orders/3000-300326/',
                    tags: ['00420706-0111-1'],
                    cells: [
                        '3000-300326',
                        {
                            innerText: '31 мая\n2026 09:36\nОтгр.:\n31 мая, 11:00\n(30 минут назад)\n00420706-0111-1',
                            orderDateText: '31 мая\n2026 09:36'
                        },
                        '8 921 324 15 66',
                        '10 / 10',
                        '350',
                        'Доставляется',
                        '',
                        'Санкт-Петербург',
                        '-',
                        '-',
                        'OZON (ОЗОН)'
                    ]
                }
            ]
        })
    );

    const order = context.parseOrders()[0];

    assert.equal(order.date, '31 мая 2026 09:36');
    assert.equal(order.phoneNormalized, '79213241566');
    assert.equal(order.totalAmount, 350);
    assert.equal(order.productsDone, 10);
    assert.equal(order.productsTotal, 10);
    assert.equal(order.city, 'Санкт-Петербург');
    assert.deepEqual(JSON.parse(JSON.stringify(order.tags)), ['00420706-0111-1']);
    assert.equal(Object.prototype.hasOwnProperty.call(order, 'shipmentDateText'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(order, 'hasOrderFlag'), false);
});

test('parseOrders returns null when required columns are missing', () => {
    const context = loadContentContext(
        createDocumentStub({
            headers: ['№', 'Дата'],
            rows: []
        })
    );

    const orders = context.parseOrders();

    assert.equal(orders, null);
});

test('parseDictionaries extracts monitor dictionaries from checkbox groups', () => {
    const documentStub = {
        querySelectorAll(selector) {
            const groups = {
                'input[type="checkbox"][name="status[]"]': [
                    {
                        value: '6806',
                        closest(target) {
                            if (target !== 'label') return null;

                            return {
                                querySelector(innerSelector) {
                                    if (innerSelector === '.form-check-label') {
                                        return {
                                            innerText: 'Ожидает оплаты'
                                        };
                                    }

                                    return null;
                                },
                                innerText: 'Ожидает оплаты'
                            };
                        }
                    }
                ],
                'input[type="checkbox"][name="delivery[]"]': [
                    {
                        value: '9797',
                        closest(target) {
                            if (target !== 'label') return null;

                            return {
                                querySelector(innerSelector) {
                                    if (innerSelector === '.form-check-label') {
                                        return {
                                            innerText: 'Самовывоз'
                                        };
                                    }

                                    return null;
                                },
                                innerText: 'Самовывоз'
                            };
                        }
                    }
                ],
                'input[type="checkbox"][name="payment[]"]': [
                    {
                        value: '9791',
                        closest(target) {
                            if (target !== 'label') return null;

                            return {
                                querySelector(innerSelector) {
                                    if (innerSelector === '.form-check-label') {
                                        return {
                                            innerText: 'Наличными в офисе'
                                        };
                                    }

                                    return null;
                                },
                                innerText: 'Наличными в офисе'
                            };
                        }
                    }
                ],
                'input[type="checkbox"][name="flag[]"]': [
                    {
                        value: '1',
                        closest(target) {
                            if (target !== 'label') return null;

                            return {
                                querySelector() {
                                    return null;
                                },
                                innerText: 'Срочный'
                            };
                        }
                    }
                ],
                'input[type="checkbox"][name="store[]"]': [
                    {
                        value: '4',
                        closest(target) {
                            if (target !== 'label') return null;

                            return {
                                querySelector() {
                                    return null;
                                },
                                innerText: 'Основной склад'
                            };
                        }
                    }
                ],
                'input[type="checkbox"][name="reserve[]"]': [
                    {
                        value: '1',
                        closest(target) {
                            if (target !== 'label') return null;

                            return {
                                querySelector() {
                                    return null;
                                },
                                innerText: 'В резерве'
                            };
                        }
                    }
                ],
                'input[type="checkbox"][name="assembly_status[]"]': [
                    {
                        value: 'yes',
                        closest(target) {
                            if (target !== 'label') return null;

                            return {
                                querySelector() {
                                    return null;
                                },
                                innerText: 'Скомплектован'
                            };
                        }
                    }
                ]
            };

            return groups[selector] || [];
        }
    };

    const context = loadContentContext(documentStub);
    const dictionaries = context.parseDictionaries();

    assert.deepEqual(JSON.parse(JSON.stringify(dictionaries)), {
        status: [{ id: '6806', label: 'Ожидает оплаты' }],
        delivery: [{ id: '9797', label: 'Самовывоз' }],
        payment: [{ id: '9791', label: 'Наличными в офисе' }],
        orderFlags: [{ id: '1', label: 'Срочный' }],
        store: [{ id: '4', label: 'Основной склад' }],
        reserve: [{ id: '1', label: 'В резерве' }],
        assemblyStatus: [{ id: 'yes', label: 'Скомплектован' }]
    });
});
test('parsePaginationState detects whether next page exists', () => {
    const context = loadContentContext(
        createDocumentStub({
            headers: [],
            paginationHrefs: [
                '/admin/orders/?page=1',
                '/admin/orders/?page=2',
                '/admin/orders/?page=3'
            ]
        })
    );

    const pageTwo = context.parsePaginationState(2);
    const pageThree = context.parsePaginationState(3);

    assert.equal(pageTwo.currentPage, 2);
    assert.equal(pageTwo.hasPagination, true);
    assert.equal(pageTwo.maxPage, 3);
    assert.equal(pageTwo.hasNextPage, true);
    assert.equal(pageTwo.isLastPage, false);

    assert.equal(pageThree.currentPage, 3);
    assert.equal(pageThree.hasPagination, true);
    assert.equal(pageThree.maxPage, 3);
    assert.equal(pageThree.hasNextPage, false);
    assert.equal(pageThree.isLastPage, true);
});

test('getOrdersCompletionMeta completes empty first page and pagination last page', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.getOrdersCompletionMeta([], {
            currentPage: 1,
            hasPagination: false,
            hasNextPage: false
        }))),
        {
            isComplete: true,
            completionReason: 'empty-first-page'
        }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.getOrdersCompletionMeta([{ id: '1' }], {
            currentPage: 3,
            hasPagination: true,
            hasNextPage: false
        }))),
        {
            isComplete: true,
            completionReason: 'pagination-last-page'
        }
    );

    assert.deepEqual(
        JSON.parse(JSON.stringify(context.getOrdersCompletionMeta([{ id: '1' }], {
            currentPage: 2,
            hasPagination: true,
            hasNextPage: true
        }))),
        {
            isComplete: false,
            completionReason: null
        }
    );
});

test('parseOrderDetails extracts watched order payload from order page text', () => {
    const context = loadContentContext(
        createDocumentStub({
            bodyText: [
                'Заказ 1000-300326',
                'Статус заказа',
                'Комплектуется',
                'Доставка: Самовывоз',
                'Оплата: Наличными в офисе',
                'Дата заказа: 11 июн. 2026 12:00',
                'Телефон: +7 (921) 324-15-66',
                'Сумма заказа: 12 350',
                'Товаров: 3 / 5',
                'Менеджер: Иванов',
                'Город: Санкт-Петербург',
                'Контрагент: ООО Ромашка'
            ].join('\n'),
            tags: ['Юрик'],
            hasLock: true
        })
    );

    const order = context.parseOrderDetails('1000-300326');

    assert.deepEqual(JSON.parse(JSON.stringify(order)), {
        id: '1000-300326',
        internalId: '1000-300326',
        status: 'Комплектуется',
        delivery: 'Самовывоз',
        payment: 'Наличными в офисе',
        date: '11 июн. 2026 12:00',
        phoneNormalized: '79213241566',
        totalAmount: 12350,
        productsDone: 3,
        productsTotal: 5,
        manager: 'Иванов',
        city: 'Санкт-Петербург',
        contractor: 'ООО Ромашка',
        orderUrl: 'https://amperkot.ru/admin/orders/1000-300326/',
        hasAutoreserve: true,
        tags: ['Юрик']
    });
});

test('parseOrderDetails reads real admin order page layout without table total noise', () => {
    const context = loadContentContext(
        createDocumentStub({
            bodyText: [
                'Заказ №2579-290626',
                'Количество',
                'Сумма',
                'Доставка:',
                '400 руб.',
                'Итог:',
                '352 350 руб.',
                'Информация о заказе',
                'Статус',
                'Новый',
                'Время оформления',
                '29 июня 2026, 15:22',
                'Авторезерв',
                'Нет',
                'Ответственный менеджер',
                'Иванов',
                'Источник',
                'Основной сайт',
                'Теги',
                'предзаказ',
                'Действия',
                'Данные заказа',
                'Клиент',
                'ООО Тест',
                'Город',
                'Санкт-Петербург',
                'Телефон',
                '+7 967 968-88-89',
                'Email',
                'test@example.invalid',
                'Доставка',
                'Способ доставки',
                'Курьер',
                'Зарегистрировать',
                'Оплата',
                'Способ оплаты',
                'Безналичный расчет для юридических лиц',
                'Оплачено',
                '0 %'
            ].join('\n')
        })
    );

    const order = context.parseOrderDetails('2579-290626');

    assert.equal(order.status, 'Новый');
    assert.equal(order.delivery, 'Курьер');
    assert.equal(order.payment, 'Безналичный расчет для юридических лиц');
    assert.equal(order.date, '29 июня 2026, 15:22');
    assert.equal(order.phoneNormalized, '79679688889');
    assert.equal(order.totalAmount, 352350);
    assert.equal(order.city, 'Санкт-Петербург');
    assert.equal(order.contractor, 'ООО Тест');
    assert.deepEqual(JSON.parse(JSON.stringify(order.tags)), ['предзаказ']);
});


test('content runtime messaging ignores extension context invalidated throws', () => {
    let sendCalls = 0;
    let timeoutCalls = 0;

    const runtime = {
        lastError: null,
        sendMessage: () => {
            sendCalls += 1;
            throw new Error('Extension context invalidated.');
        }
    };

    const context = loadContentContext(createDocumentStub({ headers: [] }), {
        runtime,
        setTimeout: () => {
            timeoutCalls += 1;
            return 0;
        }
    });

    assert.doesNotThrow(() => context.sendWithRetry({ type: 'ORDERS' }));
    assert.equal(sendCalls, 1);
    assert.equal(timeoutCalls, 0);
});

test('content runtime messaging does not retry invalidated lastError callbacks', () => {
    let sendCalls = 0;
    let timeoutCalls = 0;

    const runtime = {
        lastError: { message: 'Extension context invalidated.' },
        sendMessage: (_payload, callback) => {
            sendCalls += 1;
            if (typeof callback === 'function') {
                callback(null);
            }
        }
    };

    const context = loadContentContext(createDocumentStub({ headers: [] }), {
        runtime,
        setTimeout: () => {
            timeoutCalls += 1;
            return 0;
        }
    });

    assert.doesNotThrow(() => context.sendWithRetry({ type: 'ORDERS' }));
    assert.equal(sendCalls, 1);
    assert.equal(timeoutCalls, 0);
});
