const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class ElementStub {
    constructor({ tagName = 'DIV', text = '', children = [], style = {}, href = '' } = {}) {
        this.tagName = tagName;
        this.textContent = text;
        this.innerText = text;
        this.children = children;
        this.style = style;
        this.href = href;
        for (const child of children) child.parentElement = this;
    }

    querySelectorAll(selector) {
        const result = [];
        const wantsAnchor = selector.includes('a[');
        const wantsProduct = selector.includes('products');
        const wantsTextNodes = selector.includes('h1') || selector.includes('p') || selector.includes('span') || selector.includes('div') || selector.includes('strong') || selector.includes('a');
        const visit = node => {
            for (const child of node.children || []) {
                const tag = String(child.tagName || '').toLowerCase();
                const textSelectorMatch = wantsTextNodes && ['h1','h2','h3','h4','p','strong','a','span','div'].includes(tag);
                const anchorMatch = wantsAnchor && tag === 'a' && wantsProduct && String(child.href || '').includes('products');
                if (anchorMatch || (!wantsAnchor && textSelectorMatch)) result.push(child);
                visit(child);
            }
        };
        visit(this);
        return result;
    }
}

function loadContext() {
    const context = { console: { log: () => {}, warn: () => {}, error: () => {} } };
    context.globalThis = context;
    vm.createContext(context);
    const core = fs.readFileSync(path.join(__dirname, '..', 'core', 'warehouse-stock-view-model.js'), 'utf8');
    vm.runInContext(core, context);
    const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
    const start = source.indexOf('function normalizeWarehouseIncomeProductTitleForContent');
    const end = source.indexOf('\nfunction getWarehouseIncomeProductIds()', start);
    const fragment = source.slice(start, end);
    vm.runInContext(fragment, context);
    context.ElementStub = ElementStub;
    return context;
}

test('extracts product title when name and ID are separate card nodes', () => {
    const context = loadContext();
    const card = new ElementStub({
        children: [
            new ElementStub({ tagName: 'P', text: 'Чернила маркировочные 30 мл' }),
            new ElementStub({ tagName: 'P', text: 'Поставщик: Технопайка' }),
            new ElementStub({ tagName: 'P', text: 'Артикул: 14527, ID: 39163106' })
        ]
    });
    assert.equal(context.extractWarehouseIncomeProductTitleFromCard(card), 'Чернила маркировочные 30 мл');
});
