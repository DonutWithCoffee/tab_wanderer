const test = require('node:test');
const assert = require('node:assert/strict');
const auto = require('../core/sold-auto-cleanup.js');
const productId = '42739090';
function event(barcode, number='3923-250626', type=0, id='111') {
    return {id,created_at:'2026-06-25T08:00:00Z', action:{type:3},product:{id:productId},
      attributes:{shop_order:{number,id:'50'},affected_quantity:1},productItem:{id:'7',barcode,type}};
}
const order = (number='3923-250626', source=197300, status=6809) => ({shop_order:{number,id:'50',status:{id:status},source:{id:source},items:[{type:'product',item_id:productId,quantity:1}]}});
test('targets only confirmed sold barcodes from completed Ozon orders', async()=>{
 const rows=[event('2415152'),event('2415154','8288-300626',0,'112')];
 const result=await auto.collectConfirmedSold(productId,rows,n=>Promise.resolve(order(n)),()=>{},['2415154']);
 assert.deepEqual(result.barcodes,['2415152']);
});
test('non-Ozon, incomplete, and current assembly barcodes never authorize deletion', async()=>{
 const rows=[event('2415152'),event('2415153','8288-300626',1,'112'),event('2415154','1234-010626',0,'113')];
 const result=await auto.collectConfirmedSold(productId,rows,n=>Promise.resolve(order(n,n==='3923-250626'?11:197300)),()=>{},['2415154']);
 assert.deepEqual(result.barcodes,['2415153']);
});
test('unavailable order proof fails closed', async()=>{
 const result=await auto.collectConfirmedSold(productId,[event('2415152')],()=>{throw Error('auth');},()=>{},[]);
 assert.deepEqual(result.barcodes,[]);
});


test('Ozon-first search only looks up exact current barcodes from stock history',()=>{
 const otherProduct={...event('2415152'),product:{id:'99999999'}};
 const rows=[event('2415152'),event('2415153','8288-300626',1,'112'),
   event('2415154','8288-300626',0,'113'),otherProduct,event('2415155','8288-300626',0,'114')];
 assert.deepEqual(auto.saleHistoryMatchingOzonBarcodes(rows,productId,
   ['2415152','2415153','2415154'],['2415154']).map(row=>row.productItem.barcode),['2415152','2415153']);
});

test('Ozon-first filtering does not treat empty or malformed Ozon data as sales',()=>{
 assert.deepEqual(auto.saleHistoryMatchingOzonBarcodes([event('2415152')],productId,[]),[]);
 assert.deepEqual(auto.saleHistoryMatchingOzonBarcodes([event('2415152')],productId,['wrong']),[]);
 assert.throws(()=>auto.saleHistoryMatchingOzonBarcodes([],productId,
   Array.from({length:501},(_,index)=>String(index+10000))),/Unbounded/);
});


test('temporary diagnostics report item types without requiring them for matching', () => {
 const rows = [event('2415152'), event('2415153','8288-300626',1,'112'),
  event('2415154','8288-300626',0,'113'),
  {...event('2415155','8288-300626',0,'114'), productItem:{id:'9',type:0}},
  {...event('2415156','8288-300626',0,'115'), action:{type:2}}];
 const out = auto.diagnoseHistoryIntersection(rows, productId, ['2415152','2415153','2415154','2415156'], ['2415154']);
 assert.equal(out.counts.events,5);
 assert.equal(out.counts.saleEvents,4);
 assert.equal(out.counts.saleWithUnitType,2);
 assert.equal(out.counts.saleBarcodeInOzon,3);
 assert.equal(out.counts.finalFilterMatches,2);
 assert.equal(out.counts.saleMultiItem,1);
 assert.equal(out.counts.saleMissingBarcode,1);
 assert.equal(out.counts.saleCurrentBarcode,1);
 assert.equal(out.counts.anyBarcodeInOzon,4);
 assert.equal(out.actionTypes['2'],1);
 assert.equal(out.fieldPresence['productItem.barcode'],4);
 assert.deepEqual(auto.saleHistoryMatchingOzonBarcodes(rows, productId, ['2415152','2415153','2415154','2415156'], ['2415154']).map(row=>row.productItem.barcode),['2415152','2415153']);
});

test('diagnostics show missing warehouse fields and unexpected action types', () => {
 const result = auto.diagnoseHistoryIntersection([{action:{type:7},productItem:{barcode:'123456'}},{action:{type:3},product:{id:productId},productItem:{id:'2'}}],productId,['123456']);
 assert.equal(result.counts.saleMissingBarcode,1);
 assert.equal(result.counts.anyBarcodeInOzon,1);
 assert.equal(result.actionTypes['7'],1);
 assert.equal(result.saleSamples[0].itemIdAvailable,true);
});

// Production warehouse-history rows omit productItem.type, even for unit sales.
test('Ozon-first comparison accepts sold barcodes without item type', () => {
 const row = event('2508523');
 delete row.productItem.type;
 assert.deepEqual(auto.saleHistoryMatchingOzonBarcodes([row],productId,['2508523']).map(e=>e.productItem.barcode),['2508523']);
 const diagnostics = auto.diagnoseHistoryIntersection([row],productId,['2508523']);
 assert.equal(diagnostics.counts.saleMissingItemType,1);
 assert.equal(diagnostics.counts.finalFilterMatches,1);
});

test('automatic sale confirmation needs completed Ozon order, not item type', async () => {
 const sale = event('2508523');
 delete sale.productItem.type;
 let itemLookups=0;
 const found = await auto.collectConfirmedSold(productId,[sale],
  n=>Promise.resolve(order(n)),()=>{itemLookups++;throw Error('should not fetch type');});
 assert.deepEqual(found.barcodes,['2508523']);
 assert.equal(itemLookups,0);
 const notOzon=await auto.collectConfirmedSold(productId,[sale],
  n=>Promise.resolve(order(n,11)),()=>{throw Error('should not fetch type');});
 assert.deepEqual(notOzon.barcodes,[]);
 const wrongOrderId=await auto.collectConfirmedSold(productId,
  [{...sale,attributes:{shop_order:{number:'3923-250626',id:'another'}}}],
  n=>Promise.resolve(order(n)),()=>{});
 assert.deepEqual(wrongOrderId.barcodes,[]);
});


test('diagnostics retain every confirmed barcode with its verified order', async () => {
 const rows = Array.from({length: 18}, (_, i) => {
  const number = `${String(5000+i)}-250626`;
  const row = event(String(2508500+i), number, 0, String(100+i));
  row.attributes.shop_order.id = String(1000+i);
  return row;
 });
 const found = await auto.collectConfirmedSold(productId, rows, n => {
  const i = Number(n.slice(0,4))-5000;
  return Promise.resolve({shop_order:{number:n,id:String(1000+i),status:{id:6809},source:{id:197300},items:[{type:'product',item_id:productId,quantity:1}]}});
 }, () => {throw Error('no item lookup');});
 assert.equal(found.barcodes.length,18);
 assert.equal(found.evidence.length,18);
 assert.deepEqual(found.evidence.map(r=>r.barcode),found.barcodes);
 assert.equal(found.evidence[17].orderNumber,'5017-250626');
 assert.deepEqual(found.failedOrderNumbers,[]);
});

test('failed order numbers are reported but never authorize barcode deletion', async () => {
 const rows=[event('2508523','3923-250626',0,'151'),event('2508524','8288-300626',0,'152')];
 const found=await auto.collectConfirmedSold(productId,rows,n=>{
  if(n==='8288-300626') throw Error('not found');
  return Promise.resolve(order(n));
 },()=>{});
 assert.deepEqual(found.barcodes,['2508523']);
 assert.deepEqual(found.evidence,[{barcode:'2508523',orderNumber:'3923-250626'}]);
 assert.equal(found.failedOrders,1);
 assert.deepEqual(found.failedOrderNumbers,['8288-300626']);
});
