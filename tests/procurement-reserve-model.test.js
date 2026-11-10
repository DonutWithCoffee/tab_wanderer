'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../core/procurement-reserve-model.js');

function item(id, quantity, status = 'pending', title = 'Product') {
    return { product: { id, article: `SKU-${id}`, title }, quantity, status };
}

test('reads the whole Angular procurement array regardless of UI pagination', () => {
    const input = JSON.stringify([item(12, 3, 'pending', 'Model ]; [text]'), item(42, 2)]);
    const source = `angular.module('x').controller('WrongCtrl', function() {vm.items=[];})\n.controller('ProcurementItemsCtrl', function() {vm.items = ${input}; vm.pagination={per_page:50};});`;
    const actual = model.readJsonArrayAssignment(source);
    assert.equal(actual.length, 2);
    assert.equal(actual[0].product.title, 'Model ]; [text]');
});

test('rejects unrecognized procurement source and invalid JSON', () => {
    assert.throws(() => model.readJsonArrayAssignment('vm.items = [];'), /контроллер/);
    assert.throws(() => model.readJsonArrayAssignment(".controller('ProcurementItemsCtrl', x => {vm.items = [{];"), /JSON|массив/);
});

test('combines duplicated product IDs, skips rejected and zero quantity', () => {
    const s = model.summarizeItems([item(1, 4), item(2, 0), item(1, 2), item(3, 9, 'rejected')]);
    assert.equal(s.sourceRows, 4);
    assert.equal(s.skipped, 2);
    assert.equal(s.sourceUnits, 15);
    assert.equal(s.units, 6);
    assert.deepEqual(s.rows.map(x => [x.id, x.quantity, x.sourceRows]), [[1, 6, 2]]);
});

test('zero-quantity rejected items are not placed into the order', () => {
    const s = model.summarizeItems([item(44, 0, 'rejected'), item(45, 2)]);
    assert.deepEqual(s.rows.map(x => x.id), [45]);
    assert.equal(s.problems.length, 0);
});

test('invalid quantities and missing product IDs fail validation', () => {
    const s = model.summarizeItems([item(1, -3), item(2, 1.5), { quantity: 3, status: 'pending' }, item(4, '3')]);
    assert.equal(s.problems.length, 3);
    assert.equal(s.rows[0].id, 4);
});

test('accepts only the legacy admin order URL on amperkot.ru', () => {
    const s = model.parseOrderUrl(' https://amperkot.ru/admin/orders/3486-101126/ ');
    assert.equal(s.number, '3486-101126');
    assert.equal(s.formUrl, 'https://amperkot.ru/admin/orders/3486-101126/items/new/?type=product');
    assert.equal(model.parseOrderUrl('https://amperkot.ru/admin/orders/2-345').number, '2-345');
});

test('rejects offsite URLs, lookalikes, orders2 and paths other than order detail', () => {
    for (const url of [
        'https://evil-amperkot.ru/admin/orders/3486-101126/',
        'https://amperkot.ru.evil.com/admin/orders/3486-101126/',
        'http://amperkot.ru/admin/orders/3486-101126/',
        'https://amperkot.ru/admin/orders2/3486-101126/',
        'https://amperkot.ru/admin/orders/3486-101126/items/new/',
        'https://amperkot.ru/admin/orders/3486-101126/?token=abc',
        'javascript:alert(1)',
        'https://username:secret@amperkot.ru/admin/orders/3486-101126/'
    ]) {
        assert.throws(() => model.parseOrderUrl(url), undefined, url);
    }
});

test('reconciliation safely returns all items for an empty order', () => {
    const rows = model.summarizeItems([item(1, 2), item(2, 3)]).rows;
    const plan = model.reconcileItems(rows, new Map());
    assert.deepEqual(plan.toAdd.map(x => x.id), [1, 2]);
    assert.equal(plan.already.length, 0);
    assert.equal(plan.conflicts.length, 0);
});

test('reconciliation prevents duplicate adds after partial run', () => {
    const rows = model.summarizeItems([item(1, 2), item(2, 3)]).rows;
    const plan = model.reconcileItems(rows, new Map([[1, 2]]));
    assert.deepEqual(plan.toAdd.map(x => x.id), [2]);
    assert.deepEqual(plan.already.map(x => x.id), [1]);
    assert.equal(plan.conflicts.length, 0);
});

test('reconciliation blocks unknown and mismatched existing items', () => {
    const rows = model.summarizeItems([item(1, 2), item(2, 3)]).rows;
    const plan = model.reconcileItems(rows, new Map([[1, 1], [99, 5]]));
    assert.equal(plan.conflicts.length, 2);
    assert.match(plan.conflicts[0], /ID 1/);
    assert.match(plan.conflicts[1], /ID 99/);
});

test('fast transfer reads order only at start and finish and verifies each POST redirect snapshot', async () => {
    const desired = [item(1, 2), item(2, 5), item(3, 1)];
    const rows = model.summarizeItems(desired).rows;
    const existing = new Map();
    const events = [];
    let reads = 0;
    let tokens = 0;
    let posts = 0;
    const result = await model.transferToOrder(rows, {
        readOrder: async () => { reads += 1; return new Map(existing); },
        getFormToken: async () => { tokens += 1; return 'csrf'; },
        addAndRead: async (row, token) => {
            assert.equal(token, 'csrf');
            posts += 1;
            assert.ok(!existing.has(row.id), 'must not submit the same product twice');
            existing.set(row.id, row.quantity);
            return new Map(existing); // parsed HTML of the POST redirect
        },
        onUpdate: ({ phase, added }) => events.push([phase, added])
    });
    assert.deepEqual(result, { added: 3, already: 0, total: 3 });
    assert.equal(reads, 2); // not 2 extra GETs for every product
    assert.equal(tokens, 1);
    assert.equal(posts, 3);
    assert.deepEqual(events.filter(([phase]) => phase === 'confirmed').map(([, count]) => count), [1, 2, 3]);
});

test('fast transfer resumes a partially copied order without duplicate writes', async () => {
    const rows = model.summarizeItems([item(1, 2), item(2, 3)]).rows;
    const existing = new Map([[1, 2]]);
    const added = [];
    const result = await model.transferToOrder(rows, {
        readOrder: async () => new Map(existing),
        getFormToken: async () => 'token',
        addAndRead: async (row) => { added.push(row.id); existing.set(row.id, row.quantity); return new Map(existing); }
    });
    assert.deepEqual(added, [2]);
    assert.deepEqual(result, { added: 1, already: 1, total: 2 });
});

test('fast transfer fails closed when POST redirect does not show the new product', async () => {
    const rows = model.summarizeItems([item(1, 2), item(2, 3)]).rows;
    let posts = 0;
    let reads = 0;
    await assert.rejects(model.transferToOrder(rows, {
        readOrder: async () => { reads += 1; return new Map(); },
        getFormToken: async () => 'token',
        addAndRead: async () => { posts += 1; return new Map(); }
    }), /не обнаружен/);
    assert.equal(posts, 1);
    assert.equal(reads, 1); // no unverified second POST, nor final 'success' read
});

test('fast transfer detects unexpected products in redirected order snapshot and stops', async () => {
    const rows = model.summarizeItems([item(1, 2), item(2, 3)]).rows;
    let posts = 0;
    await assert.rejects(model.transferToOrder(rows, {
        readOrder: async () => new Map(),
        getFormToken: async () => 'token',
        addAndRead: async (row) => {
            posts += 1;
            return new Map([[row.id, row.quantity], [999, 1]]);
        }
    }), /посторонний товар/);
    assert.equal(posts, 1);
});

test('fast transfer respects stop request before making another write', async () => {
    const rows = model.summarizeItems([item(1, 2), item(2, 3)]).rows;
    const existing = new Map();
    let posts = 0;
    let cancelled = false;
    await assert.rejects(model.transferToOrder(rows, {
        readOrder: async () => new Map(existing),
        getFormToken: async () => 'token',
        addAndRead: async (row) => {
            posts += 1;
            existing.set(row.id, row.quantity);
            cancelled = true;
            return new Map(existing);
        },
        isCancelled: () => cancelled
    }), /Остановлено пользователем/);
    assert.equal(posts, 1);
});

test('fast transfer skips token and writes for already complete order and independently verifies', async () => {
    const rows = model.summarizeItems([item(1, 2)]).rows;
    let reads = 0;
    const result = await model.transferToOrder(rows, {
        readOrder: async () => { reads += 1; return new Map([[1, 2]]); },
        getFormToken: async () => { throw new Error('token not needed'); },
        addAndRead: async () => { throw new Error('write not needed'); }
    });
    assert.deepEqual(result, { added: 0, already: 1, total: 1 });
    assert.equal(reads, 2);
});
