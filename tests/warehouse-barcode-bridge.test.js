const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { URL } = require('url');

class ElementStub {
    constructor({ tagName = 'DIV', text = '', children = [], style = {} } = {}) {
        this.tagName = tagName.toUpperCase();
        this.innerText = text;
        this.textContent = text;
        this.children = children;
        this.parentElement = null;
        this.disabled = false;
        this.style = { ...style };

        for (const child of children) {
            child.parentElement = this;
        }
    }

    querySelectorAll() {
        const result = [];

        function visit(node) {
            for (const child of node.children || []) {
                result.push(child);
                visit(child);
            }
        }

        visit(this);
        return result;
    }

    getAttribute() {
        return null;
    }
}

function createDocumentStub(elements = []) {
    return {
        documentElement: new ElementStub({ tagName: 'HTML' }),
        body: new ElementStub({ tagName: 'BODY', children: elements }),
        getElementById: () => null,
        querySelectorAll: () => elements.concat(elements.flatMap(element => element.querySelectorAll()))
    };
}

function createXhrStub(responsePayloadByUrl = {}) {
    class XMLHttpRequestStub {
        constructor() {
            this.listeners = {};
            this.status = 0;
            this.responseText = '';
            this.responseURL = '';
            XMLHttpRequestStub.instances.push(this);
        }

        open(method, url) {
            this.method = method;
            this.url = String(url || '');
            this.responseURL = this.url;
        }

        send() {
            const responseConfig = responsePayloadByUrl[this.url] || responsePayloadByUrl.default || null;
            const wrapped = responseConfig
                && typeof responseConfig === 'object'
                && Object.prototype.hasOwnProperty.call(responseConfig, 'httpStatus')
                && Object.prototype.hasOwnProperty.call(responseConfig, 'payload');
            const payload = wrapped ? responseConfig.payload : responseConfig;
            this.status = wrapped ? Number(responseConfig.httpStatus) || 0 : payload ? 200 : 404;
            this.responseText = payload ? JSON.stringify(payload) : '';

            const listeners = [...(this.listeners.loadend || [])];
            for (const entry of listeners) {
                entry.listener.call(this);
                if (entry.once) {
                    this.listeners.loadend = (this.listeners.loadend || []).filter(item => item !== entry);
                }
            }
        }

        addEventListener(type, listener, options = {}) {
            this.listeners[type] = this.listeners[type] || [];
            this.listeners[type].push({ listener, once: options?.once === true });
        }
    }

    XMLHttpRequestStub.instances = [];
    return XMLHttpRequestStub;
}

function loadBridgeContext(documentStub, options = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'warehouse-barcode-bridge.js'), 'utf8');
    const listeners = {};
    const storage = {};
    const locationHref = options.locationHref
        || 'https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/assembly/4336?order=5147-290626';
    const locationHash = new URL(locationHref).hash;
    const XMLHttpRequest = options.responsePayloadByUrl
        ? createXhrStub(options.responsePayloadByUrl)
        : undefined;
    const context = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        document: documentStub,
        location: {
            href: locationHref,
            hash: locationHash
        },
        window: {
            location: {
                href: locationHref,
                hash: locationHash,
                origin: new URL(locationHref).origin
            },
            sessionStorage: {
                getItem: key => storage[key] || null,
                setItem: (key, value) => { storage[key] = String(value); }
            },
            addEventListener: (type, listener) => {
                listeners[type] = listeners[type] || [];
                listeners[type].push(listener);
            },
            dispatchEvent: event => {
                for (const listener of listeners[event.type] || []) {
                    listener(event);
                }
            }
        },
        URL,
        CustomEvent: class {
            constructor(type, options = {}) {
                this.type = type;
                this.detail = options.detail;
            }
        }
    };

    if (XMLHttpRequest) {
        context.XMLHttpRequest = XMLHttpRequest;
        context.window.XMLHttpRequest = XMLHttpRequest;
    }

    if (options.angularScope) {
        context.window.angular = { element: () => ({ scope: () => options.angularScope }) };
    }

    if (typeof options.angularHttpGet === 'function') {
        context.window.angular = {
            element: () => ({
                injector: () => ({
                    get: name => name === '$http' ? Object.assign((...args) => options.angularHttpGet(...args), { get: options.angularHttpGet }) : null
                })
            })
        };
    }

    context.window.window = context.window;
    context.window.document = documentStub;
    context.window.CustomEvent = context.CustomEvent;
    context.globalThis = context;

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'warehouse-barcode-bridge.js' });

    return context;
}

test('warehouse bridge extracts visible barcode candidates without inventing unit type', () => {
    const barcodeNode = new ElementStub({ tagName: 'SPAN', text: '2486831' });
    const card = new ElementStub({
        tagName: 'DIV',
        text: 'Промышленный 8-канальный модуль ввода PWM Waveshare ID: 43150731, Собрано 1/1 2486831',
        children: [barcodeNode]
    });
    const context = loadBridgeContext(createDocumentStub([card]));
    const responses = [];

    context.window.addEventListener('tab_wanderer:warehouse-shop-order-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-shop-order-request'));

    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, true);
    assert.equal(responses[0].source, 'warehouse-dom-visible');
    assert.equal(responses[0].shopOrder.id, '5147-290626');
    assert.equal(responses[0].shopOrder.assembly.length, 1);
    assert.equal(responses[0].shopOrder.assembly[0].product_item.product_id, '43150731');
    assert.equal(responses[0].shopOrder.assembly[0].product_item.barcode, '2486831');
    assert.equal(responses[0].shopOrder.assembly[0].product_item.type, null);
});



test('warehouse DOM fallback preserves Angular multi-barcode type instead of assuming unit type', () => {
    const barcodeNode = new ElementStub({ tagName: 'SPAN', text: '500020' });
    const card = new ElementStub({
        tagName: 'DIV',
        text: 'Набор одинаковых товаров ID: 24000045, Собрано 12/12 500020',
        children: [barcodeNode]
    });
    const context = loadBridgeContext(createDocumentStub([card]));
    const angularShopOrder = {
        number: '5147-290626',
        assembly: [
            {
                quantity: 12,
                product_item: {
                    barcode: '',
                    type: 1,
                    reserved_quantity: 12,
                    product_id: '24000045',
                    product: { id: '24000045', title: 'Набор одинаковых товаров' }
                }
            }
        ]
    };
    const rootScope = { ctrl: { shopOrder: angularShopOrder } };

    context.window.angular = {
        element() {
            return {
                injector() {
                    return { get: () => rootScope };
                },
                scope: () => rootScope,
                isolateScope: () => null,
                data: () => ({}),
                controller: () => null
            };
        }
    };

    const responses = [];
    context.window.addEventListener('tab_wanderer:warehouse-shop-order-response', event => {
        responses.push(event.detail);
    });
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-shop-order-request'));

    const response = responses.at(-1);
    assert.equal(response.ok, true);
    assert.equal(response.source, 'warehouse-dom-visible');
    assert.equal(response.shopOrder.assembly[0].product_item.product_id, '24000045');
    assert.equal(response.shopOrder.assembly[0].product_item.barcode, '500020');
    assert.equal(response.shopOrder.assembly[0].product_item.type, 1);
    assert.equal(response.shopOrder.assembly[0].product_item.reserved_quantity, 12);
});

test('warehouse bridge captures assembly API while preloaded on actions route', () => {
    const apiUrl = '/_api/private/warehouse/wh1/shop-orders/5147-290626/actions/assembly/4336';
    const context = loadBridgeContext(createDocumentStub([]), {
        locationHref: 'https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/actions?order=5147-290626',
        responsePayloadByUrl: {
            [apiUrl]: {
                shop_order: {
                    number: '5147-290626',
                    assembly: [
                        {
                            quantity: 1,
                            product_item: {
                                barcode: '2486831',
                                type: 0,
                                product_id: '43150731',
                                product: { id: '43150731', title: 'Промышленный модуль' }
                            }
                        }
                    ]
                }
            }
        }
    });
    const responses = [];

    context.window.addEventListener('tab_wanderer:warehouse-shop-order-response', event => {
        responses.push(event.detail);
    });
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-api-capture-arm', {
        detail: { durationMs: 5000 }
    }));

    const xhr = new context.window.XMLHttpRequest();
    xhr.open('POST', apiUrl);
    xhr.send();

    assert.equal(responses.length, 1);
    assert.equal(responses[0].source, 'warehouse-api-response');
    assert.equal(responses[0].shopOrder.number, '5147-290626');
    assert.equal(responses[0].shopOrder.assembly[0].product_item.barcode, '2486831');
});


test('warehouse bridge prefers captured API shopOrder over visible DOM fallback', () => {
    const apiUrl = '/_api/private/warehouse/wh1/shop-orders/5147-290626/actions/assembly/4336';
    const barcodeNode = new ElementStub({ tagName: 'SPAN', text: '9999999' });
    const card = new ElementStub({
        tagName: 'DIV',
        text: 'Промышленный 8-канальный модуль ввода PWM Waveshare ID: 43150731, Собрано 1/1 9999999',
        children: [barcodeNode]
    });
    const context = loadBridgeContext(createDocumentStub([card]), {
        responsePayloadByUrl: {
            [apiUrl]: {
                shop_order: {
                    number: '5147-290626',
                    assembly: [
                        {
                            quantity: 1,
                            product_item: {
                                barcode: '2486831',
                                type: 0,
                                product_id: '43150731',
                                product: { id: '43150731', title: 'Промышленный модуль' }
                            }
                        }
                    ]
                }
            }
        }
    });
    const responses = [];

    context.window.addEventListener('tab_wanderer:warehouse-shop-order-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-api-capture-arm', {
        detail: { durationMs: 5000 }
    }));

    const xhr = new context.window.XMLHttpRequest();
    xhr.open('GET', apiUrl);
    xhr.send();

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-shop-order-request'));

    const lastResponse = responses[responses.length - 1];
    assert.equal(lastResponse.ok, true);
    assert.equal(lastResponse.source, 'warehouse-api-response');
    assert.equal(lastResponse.shopOrder.assembly.length, 1);
    assert.equal(lastResponse.shopOrder.assembly[0].product_item.barcode, '2486831');
});


test('warehouse first-open panel reads assembly form controller without generic Angular graph scan', () => {
    const form = new ElementStub({ tagName: 'FORM' });
    const documentStub = createDocumentStub([form]);
    documentStub.querySelector = selector => selector === 'form[name="assemblyForm"]' ? form : null;
    const context = loadBridgeContext(documentStub);
    const order = {
        number: '5147-290626',
        items: [{ id: 12, item_id: 43150731, title: 'Модуль', assembled_quantity: 1,
            product_items: [{ id: 100, barcode: '2486831', type: 0, quantity: 1 }] }]
    };
    context.window.angular = {
        element(node) {
            if (node === form) return { scope: () => ({ $ctrl: { shopOrder: order } }) };
            return { scope: () => null, isolateScope: () => null, data: () => ({}), controller: () => null };
        }
    };
    const results = [];
    context.window.addEventListener('tab_wanderer:warehouse-shop-order-response', event => results.push(event.detail));
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-shop-order-request'));
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].source, 'angular-snapshot');
    assert.equal(results[0].shopOrder.assembly[0].product_item.barcode, '2486831');
    assert.match(results[0].debug.lastMatchedPath, /assembly-controller/);
});

test('warehouse bridge prefers Angular barcode snapshot over stored API shell without barcodes', () => {
    const apiUrl = '/_api/private/warehouse/wh1/shop-orders/5147-290626/actions/assembly/4336';
    const context = loadBridgeContext(createDocumentStub([]), {
        responsePayloadByUrl: {
            [apiUrl]: {
                shop_order: {
                    number: '5147-290626',
                    assembly: []
                }
            }
        }
    });
    const angularShopOrder = {
        number: '5147-290626',
        assembly: [
            {
                quantity: 1,
                product_item: {
                    barcode: '2486831',
                    type: 0,
                    product_id: '43150731',
                    product: { id: '43150731', title: 'Промышленный модуль' }
                }
            }
        ]
    };
    const rootScope = { ctrl: { shopOrder: angularShopOrder } };

    context.window.angular = {
        element() {
            return {
                injector() {
                    return { get: () => rootScope };
                },
                scope: () => rootScope,
                isolateScope: () => null,
                data: () => ({}),
                controller: () => null
            };
        }
    };

    const responses = [];
    context.window.addEventListener('tab_wanderer:warehouse-shop-order-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-api-capture-arm', {
        detail: { durationMs: 5000 }
    }));

    const xhr = new context.window.XMLHttpRequest();
    xhr.open('GET', apiUrl);
    xhr.send();

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-shop-order-request'));

    const lastResponse = responses.at(-1);
    assert.equal(lastResponse.ok, true);
    assert.equal(lastResponse.source, 'angular-snapshot');
    assert.equal(lastResponse.shopOrder.assembly[0].product_item.barcode, '2486831');
});

test('warehouse bridge ignores unsuccessful API responses before using barcode snapshots', () => {
    const apiUrl = '/_api/private/warehouse/wh1/shop-orders/5147-290626/actions/assembly/4336';
    const barcodeNode = new ElementStub({ tagName: 'SPAN', text: '2486831' });
    const card = new ElementStub({
        tagName: 'DIV',
        text: 'Промышленный модуль ID: 43150731, Собрано 1/1 2486831',
        children: [barcodeNode]
    });
    const context = loadBridgeContext(createDocumentStub([card]), {
        responsePayloadByUrl: {
            [apiUrl]: {
                httpStatus: 500,
                payload: {
                    shop_order: {
                        number: '5147-290626',
                        assembly: [
                            {
                                quantity: 1,
                                product_item: {
                                    barcode: '9999999',
                                    type: 0,
                                    product_id: '43150731'
                                }
                            }
                        ]
                    }
                }
            }
        }
    });
    const responses = [];

    context.window.addEventListener('tab_wanderer:warehouse-shop-order-response', event => {
        responses.push(event.detail);
    });
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-api-capture-arm', {
        detail: { durationMs: 5000 }
    }));

    const xhr = new context.window.XMLHttpRequest();
    xhr.open('POST', apiUrl);
    xhr.send();
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-shop-order-request'));

    const lastResponse = responses.at(-1);
    assert.equal(lastResponse.ok, true);
    assert.equal(lastResponse.source, 'warehouse-dom-visible');
    assert.equal(lastResponse.shopOrder.assembly[0].product_item.barcode, '2486831');
    assert.match(
        context.window.__TAB_WANDERER_WAREHOUSE_BRIDGE_DEBUG__.lastApiResult,
        /unsuccessful status/
    );
});

test('warehouse bridge clears an older API snapshot when a new assembly action is armed', () => {
    const apiUrl = '/_api/private/warehouse/wh1/shop-orders/5147-290626/actions/assembly/4336';
    const barcodeNode = new ElementStub({ tagName: 'SPAN', text: '9999999' });
    const card = new ElementStub({
        tagName: 'DIV',
        text: 'Промышленный модуль ID: 43150731, Собрано 1/1 9999999',
        children: [barcodeNode]
    });
    const context = loadBridgeContext(createDocumentStub([card]), {
        responsePayloadByUrl: {
            [apiUrl]: {
                shop_order: {
                    number: '5147-290626',
                    assembly: [{
                        quantity: 1,
                        product_item: {
                            barcode: '2486831',
                            type: 0,
                            product_id: '43150731'
                        }
                    }]
                }
            }
        }
    });
    const responses = [];
    context.window.addEventListener('tab_wanderer:warehouse-shop-order-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-api-capture-arm'));
    const xhr = new context.window.XMLHttpRequest();
    xhr.open('POST', apiUrl);
    xhr.send();

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-api-capture-arm'));
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-shop-order-request'));

    const lastResponse = responses.at(-1);
    assert.equal(lastResponse.source, 'warehouse-dom-visible');
    assert.equal(lastResponse.shopOrder.assembly[0].product_item.barcode, '9999999');
});

test('warehouse bridge ignores API requests that started before capture was armed', () => {
    const apiUrl = '/_api/private/warehouse/wh1/shop-orders/5147-290626/actions/assembly/4336';
    const barcodeNode = new ElementStub({ tagName: 'SPAN', text: '9999999' });
    const card = new ElementStub({
        tagName: 'DIV',
        text: 'Промышленный модуль ID: 43150731, Собрано 1/1 9999999',
        children: [barcodeNode]
    });
    const context = loadBridgeContext(createDocumentStub([card]), {
        responsePayloadByUrl: {
            [apiUrl]: {
                shop_order: {
                    number: '5147-290626',
                    assembly: [{
                        quantity: 1,
                        product_item: {
                            barcode: '2486831',
                            type: 0,
                            product_id: '43150731'
                        }
                    }]
                }
            }
        }
    });
    const responses = [];
    context.window.addEventListener('tab_wanderer:warehouse-shop-order-response', event => {
        responses.push(event.detail);
    });

    const xhr = new context.window.XMLHttpRequest();
    xhr.open('POST', apiUrl);
    xhr.send();
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-api-capture-arm'));
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-shop-order-request'));

    const lastResponse = responses.at(-1);
    assert.equal(lastResponse.source, 'warehouse-dom-visible');
    assert.equal(lastResponse.shopOrder.assembly[0].product_item.barcode, '9999999');
});

test('warehouse bridge treats status zero as unsuccessful on a real XHR object', () => {
    const apiUrl = '/_api/private/warehouse/wh1/shop-orders/5147-290626/actions/assembly/4336';
    const barcodeNode = new ElementStub({ tagName: 'SPAN', text: '2486831' });
    const card = new ElementStub({
        tagName: 'DIV',
        text: 'Промышленный модуль ID: 43150731, Собрано 1/1 2486831',
        children: [barcodeNode]
    });
    const context = loadBridgeContext(createDocumentStub([card]), {
        responsePayloadByUrl: {
            [apiUrl]: {
                httpStatus: 0,
                payload: {
                    shop_order: {
                        number: '5147-290626',
                        assembly: [{
                            quantity: 1,
                            product_item: {
                                barcode: '9999999',
                                type: 0,
                                product_id: '43150731'
                            }
                        }]
                    }
                }
            }
        }
    });
    const responses = [];
    context.window.addEventListener('tab_wanderer:warehouse-shop-order-response', event => {
        responses.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-api-capture-arm'));
    const xhr = new context.window.XMLHttpRequest();
    xhr.open('POST', apiUrl);
    xhr.send();
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-shop-order-request'));

    const lastResponse = responses.at(-1);
    assert.equal(lastResponse.source, 'warehouse-dom-visible');
    assert.equal(lastResponse.shopOrder.assembly[0].product_item.barcode, '2486831');
});

test('warehouse XHR capture uses one-shot loadend listeners on reused requests', () => {
    const orderId = '5147-290626';
    const apiUrl = 'https://amperkot.ru/web-apps/wh3/api/shop-orders/4336';
    const payload = {
        id: 4336,
        number: orderId,
        assembly: []
    };
    const context = loadBridgeContext(createDocumentStub([]), {
        locationHref: `https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/assembly/4336?order=${orderId}`,
        responsePayloadByUrl: {
            [apiUrl]: payload
        }
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-api-capture-arm', {
        detail: { reason: 'test', durationMs: 12000 }
    }));

    const xhr = new context.window.XMLHttpRequest();
    xhr.open('GET', apiUrl);
    xhr.send();
    assert.equal((xhr.listeners.loadend || []).length, 0);

    xhr.open('GET', apiUrl);
    xhr.send();
    assert.equal((xhr.listeners.loadend || []).length, 0);
});

test('warehouse bridge preserves zero quantities and marks coercive types invalid', () => {
    const apiUrl = '/_api/private/warehouse/wh1/shop-orders/5147-290626/actions/assembly/4336';
    const context = loadBridgeContext(createDocumentStub([]), {
        responsePayloadByUrl: {
            [apiUrl]: {
                shop_order: {
                    number: '5147-290626',
                    assembly: [
                        {
                            quantity: 0,
                            product_item: {
                                barcode: '2486831',
                                type: false,
                                quantity: 0,
                                reserved_quantity: 0,
                                product_id: '43150731',
                                product: { id: '43150731', title: 'Промышленный модуль' }
                            }
                        }
                    ]
                }
            }
        }
    });
    const responses = [];

    context.window.addEventListener('tab_wanderer:warehouse-shop-order-response', event => {
        responses.push(event.detail);
    });
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-api-capture-arm', {
        detail: { durationMs: 5000 }
    }));

    const xhr = new context.window.XMLHttpRequest();
    xhr.open('POST', apiUrl);
    xhr.send();

    const entry = responses.at(-1).shopOrder.assembly[0];
    assert.equal(entry.quantity, 0);
    assert.equal(entry.quantity_invalid, undefined);
    assert.equal(entry.product_item.type, null);
    assert.equal(entry.product_item.type_invalid, true);
    assert.equal(entry.product_item.quantity, 0);
    assert.equal(entry.product_item.quantity_invalid, undefined);
    assert.equal(entry.product_item.reserved_quantity, 0);
    assert.equal(entry.product_item.reserved_quantity_invalid, undefined);
});

test('warehouse bridge captures product item summary responses independently of assembly capture', () => {
    const productUrl = 'https://amperkot.ru/_api/v1/warehouse/wh1/products/39163106/product-items-summary';
    const context = loadBridgeContext(createDocumentStub(), {
        locationHref: 'https://amperkot.ru/web-apps/wh3/#/income/actions/3238/perform?s=true',
        responsePayloadByUrl: {
            [productUrl]: {
                '1': [
                    {
                        id: 6788,
                        title: 'В наличии СПб (Коробка #373)',
                        quantity: 68,
                        reserved_quantity: 0
                    }
                ]
            }
        }
    });

    const events = [];
    context.window.addEventListener('tab_wanderer:warehouse-product-items-summary-response', event => {
        events.push(event.detail);
    });

    const xhr = new context.XMLHttpRequest();
    xhr.open('GET', productUrl);
    xhr.send();

    assert.equal(events.length, 1);
    assert.equal(events[0].ok, true);
    assert.equal(events[0].productId, '39163106');
    assert.equal(events[0].payload['1'][0].quantity, 68);
});


test('warehouse bridge requests product item summary through Angular $http', async () => {
    const requested = [];
    const context = loadBridgeContext(createDocumentStub(), {
        locationHref: 'https://amperkot.ru/web-apps/wh3/#/income/actions/3238/perform?s=true',
        angularHttpGet: url => {
            requested.push(url);
            return Promise.resolve({
                data: {
                    '1': [
                        {
                            id: 6788,
                            title: 'В наличии СПб (Коробка #373)',
                            quantity: 68,
                            reserved_quantity: 0
                        }
                    ]
                },
                config: { url }
            });
        }
    });

    const events = [];
    context.window.addEventListener('tab_wanderer:warehouse-product-items-summary-response', event => {
        events.push(event.detail);
    });

    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-product-items-summary-request', {
        detail: { productId: '39163106' }
    }));

    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(requested, [
        '/_api/v1/warehouse/wh1/products/39163106/product-items-summary'
    ]);
    assert.equal(events.length, 1);
    assert.equal(events[0].ok, true);
    assert.equal(events[0].productId, '39163106');
    assert.equal(events[0].payload['1'][0].quantity, 68);
});


test('warehouse bridge requests only active income product when previous card is still visible', async () => {
    const firstProductCard = new ElementStub({
        tagName: 'DIV',
        style: { opacity: '1' },
        children: [new ElementStub({ tagName: 'P', text: 'ID: 39163106' })]
    });
    const secondProductCard = new ElementStub({
        tagName: 'DIV',
        style: { opacity: '1' },
        children: [new ElementStub({ tagName: 'P', text: 'ID: 23810781' })]
    });
    const requested = [];
    const context = loadBridgeContext(createDocumentStub([firstProductCard, secondProductCard]), {
        locationHref: 'https://amperkot.ru/web-apps/wh3/#/income/actions/3238/perform?s=true',
        angularHttpGet: url => {
            requested.push(url);
            return Promise.resolve({ data: { '1': [] }, config: { url } });
        }
    });

    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(requested, [
        '/_api/v1/warehouse/wh1/products/23810781/product-items-summary'
    ]);
});

test('warehouse bridge requests a newly added selected income product without repeating existing products', async () => {
    const firstProductCard = new ElementStub({
        tagName: 'DIV',
        style: { opacity: '1' },
        children: [new ElementStub({ tagName: 'P', text: 'ID: 39163106' })]
    });
    const secondProductCard = new ElementStub({
        tagName: 'DIV',
        style: { opacity: '1' },
        children: [new ElementStub({ tagName: 'P', text: 'ID: 23810781' })]
    });
    const requested = [];
    const elements = [firstProductCard];
    const context = loadBridgeContext(createDocumentStub(elements), {
        locationHref: 'https://amperkot.ru/web-apps/wh3/#/income/actions/3238/perform?s=true',
        angularHttpGet: url => {
            requested.push(url);
            return Promise.resolve({ data: { '1': [] }, config: { url } });
        }
    });

    await new Promise(resolve => setImmediate(resolve));
    elements.push(secondProductCard);
    context.window.dispatchEvent({ type: 'hashchange' });
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(requested, [
        '/_api/v1/warehouse/wh1/products/39163106/product-items-summary',
        '/_api/v1/warehouse/wh1/products/23810781/product-items-summary'
    ]);
});

test('warehouse bridge auto-requests selected income product without a content-script request event', async () => {
    const productCard = new ElementStub({
        tagName: 'DIV',
        style: { opacity: '1' },
        children: [
            new ElementStub({ tagName: 'P', text: 'ID: 39163106' })
        ]
    });
    let resolveHttp;
    const requested = [];
    const context = loadBridgeContext(createDocumentStub([productCard]), {
        locationHref: 'https://amperkot.ru/web-apps/wh3/#/income/actions/3238/perform?s=true',
        angularHttpGet: url => {
            requested.push(url);
            return new Promise(resolve => {
                resolveHttp = () => resolve({
                    data: {
                        '1': [
                            {
                                id: 6788,
                                title: 'В наличии СПб (Коробка #373)',
                                quantity: 68,
                                reserved_quantity: 0
                            }
                        ]
                    },
                    config: { url }
                });
            });
        }
    });

    const events = [];
    context.window.addEventListener('tab_wanderer:warehouse-product-items-summary-response', event => {
        events.push(event.detail);
    });

    assert.deepEqual(requested, [
        '/_api/v1/warehouse/wh1/products/39163106/product-items-summary'
    ]);

    resolveHttp();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(events.length, 1);
    assert.equal(events[0].productId, '39163106');
    assert.equal(events[0].payload['1'][0].quantity, 68);
});

test('warehouse disassembly captures exact selected unit barcode after confirmed quantity decrease', () => {
    const number = '2218-101126';
    const url = `https://amperkot.ru/_api/private/warehouse/wh1/shop-orders/${number}/actions/disassembly/4337?fields%5B0%5D=status.text`;
    const scope = { $ctrl: { shopOrder: { number, items: [
        {id:2348771,item_id:41128428,assembled_quantity:20,product_items:[
            {id:3998496,barcode:'2494390',type:0}, {id:3998497,barcode:'2494391',type:0}]},
        {id:2348774,item_id:41128433,assembled_quantity:9,product_items:[]}
    ] } } };
    const documentStub = createDocumentStub([]);
    documentStub.querySelector = selector => selector === 'form[name="disassemblyForm"]' ? {} : null;
    const ctx = loadBridgeContext(documentStub, {
        locationHref:`https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/disassembly/4337?order=${number}`,
        angularScope:scope,
        responsePayloadByUrl: { [url]: {
            order:{number,items:[{id:2348771,assembled_quantity:19},{id:2348774,assembled_quantity:9}]},
            shop_order:{number,source:{value:'OZON'}}
        }}
    });
    const events=[];
    ctx.window.addEventListener('tab_wanderer:warehouse-disassembly-confirmed', event=>events.push(event.detail));
    const xhr = new ctx.window.XMLHttpRequest();
    xhr.open('POST',url);
    xhr.send(JSON.stringify({ number, items:[
        {id:2348771,product_items:[{id:3998496}]},
        {id:2348774,product_items:[]}
    ]}));
    assert.equal(events.length,1);
    assert.equal(events[0].confirmed,true);
    assert.equal(events[0].source,'OZON');
    assert.deepEqual(JSON.parse(JSON.stringify(events[0].rows)),[
        {productId:'41128428',productItemId:'3998496',barcode:'2494390',type:0}
    ]);
});

test('warehouse disassembly rejects HTTP success without matching warehouse quantity decrease', () => {
    const number='2218-101126';
    const url=`https://amperkot.ru/_api/private/warehouse/wh1/shop-orders/${number}/actions/disassembly/4337`;
    const scope={$ctrl:{shopOrder:{number,items:[
        {id:2348771,item_id:41128428,assembled_quantity:20,product_items:[{id:3998496,barcode:'2494390',type:0}]}
    ]}}};
    const doc=createDocumentStub([]);
    doc.querySelector=selector=>selector==='form[name="disassemblyForm"]'?{}:null;
    const ctx=loadBridgeContext(doc,{
        locationHref:`https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/disassembly/4337?order=${number}`,
        angularScope:scope,
        responsePayloadByUrl:{ [url]: {order:{number,items:[{id:2348771,assembled_quantity:20}]},shop_order:{number,source:{value:'OZON'}}} }
    });
    const events=[];
    ctx.window.addEventListener('tab_wanderer:warehouse-disassembly-confirmed',event=>events.push(event.detail));
    const xhr = new ctx.window.XMLHttpRequest();
    xhr.open('POST',url);
    xhr.send(JSON.stringify({number,items:[{id:2348771,product_items:[{id:3998496}]}]}));
    assert.equal(events.length,0);
});

test('disassembly snapshot reports only selected unit barcodes and skips grouped items', () => {
    const form = new ElementStub({tagName: 'FORM'});
    const document = createDocumentStub([form]);
    document.querySelector = selector => selector === 'form[name="disassemblyForm"]' ? form : null;
    const scope = {$ctrl: {shopOrder: {
        number: '2218-101126', source: {value: 'OZON'}, items: [
            {item_id:'41128428', title:'NX-12B', product_items:[
                {id:3998496,barcode:'2494390',type:0},
                {id:3998497,barcode:'2494391',type:0}]},
            {item_id:'41128433', title:'Group', product_items:[
                {id:3998500,barcode:'2403226',type:1}]}
        ]
    }}};
    const context = loadBridgeContext(document, {
        locationHref:'https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/disassembly/4337?order=2218-101126',
        angularScope: scope
    });
    let snapshot;
    context.window.addEventListener('tab_wanderer:warehouse-disassembly-selection-response', e => { snapshot=e.detail; });
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-disassembly-selection-request'));
    assert.equal(snapshot.orderId,'2218-101126');
    assert.equal(snapshot.source,'OZON');
    assert.equal(snapshot.skipped,1);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.rows.map(r => [r.productId,r.productItemId,r.barcode]))), [
        ['41128428','3998496','2494390'], ['41128428','3998497','2494391']
    ]);
});

test('disassembly snapshot does not publish on assembly routes or mismatched order', () => {
    const form = new ElementStub({tagName:'FORM'});
    const document = createDocumentStub([form]);
    document.querySelector = () => form;
    const scope = {$ctrl: {shopOrder: {number:'9999-010101',items:[]}}};
    const context = loadBridgeContext(document, {
        locationHref:'https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/disassembly/4337?order=2218-101126',
        angularScope:scope
    });
    let called=false;
    context.window.addEventListener('tab_wanderer:warehouse-disassembly-selection-response',()=>{called=true;});
    context.window.dispatchEvent(new context.CustomEvent('tab_wanderer:warehouse-disassembly-selection-request'));
    assert.equal(called,false);
});

test('assembly POST sends exact scanned barcode immediately after confirmed quantity increase', () => {
    const apiUrl = '/_api/private/warehouse/wh1/shop-orders/5147-290626/actions/assembly/4336';
    const order = { number: '5147-290626', items: [
        { id: 2348771, item_id: '41128428', assembled_quantity: 19, title: 'Test',
            product_items: [{ id: 3998496, barcode: '2494390', type: 0 }] },
        { id: 2348774, item_id: '41128433', assembled_quantity: 9, product_items: [] }
    ] };
    const documentStub = createDocumentStub([]);
    documentStub.querySelector = selector => selector === 'form[name="assemblyForm"]' ? {} : null;
    const context = loadBridgeContext(documentStub, {
        angularScope: { $ctrl: { shopOrder: order } },
        responsePayloadByUrl: {
            [apiUrl]: { order: { number: order.number, items: [
                { id: 2348771, assembled_quantity: 20 }, { id: 2348774, assembled_quantity: 9 }
            ] }, shop_order: { number: order.number, source: { value: 'OZON' } } }
        }
    });
    const confirmed = [];
    context.window.addEventListener('tab_wanderer:warehouse-assembly-confirmed', e => confirmed.push(e.detail));
    const xhr = new context.window.XMLHttpRequest();
    xhr.open('POST', apiUrl);
    xhr.send(JSON.stringify({ number: order.number, items: [
        { id: 2348771, product_items: [{ id: 3998496 }] },
        { id: 2348774, product_items: [] }
    ] }));
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].rows.length, 1);
    assert.equal(confirmed[0].rows[0].barcode, '2494390');
    assert.equal(confirmed[0].rows[0].productId, '41128428');
    assert.equal(confirmed[0].rows[0].productItemId, '3998496');
});

test('assembly POST does not authorize Ozon write without confirmed count increase', () => {
    const apiUrl = '/_api/private/warehouse/wh1/shop-orders/5147-290626/actions/assembly/4336';
    const documentStub = createDocumentStub([]);
    documentStub.querySelector = () => ({});
    const context = loadBridgeContext(documentStub, {
        angularScope: { $ctrl: { shopOrder: { number: '5147-290626', items: [
            { id: 2348771, item_id: '41128428', assembled_quantity: 19,
                product_items: [{ id: 3998496, barcode: '2494390', type: 0 }] }
        ] } } },
        responsePayloadByUrl: { [apiUrl]: {
            order: { number: '5147-290626', items: [{ id: 2348771, assembled_quantity: 19 }] },
            shop_order: { number: '5147-290626', source: { value: 'OZON' } }
        } }
    });
    let confirmed = 0;
    context.window.addEventListener('tab_wanderer:warehouse-assembly-confirmed', () => confirmed++);
    const xhr = new context.window.XMLHttpRequest();
    xhr.open('POST', apiUrl);
    xhr.send(JSON.stringify({ number: '5147-290626', items: [
        { id: 2348771, product_items: [{ id: 3998496 }] }
    ] }));
    assert.equal(confirmed, 0);
});

test('assembly POST fails closed if selected product-item ID cannot be mapped to Angular barcode', () => {
    const apiUrl = '/_api/private/warehouse/wh1/shop-orders/5147-290626/actions/assembly/4336';
    const documentStub = createDocumentStub([]);
    documentStub.querySelector = () => ({});
    const context = loadBridgeContext(documentStub, {
        angularScope: { $ctrl: { shopOrder: { number: '5147-290626', items: [
            { id: 2348771, item_id: '41128428', assembled_quantity: 19, product_items: [] }
        ] } } },
        responsePayloadByUrl: { [apiUrl]: {
            order: { number: '5147-290626', items: [{ id: 2348771, assembled_quantity: 20 }] },
            shop_order: { number: '5147-290626', source: { value: 'OZON' } }
        } }
    });
    let confirmed = 0;
    context.window.addEventListener('tab_wanderer:warehouse-assembly-confirmed', () => confirmed++);
    const xhr = new context.window.XMLHttpRequest();
    xhr.open('POST', apiUrl);
    xhr.send(JSON.stringify({ number: '5147-290626', items: [
        { id: 2348771, product_items: [{ id: 3998496 }] }
    ] }));
    assert.equal(confirmed, 0);
});
