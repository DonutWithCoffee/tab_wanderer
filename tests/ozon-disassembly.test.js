const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackgroundContext, sendRuntimeMessage, settleBackgroundContext, runExpression } = require('./helpers/load-extension-context');

const orderId = '2218-101126';
const actionId = '4337';
const baseEvent = {
    type: 'OZON_DISASSEMBLY_CONFIRMED', confirmed: true, source: 'OZON', orderId, actionId,
    rows: [{ productId: '41128428', productItemId: '3998496', barcode: '2494390', type: 0 }]
};
const warehouseSender = { tab: { id: 21, url: `https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/disassembly/${actionId}?order=${orderId}` } };
const ozonSender = (id, productId) => ({ tab: { id, url: `https://seller.ozon.ru/app/products?search=${productId}` } });
const resolvedProduct = (productId = '41128428', sku = '3073595175', sellerId = '185464') => ({
    type: 'OZON_PRODUCT_RESOLVE_RESULT', productId, sellerId,
    result: {ok:true,productId,product:{offerId:productId,ozonSku:sku,existingBarcodes:['2494390','2494391']}}
});
const createTestContext = async () => {
    const context = loadBackgroundContext({ setTimeout: () => 1, clearTimeout: () => {} });
    await settleBackgroundContext();
    return context;
};

test('warehouse disassembly requires exact route, confirmation, unit barcode and matching order', async () => {
    const context = await createTestContext();
    const invalid = [
        [{...baseEvent, confirmed: false}, warehouseSender],
        [{...baseEvent, rows: [{...baseEvent.rows[0],type:1}]}, warehouseSender],
        [{...baseEvent, orderId: '0001-010101'}, warehouseSender],
        [baseEvent, {tab: {id:21, url:`https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/assembly/${actionId}?order=${orderId}`}}],
        [baseEvent, {tab: {id:21, url:`https://fakeamperkot.ru/web-apps/wh3/#/wh/shop-orders/disassembly/${actionId}?order=${orderId}`}}],
        [baseEvent, {tab: {id:21, url:`https://amperkot.ru/web-apps/wh3/#/wh/shop-orders/disassembly/9999?order=${orderId}`}}]
    ];
    for (const [event,sender] of invalid) {
        const result = await sendRuntimeMessage(context,event,sender);
        assert.equal(result.ok,false);
    }
    assert.equal(context.__test.createdTabs.length,0);
});

test('auto-delete enabled by default and explicit opt-out prevents any Ozon tab', async () => {
    const context = await createTestContext();
    const baseline = await sendRuntimeMessage(context, {type:'GET_CONFIG'});
    assert.equal(baseline.userConfig.ozonAutoBarcodeRemoveEnabled, true);
    const configResult = await sendRuntimeMessage(context, {type:'UPDATE_CONFIG', userConfig:{...baseline.userConfig,ozonAutoBarcodeRemoveEnabled:false}});
    assert.equal(configResult.userConfig.ozonAutoBarcodeRemoveEnabled,false);
    const result = await sendRuntimeMessage(context, baseEvent, warehouseSender);
    assert.equal(result.ok,true);
    assert.equal(result.disabled,true);
    assert.equal(context.__test.createdTabs.length,0);
});

test('confirmed partial disassembly deletes only selected barcode and reports verified result', async () => {
    const context = await createTestContext();
    const started = await sendRuntimeMessage(context, baseEvent, warehouseSender);
    assert.equal(started.ok,true);
    assert.equal(started.barcodeCount,1);
    assert.equal(context.__test.createdTabs.length,1);
    assert.match(context.__test.createdTabs[0].url,/search=41128428/);
    const premature = await sendRuntimeMessage(context,{type:'OZON_PRODUCT_WORKER_READY',productId:'41128428'},ozonSender(1,'41128428'));
    assert.equal(premature.ignored,true);
    assert.equal(context.__test.tabMessages.length,0);
    const ready = await sendRuntimeMessage(context,resolvedProduct(),ozonSender(1,'41128428'));
    assert.equal(ready.ok,true);
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.tabMessages[0].message)),{
        type:'OZON_UI_REMOVE_IN_WORKER', productId:'41128428',barcodes:['2494390'],
        ozonSku:'3073595175',sellerId:'185464'
    });
    const result = await sendRuntimeMessage(context,{
        type:'OZON_UI_REMOVE_RESULT',productId:'41128428',ok:true,
        verifiedCount:1,removedCount:1,alreadyMissingCount:0
    },ozonSender(1,'41128428'));
    assert.equal(result.ok,true);
    const reply = context.__test.tabMessages.find(m=>m.tabId===21);
    assert.equal(reply.message.type,'OZON_DISASSEMBLY_REMOVE_RESULT');
    assert.equal(reply.message.ok,true);
    assert.equal(reply.message.removedCount,1);
    assert.deepEqual(context.__test.removedTabs,[1]);
    assert.equal(runExpression(context,'ozonUiRemoveSession'),null);
});

test('removal never proceeds to next product after failed verification', async () => {
    const context = await createTestContext();
    const event = {...baseEvent,rows:[...baseEvent.rows,{productId:'41128433',productItemId:'3998497',barcode:'2494391',type:0}]};
    const started = await sendRuntimeMessage(context,event,warehouseSender);
    assert.equal(started.ok,true);
    await sendRuntimeMessage(context,resolvedProduct(),ozonSender(1,'41128428'));
    await sendRuntimeMessage(context,{type:'OZON_UI_REMOVE_RESULT',productId:'41128428',ok:false,error:'Ozon failed',removedCount:0},ozonSender(1,'41128428'));
    const result = context.__test.tabMessages.find(m=>m.tabId===21);
    assert.equal(result.message.ok,false);
    assert.match(result.message.error,/Ozon failed/);
    assert.equal(context.__test.tabUpdates.length,0);
});

test('no concurrent automatic removal while another Ozon operation owns worker', async () => {
    const context = await createTestContext();
    const result1 = await sendRuntimeMessage(context,baseEvent,warehouseSender);
    assert.equal(result1.ok,true);
    const result2 = await sendRuntimeMessage(context,baseEvent,warehouseSender);
    assert.equal(result2.ok,false);
    assert.equal(result2.busy,true);
    assert.equal(context.__test.createdTabs.length,1);
});

test('confirmed unit barcode groups are exact and reject duplicate or unverified values', async () => {
    const context = await createTestContext();
    const validation = context.validateOzonDisassemblyEvent({...baseEvent,rows:[
        {...baseEvent.rows[0]},
        {productId:'41128428',productItemId:'3998497',barcode:'2494391',type:0},
        {productId:'41128433',productItemId:'3998498',barcode:'2494392',type:0}
    ]});
    assert.equal(validation.ok,true);
    assert.equal(validation.productRequests.length,2);
    assert.deepEqual(Array.from(validation.productRequests[0].barcodes),['2494390','2494391']);
    assert.equal(context.validateOzonDisassemblyEvent({...baseEvent,rows:[baseEvent.rows[0],baseEvent.rows[0]]}).ok,false);
    assert.equal(context.validateOzonDisassemblyEvent({...baseEvent,rows:[{...baseEvent.rows[0],type:1}]}).ok,false);
});

test('confirmed disassembly preempts a read-only Ozon preview instead of losing the removal', async () => {
    const context = await createTestContext();
    const productId='41128428';
    const extraction = { orderId, productsById: {
        [productId]: {productId,eligibleBarcodes:[{
            barcode:'2494390',productId,itemType:0,assemblyQuantity:1,reservedQuantity:1
        }],skippedBarcodes:[]}
    }};
    const preview = await sendRuntimeMessage(context,{
        type:'OZON_RESOLVE_PREVIEW_REQUEST', trigger:'manual',orderId,warehouseExtraction:extraction
    },warehouseSender);
    assert.equal(preview.ok,true);
    assert.equal(preview.started,true);
    assert.equal(context.__test.createdTabs.length,1);
    const remove = await sendRuntimeMessage(context,baseEvent,warehouseSender);
    assert.equal(remove.ok,true,remove.error);
    assert.equal(remove.started,true);
    assert.equal(context.__test.createdTabs.length,2);
    assert.deepEqual(context.__test.removedTabs,[1]);
});

test('Ozon removal refuses identity ambiguity and never sends delete command', async () => {
    const cases = [
        {...resolvedProduct(),sellerId:''},
        {...resolvedProduct(),sellerId:'not-an-id'},
        {...resolvedProduct(),result:{ok:true,product:{offerId:'other',ozonSku:'3073595175'}}},
        {...resolvedProduct(),result:{ok:true,product:{offerId:'41128428',ozonSku:''}}},
        {...resolvedProduct(),result:{ok:false,error:'notFound',product:null}}
    ];
    for (const candidate of cases) {
        const context = await createTestContext();
        await sendRuntimeMessage(context,baseEvent,warehouseSender);
        const result = await sendRuntimeMessage(context,candidate,ozonSender(1,'41128428'));
        assert.equal(result.ok,true);
        assert.equal(context.__test.tabMessages.some(entry=>entry.message.type==='OZON_UI_REMOVE_IN_WORKER'),false);
        assert.equal(context.__test.tabMessages.find(entry=>entry.tabId===21)?.message.ok,false);
        assert.equal(context.__test.removedTabs.includes(1),true);
    }
});

test('Ozon removal accepts product resolution only from its own worker and only once', async () => {
    const context = await createTestContext();
    await sendRuntimeMessage(context,baseEvent,warehouseSender);
    await sendRuntimeMessage(context,resolvedProduct(),ozonSender(99,'41128428'));
    assert.equal(context.__test.tabMessages.length,0);
    await sendRuntimeMessage(context,resolvedProduct(),ozonSender(1,'41128428'));
    await sendRuntimeMessage(context,resolvedProduct(),ozonSender(1,'41128428'));
    assert.equal(context.__test.tabMessages.filter(entry=>entry.message.type==='OZON_UI_REMOVE_IN_WORKER').length,1);
});

test('manual removal uses verified pipeline even when automatic removal is disabled', async () => {
    const context = await createTestContext();
    const config = await sendRuntimeMessage(context,{type:'GET_CONFIG'});
    await sendRuntimeMessage(context,{type:'UPDATE_CONFIG',userConfig:{...config.userConfig,ozonAutoBarcodeRemoveEnabled:false}});
    const manual = await sendRuntimeMessage(context,{...baseEvent,type:'OZON_DISASSEMBLY_MANUAL_REMOVE'},warehouseSender);
    assert.equal(manual.ok,true,manual.error);
    assert.equal(manual.started,true);
    assert.equal(context.__test.createdTabs.length,1);
    await sendRuntimeMessage(context,resolvedProduct(),ozonSender(1,'41128428'));
    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.tabMessages[0].message.barcodes)),['2494390']);
    assert.equal(context.__test.tabMessages[0].message.type,'OZON_UI_REMOVE_IN_WORKER');
});

test('manual removal rejects wrong action, missing warehouse confirmation and group barcodes', async () => {
    const cases = [
        {...baseEvent,type:'OZON_DISASSEMBLY_MANUAL_REMOVE',confirmed:false},
        {...baseEvent,type:'OZON_DISASSEMBLY_MANUAL_REMOVE',actionId:'9999'},
        {...baseEvent,type:'OZON_DISASSEMBLY_MANUAL_REMOVE',rows:[{...baseEvent.rows[0],type:1}]}
    ];
    for (const item of cases) {
        const context = await createTestContext();
        const result = await sendRuntimeMessage(context,item,warehouseSender);
        assert.equal(result.ok,false);
        assert.equal(context.__test.createdTabs.length,0);
    }
});
