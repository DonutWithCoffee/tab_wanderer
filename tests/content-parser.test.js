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
            },
            ...(overrides.window || {})
        },
        location: {
            reload: overrides.reload || (() => {})
        },
        setTimeout: overrides.setTimeout || (() => 0),
        clearTimeout: overrides.clearTimeout || (() => {}),
        setInterval: overrides.setInterval || (() => 0),
        clearInterval: overrides.clearInterval || (() => {}),
        CustomEvent: overrides.CustomEvent || class {
            constructor(type, options = {}) {
                this.type = type;
                this.detail = options.detail;
            }
        }
    };

    context.globalThis = context;

    const warehouseExtractorSource = fs.readFileSync(
        path.join(__dirname, '..', 'core', 'warehouse-barcode-extractor.js'),
        'utf8'
    );

    vm.createContext(context);
    vm.runInContext(warehouseExtractorSource, context, { filename: 'core/warehouse-barcode-extractor.js' });
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

test('parseOrderDetails strips dynamic local time from order city', () => {
    const context = loadContentContext(
        createDocumentStub({
            bodyText: [
                'Информация о заказе',
                'Статус',
                'Новый',
                'Данные заказа',
                'Город',
                'Мытищи, Московская обл. (местное время: 12:26)',
                'Телефон',
                '+7 921 324-15-66',
                'Доставка',
                'Способ доставки',
                'Курьер',
                'Оплата',
                'Способ оплаты',
                'Оплата онлайн'
            ].join('\n')
        })
    );

    const order = context.parseOrderDetails('3010-010726');

    assert.equal(order.city, 'Мытищи, Московская обл.');
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


test('isWarehouseAssemblyPageUrl detects warehouse assembly route only', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));

    assert.equal(
        context.isWarehouseAssemblyPageUrl('https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/assembly/4336?order=9205-010726'),
        true
    );
    assert.equal(
        context.isWarehouseAssemblyPageUrl('https://amperkot.ru/admin/orders/?page=1'),
        false
    );
    assert.equal(
        context.isWarehouseAssemblyPageUrl('https://example.invalid/web-apps/wh3/#/wh/shop-orders/assembly/4336'),
        false
    );
});

test('sanitizeWarehouseShopOrderForBarcodeBridge keeps only safe barcode fields', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));
    const sanitized = context.sanitizeWarehouseShopOrderForBarcodeBridge({
        id: 4336,
        number: '9205-010726',
        total_quantity: 16,
        assembled_quantity: 16,
        ignoredHeavyField: { secret: 'not copied' },
        items: [
            {
                id: 1,
                item_id: 23870634,
                title: 'Матовый LED RGB светодиод',
                quantity: 15,
                assembled_quantity: 15,
                ignored: true
            }
        ],
        assembly: [
            {
                id: 10,
                quantity: 15,
                product_item: {
                    id: 20,
                    barcode: '2049684',
                    type: 1,
                    quantity: 157,
                    reserved_quantity: 15,
                    product_id: 23870634,
                    product: {
                        id: 23870634,
                        title: 'Матовый LED RGB светодиод',
                        ignoredPhoto: 'large blob'
                    },
                    state: { title: 'На складе', ignored: true }
                },
                order_item: { id: 1 }
            }
        ]
    });

    assert.deepEqual(JSON.parse(JSON.stringify(sanitized)), {
        id: '9205-010726',
        internalId: '4336',
        number: '9205-010726',
        total_quantity: 16,
        assembled_quantity: 16,
        items: [
            {
                id: '1',
                item_id: '23870634',
                title: 'Матовый LED RGB светодиод',
                quantity: 15,
                assembled_quantity: 15,
                assemble_status: ''
            }
        ],
        assembly: [
            {
                id: '10',
                quantity: 15,
                product_item: {
                    id: '20',
                    barcode: '2049684',
                    type: 1,
                    quantity: 157,
                    reserved_quantity: 15,
                    product_id: '23870634',
                    product: {
                        id: '23870634',
                        title: 'Матовый LED RGB светодиод'
                    },
                    state: { title: 'На складе' }
                },
                order_item: {
                    id: '1',
                    item_id: '',
                    title: ''
                }
            }
        ]
    });
});

test('createWarehouseBarcodePreviewFromShopOrder extracts eligible and skipped barcode summary', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));
    const preview = context.createWarehouseBarcodePreviewFromShopOrder({
        id: '9205-010726',
        items: [],
        assembly: [
            {
                id: 1,
                quantity: 1,
                product_item: {
                    id: 101,
                    barcode: '2317613',
                    type: 0,
                    quantity: 0,
                    reserved_quantity: 1,
                    product_id: 24126456,
                    product: { id: 24126456, title: 'DC-DC MT3608' }
                }
            },
            {
                id: 2,
                quantity: 15,
                product_item: {
                    id: 102,
                    barcode: '2049684',
                    type: 1,
                    quantity: 157,
                    reserved_quantity: 15,
                    product_id: 23870634,
                    product: { id: 23870634, title: 'LED RGB' }
                }
            }
        ]
    });

    assert.equal(preview.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(preview.summary)), {
        productCount: 2,
        eligibleCount: 1,
        skippedCount: 1
    });
    assert.equal(preview.extraction.eligibleBarcodes[0].barcode, '2317613');
    assert.equal(preview.extraction.skippedBarcodes[0].reason, 'multiBarcodeType');
});

test('handleWarehouseShopOrderBridgeResponse stores preview and reports missing shopOrder', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));

    const failed = context.handleWarehouseShopOrderBridgeResponse({
        detail: {
            ok: false,
            error: 'warehouse shopOrder not found'
        }
    });

    assert.equal(failed.ok, false);
    assert.equal(context.getLastWarehouseBarcodePreview().error, 'warehouse shopOrder not found');

    const ok = context.handleWarehouseShopOrderBridgeResponse({
        detail: {
            ok: true,
            shopOrder: {
                id: '9205-010726',
                assembly: [
                    {
                        quantity: 1,
                        product_item: {
                            barcode: '2317613',
                            type: 0,
                            reserved_quantity: 1,
                            product_id: '24126456',
                            product: { title: 'DC-DC MT3608' }
                        }
                    }
                ]
            }
        }
    });

    assert.equal(ok.ok, true);
    assert.equal(context.getLastWarehouseBarcodePreview().summary.eligibleCount, 1);
});

test('handleWarehouseShopOrderBridgeResponse retries initial empty warehouse snapshots until barcodes appear', () => {
    const timers = [];
    const context = loadContentContext(createDocumentStub({ headers: [] }), {
        setTimeout: (callback) => {
            timers.push(callback);
            return timers.length;
        },
        clearTimeout: () => {}
    });
    context.window.location.href = 'https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/assembly/4336?order=9205-010726';

    const result = context.handleWarehouseShopOrderBridgeResponse({
        detail: {
            ok: true,
            source: 'angular-snapshot',
            shopOrder: {
                id: '9205-010726',
                assembly: []
            }
        }
    });

    assert.equal(result.ok, null);
    assert.match(result.message, /Ждём данные сборки на странице склада/);
    assert.equal(timers.length, 1);
    assert.equal(context.getLastWarehouseBarcodePreview().ok, null);
});

test('handleWarehouseShopOrderBridgeResponse keeps after-assembly empty snapshot flow unchanged', () => {
    const timers = [];
    const documentStub = {
        ...createDocumentStub({ headers: [] }),
        getElementById: (id) => id === 'tab-wanderer-warehouse-barcode-bridge'
            ? { dataset: { installed: 'true' } }
            : null
    };
    const context = loadContentContext(documentStub, {
        window: {
            dispatchEvent: () => {}
        },
        setTimeout: (callback) => {
            timers.push(callback);
            return timers.length;
        },
        clearTimeout: () => {}
    });
    context.window.location.href = 'https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/assembly/4336?order=9205-010726';

    context.requestWarehouseShopOrderSnapshot({ resetAttempts: false, reason: 'assembly-action' });
    const result = context.handleWarehouseShopOrderBridgeResponse({
        detail: {
            ok: true,
            source: 'warehouse-api-response-empty',
            shopOrder: {
                id: '9205-010726',
                assembly: []
            }
        }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.summary)), {
        productCount: 0,
        eligibleCount: 0,
        skippedCount: 0
    });
    assert.equal(timers.length, 0);
});

test('createWarehouseBarcodePreviewViewModel builds compact warehouse barcode preview', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));
    const viewModel = context.createWarehouseBarcodePreviewViewModel({
        ok: true,
        shopOrder: { id: '9205-010726' },
        summary: {
            productCount: 2,
            eligibleCount: 3,
            skippedCount: 1
        },
        extraction: {
            orderId: '9205-010726',
            summary: {
                productCount: 2,
                eligibleCount: 3,
                skippedCount: 1
            },
            productsById: {
                24126456: {
                    productId: '24126456',
                    productTitle: 'DC-DC MT3608',
                    eligibleBarcodes: [{ barcode: '2317613' }, { barcode: '2317680' }],
                    skippedBarcodes: []
                },
                23870634: {
                    productId: '23870634',
                    productTitle: 'LED RGB',
                    eligibleBarcodes: [],
                    skippedBarcodes: [{ barcode: '2049684', reason: 'multiBarcodeType' }]
                }
            }
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(viewModel)), {
        title: 'tab_wanderer · Ozon barcodes',
        actionLabel: 'Добавить в Ozon',
        actions: [
            { id: 'ozon-ui-apply', label: 'Добавить в Ozon', variant: 'primary', disabled: false },
            { id: 'ozon-resolve', label: 'Проверить штрихкоды', variant: 'secondary', disabled: false }
        ],
        status: 'ready',
        message: 'Локальный предпросмотр. Записи в Ozon пока нет.',
        metrics: [
            { label: 'Заказ', value: '9205-010726' },
            { label: 'Товаров', value: '2' },
            { label: 'Кандидатов', value: '3' },
            { label: 'Пропущено мультишк', value: '1' }
        ],
        products: [
            {
                productId: '23870634',
                productTitle: 'LED RGB',
                eligibleCount: 0,
                skippedCount: 1,
                ozonStatus: '',
                ozonReason: '',
                ozonSku: '',
                ozonToAddCount: 0,
                ozonAlreadyExistsCount: 0,
                ozonExistingCount: 0,
                ozonApplyStatus: '',
                ozonApplyError: '',
                ozonApplyAddedCount: 0
            },
            {
                productId: '24126456',
                productTitle: 'DC-DC MT3608',
                eligibleCount: 2,
                skippedCount: 0,
                ozonStatus: '',
                ozonReason: '',
                ozonSku: '',
                ozonToAddCount: 0,
                ozonAlreadyExistsCount: 0,
                ozonExistingCount: 0,
                ozonApplyStatus: '',
                ozonApplyError: '',
                ozonApplyAddedCount: 0
            }
        ],
        ozon: null,
        ozonApply: null
    });
});


test('createWarehouseBarcodePreviewViewModel includes Ozon resolve summary after preview result', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));

    context.handleWarehouseRuntimeMessage({
        type: 'OZON_RESOLVE_PREVIEW_RESULT',
        ok: true,
        plan: {
            summary: {
                toAddCount: 1,
                alreadyExistsCount: 2
            },
            productPlans: [
                {
                    status: 'ready',
                    productId: '24126456',
                    ozonSku: '1675596792',
                    existingBarcodes: ['2317000', '2317613'],
                    toAdd: [{ barcode: '2317680' }],
                    alreadyExists: [{ barcode: '2317613' }],
                    skippedWarehouseBarcodes: []
                }
            ]
        }
    }, null, () => {});

    const viewModel = context.createWarehouseBarcodePreviewViewModel({
        ok: true,
        shopOrder: { id: '9205-010726' },
        summary: {
            productCount: 1,
            eligibleCount: 2,
            skippedCount: 0
        },
        extraction: {
            orderId: '9205-010726',
            productsById: {
                24126456: {
                    productId: '24126456',
                    productTitle: 'DC-DC MT3608',
                    eligibleBarcodes: [{ barcode: '2317613' }, { barcode: '2317680' }],
                    skippedBarcodes: []
                }
            }
        }
    });

    assert.equal(viewModel.message, 'Ozon проверен. Записи пока нет.');
    assert.deepEqual(JSON.parse(JSON.stringify(viewModel.metrics.slice(-2))), [
        { label: 'Добавить', value: '1' },
        { label: 'Уже есть', value: '2' }
    ]);
    assert.equal(viewModel.products[0].ozonStatus, 'ready');
    assert.equal(viewModel.products[0].ozonToAddCount, 1);
    assert.equal(viewModel.products[0].ozonAlreadyExistsCount, 1);
});


test('createWarehouseBarcodePreviewViewModel includes Ozon UI apply result', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));

    context.handleWarehouseRuntimeMessage({
        type: 'OZON_UI_APPLY_RESULT',
        ok: true,
        productId: '24126456',
        addedCount: 2,
        barcodes: ['2317613', '2317680']
    }, null, () => {});

    const viewModel = context.createWarehouseBarcodePreviewViewModel({
        ok: true,
        shopOrder: { id: '9205-010726' },
        summary: {
            productCount: 1,
            eligibleCount: 2,
            skippedCount: 0
        },
        extraction: {
            orderId: '9205-010726',
            productsById: {
                24126456: {
                    productId: '24126456',
                    productTitle: 'DC-DC MT3608',
                    eligibleBarcodes: [{ barcode: '2317613' }, { barcode: '2317680' }],
                    skippedBarcodes: []
                }
            }
        }
    });

    assert.equal(viewModel.message, 'Ozon: добавлено 2.');
    assert.deepEqual(JSON.parse(JSON.stringify(viewModel.metrics.slice(-1))), [
        { label: 'Записано', value: '2' }
    ]);
    assert.equal(viewModel.products[0].ozonApplyStatus, 'ready');
    assert.equal(viewModel.products[0].ozonApplyAddedCount, 2);
});

test('Ozon apply product text hides fallback reason when final verification succeeds', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));

    context.handleWarehouseRuntimeMessage({
        type: 'OZON_UI_APPLY_RESULT',
        ok: true,
        productId: '24126456',
        addedCount: 2,
        verifiedCount: 2,
        missingBarcodes: [],
        barcodes: ['2317613', '2317680'],
        details: {
            writeMethod: 'api-ui-fallback',
            fallbackReason: 'api-verify-after-reload-failed',
            verify: {
                verifiedCount: 2,
                missingBarcodes: []
            }
        }
    }, null, () => {});

    const viewModel = context.createWarehouseBarcodePreviewViewModel({
        ok: true,
        shopOrder: { id: '9205-010726' },
        summary: {
            productCount: 1,
            eligibleCount: 2,
            skippedCount: 0
        },
        extraction: {
            orderId: '9205-010726',
            productsById: {
                24126456: {
                    productId: '24126456',
                    productTitle: 'DC-DC MT3608',
                    eligibleBarcodes: [{ barcode: '2317613' }, { barcode: '2317680' }],
                    skippedBarcodes: []
                }
            }
        }
    });
    const product = viewModel.products[0];
    const text = context.createWarehouseOzonApplyProductText(product);

    assert.equal(text, 'Ozon API + UI fallback: проверено 2/2');
    assert.equal(text.includes('api-verify-after-reload-failed'), false);
    assert.equal(viewModel.ozonApply.productResults[0].fallbackReason, 'api-verify-after-reload-failed');
});

test('Ozon apply product text keeps fallback reason when verification is incomplete', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));

    const text = context.createWarehouseOzonApplyProductText({
        eligibleCount: 2,
        ozonApplyStatus: 'ready',
        ozonApplyVerifiedCount: 1,
        ozonApplyMissingCount: 1,
        ozonApplyWriteMethod: 'API + UI fallback',
        ozonApplyFallbackReason: 'api-verify-after-reload-failed'
    });

    assert.equal(text, 'Ozon API + UI fallback: проверено 1/2, не найдено 1, fallback: api-verify-after-reload-failed');
});

test('Ozon apply view model reports API write with unconfirmed verify without false added zero error', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));

    context.handleWarehouseRuntimeMessage({
        type: 'OZON_UI_APPLY_RESULT',
        ok: true,
        productId: '42614044',
        addedCount: 3,
        verifiedCount: 0,
        missingBarcodes: ['1111111', '2222222', '3333333'],
        barcodes: ['1111111', '2222222', '3333333'],
        errorCount: 0,
        details: {
            writeMethod: 'api',
            verifyUnconfirmed: true,
            verify: {
                verifiedCount: 0,
                missingBarcodes: ['1111111', '2222222', '3333333']
            }
        }
    }, null, () => {});

    const viewModel = context.createWarehouseBarcodePreviewViewModel({
        ok: true,
        shopOrder: { id: '5561-010726' },
        summary: {
            productCount: 1,
            eligibleCount: 3,
            skippedCount: 0
        },
        extraction: {
            orderId: '5561-010726',
            productsById: {
                42614044: {
                    productId: '42614044',
                    productTitle: 'Плата разработчика Waveshare ESP32-P4-WIFI6',
                    eligibleBarcodes: [{ barcode: '1111111' }, { barcode: '2222222' }, { barcode: '3333333' }],
                    skippedBarcodes: []
                }
            }
        }
    });
    const product = viewModel.products[0];
    const productText = context.createWarehouseOzonApplyProductText(product);

    assert.equal(viewModel.message, 'Ozon: запись отправлена, проверка не подтвердила 0/3.');
    assert.equal(productText, 'Ozon API: запись отправлена, проверка не подтвердила 0/3');
    assert.equal(viewModel.ozonApply.errorCount, 0);
    assert.equal(viewModel.metrics.some(item => item.label === 'Ошибки Ozon'), false);
});

test('createWarehouseBarcodePreviewViewModel reports loading and error states', () => {
    const context = loadContentContext(createDocumentStub({ headers: [] }));

    const loading = context.createWarehouseBarcodePreviewViewModel(null);
    const failed = context.createWarehouseBarcodePreviewViewModel({
        ok: false,
        error: 'warehouse shopOrder not found'
    });

    assert.equal(loading.status, 'loading');
    assert.equal(loading.message, 'Ищем данные сборки на странице склада. Ozon не изменяем.');
    assert.equal(failed.status, 'error');
    assert.equal(failed.message, 'warehouse shopOrder not found');
});
