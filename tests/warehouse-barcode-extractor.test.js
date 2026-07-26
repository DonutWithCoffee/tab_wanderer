const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadWarehouseBarcodeContext() {
    const context = { console: { log: () => {}, warn: () => {}, error: () => {} } };

    context.globalThis = context;
    vm.createContext(context);

    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'core', 'warehouse-barcode-extractor.js'), 'utf8'),
        context,
        { filename: 'core/warehouse-barcode-extractor.js' }
    );

    return context;
}

function createAssemblyEntry(overrides = {}) {
    return {
        id: overrides.id || 1,
        quantity: overrides.quantity ?? 1,
        product_item: {
            id: overrides.productItemId || 10,
            product_id: overrides.productId || 24126456,
            barcode: overrides.barcode || 2317613,
            type: overrides.type ?? 0,
            quantity: overrides.stockQuantity ?? 0,
            reserved_quantity: overrides.reservedQuantity ?? 1,
            state: {
                title: overrides.stateTitle || 'В наличии СПб (Коробка #192)'
            },
            product: {
                title: overrides.productTitle || 'DC-DC повышающий преобразователь MT3608'
            }
        }
    };
}

test('classifyWarehouseBarcodeEntry accepts unit barcode rows', () => {
    const context = loadWarehouseBarcodeContext();

    const result = context.classifyWarehouseBarcodeEntry(createAssemblyEntry());

    assert.equal(result.decision, 'eligible');
    assert.equal(result.reason, null);
    assert.equal(result.barcode, '2317613');
    assert.equal(result.productId, '24126456');
    assert.equal(result.itemType, 0);
    assert.equal(result.assemblyQuantity, 1);
    assert.equal(result.reservedQuantity, 1);
});

test('classifyWarehouseBarcodeEntry skips multi barcode rows by product item type', () => {
    const context = loadWarehouseBarcodeContext();

    const result = context.classifyWarehouseBarcodeEntry(createAssemblyEntry({
        productId: 23870634,
        barcode: 2049684,
        type: 1,
        quantity: 15,
        reservedQuantity: 15,
        stockQuantity: 157,
        productTitle: 'Матовый LED RGB светодиод 5mm с общим катодом (1 шт.)'
    }));

    assert.equal(result.decision, 'skipped');
    assert.equal(result.reason, 'multiBarcodeType');
    assert.equal(result.barcode, '2049684');
    assert.equal(result.productId, '23870634');
});


test('classifyWarehouseBarcodeEntry fails closed when unit type is missing', () => {
    const context = loadWarehouseBarcodeContext();
    const entry = createAssemblyEntry();
    delete entry.product_item.type;

    const result = context.classifyWarehouseBarcodeEntry(entry);

    assert.equal(result.decision, 'skipped');
    assert.equal(result.reason, 'itemTypeUnknown');
    assert.equal(result.barcode, '2317613');
});

test('revalidateWarehouseBarcodeExtraction rejects unconfirmed and multi rows at write boundary', () => {
    const context = loadWarehouseBarcodeContext();

    const result = context.revalidateWarehouseBarcodeExtraction({
        orderId: '9205-010726',
        productsById: {
            24126456: {
                productId: '24126456',
                productTitle: 'Unit product',
                eligibleBarcodes: [
                    { barcode: '2317613', productId: '24126456', itemType: 0, assemblyQuantity: 1, reservedQuantity: 1 },
                    { barcode: '2317680', productId: '24126456' }
                ],
                skippedBarcodes: []
            },
            23870634: {
                productId: '23870634',
                productTitle: 'Multi product',
                eligibleBarcodes: [
                    { barcode: '2049684', productId: '23870634', itemType: 1, assemblyQuantity: 15, reservedQuantity: 15 }
                ],
                skippedBarcodes: []
            }
        }
    });

    assert.equal(result.summary.eligibleCount, 1);
    assert.equal(result.summary.skippedCount, 2);
    assert.equal(result.productsById['24126456'].eligibleBarcodes[0].barcode, '2317613');
    assert.equal(result.productsById['24126456'].skippedBarcodes[0].reason, 'itemTypeUnknown');
    assert.equal(result.productsById['23870634'].skippedBarcodes[0].reason, 'multiBarcodeType');
    assert.deepEqual(JSON.parse(JSON.stringify(result.revalidation)), {
        sourceEligibleCount: 3,
        eligibleCount: 1,
        rejectedEligibleCount: 2,
        rejectionReasons: {
            itemTypeUnknown: 1,
            multiBarcodeType: 1
        }
    });
});

test('extractWarehouseAssemblyBarcodes groups eligible and skipped barcodes by product id', () => {
    const context = loadWarehouseBarcodeContext();

    const extraction = context.extractWarehouseAssemblyBarcodes({
        id: '9205-010726',
        assembly: [
            createAssemblyEntry({ id: 1, productId: 24126456, barcode: 2317613 }),
            createAssemblyEntry({ id: 2, productId: 24126456, barcode: 2317680 }),
            createAssemblyEntry({ id: 3, productId: 23870634, barcode: 2049684, type: 1, quantity: 15, reservedQuantity: 15 })
        ]
    });

    assert.equal(extraction.orderId, '9205-010726');
    assert.deepEqual(JSON.parse(JSON.stringify(extraction.summary)), {
        productCount: 2,
        eligibleCount: 2,
        skippedCount: 1
    });
    assert.equal(extraction.productsById['24126456'].eligibleBarcodes.length, 2);
    assert.equal(extraction.productsById['23870634'].skippedBarcodes[0].reason, 'multiBarcodeType');
});

test('extractWarehouseAssemblyBarcodes deduplicates repeated product barcodes', () => {
    const context = loadWarehouseBarcodeContext();

    const extraction = context.extractWarehouseAssemblyBarcodes({
        id: '9205-010726',
        assembly: [
            createAssemblyEntry({ id: 1, productId: 24126456, barcode: 2317613 }),
            createAssemblyEntry({ id: 2, productId: 24126456, barcode: 2317613 })
        ]
    });

    assert.equal(extraction.eligibleBarcodes.length, 1);
    assert.equal(extraction.skippedBarcodes.length, 1);
    assert.equal(extraction.skippedBarcodes[0].reason, 'duplicateBarcode');
});
