const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDocumentStub } = require('./helpers/content-dom-stub');

function loadContentContext(documentStub) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'content.js'),
        'utf8'
    );

    const context = {
        URL,
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        chrome: {
            runtime: {
                lastError: null,
                sendMessage: (_payload, callback) => {
                    if (typeof callback === 'function') {
                        callback({ isWorker: false, isRunning: false });
                    }
                }
            }
        },
        document: documentStub,
        window: {
            location: {
                origin: 'https://amperkot.ru'
            }
        },
        location: {
            reload: () => {}
        },
        setTimeout: () => 0,
        clearTimeout: () => {},
        setInterval: () => 0,
        clearInterval: () => {}
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
        payment: [{ id: '9791', label: 'Наличными в офисе' }]
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
