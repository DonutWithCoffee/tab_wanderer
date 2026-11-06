const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadContext() {
    const context = { console: { log: () => {}, warn: () => {}, error: () => {} } };
    context.globalThis = context;
    context.self = context;
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'core', 'warehouse-stock-view-model.js'), 'utf8'),
        context,
        { filename: 'core/warehouse-stock-view-model.js' }
    );
    return context;
}

test('normalizes stock branch with default fallback', () => {
    const context = loadContext();
    assert.equal(context.normalizeWarehouseStockBranch('spb'), 'spb');
    assert.equal(context.normalizeWarehouseStockBranch('moscow'), 'moscow');
    assert.equal(context.normalizeWarehouseStockBranch('unknown'), 'default');
});

test('accepts a stock response only for a currently selected product', () => {
    const context = loadContext();
    assert.equal(context.isWarehouseStockResponseCurrent('39235607', ['39235607']), true);
    assert.equal(context.isWarehouseStockResponseCurrent('39235607', ['39163106']), false);
    assert.equal(context.isWarehouseStockResponseCurrent('39235607', []), false);
});

test('parses SPb and Moscow storage titles', () => {
    const context = loadContext();
    assert.equal(JSON.stringify(context.parseWarehouseStockLocationTitle('В наличии СПб (Коробка #373)')), JSON.stringify({ city: 'spb', cityLabel: 'СПб', location: 'Коробка #373' }));
    assert.equal(JSON.stringify(context.parseWarehouseStockLocationTitle('Москва ТГ: в наличии (Полка C3-3-8)')), JSON.stringify({ city: 'moscow', cityLabel: 'Москва ТГ', location: 'Полка C3-3-8' }));
    assert.equal(JSON.stringify(context.parseWarehouseStockLocationTitle('Москва ТГ: в наличии (Витрина)')), JSON.stringify({ city: 'moscow', cityLabel: 'Москва ТГ', location: 'Витрина' }));
});

test('uses physical location quantity and does not add reserved quantity twice', () => {
    const context = loadContext();
    const rows = context.createWarehouseStockRows({
        '1': [
            { id: 1, title: 'В наличии СПб (Коробка #373)', quantity: 68, reserved_quantity: 0 },
            { id: 2, title: 'Москва ТГ: в наличии (Полка C3-3-8)', quantity: 243, reserved_quantity: 6 },
            { id: 3, title: 'Москва ТГ: в наличии (Витрина)', quantity: 0, reserved_quantity: 0 }
        ]
    }, 'default');

    assert.deepEqual(rows.map(row => [row.city, row.location, row.totalQuantity]), [
        ['spb', 'Коробка #373', 68],
        ['moscow', 'Полка C3-3-8', 237]
    ]);
});

test('filters rows by selected branch', () => {
    const context = loadContext();
    const payload = {
        '1': [
            { title: 'В наличии СПб (Коробка #373)', quantity: 68, reserved_quantity: 0 },
            { title: 'Москва ТГ: в наличии (Полка C3-3-8)', quantity: 249, reserved_quantity: 6 }
        ]
    };

    assert.deepEqual(context.createWarehouseStockViewModel(payload, 'spb').rows.map(row => row.location), ['Коробка #373']);
    assert.deepEqual(context.createWarehouseStockViewModel(payload, 'moscow').rows.map(row => row.location), ['Полка C3-3-8']);
    assert.equal(context.createWarehouseStockViewModel(payload, 'default').rows.length, 2);
});
test('extracts selected income product ids from product card text', () => {
    const context = loadContext();
    assert.equal(
        JSON.stringify(context.extractWarehouseIncomeProductIdsFromText('Артикул: 14527, ID: 39235607')),
        JSON.stringify(['39235607'])
    );
});

test('prefers product-card ids over unrelated page ids', () => {
    const context = loadContext();
    assert.equal(
        JSON.stringify(context.extractWarehouseIncomeProductIdsFromText('Поставка ID: 123456 Артикул: 14527, ID: 39235607 Заказ ID: 7654321')),
        JSON.stringify(['39235607'])
    );
});

test('falls back to plain product id text when article is absent', () => {
    const context = loadContext();
    assert.equal(
        JSON.stringify(context.extractWarehouseIncomeProductIdsFromText('Товар ID: 39235607')),
        JSON.stringify(['39235607'])
    );
});



test('extracts product title from selected income card text before supplier/article metadata', () => {
    const context = loadContext();

    assert.equal(
        context.extractWarehouseIncomeProductTitleFromCardText(
            'Чернила маркировочные 30 мл Поставщик: Технопайка, Артикул: Технопайка, ID: 39177734'
        ),
        'Чернила маркировочные 30 мл'
    );
});

test('keeps product title in stock view model', () => {
    const context = loadContext();

    const model = context.createWarehouseStockViewModel(
        {
            '1': [
                { title: 'В наличии СПб (Коробка #373)', quantity: 68, reserved_quantity: 0 }
            ]
        },
        'default',
        '39163106',
        'Чернила маркировочные 30 мл'
    );

    assert.equal(model.productTitle, 'Чернила маркировочные 30 мл');
});
