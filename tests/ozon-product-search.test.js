const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadOzonProductSearchContext() {
    const context = { URL, console: { log: () => {}, warn: () => {}, error: () => {} } };

    context.globalThis = context;
    vm.createContext(context);

    vm.runInContext(
        fs.readFileSync(path.join(__dirname, '..', 'core', 'ozon-product-search.js'), 'utf8'),
        context,
        { filename: 'core/ozon-product-search.js' }
    );

    return context;
}

test('buildOzonProductSearchUrl builds seller product search URL', () => {
    const context = loadOzonProductSearchContext();

    assert.equal(
        context.buildOzonProductSearchUrl('41169171'),
        'https://seller.ozon.ru/app/products?search=41169171'
    );
});

test('resolveOzonProductSearchResult resolves product from Ozon UI module state', () => {
    const context = loadOzonProductSearchContext();

    const result = context.resolveOzonProductSearchResult({
        productList: {
            itemFrontItems: [
                {
                    id: 1165252638,
                    sku: 1675596792,
                    ozonSku: 1675596792,
                    offerId: '41169171',
                    title: 'Преобразователь промышленного уровня Waveshare USB - RS485',
                    barcodes: [
                        { barcode: '2486885', status: 'Accepted' },
                        { barcode: '2486886', status: 'Accepted' },
                        { barcode: '2486885', status: 'Accepted' }
                    ]
                }
            ]
        }
    }, '41169171');

    assert.equal(result.ok, true);
    assert.equal(result.product.offerId, '41169171');
    assert.equal(result.product.ozonSku, '1675596792');
    assert.equal(result.product.internalItemId, '1165252638');
    assert.deepEqual(JSON.parse(JSON.stringify(result.product.existingBarcodes)), ['2486885', '2486886']);
});

test('resolveOzonProductSearchResult resolves product from list-by-filter API response', () => {
    const context = loadOzonProductSearchContext();

    const result = context.resolveOzonProductSearchResult({
        products: [
            {
                item_id: '1165252638',
                part_item: {
                    offer_id: '41169171',
                    name: 'Преобразователь промышленного уровня Waveshare USB - RS485'
                },
                part_sources: {
                    sources: [{ sku: '1675596792' }]
                },
                part_barcodes: {
                    barcodes: [
                        { barcode: '2486857', status: 'Accepted', error: '' },
                        { barcode: '2486885', status: 'Accepted', error: '' }
                    ]
                }
            }
        ]
    }, '41169171');

    assert.equal(result.ok, true);
    assert.equal(result.product.ozonSku, '1675596792');
    assert.deepEqual(JSON.parse(JSON.stringify(result.product.existingBarcodes)), ['2486857', '2486885']);
});

test('resolveOzonProductSearchResult rejects ambiguous products', () => {
    const context = loadOzonProductSearchContext();

    const result = context.resolveOzonProductSearchResult({
        productList: {
            itemFrontItems: [
                { offerId: '41169171', sku: '1675596792' },
                { offerId: '41169171', sku: '1675596793' }
            ]
        }
    }, '41169171');

    assert.equal(result.ok, false);
    assert.equal(result.error, 'productAmbiguous');
});
