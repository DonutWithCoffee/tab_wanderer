const test=require('node:test');
const assert=require('node:assert/strict');
const {createBatch}=require('../core/sold-ozon-cleanup-execution');
const preview={version:1,mode:'read-only-preview',snapshotId:'scan-1',inspectionSavedAt:'check-1',products:3,
  rows:[
    {productId:'42739090',barcode:'2415152',orders:['3923-250626'],sales:1,status:'present-in-ozon'},
    {productId:'42739090',barcode:'2415154',orders:['8288-300626'],sales:1,status:'present-in-ozon'},
    {productId:'99999999',barcode:'1234567',orders:['1000-010626'],sales:1,status:'present-in-ozon'}]};
test('groups explicitly selected barcodes by article; no implicit extras',()=>{
 const r=createBatch(preview,['42739090:2415152','42739090:2415154'],structuredClone(preview));
 assert.equal(r.ok,true);assert.equal(r.barcodes,2);
 assert.deepEqual(r.products,[{productId:'42739090',barcodes:['2415152','2415154']}]);
});
test('unselected items never enter batch',()=>{
 const r=createBatch(preview,['99999999:1234567'],structuredClone(preview));
 assert.deepEqual(r.products,[{productId:'99999999',barcodes:['1234567']}]);
});
test('stale inspection, empty set and unknown selected barcodes fail closed',()=>{
 assert.equal(createBatch(preview,['42739090:2415152'],{...preview,inspectionSavedAt:'new'}).ok,false);
 assert.equal(createBatch(preview,[],preview).ok,false);
 assert.equal(createBatch(preview,['42739090:0000000'],preview).ok,false);
});
test('duplicates and missing evidence are rejected',()=>{
 assert.equal(createBatch(preview,['42739090:2415152','42739090:2415152'],preview).ok,false);
 const malformed={...preview,rows:[{...preview.rows[0],orders:[]}]};
 assert.equal(createBatch(malformed,['42739090:2415152'],malformed).ok,false);
});
