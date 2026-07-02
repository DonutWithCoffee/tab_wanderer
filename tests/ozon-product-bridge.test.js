const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class ElementStub {
    constructor({ tagName = 'DIV', text = '', className = '', children = [], rect = null, attrs = {} } = {}) {
        this.tagName = tagName.toUpperCase();
        this.innerText = text;
        this.textContent = text;
        this.className = className;
        this.children = children;
        this.parentElement = null;
        this.disabled = false;
        this.attrs = attrs;
        this.rect = rect || { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 };

        for (const child of children) {
            child.parentElement = this;
        }
    }

    getBoundingClientRect() {
        return this.rect;
    }

    getAttribute(name) {
        if (name === 'class') {
            return this.className;
        }

        return this.attrs[name] ?? null;
    }

    querySelectorAll(selector) {
        const descendants = [];

        function visit(node) {
            for (const child of node.children || []) {
                descendants.push(child);
                visit(child);
            }
        }

        visit(this);

        if (/button|\[role="button"\]/i.test(selector)) {
            return descendants.filter(node => node.tagName === 'BUTTON' || node.attrs.role === 'button');
        }

        const dataStyleMatch = String(selector).match(/\[data-style="([^"]+)"\]/);

        if (dataStyleMatch) {
            return descendants.filter(node => node.attrs['data-style'] === dataStyleMatch[1]);
        }

        return descendants;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    closest(selector) {
        let current = this;

        while (current) {
            if (/button/i.test(selector) && current.tagName === 'BUTTON') {
                return current;
            }

            current = current.parentElement;
        }

        return null;
    }

    focus() {}

    scrollIntoView() {}

    dispatchEvent() {
        return true;
    }

    click() {}
}

async function flushAsyncWork(iterations = 8) {
    for (let index = 0; index < iterations; index += 1) {
        await Promise.resolve();
    }
}

function createDocumentStub(elements = []) {
    return {
        body: new ElementStub({ tagName: 'BODY' }),
        activeElement: null,
        querySelectorAll() {
            return elements;
        },
        elementFromPoint() {
            return null;
        }
    };
}

function loadBridgeContext(documentStub, overrides = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'ozon-product-bridge.js'), 'utf8');
    const listeners = {};
    const context = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        document: documentStub,
        location: { href: 'https://seller.ozon.ru/app/products?search=24260137', search: '?search=24260137' },
        URLSearchParams,
        Event,
        clearTimeout: () => {},
        MouseEvent: class {},
        KeyboardEvent: class {},
        CustomEvent: class {
            constructor(type, options = {}) {
                this.type = type;
                this.detail = options.detail;
            }
        },
        window: {
            screenX: 0,
            screenY: 0,
            getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
            setTimeout: (callback, ms = 0) => {
                if (typeof callback === 'function' && Number(ms) < 5000) {
                    Promise.resolve().then(callback);
                }
                return 0;
            },
            clearTimeout: () => {},
            addEventListener: (type, listener) => {
                listeners[type] = listeners[type] || [];
                listeners[type].push(listener);
            },
            dispatchEvent: (event) => {
                for (const listener of listeners[event.type] || []) {
                    listener(event);
                }
            },
            ...(overrides.window || {})
        },
        ...(overrides.global || {})
    };

    context.globalThis = context;
    context.window.window = context.window;
    context.window.document = documentStub;
    context.window.location = context.location;
    context.window.console = context.console;
    context.window.CustomEvent = context.CustomEvent;
    context.window.MouseEvent = context.MouseEvent;
    context.window.KeyboardEvent = context.KeyboardEvent;
    context.window.URLSearchParams = URLSearchParams;
    context.window.getComputedStyle = context.window.getComputedStyle;

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'ozon-product-bridge.js' });

    return context;
}

test('Ozon product bridge resolves exact product context from visible DOM row', async () => {
    const addButton = new ElementStub({ tagName: 'BUTTON', text: 'Добавить' });
    const productRow = new ElementStub({
        tagName: 'TR',
        text: 'Модуль реле 6 каналов 10A250V 5V Артикул 24260137 SKU 1237406094 Штрихкод Добавить',
        children: [addButton]
    });
    const context = loadBridgeContext(createDocumentStub([productRow]));
    const responses = [];

    context.window.addEventListener('tab_wanderer:ozon-product-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:ozon-product-request', {
        detail: { productId: '24260137' }
    }));
    await flushAsyncWork();

    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, true);
    assert.equal(responses[0].sourceType, 'dom-row');
    assert.equal(responses[0].source.products[0].offerId, '24260137');
    assert.equal(responses[0].source.products[0].ozonSku, '1237406094');
});


test('Ozon product bridge includes visible barcode from DOM row context', async () => {
    const barcodeText = new ElementStub({ tagName: 'SPAN', text: '2433878', attrs: { 'data-style': 'text' } });
    const barcodeCount = new ElementStub({ tagName: 'SPAN', text: '+ 1 штрихкод', attrs: { 'data-style': 'count' } });
    const barcodeContainer = new ElementStub({ children: [barcodeText, barcodeCount] });
    const productRow = new ElementStub({
        tagName: 'TR',
        text: 'Промышленный 1-канальный модуль реле Артикул 42608563 SKU 1237406094 2433878 + 1 штрихкод',
        children: [barcodeContainer]
    });
    const drawer = new ElementStub({
        tagName: 'ASIDE',
        text: 'Добавить штрихкод 2433878',
        children: [new ElementStub({ tagName: 'SPAN', text: '2433878' })]
    });
    const context = loadBridgeContext(createDocumentStub([productRow, drawer]));
    const responses = [];

    context.window.addEventListener('tab_wanderer:ozon-product-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:ozon-product-request', {
        detail: { productId: '42608563' }
    }));
    await flushAsyncWork();

    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, true);
    assert.deepEqual(Array.from(responses[0].source.products[0].existingBarcodes), ['2433878']);
    assert.deepEqual(Array.from(responses[0].source.products[0].part_barcodes.barcodes), ['2433878']);
});



test('Ozon product bridge resolves full barcode list through barcode details API for preview', async () => {
    const fetchCalls = [];
    const barcodeText = new ElementStub({ tagName: 'SPAN', text: '2433878', attrs: { 'data-style': 'text' } });
    const barcodeCount = new ElementStub({ tagName: 'SPAN', text: '+ 3 штрихкода', attrs: { 'data-style': 'count' } });
    const barcodeContainer = new ElementStub({ children: [barcodeText, barcodeCount] });
    const productRow = new ElementStub({
        tagName: 'TR',
        text: 'Промышленный 1-канальный модуль реле Артикул 42608563 SKU 1237406094 2433878 + 3 штрихкода',
        children: [barcodeContainer]
    });
    const context = loadBridgeContext(createDocumentStub([productRow]), {
        window: {
            __TAB_WANDERER_OZON_SELLER_ID__: '185464',
            fetch: async (url, init = {}) => {
                fetchCalls.push({ url, init });
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        barcodes: [
                            { item_id: '1237406094', barcode: '2433878', is_deletable: true },
                            { item_id: '1237406094', barcode: '2433879', is_deletable: true },
                            { item_id: '1237406094', barcode: '2433880', is_deletable: true },
                            { item_id: '1237406094', barcode: '2433881', is_deletable: true }
                        ]
                    })
                };
            }
        }
    });
    const responses = [];

    context.window.addEventListener('tab_wanderer:ozon-product-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:ozon-product-request', {
        detail: { productId: '42608563' }
    }));
    await flushAsyncWork(80);

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, '/api/sc/barcode-details-by-item-id');
    assert.deepEqual(JSON.parse(fetchCalls[0].init.body), { item_id: ['1237406094'] });
    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, true);
    assert.deepEqual(Array.from(responses[0].source.products[0].existingBarcodes), [
        '2433878',
        '2433879',
        '2433880',
        '2433881'
    ]);
    assert.equal(responses[0].source.products[0].fullBarcodeSource, 'api-barcode-details');
    assert.equal(context.window.__TAB_WANDERER_OZON_PRODUCT_BRIDGE_DEBUG__.lastResolveBarcodeDetailsRead.ok, true);
});

test('Ozon product bridge reads full barcode list from existing barcode drawer', async () => {
    const barcodeText = new ElementStub({ tagName: 'SPAN', text: '2465970', attrs: { 'data-style': 'text' } });
    const barcodeCount = new ElementStub({ tagName: 'SPAN', text: '+ 8 штрихкодов', attrs: { 'data-style': 'count' } });
    const barcodeContainer = new ElementStub({ children: [barcodeText, barcodeCount] });
    const productRow = new ElementStub({
        tagName: 'TR',
        text: 'Артикул 42608563 SKU 3410615250 2465970 + 8 штрихкодов',
        children: [barcodeContainer]
    });
    const drawer = new ElementStub({
        tagName: 'ASIDE',
        text: 'Добавить штрихкод 2465970 2465971 2465972 2465973',
        children: [
            new ElementStub({ tagName: 'SPAN', text: '2465970' }),
            new ElementStub({ tagName: 'SPAN', text: '2465971' }),
            new ElementStub({ tagName: 'SPAN', text: '2465972' }),
            new ElementStub({ tagName: 'SPAN', text: '2465973' })
        ]
    });
    const context = loadBridgeContext(createDocumentStub([productRow, drawer]));
    const responses = [];

    context.window.addEventListener('tab_wanderer:ozon-product-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:ozon-product-request', {
        detail: { productId: '42608563' }
    }));
    await flushAsyncWork();

    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, true);
    assert.deepEqual(Array.from(responses[0].source.products[0].existingBarcodes), [
        '2465970',
        '2465971',
        '2465972',
        '2465973'
    ]);
    assert.equal(context.window.__TAB_WANDERER_OZON_PRODUCT_BRIDGE_DEBUG__.lastFullBarcodeRead.ok, true);
});


test('Ozon product bridge writes barcodes through API and verifies drawer state', async () => {
    const fetchCalls = [];
    const productRow = new ElementStub({
        tagName: 'TR',
        text: 'Артикул 42608563 SKU 3410615250 2465970 + 1 штрихкод',
        children: [
            new ElementStub({
                children: [
                    new ElementStub({ tagName: 'SPAN', text: '2465970', attrs: { 'data-style': 'text' } }),
                    new ElementStub({ tagName: 'SPAN', text: '+ 1 штрихкод', attrs: { 'data-style': 'count' } })
                ]
            })
        ]
    });
    const drawer = new ElementStub({
        tagName: 'ASIDE',
        text: 'Добавить штрихкод 2465970 2486857 Сохранить',
        children: [
            new ElementStub({ tagName: 'SPAN', text: '2465970' }),
            new ElementStub({ tagName: 'SPAN', text: '2486857' })
        ]
    });
    const context = loadBridgeContext(createDocumentStub([productRow, drawer]), {
        window: {
            __TAB_WANDERER_OZON_SELLER_ID__: '185464',
            fetch: async (url, init = {}) => {
                fetchCalls.push({ url, init });
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ errors: [] })
                };
            }
        }
    });
    const responses = [];

    context.window.addEventListener('tab_wanderer:ozon-ui-apply-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:ozon-ui-apply-request', {
        detail: { productId: '42608563', barcodes: ['2486857'] }
    }));
    await flushAsyncWork(80);

    const writeCalls = fetchCalls.filter(call => call.url === '/api/barcode-add-v2');
    const detailsCalls = fetchCalls.filter(call => call.url === '/api/sc/barcode-details-by-item-id');

    assert.equal(writeCalls.length, 1);
    assert.equal(detailsCalls.length, 1);
    assert.equal(writeCalls[0].url, '/api/barcode-add-v2');
    assert.deepEqual(JSON.parse(writeCalls[0].init.body), {
        seller_id: '185464',
        barcodes: [
            { barcode: '2486857', item_id: '3410615250' }
        ]
    });
    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, true);
    assert.equal(responses[0].verifiedCount, 1);
    assert.equal(responses[0].details.writeMethod, 'api');
    assert.equal(context.window.__TAB_WANDERER_OZON_PRODUCT_BRIDGE_DEBUG__.lastApiApply.result, 'verified');
});


test('Ozon product bridge waits for drawer state to catch up after API write', async () => {
    const fetchCalls = [];
    const productRow = new ElementStub({
        tagName: 'TR',
        text: 'Артикул 40157897 SKU 3410615250 2400001 + 2 штрихкода',
        children: [
            new ElementStub({
                children: [
                    new ElementStub({ tagName: 'SPAN', text: '2400001', attrs: { 'data-style': 'text' } }),
                    new ElementStub({ tagName: 'SPAN', text: '+ 2 штрихкода', attrs: { 'data-style': 'count' } })
                ]
            })
        ]
    });
    const oldBarcode = new ElementStub({ tagName: 'SPAN', text: '2400001' });
    const fullBarcodeNodes = [
        oldBarcode,
        new ElementStub({ tagName: 'SPAN', text: '2400002' }),
        new ElementStub({ tagName: 'SPAN', text: '2400003' })
    ];
    const drawer = new ElementStub({
        tagName: 'ASIDE',
        text: 'Добавить штрихкод 2400001 Сохранить',
        children: [oldBarcode]
    });
    let readCalls = 0;

    drawer.querySelectorAll = (selector) => {
        readCalls += 1;
        const nodes = readCalls > 4 ? fullBarcodeNodes : [oldBarcode];
        const dataStyleMatch = String(selector).match(/\[data-style="([^"]+)"\]/);

        if (dataStyleMatch) {
            return nodes.filter(node => node.attrs['data-style'] === dataStyleMatch[1]);
        }

        return nodes;
    };

    const context = loadBridgeContext(createDocumentStub([productRow, drawer]), {
        window: {
            __TAB_WANDERER_OZON_SELLER_ID__: '185464',
            fetch: async (url, init = {}) => {
                fetchCalls.push({ url, init });
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ errors: [] })
                };
            }
        }
    });
    const responses = [];

    context.window.addEventListener('tab_wanderer:ozon-ui-apply-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:ozon-ui-apply-request', {
        detail: { productId: '40157897', barcodes: ['2400001', '2400002', '2400003'] }
    }));
    await flushAsyncWork(80);

    const writeCalls = fetchCalls.filter(call => call.url === '/api/barcode-add-v2');
    const detailsCalls = fetchCalls.filter(call => call.url === '/api/sc/barcode-details-by-item-id');

    assert.equal(writeCalls.length, 1);
    assert.equal(detailsCalls.length, 1);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, true);
    assert.equal(responses[0].verifiedCount, 3);
    assert.equal(responses[0].details.verify.readAttempts > 1, true);
    assert.equal(context.window.__TAB_WANDERER_OZON_PRODUCT_BRIDGE_DEBUG__.lastApiApply.result, 'verified');
});


test('Ozon product bridge verifies API write from barcode details response when drawer stays partial', async () => {
    const fetchCalls = [];
    let context = null;
    const productRow = new ElementStub({
        tagName: 'TR',
        text: 'Артикул 40157897 SKU 3410615250 2400001 + 2 штрихкода',
        children: [
            new ElementStub({
                children: [
                    new ElementStub({ tagName: 'SPAN', text: '2400001', attrs: { 'data-style': 'text' } }),
                    new ElementStub({ tagName: 'SPAN', text: '+ 2 штрихкода', attrs: { 'data-style': 'count' } })
                ]
            })
        ]
    });
    const drawer = new ElementStub({
        tagName: 'ASIDE',
        text: 'Добавить штрихкод 2400001 Сохранить',
        children: [new ElementStub({ tagName: 'SPAN', text: '2400001' })]
    });

    drawer.querySelectorAll = (selector) => {
        const dataStyleMatch = String(selector).match(/\[data-style="([^"]+)"\]/);

        if (dataStyleMatch) {
            return drawer.children.filter(node => node.attrs['data-style'] === dataStyleMatch[1]);
        }

        return drawer.children;
    };

    context = loadBridgeContext(createDocumentStub([productRow, drawer]), {
        window: {
            __TAB_WANDERER_OZON_SELLER_ID__: '185464',
            fetch: async (url, init = {}) => {
                fetchCalls.push({ url, init });

                if (String(url).includes('barcode-details')) {
                    const body = {
                        barcodes: [
                            { item_id: '3410615250', barcode: '2400001', is_deletable: true },
                            { item_id: '3410615250', barcode: '2400002', is_deletable: true },
                            { item_id: '3410615250', barcode: '2400003', is_deletable: true }
                        ]
                    };

                    return {
                        ok: true,
                        status: 200,
                        clone: () => ({ json: async () => body }),
                        json: async () => body
                    };
                }

                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ errors: [] })
                };
            }
        }
    });
    const responses = [];

    context.window.addEventListener('tab_wanderer:ozon-ui-apply-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:ozon-ui-apply-request', {
        detail: { productId: '40157897', barcodes: ['2400001', '2400002', '2400003'] }
    }));
    await flushAsyncWork(80);

    const writeCalls = fetchCalls.filter(call => call.url === '/api/barcode-add-v2');
    const detailsCalls = fetchCalls.filter(call => String(call.url).includes('barcode-details'));

    assert.equal(writeCalls.length, 1);
    assert.equal(detailsCalls.length, 1);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, true);
    assert.equal(responses[0].verifiedCount, 3);
    assert.deepEqual(Array.from(responses[0].missingBarcodes), []);
    assert.equal(responses[0].details.verify.source, 'api-read-after-write-barcode-details');
    assert.equal(responses[0].details.verify.readAttempts, 0);
    assert.deepEqual(JSON.parse(detailsCalls[0].init.body), { item_id: ['3410615250'] });
    assert.equal(context.window.__TAB_WANDERER_OZON_PRODUCT_BRIDGE_DEBUG__.lastBarcodeDetailsResponse.method, 'POST');
    assert.equal(context.window.__TAB_WANDERER_OZON_PRODUCT_BRIDGE_DEBUG__.lastBarcodeDetailsResponse.status, 200);
    assert.equal(context.window.__TAB_WANDERER_OZON_PRODUCT_BRIDGE_DEBUG__.lastBarcodeDetailsResponse.requestBody, JSON.stringify({ item_id: ['3410615250'] }));
    assert.equal(context.window.__TAB_WANDERER_OZON_PRODUCT_BRIDGE_DEBUG__.lastApiApply.result, 'verified');
});
