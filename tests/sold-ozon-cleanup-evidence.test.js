const test=require('node:test');
const assert=require('node:assert/strict');
const {loadBackgroundContext,settleBackgroundContext,runExpression}=require('./helpers/load-extension-context');

function setEvidenceDb(context,stored){
    context.indexedDB={open(name,version){
        assert.equal(name,'tw-sold-barcode-review-v1');assert.equal(version,1);
        const openReq={};
        process.nextTick(()=>openReq.onsuccess?.());
        openReq.result={
            transaction(store,mode){
                assert.equal(store,'data');assert.equal(mode,'readonly');
                const tx={objectStore(){return {get(key){const req={result:stored[key]};return req;}}}};
                process.nextTick(()=>tx.oncomplete?.());
                return tx;
            },close(){}
        };
        return openReq;
    }};
}
const saved={
    completed:{complete:true,savedAt:'snap',confirmed:[
        {productId:'42739090',barcode:'2415152'},
        {productId:'42739090',barcode:'2415154'},
        {productId:'40066635',barcode:'3214567'}]},
    ozonCheck:{complete:true,snapshotId:'snap',savedAt:'check',products:[
        {productId:'42739090',barcodes:['2415152','2415154']},
        {productId:'40066635',barcodes:['3214567']}],
        results:{'42739090':['2415152','2415154']},
        skipped:[{productId:'40066635',confirmedAbsent:true}]},
    excluded:[]
};
test('background authorizes only saved sold and Ozon-present barcode, without extra API calls',async()=>{
    const context=loadBackgroundContext();await settleBackgroundContext();setEvidenceDb(context,saved);
    await runExpression(context,"confirmSoldCleanupEvidence([{productId:'42739090',barcodes:['2415152']}],'snap','check')");
    await assert.rejects(runExpression(context,"confirmSoldCleanupEvidence([{productId:'40066635',barcodes:['3214567']}],'snap','check')"),/not verified/);
    await assert.rejects(runExpression(context,"confirmSoldCleanupEvidence([{productId:'42739090',barcodes:['0000000']}],'snap','check')"),/not confirmed/);
});
test('background rejects changed selection or stale inspection',async()=>{
    const context=loadBackgroundContext();await settleBackgroundContext();
    setEvidenceDb(context,{...saved,excluded:['42739090:2415154']});
    await assert.rejects(runExpression(context,"confirmSoldCleanupEvidence([{productId:'42739090',barcodes:['2415152']}],'snap','check')"),/changed since inspection/);
    setEvidenceDb(context,saved);
    await assert.rejects(runExpression(context,"confirmSoldCleanupEvidence([{productId:'42739090',barcodes:['2415152']}],'snap','old')"),/changed/);
});
