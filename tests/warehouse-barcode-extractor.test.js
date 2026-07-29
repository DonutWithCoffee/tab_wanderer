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

test('warehouse number normalization rejects coercive non-scalar unit types', () => {
    const context = loadWarehouseBarcodeContext();
    const invalidTypes = [false, true, [], [0], {}, '0x0', '  ', '0abc'];

    for (const type of invalidTypes) {
        const result = context.classifyWarehouseBarcodeEntry(createAssemblyEntry({ type }));
        assert.equal(result.decision, 'skipped', `type ${JSON.stringify(type)} must be skipped`);
        assert.equal(result.reason, 'itemTypeUnknown', `type ${JSON.stringify(type)} must stay unknown`);
    }

    const decimalString = context.classifyWarehouseBarcodeEntry(createAssemblyEntry({ type: '0' }));
    assert.equal(decimalString.decision, 'eligible');
    assert.equal(decimalString.itemType, 0);
});

test('warehouse quantities stay diagnostic and do not define barcode unit type', () => {
    const context = loadWarehouseBarcodeContext();

    const stockThree = context.classifyWarehouseBarcodeEntry(createAssemblyEntry({
        quantity: 1,
        reservedQuantity: 3,
        stockQuantity: 3,
        type: 0
    }));
    assert.equal(stockThree.decision, 'eligible');
    assert.equal(stockThree.reason, null);
    assert.equal(stockThree.assemblyQuantity, 1);
    assert.equal(stockThree.reservedQuantity, 3);
    assert.equal(stockThree.stockQuantity, 3);

    const zeroAssembly = context.classifyWarehouseBarcodeEntry(createAssemblyEntry({ quantity: 0, type: 0 }));
    assert.equal(zeroAssembly.decision, 'eligible');
    assert.equal(zeroAssembly.assemblyQuantity, 0);

    const invalidQuantity = context.classifyWarehouseBarcodeEntry(createAssemblyEntry({ quantity: [1], type: 0 }));
    assert.equal(invalidQuantity.decision, 'eligible');
    assert.equal(invalidQuantity.assemblyQuantity, null);
    assert.equal(invalidQuantity.assemblyQuantityInvalid, true);
});

test('write-boundary revalidation keeps confirmed unit type eligible despite warehouse quantity metadata', () => {
    const context = loadWarehouseBarcodeContext();

    const result = context.revalidateWarehouseBarcodeExtraction({
        orderId: '6373-280726',
        productsById: {
            41764825: {
                productId: '41764825',
                productTitle: 'Отладочная плата Waveshare RP2350-Zero',
                eligibleBarcodes: [
                    {
                        barcode: '1234567890',
                        productId: '41764825',
                        itemType: 0,
                        assemblyQuantity: 1,
                        reservedQuantity: 3,
                        stockQuantity: 3
                    }
                ],
                skippedBarcodes: []
            }
        }
    });

    assert.equal(result.summary.eligibleCount, 1);
    assert.equal(result.summary.skippedCount, 0);
    assert.equal(result.productsById['41764825'].eligibleBarcodes[0].itemType, 0);
});

test('warehouse extraction bounds reject oversized Ozon payloads before processing', () => {
    const context = loadWarehouseBarcodeContext();
    const tooManyProducts = {};

    for (let index = 0; index < context.MAX_WAREHOUSE_OZON_PRODUCTS + 1; index += 1) {
        const productId = String(10000000 + index);
        tooManyProducts[productId] = {
            productId,
            eligibleBarcodes: [],
            skippedBarcodes: []
        };
    }

    const productLimit = context.validateWarehouseBarcodeExtractionBounds({ productsById: tooManyProducts });
    assert.equal(productLimit.ok, false);
    assert.match(productLimit.error, /too many products/);

    const oversizedBarcode = context.validateWarehouseBarcodeExtractionBounds({
        productsById: {
            24126456: {
                productId: '24126456',
                eligibleBarcodes: [
                    {
                        barcode: '1'.repeat(81),
                        productId: '24126456',
                        itemType: 0,
                        assemblyQuantity: 1,
                        reservedQuantity: 1
                    }
                ],
                skippedBarcodes: []
            }
        }
    });
    assert.equal(oversizedBarcode.ok, false);
    assert.match(oversizedBarcode.error, /oversized barcode metadata/);

    const revalidated = context.revalidateWarehouseBarcodeExtraction({ productsById: tooManyProducts });
    assert.equal(revalidated.revalidation.limitsExceeded, true);
    assert.equal(revalidated.summary.eligibleCount, 0);
});
