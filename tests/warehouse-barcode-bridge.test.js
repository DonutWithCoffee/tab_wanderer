const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class ElementStub {
    constructor({ tagName = 'DIV', text = '', children = [] } = {}) {
        this.tagName = tagName.toUpperCase();
        this.innerText = text;
        this.textContent = text;
        this.children = children;
        this.parentElement = null;
        this.disabled = false;

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
    return class XMLHttpRequestStub {
        constructor() {
            this.listeners = {};
            this.status = 0;
            this.responseText = '';
            this.responseURL = '';
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

            for (const listener of this.listeners.loadend || []) {
                listener.call(this);
            }
        }

        addEventListener(type, listener) {
            this.listeners[type] = this.listeners[type] || [];
            this.listeners[type].push(listener);
        }
    };
}

function loadBridgeContext(documentStub, options = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'warehouse-barcode-bridge.js'), 'utf8');
    const listeners = {};
    const storage = {};
    const XMLHttpRequest = options.responsePayloadByUrl
        ? createXhrStub(options.responsePayloadByUrl)
        : undefined;
    const context = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        document: documentStub,
        location: {
            href: 'https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/assembly/4336?order=5147-290626',
            hash: '#/wh/shop-orders/assembly/4336?order=5147-290626'
        },
        window: {
            location: {
                href: 'https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/assembly/4336?order=5147-290626',
                hash: '#/wh/shop-orders/assembly/4336?order=5147-290626'
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

    context.window.window = context.window;
    context.window.document = documentStub;
    context.window.CustomEvent = context.CustomEvent;
    context.globalThis = context;

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'warehouse-barcode-bridge.js' });

    return context;
}

test('warehouse bridge extracts visible assembled barcodes from DOM without reload', () => {
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
    assert.equal(responses[0].shopOrder.assembly[0].product_item.type, 0);
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
