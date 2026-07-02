const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadOzonBarcodeBindingContext() {
    const context = { console: { log: () => {}, warn: () => {}, error: () => {} } };

    context.globalThis = context;
    vm.createContext(context);

    for (const filename of [
        'core/warehouse-barcode-extractor.js',
        'core/ozon-product-search.js',
        'core/ozon-barcode-binding.js'
    ]) {
        vm.runInContext(
            fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'),
            context,
            { filename }
        );
    }

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
            product: {
                title: overrides.productTitle || 'DC-DC повышающий преобразователь MT3608'
            }
        }
    };
}

test('createOzonBarcodeAddPayload creates barcode-add-v2 payload', () => {
    const context = loadOzonBarcodeBindingContext();

    const payload = context.createOzonBarcodeAddPayload('185464', '1675596792', ['2486857', '2486857', '2486885']);

    assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        seller_id: '185464',
        barcodes: [
            { barcode: '2486857', item_id: '1675596792' },
            { barcode: '2486885', item_id: '1675596792' }
        ]
    });
});

test('createOzonBarcodeBindingPlan adds only missing barcodes and keeps skipped warehouse rows', () => {
    const context = loadOzonBarcodeBindingContext();
    const warehouseExtraction = context.extractWarehouseAssemblyBarcodes({
        id: '9205-010726',
        assembly: [
            createAssemblyEntry({ id: 1, productId: 41169171, barcode: 2486857 }),
            createAssemblyEntry({ id: 2, productId: 41169171, barcode: 2486885 }),
            createAssemblyEntry({ id: 3, productId: 41169171, barcode: 2049684, type: 1, quantity: 15, reservedQuantity: 15 })
        ]
    });

    const plan = context.createOzonBarcodeBindingPlan({
        warehouseExtraction,
        sellerId: '185464',
        ozonProductsByProductId: {
            41169171: {
                offerId: '41169171',
                ozonSku: '1675596792',
                title: 'Преобразователь промышленного уровня Waveshare USB - RS485',
                existingBarcodes: ['2486885', '2486886']
            }
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(plan.summary)), {
        productCount: 1,
        readyProductCount: 1,
        errorProductCount: 0,
        skippedProductCount: 0,
        toAddCount: 1,
        alreadyExistsCount: 1,
        skippedWarehouseCount: 1,
        requestCount: 1
    });

    assert.equal(plan.productPlans[0].status, 'ready');
    assert.deepEqual(JSON.parse(JSON.stringify(plan.productPlans[0].toAdd.map(entry => entry.barcode))), ['2486857']);
    assert.deepEqual(JSON.parse(JSON.stringify(plan.productPlans[0].alreadyExists.map(entry => entry.barcode))), ['2486885']);
    assert.equal(plan.productPlans[0].skippedWarehouseBarcodes[0].reason, 'multiBarcodeType');
    assert.deepEqual(JSON.parse(JSON.stringify(plan.productPlans[0].requests[0])), {
        url: '/api/barcode-add-v2',
        method: 'POST',
        payload: {
            seller_id: '185464',
            barcodes: [
                { barcode: '2486857', item_id: '1675596792' }
            ]
        }
    });
});

test('createOzonBarcodeBindingPlan splits product payloads into chunks', () => {
    const context = loadOzonBarcodeBindingContext();
    const warehouseExtraction = context.extractWarehouseAssemblyBarcodes({
        id: '9205-010726',
        assembly: [
            createAssemblyEntry({ id: 1, productId: 41169171, barcode: 111 }),
            createAssemblyEntry({ id: 2, productId: 41169171, barcode: 222 }),
            createAssemblyEntry({ id: 3, productId: 41169171, barcode: 333 })
        ]
    });

    const plan = context.createOzonBarcodeBindingPlan({
        warehouseExtraction,
        sellerId: '185464',
        chunkSize: 2,
        ozonProductsByProductId: {
            41169171: {
                offerId: '41169171',
                ozonSku: '1675596792',
                existingBarcodes: []
            }
        }
    });

    assert.equal(plan.productPlans[0].requests.length, 2);
    assert.deepEqual(
        JSON.parse(JSON.stringify(plan.productPlans[0].requests.map(request => request.payload.barcodes.map(item => item.barcode)))),
        [['111', '222'], ['333']]
    );
});

test('createOzonBarcodeBindingPlan blocks writes when seller id is missing', () => {
    const context = loadOzonBarcodeBindingContext();
    const warehouseExtraction = context.extractWarehouseAssemblyBarcodes({
        id: '9205-010726',
        assembly: [createAssemblyEntry({ id: 1, productId: 41169171, barcode: 2486857 })]
    });

    const plan = context.createOzonBarcodeBindingPlan({
        warehouseExtraction,
        sellerId: '',
        ozonProductsByProductId: {
            41169171: {
                offerId: '41169171',
                ozonSku: '1675596792',
                existingBarcodes: []
            }
        }
    });

    assert.equal(plan.productPlans[0].status, 'error');
    assert.equal(plan.productPlans[0].reason, 'sellerIdMissing');
    assert.equal(plan.summary.requestCount, 0);
});

test('Ozon binding plans keep skipped-only warehouse products out of Ozon errors', () => {
    const context = loadOzonBarcodeBindingContext();
    const warehouseExtraction = context.extractWarehouseAssemblyBarcodes({
        id: '9205-010726',
        assembly: [
            createAssemblyEntry({
                id: 1,
                productId: 39437515,
                barcode: 2049684,
                type: 1,
                quantity: 15,
                reservedQuantity: 15
            })
        ]
    });

    const previewPlan = context.createOzonBarcodeBindingPreviewPlan({
        warehouseExtraction,
        ozonProductsByProductId: {}
    });
    const applyPlan = context.createOzonBarcodeBindingPlan({
        warehouseExtraction,
        sellerId: '',
        ozonProductsByProductId: {}
    });

    assert.deepEqual(JSON.parse(JSON.stringify(previewPlan.summary)), {
        productCount: 1,
        readyProductCount: 0,
        errorProductCount: 0,
        skippedProductCount: 1,
        toAddCount: 0,
        alreadyExistsCount: 0,
        skippedWarehouseCount: 1
    });
    assert.equal(previewPlan.productPlans[0].status, 'skipped');
    assert.equal(previewPlan.productPlans[0].reason, 'noEligibleBarcodes');

    assert.equal(applyPlan.summary.errorProductCount, 0);
    assert.equal(applyPlan.summary.skippedProductCount, 1);
    assert.equal(applyPlan.summary.toAddCount, 0);
    assert.equal(applyPlan.summary.requestCount, 0);
    assert.equal(applyPlan.productPlans[0].status, 'skipped');
    assert.equal(applyPlan.productPlans[0].reason, 'noEligibleBarcodes');
});

test('createOzonBarcodeBindingPreviewPlan compares warehouse barcodes with resolved Ozon product without sellerId', () => {
    const context = loadOzonBarcodeBindingContext();

    const plan = context.createOzonBarcodeBindingPreviewPlan({
        warehouseExtraction: {
            orderId: '4171-010726',
            productsById: {
                40534835: {
                    productId: '40534835',
                    productTitle: 'PETG пластик',
                    eligibleBarcodes: [
                        { barcode: '2486857', productId: '40534835' },
                        { barcode: '2486885', productId: '40534835' }
                    ],
                    skippedBarcodes: []
                }
            }
        },
        ozonProductsByProductId: {
            40534835: {
                ok: true,
                product: {
                    offerId: '40534835',
                    ozonSku: '1675596792',
                    existingBarcodes: ['2486885']
                }
            }
        }
    });

    assert.equal(plan.orderId, '4171-010726');
    assert.equal(plan.summary.productCount, 1);
    assert.equal(plan.summary.toAddCount, 1);
    assert.equal(plan.summary.alreadyExistsCount, 1);
    assert.equal(plan.summary.errorProductCount, 0);
    assert.equal(plan.productPlans[0].status, 'ready');
    assert.equal(plan.productPlans[0].toAdd[0].barcode, '2486857');
    assert.equal(plan.productPlans[0].alreadyExists[0].barcode, '2486885');
});
