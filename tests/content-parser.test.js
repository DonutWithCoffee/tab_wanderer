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
                'ID',
                'Статус',
                'Доставка',
                'Оплата',
                'Дата',
                'Контрагент'
            ]
        })
    );

    const map = context.getColumnMap();

    assert.deepEqual(JSON.parse(JSON.stringify(map)), {
        status: 1,
        delivery: 2,
        payment: 3,
        date: 4,
        contractor: 5
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

test('extractShipmentDate returns shipment line when present', () => {
    const context = loadContentContext(
        createDocumentStub({
            headers: []
        })
    );

    const value = context.extractShipmentDate('30 мар. 2026 10:00\nОтгр.: 31 мар.\nчерез 3 минуты');

    assert.equal(value, 'Отгр.: 31 мар.');
});

test('parseOrders extracts normalized order payload from table', () => {
    const context = loadContentContext(
        createDocumentStub({
            headers: [
                'ID',
                'Статус',
                'Доставка',
                'Оплата',
                'Дата',
                'Контрагент'
            ],
            rows: [
                {
                    internalId: '1000',
                    displayId: '1000-300326',
                    href: '/admin/orders/1000-300326/',
                    cells: [
                        '1000-300326',
                        'Новый',
                        'Пункт самовывоза СДЭК',
                        'Оплата онлайн',
                        '30 мар. 2026 10:00\nобновлено 10:15',
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
            contractor: 'ООО "Ромашка"',
            orderUrl: 'https://amperkot.ru/admin/orders/1000-300326/',
            shipmentDateText: '',
            hasOrderFlag: false,
            hasAutoreserve: false,
            tags: []
        }
    ]);
});

test('parseOrders extracts diagnostic fields', () => {
    const context = loadContentContext(
        createDocumentStub({
            headers: [
                'ID',
                'Статус',
                'Доставка',
                'Оплата',
                'Дата',
                'Контрагент'
            ],
            rows: [
                {
                    internalId: '2000',
                    displayId: '2000-300326',
                    href: '/admin/orders/2000-300326/',
                    hasFlag: true,
                    hasLock: true,
                    tags: ['tag1', 'tag2'],
                    cells: [
                        '2000-300326',
                        'Новый',
                        'СДЭК',
                        'Онлайн',
                        '30 мар. 2026 10:00\nОтгр.: 31 мар.',
                        'ООО "Тест"'
                    ]
                }
            ]
        })
    );

    const orders = context.parseOrders();
    const order = orders[0];

    assert.equal(order.hasOrderFlag, true);
    assert.equal(order.hasAutoreserve, true);
    assert.deepEqual(JSON.parse(JSON.stringify(order.tags)), ['tag1', 'tag2']);
    assert.equal(order.shipmentDateText, 'Отгр.: 31 мар.');
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