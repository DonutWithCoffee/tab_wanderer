const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createPanelContext() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
    const stateStart = source.indexOf('const warehouseDisassemblyPanelState =');
    const stateEnd = source.indexOf('\nfunction getWarehouseDisassemblyPanelButton(', stateStart);
    const rowsStart = source.indexOf('function getWarehouseDisassemblyPanelRows()');
    const rowsEnd = source.indexOf('\nfunction renderWarehouseDisassemblyPanel()', rowsStart);
    const extractionStart = source.indexOf('function makeWarehouseDisassemblyVerificationExtraction(rows)');
    const extractionEnd = source.indexOf('\nfunction handleWarehouseDisassemblyPanelAction(', extractionStart);
    for (const pos of [stateStart,stateEnd,rowsStart,rowsEnd,extractionStart,extractionEnd]) assert.ok(pos>=0);
    const context = { getWarehouseOrderIdFromUrl: () => '2218-101126' };
    vm.createContext(context);
    vm.runInContext(`${source.slice(stateStart,stateEnd)}\n${source.slice(rowsStart,rowsEnd)}\n${source.slice(extractionStart,extractionEnd)}`,context);
    return context;
}

test('disassembly panel read-only preview includes only warehouse selected barcodes', () => {
    const context = createPanelContext();
    vm.runInContext(`warehouseDisassemblyPanelState.selected = [
        {productId:'41128428', productItemId:'3998496',barcode:'2494390',type:0},
        {productId:'41128428', productItemId:'3998497',barcode:'2494391',type:0},
        {productId:'41128433', productItemId:'3998500',barcode:'2403226',type:0}
    ]`,context);
    const extraction = vm.runInContext('makeWarehouseDisassemblyVerificationExtraction(getWarehouseDisassemblyPanelRows())',context);
    assert.equal(extraction.orderId,'2218-101126');
    assert.deepEqual(JSON.parse(JSON.stringify(extraction.productsById['41128428'].eligibleBarcodes.map(r=>r.barcode))),['2494390','2494391']);
    assert.deepEqual(JSON.parse(JSON.stringify(extraction.productsById['41128433'].eligibleBarcodes.map(r=>r.barcode))),['2403226']);
});

test('confirmed disassembly takes precedence over scanned selection for Ozon operations', () => {
    const context = createPanelContext();
    vm.runInContext(`warehouseDisassemblyPanelState.selected = [
        {productId:'41128428',productItemId:'3998496',barcode:'2494390',type:0},
        {productId:'41128428',productItemId:'3998497',barcode:'2494391',type:0}
    ]; warehouseDisassemblyPanelState.confirmed = [
        {productId:'41128428',productItemId:'3998496',barcode:'2494390',type:0}
    ]`,context);
    const rows = vm.runInContext('getWarehouseDisassemblyPanelRows()',context);
    assert.deepEqual(JSON.parse(JSON.stringify(rows.map(r=>r.barcode))),['2494390']);
    const extraction = vm.runInContext('makeWarehouseDisassemblyVerificationExtraction(getWarehouseDisassemblyPanelRows())',context);
    assert.deepEqual(JSON.parse(JSON.stringify(extraction.productsById['41128428'].eligibleBarcodes.map(r=>r.barcode))),['2494390']);
});

test('Ozon read-only preview rejects malformed product identifiers and barcodes', () => {
    const context = createPanelContext();
    const result = vm.runInContext("makeWarehouseDisassemblyVerificationExtraction([{productId:'41128428',barcode:'bad barcode'}])",context);
    assert.equal(result,null);
});

test('disassembly keeps assembled barcode list independent from selected removal list', () => {
    const context = createPanelContext();
    vm.runInContext(`warehouseDisassemblyPanelState.assembled = [
        {productId:'41128428',barcode:'2494390',type:0},
        {productId:'41128428',barcode:'2494391',type:0},
        {productId:'41128433',barcode:'2403226',type:1,quantity:9}
    ]; warehouseDisassemblyPanelState.selected = [
        {productId:'41128428',productItemId:'3998496',barcode:'2494390',type:0}
    ]`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('getWarehouseDisassemblyAssembledRows()',context).map(r => r.barcode))), ['2494390','2494391','2403226']);
    assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('getWarehouseDisassemblyPanelRows()',context).map(r => r.barcode))), ['2494390']);
    assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('makeWarehouseDisassemblyVerificationExtraction(getWarehouseDisassemblyPanelRows()).productsById["41128428"].eligibleBarcodes.map(r => r.barcode)',context))), ['2494390']);
});

test('resetting disassembly order removes both barcode lists', () => {
    const context = createPanelContext();
    vm.runInContext(`warehouseDisassemblyPanelState.assembled=[{barcode:'2494390'}]; warehouseDisassemblyPanelState.selected=[{barcode:'2494391'}]; warehouseDisassemblyPanelState.confirmed=[{barcode:'2494392'}]; resetWarehouseDisassemblyPanel('1111-111111')`, context);
    assert.equal(vm.runInContext('warehouseDisassemblyPanelState.assembled.length',context), 0);
    assert.equal(vm.runInContext('warehouseDisassemblyPanelState.selected.length',context), 0);
    assert.equal(vm.runInContext('warehouseDisassemblyPanelState.confirmed.length',context), 0);
});

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
function autoApplyFreshnessContext() {
    const start = contentSource.indexOf('function isWarehouseAutoApplySnapshotFresh(');
    const end = contentSource.indexOf('\nfunction maybeStartWarehouseAutoApply(', start);
    assert.ok(start >= 0 && end > start);
    const context = {
        warehouseAutoApplyIntent: { status:'waiting', orderId:'2218-101126', expiresAt: Date.now()+60000, baselineKnown:true, baselineFingerprint:'41128428:2494390:0', sourceRoute:'assembly' },
        getWarehouseOrderIdFromUrl: () => '2218-101126',
        getWarehouseBarcodePreviewOrderId: p => p.orderId,
        normalizeAmperkotOrderId: id => id,
        getWarehouseBarcodePreviewFingerprint: p => p.fingerprint,
        isWarehouseAssemblyPageUrl: () => true,
        WAREHOUSE_DOCUMENT_INSTANCE_ID: 'document-a'
    };
    vm.createContext(context);
    vm.runInContext(contentSource.slice(start,end), context);
    return context;
}

test('partially assembled order does not trigger auto-add on old nonempty API snapshot', () => {
    const context = autoApplyFreshnessContext();
    const oldPreview = {orderId:'2218-101126', summary:{eligibleCount:1},fingerprint:'41128428:2494390:0'};
    assert.equal(context.isWarehouseAutoApplySnapshotFresh(oldPreview,'warehouse-api-response'), false);
});

test('partially assembled order refuses Angular-only changes until confirmed POST', () => {
    const context = autoApplyFreshnessContext();
    const updatedPreview = {orderId:'2218-101126', summary:{eligibleCount:2},fingerprint:'41128428:2494390:0|41128428:2494391:0'};
    assert.equal(context.isWarehouseAutoApplySnapshotFresh(updatedPreview,'angular-snapshot'), false);
    assert.equal(context.isWarehouseAutoApplySnapshotFresh(updatedPreview,'warehouse-api-response'), false);
});

test('automatic addition still refuses snapshots from another order', () => {
    const context = autoApplyFreshnessContext();
    assert.equal(context.isWarehouseAutoApplySnapshotFresh({orderId:'9999-999999',summary:{eligibleCount:2},fingerprint:'changed'},'warehouse-api-response'),false);
});

test('disassembly uses assembly-style groups by article with multiline barcodes', () => {
    const start = contentSource.indexOf('function groupWarehouseDisassemblyBarcodes(');
    const end = contentSource.indexOf('\nfunction appendWarehouseDisassemblyBarcodeList(', start);
    assert.ok(start >= 0 && end > start);
    const context = {};
    vm.createContext(context);
    vm.runInContext(contentSource.slice(start, end), context);
    const grouped = vm.runInContext(`groupWarehouseDisassemblyBarcodes([
        {productId:'41128428', title:'Red button',barcode:'2494386',type:0},
        {productId:'41128433', title:'Yellow button',barcode:'2403226',type:1,quantity:9},
        {productId:'41128428', title:'Red button',barcode:'2494378',type:0},
        {productId:'41128428', title:'Red button',barcode:'2494378',type:0},
        {productId:'41128449', title:'Power button',barcode:'2416154',type:0}
    ])`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(grouped.map(r => r.productId))), ['41128428','41128433','41128449']);
    assert.deepEqual(JSON.parse(JSON.stringify(grouped[0].barcodes)), ['2494386','2494378']);
    assert.equal(grouped[0].productTitle,'Red button');
    assert.deepEqual(JSON.parse(JSON.stringify(grouped[1].barcodes)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(grouped[1].skippedBarcodeGroups)),
        [{label:'Мультиштрихкоды',count:1,barcodes:['2403226']}]);
});

test('disassembly confirmation and displayed assembled lists group separately', () => {
    const start = contentSource.indexOf('function groupWarehouseDisassemblyBarcodes(');
    const end = contentSource.indexOf('\nfunction appendWarehouseDisassemblyBarcodeList(', start);
    const context = createPanelContext();
    vm.runInContext(contentSource.slice(start, end), context);
    vm.runInContext(`warehouseDisassemblyPanelState.assembled = [
        {productId:'41128428',barcode:'2494386',type:0},
        {productId:'41128428',barcode:'2494378',type:0}
    ]; warehouseDisassemblyPanelState.confirmed = [
        {productId:'41128428',barcode:'2494386',type:0}
    ]`, context);
    const assembled = vm.runInContext('groupWarehouseDisassemblyBarcodes(getWarehouseDisassemblyAssembledRows())',context);
    const remove = vm.runInContext('groupWarehouseDisassemblyBarcodes(getWarehouseDisassemblyPanelRows())',context);
    assert.deepEqual(JSON.parse(JSON.stringify(assembled[0].barcodes)), ['2494386','2494378']);
    assert.deepEqual(JSON.parse(JSON.stringify(remove[0].barcodes)), ['2494386']);
});

test('successful verified removal disables manual removal for that disassembly', () => {
    const start = contentSource.indexOf('function isWarehouseDisassemblyRemovalSatisfied(');
    const end = contentSource.indexOf('\nfunction handleWarehouseRuntimeMessage(', start);
    assert.ok(start >= 0 && end > start);
    const context = {};
    vm.createContext(context);
    vm.runInContext(contentSource.slice(start,end),context);
    assert.equal(context.isWarehouseDisassemblyRemovalSatisfied({ok:true,removedCount:1,alreadyMissingCount:0},1),true);
    assert.equal(context.isWarehouseDisassemblyRemovalSatisfied({ok:true,removedCount:0,alreadyMissingCount:1},1),true);
    assert.equal(context.isWarehouseDisassemblyRemovalSatisfied({ok:true,removedCount:1,alreadyMissingCount:1},2),true);
    assert.equal(context.isWarehouseDisassemblyRemovalSatisfied({ok:true,removedCount:1,alreadyMissingCount:0},2),false);
    assert.equal(context.isWarehouseDisassemblyRemovalSatisfied({ok:false,removedCount:1,alreadyMissingCount:0},1),false);
});

test('disassembly manual removal button is guarded by completed state', () => {
    assert.match(contentSource, /!hasConfirmed \|\| state\.removalCompleted \|\| state\.busy/);
    assert.match(contentSource, /state\.removalCompleted = false;\s*state\.verification = null/);
    assert.match(contentSource, /state\.removalCompleted = isWarehouseDisassemblyRemovalSatisfied/);
    assert.match(contentSource, /String\(msg\.actionId \|\| ''\) === warehouseDisassemblyPanelState\.actionId/);
});

function confirmedPanelContext() {
    const start = contentSource.indexOf('function createWarehouseConfirmedPanelPreview(');
    const end = contentSource.indexOf('\n// The Warehouse POST confirms precise item IDs', start);
    assert.ok(start >= 0 && end > start, 'confirmed-panel helpers must exist');
    const context = {
        normalizeAmperkotOrderId: id => /^\d{4}-\d{6}$/.test(String(id || '')) ? String(id) : '',
        normalizeWarehouseBridgeId: value => String(value || '').trim(),
        createWarehouseBarcodePreviewFromShopOrder: shopOrder => ({
            shopOrder,
            ok: true,
            summary: { productCount: shopOrder.assembly.length ? 1 : 0, eligibleCount: shopOrder.assembly.length, skippedCount: 0 }
        }),
        isWarehouseAssemblyPageUrl: () => true,
        getWarehouseOrderIdFromUrl: () => '2218-101126',
        warehouseConfirmedPanelSnapshot: null
    };
    vm.createContext(context);
    vm.runInContext(contentSource.slice(start, end), context);
    return context;
}

test('confirmed Warehouse POST produces a read-only partial panel while Angular shell is empty', () => {
    const ctx = confirmedPanelContext();
    const preview = ctx.createWarehouseConfirmedPanelPreview({
        orderId: '2218-101126', rows: [{productId:'41128428',productItemId:'3998496', barcode:'2494390', type:0, title:'Test'}]
    });
    assert.equal(preview.partialConfirmed, true);
    assert.equal(preview.summary.eligibleCount, 1);
    assert.equal(preview.shopOrder.assembly[0].product_item.barcode, '2494390');
    ctx.warehouseConfirmedPanelSnapshot = { orderId: '2218-101126', preview };
    assert.equal(ctx.shouldPreserveWarehouseConfirmedPanelPreview({ summary: {eligibleCount:0,skippedCount:0}},'2218-101126'), true);
    assert.equal(ctx.shouldPreserveWarehouseConfirmedPanelPreview({ summary: {eligibleCount:1,skippedCount:0}},'2218-101126'), false);
    assert.equal(ctx.shouldPreserveWarehouseConfirmedPanelPreview({ summary: {eligibleCount:0,skippedCount:0}},'9999-999999'), false);
});

test('partial panel accumulates distinct confirmed scans and refuses invalid unit types', () => {
    const ctx = confirmedPanelContext();
    const detail = {orderId:'2218-101126',rows:[{productId:'41128428',barcode:'2494390',type:0}]};
    const first = ctx.createWarehouseConfirmedPanelPreview(detail);
    const second = ctx.createWarehouseConfirmedPanelPreview({
        orderId:'2218-101126',rows:[{productId:'41128428',barcode:'2494391',type:0}]
    },first);
    assert.equal(second.shopOrder.assembly.length,2);
    assert.equal(ctx.createWarehouseConfirmedPanelPreview({
        orderId:'2218-101126',rows:[{productId:'41128428',barcode:'2494392',type:1}]
    }),null);
});
