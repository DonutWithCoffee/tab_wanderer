const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeEventTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, handler) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }

        this.listeners.get(type).push(handler);
    }

    dispatchEvent(event) {
        const handlers = this.listeners.get(event.type) || [];

        for (const handler of handlers) {
            handler.call(this, event);
        }
    }
}

class FakeElement extends FakeEventTarget {
    constructor(tagName, ownerDocument, id = '') {
        super();
        this.tagName = String(tagName || '').toUpperCase();
        this.ownerDocument = ownerDocument;
        this.id = id;
        this.innerText = '';
        this.textContent = '';
        this.value = '';
        this.checked = false;
        this.attributes = {};
        this.className = '';
        this.dataset = {};
        this._innerHTML = '';
        this.onclick = null;

        this.classList = {
            add: (...tokens) => {
                const current = new Set(this.className.split(/\s+/).filter(Boolean));

                for (const token of tokens) {
                    current.add(token);
                }

                this.className = Array.from(current).join(' ');
            },
            remove: (...tokens) => {
                const blocked = new Set(tokens);
                this.className = this.className
                    .split(/\s+/)
                    .filter((token) => token && !blocked.has(token))
                    .join(' ');
            },
            contains: (token) => {
                return this.className.split(/\s+/).includes(token);
            }
        };
    }

    set innerHTML(value) {
        this._innerHTML = String(value || '');
        this.ownerDocument.registerScopeInputsFromHTML(this.id, this._innerHTML);
    }

    get innerHTML() {
        return this._innerHTML;
    }

    click() {
        if (typeof this.onclick === 'function') {
            this.onclick();
        }

        this.dispatchEvent({ type: 'click', target: this });
    }
}

class FakeInputElement extends FakeElement {
    constructor(ownerDocument, id = '') {
        super('input', ownerDocument, id);
        this.type = 'text';
    }

    matches(selector) {
        if (selector === 'input[data-scope-group]') {
            return this.tagName === 'INPUT' && this.dataset.scopeGroup;
        }

        return false;
    }
}

class FakeDocument extends FakeEventTarget {
    constructor() {
        super();

        this.elements = new Map();
        this.scopeInputs = [];

        this.body = new FakeElement('body', this, 'body');
    }

    createElement(tagName) {
        if (String(tagName).toLowerCase() === 'input') {
            return new FakeInputElement(this);
        }

        return new FakeElement(tagName, this);
    }

    registerElement(id, element) {
        this.elements.set(id, element);
        return element;
    }

    getElementById(id) {
        return this.elements.get(id) || null;
    }

    querySelectorAll(selector) {
        const checkedScopeMatch = selector.match(/^input\[data-scope-group="(.+)"\]:checked$/);

        if (checkedScopeMatch) {
            const group = checkedScopeMatch[1];

            return this.scopeInputs.filter((input) => {
                return input.dataset.scopeGroup === group && input.checked;
            });
        }

        return [];
    }

    registerScopeInputsFromHTML(containerId, html) {
        this.scopeInputs = this.scopeInputs.filter((input) => input.__containerId !== containerId);

        const inputRegex = /<input\s+([^>]+)>/g;
        let match = inputRegex.exec(html);

        while (match) {
            const attrs = match[1];
            const input = new FakeInputElement(this);

            input.__containerId = containerId;
            input.type = this.extractAttr(attrs, 'type') || 'checkbox';
            input.value = this.decodeHtml(this.extractAttr(attrs, 'value') || '');
            input.checked = /\schecked(?:\s|>)/.test(match[0]);
            input.dataset.scopeGroup = this.decodeHtml(this.extractAttr(attrs, 'data-scope-group') || '');

            this.scopeInputs.push(input);

            match = inputRegex.exec(html);
        }
    }

    extractAttr(attrs, name) {
        const regex = new RegExp(`${name}="([^"]*)"`);
        const found = attrs.match(regex);
        return found ? found[1] : '';
    }

    decodeHtml(value) {
        return String(value || '')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, '\'')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
    }
}

function createPopupDom() {
    const document = new FakeDocument();

    const ids = [
        'version',
        'status',
        'start',
        'stop',
        'monitorModeWindowed',
        'monitorModeActive',
        'ignoreOzon',
        'ignoreJurics',
        'scopeStatusSummary',
        'scopeStatusOptions',
        'scopeDeliverySummary',
        'scopeDeliveryOptions',
        'scopePaymentSummary',
        'scopePaymentOptions',
        'configStatus',
        'applyConfig',
        'resetConfig'
    ];

    for (const id of ids) {
              const isInput = ['monitorModeWindowed', 'monitorModeActive', 'ignoreOzon', 'ignoreJurics'].includes(id);
        const element = isInput ? new FakeInputElement(document, id) : new FakeElement('div', document, id);

        if (isInput) {
            element.type = ['monitorModeWindowed', 'monitorModeActive'].includes(id)
                ? 'radio'
                : 'checkbox';
        }

        document.registerElement(id, element);
    }

    return document;
}

function loadPopupContext(overrides = {}) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'popup.js'),
        'utf8'
    );

    const sentMessages = [];
    const manifest = { version: '0.9.7-test' };

    const defaultConfig = {
        monitorMode: 'windowed',
        rules: {
            ignoreOzon: false,
            ignoreLegalEntityBankTransfer: false
        },
        monitorScope: {
            status: ['6806'],
            delivery: ['9797'],
            payment: ['9791'],
            orderFlags: [],
            store: [],
            reserve: [],
            assemblyStatus: [],
            predicates: {
                ozonOnly: false,
                juridicalOnly: false
            }
        }
    };

    const defaultDictionaries = {
        status: [
            { id: '6806', label: 'Ожидает оплаты' },
            { id: '6810', label: 'Отменен' }
        ],
        delivery: [
            { id: '9797', label: 'Самовывоз' },
            { id: '9847', label: 'Курьер СДЭК' }
        ],
        payment: [
            { id: '9791', label: 'Наличными в офисе' },
            { id: '9793', label: 'Оплата онлайн' }
        ],
        updatedAt: 123
    };

    const document = createPopupDom();

    const context = {
        console: {
            log: () => {},
            warn: () => {},
            error: () => {}
        },
        document,
        window: {},
        HTMLInputElement: FakeInputElement,
        chrome: {
            runtime: {
                sendMessage: (msg, callback) => {
                    sentMessages.push(msg);

                    let response = { ok: true };

                    if (msg.type === 'CHECK_WORKER') {
                        response = { isRunning: true };
                    }

                    if (msg.type === 'GET_CONFIG') {
                        response = {
                            ok: true,
                            userConfig: JSON.parse(JSON.stringify(defaultConfig)),
                            monitorDictionaries: JSON.parse(JSON.stringify(defaultDictionaries))
                        };
                    }

                    if (msg.type === 'UPDATE_CONFIG') {
                        response = {
                            ok: true,
                            userConfig: JSON.parse(JSON.stringify(msg.userConfig))
                        };
                    }

                    if (typeof callback === 'function') {
                        callback(response);
                    }
                },
                getManifest: () => manifest
            }
        },
        __test: {
            sentMessages,
            document,
            defaultConfig,
            defaultDictionaries
        },
        ...overrides
    };

    context.globalThis = context;
    context.window = context;

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'popup.js' });

    document.dispatchEvent({ type: 'DOMContentLoaded' });

    return context;
}

function getSentMessagesByType(context, type) {
    return context.__test.sentMessages.filter((msg) => msg.type === type);
}

function getScopeCheckboxes(context, groupName) {
    return context.__test.document.scopeInputs.filter((input) => {
        return input.dataset.scopeGroup === groupName;
    });
}

test('popup initializes from GET_CONFIG and renders dictionaries', () => {
    const context = loadPopupContext();
    const document = context.__test.document;

    assert.equal(getSentMessagesByType(context, 'CHECK_WORKER').length, 1);
    assert.equal(getSentMessagesByType(context, 'GET_CONFIG').length, 1);

    assert.equal(document.getElementById('status').innerText, 'Status: RUNNING');
    assert.equal(document.getElementById('version').innerText, 'v0.9.7-test');
       assert.equal(document.getElementById('configStatus').innerText, 'No changes');

    assert.equal(document.getElementById('monitorModeWindowed').checked, true);
    assert.equal(document.getElementById('monitorModeActive').checked, false);
    assert.equal(document.getElementById('ignoreOzon').checked, false);
    assert.equal(document.getElementById('ignoreJurics').checked, false);

    assert.equal(document.getElementById('scopeStatusSummary').innerText, 'Статус: Ожидает оплаты');
    assert.equal(document.getElementById('scopeDeliverySummary').innerText, 'Доставка: Самовывоз');
    assert.equal(document.getElementById('scopePaymentSummary').innerText, 'Оплата: Наличными в офисе');

    assert.equal(getScopeCheckboxes(context, 'Status').length, 2);
    assert.equal(getScopeCheckboxes(context, 'Delivery').length, 2);
    assert.equal(getScopeCheckboxes(context, 'Payment').length, 2);
});

test('popup changes draft without live UPDATE_CONFIG on scope change', () => {
    const context = loadPopupContext();
    const statusCheckboxes = getScopeCheckboxes(context, 'Status');
    const updateCallsBefore = getSentMessagesByType(context, 'UPDATE_CONFIG').length;

    statusCheckboxes[1].checked = true;

    context.__test.document.dispatchEvent({
        type: 'change',
        target: statusCheckboxes[1]
    });

    const updateCallsAfter = getSentMessagesByType(context, 'UPDATE_CONFIG').length;

    assert.equal(updateCallsBefore, 0);
    assert.equal(updateCallsAfter, 0);
    assert.equal(context.__test.document.getElementById('configStatus').innerText, 'Unsaved changes');
    assert.equal(
        context.__test.document.getElementById('scopeStatusSummary').innerText,
        'Статус: Ожидает оплаты, Отменен'
    );
});

test('popup Apply sends UPDATE_CONFIG with draft state and clears dirty flag', () => {
    const context = loadPopupContext();
    const document = context.__test.document;
    const statusCheckboxes = getScopeCheckboxes(context, 'Status');

    statusCheckboxes[1].checked = true;

    document.dispatchEvent({
        type: 'change',
        target: statusCheckboxes[1]
    });

    document.getElementById('applyConfig').dispatchEvent({
        type: 'click',
        target: document.getElementById('applyConfig')
    });

    const updateCalls = getSentMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateCalls.length, 1);
    assert.equal(
        JSON.stringify(updateCalls[0].userConfig.monitorScope.status),
        JSON.stringify(['6806', '6810'])
    );
    assert.equal(document.getElementById('configStatus').innerText, 'No changes');
});

test('popup Reset restores current config and clears unsaved state', () => {
    const context = loadPopupContext();
    const document = context.__test.document;
    const statusCheckboxes = getScopeCheckboxes(context, 'Status');

    statusCheckboxes[1].checked = true;

    document.dispatchEvent({
        type: 'change',
        target: statusCheckboxes[1]
    });

    assert.equal(document.getElementById('configStatus').innerText, 'Unsaved changes');

    document.getElementById('resetConfig').dispatchEvent({
        type: 'click',
        target: document.getElementById('resetConfig')
    });

    const resetStatusCheckboxes = getScopeCheckboxes(context, 'Status');

    assert.equal(document.getElementById('configStatus').innerText, 'No changes');
    assert.equal(resetStatusCheckboxes[0].checked, true);
    assert.equal(resetStatusCheckboxes[1].checked, false);
    assert.equal(document.getElementById('scopeStatusSummary').innerText, 'Статус: Ожидает оплаты');
});

test('popup rules checkbox also works through draft and Apply', () => {
    const context = loadPopupContext();
    const document = context.__test.document;
    const ignoreOzon = document.getElementById('ignoreOzon');

    ignoreOzon.checked = true;
    ignoreOzon.dispatchEvent({
        type: 'change',
        target: ignoreOzon
    });

    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(document.getElementById('configStatus').innerText, 'Unsaved changes');

    document.getElementById('applyConfig').dispatchEvent({
        type: 'click',
        target: document.getElementById('applyConfig')
    });

    const updateCalls = getSentMessagesByType(context, 'UPDATE_CONFIG');

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].userConfig.rules.ignoreOzon, true);
    assert.equal(document.getElementById('configStatus').innerText, 'No changes');
});

test('popup handles empty monitorDictionaries without crashing', () => {
    const sentMessages = [];

    const context = loadPopupContext({
        chrome: {
            runtime: {
                sendMessage: (msg, callback) => {
                    sentMessages.push(msg);

                    let response = { ok: true };

                    if (msg.type === 'CHECK_WORKER') {
                        response = { isRunning: true };
                    }

                    if (msg.type === 'GET_CONFIG') {
                        response = {
                            ok: true,
                            userConfig: {
                                rules: {
                                    ignoreOzon: false,
                                    ignoreLegalEntityBankTransfer: false
                                },
                                monitorScope: {
                                    status: ['6806'],
                                    delivery: ['9797'],
                                    payment: ['9791'],
                                    orderFlags: [],
                                    store: [],
                                    reserve: [],
                                    assemblyStatus: [],
                                    predicates: {
                                        ozonOnly: false,
                                        juridicalOnly: false
                                    }
                                }
                            },
                            monitorDictionaries: null
                        };
                    }

                    if (msg.type === 'UPDATE_CONFIG') {
                        response = {
                            ok: true,
                            userConfig: JSON.parse(JSON.stringify(msg.userConfig))
                        };
                    }

                    if (typeof callback === 'function') {
                        callback(response);
                    }
                },
                getManifest: () => ({ version: '0.9.7-test' })
            }
        }
    });

    context.__test.sentMessages = sentMessages;

    const document = context.__test.document;

    assert.equal(document.getElementById('configStatus').innerText, 'No changes');
    assert.equal(document.getElementById('scopeStatusSummary').innerText, 'Статус: 1 выбрано');
    assert.equal(document.getElementById('scopeDeliverySummary').innerText, 'Доставка: 1 выбрано');
    assert.equal(document.getElementById('scopePaymentSummary').innerText, 'Оплата: 1 выбрано');
    assert.equal(getScopeCheckboxes(context, 'Status').length, 0);
    assert.equal(getScopeCheckboxes(context, 'Delivery').length, 0);
    assert.equal(getScopeCheckboxes(context, 'Payment').length, 0);
});

test('popup keeps working when monitorScope contains unknown ids', () => {
    const sentMessages = [];
    const defaultDictionaries = {
        status: [
            { id: '6806', label: 'Ожидает оплаты' },
            { id: '6810', label: 'Отменен' }
        ],
        delivery: [
            { id: '9797', label: 'Самовывоз' },
            { id: '9847', label: 'Курьер СДЭК' }
        ],
        payment: [
            { id: '9791', label: 'Наличными в офисе' },
            { id: '9793', label: 'Оплата онлайн' }
        ],
        updatedAt: 123
    };

    const context = loadPopupContext({
        chrome: {
            runtime: {
                sendMessage: (msg, callback) => {
                    sentMessages.push(msg);

                    let response = { ok: true };

                    if (msg.type === 'CHECK_WORKER') {
                        response = { isRunning: true };
                    }

                    if (msg.type === 'GET_CONFIG') {
                        response = {
                            ok: true,
                            userConfig: {
                                rules: {
                                    ignoreOzon: false,
                                    ignoreLegalEntityBankTransfer: false
                                },
                                monitorScope: {
                                    status: ['999999'],
                                    delivery: ['888888'],
                                    payment: ['777777'],
                                    orderFlags: [],
                                    store: [],
                                    reserve: [],
                                    assemblyStatus: [],
                                    predicates: {
                                        ozonOnly: false,
                                        juridicalOnly: false
                                    }
                                }
                            },
                            monitorDictionaries: JSON.parse(JSON.stringify(defaultDictionaries))
                        };
                    }

                    if (msg.type === 'UPDATE_CONFIG') {
                        response = {
                            ok: true,
                            userConfig: JSON.parse(JSON.stringify(msg.userConfig))
                        };
                    }

                    if (typeof callback === 'function') {
                        callback(response);
                    }
                },
                getManifest: () => ({ version: '0.9.7-test' })
            }
        }
    });

    context.__test.sentMessages = sentMessages;

    const document = context.__test.document;

    assert.equal(document.getElementById('scopeStatusSummary').innerText, 'Статус: 1 выбрано');
    assert.equal(document.getElementById('scopeDeliverySummary').innerText, 'Доставка: 1 выбрано');
    assert.equal(document.getElementById('scopePaymentSummary').innerText, 'Оплата: 1 выбрано');
});

test('popup summary uses compact format for three or more selected values', () => {
    const sentMessages = [];
    const defaultDictionaries = {
        delivery: [
            { id: '9797', label: 'Самовывоз' },
            { id: '9847', label: 'Курьер СДЭК' }
        ],
        payment: [
            { id: '9791', label: 'Наличными в офисе' },
            { id: '9793', label: 'Оплата онлайн' }
        ]
    };

    const context = loadPopupContext({
        chrome: {
            runtime: {
                sendMessage: (msg, callback) => {
                    sentMessages.push(msg);

                    let response = { ok: true };

                    if (msg.type === 'CHECK_WORKER') {
                        response = { isRunning: true };
                    }

                    if (msg.type === 'GET_CONFIG') {
                        response = {
                            ok: true,
                            userConfig: {
                                rules: {
                                    ignoreOzon: false,
                                    ignoreLegalEntityBankTransfer: false
                                },
                                monitorScope: {
                                    status: ['6806', '6810', '11184'],
                                    delivery: ['9797'],
                                    payment: ['9791'],
                                    orderFlags: [],
                                    store: [],
                                    reserve: [],
                                    assemblyStatus: [],
                                    predicates: {
                                        ozonOnly: false,
                                        juridicalOnly: false
                                    }
                                }
                            },
                            monitorDictionaries: {
                                status: [
                                    { id: '6806', label: 'Ожидает оплаты' },
                                    { id: '6810', label: 'Отменен' },
                                    { id: '11184', label: 'Готов к выдаче' }
                                ],
                                delivery: JSON.parse(JSON.stringify(defaultDictionaries.delivery)),
                                payment: JSON.parse(JSON.stringify(defaultDictionaries.payment)),
                                updatedAt: 123
                            }
                        };
                    }

                    if (msg.type === 'UPDATE_CONFIG') {
                        response = {
                            ok: true,
                            userConfig: JSON.parse(JSON.stringify(msg.userConfig))
                        };
                    }

                    if (typeof callback === 'function') {
                        callback(response);
                    }
                },
                getManifest: () => ({ version: '0.9.7-test' })
            }
        }
    });

    context.__test.sentMessages = sentMessages;

    assert.equal(
        context.__test.document.getElementById('scopeStatusSummary').innerText,
        'Статус: Ожидает оплаты, Отменен +1'
    );
});

test('popup Apply does nothing when there are no changes', () => {
    const context = loadPopupContext();
    const document = context.__test.document;

    document.getElementById('applyConfig').dispatchEvent({
        type: 'click',
        target: document.getElementById('applyConfig')
    });

    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(document.getElementById('configStatus').innerText, 'No changes');
});

test('popup Reset does nothing harmful when there are no changes', () => {
    const context = loadPopupContext();
    const document = context.__test.document;

    document.getElementById('resetConfig').dispatchEvent({
        type: 'click',
        target: document.getElementById('resetConfig')
    });

    assert.equal(getSentMessagesByType(context, 'UPDATE_CONFIG').length, 0);
    assert.equal(document.getElementById('configStatus').innerText, 'No changes');
    assert.equal(document.getElementById('scopeStatusSummary').innerText, 'Статус: Ожидает оплаты');
});