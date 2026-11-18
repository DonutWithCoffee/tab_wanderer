const test=require('node:test');
const assert=require('node:assert/strict');
const {groupSales,keyOf,presentGroups,selectionGroups}=require('../core/sold-barcode-review.js');
const sales=[
 {productId:'12',barcode:'200',number:'A'},
 {productId:'12',barcode:'200',number:'B'},
 {productId:'12',barcode:'201',number:'A'},
 {productId:'13',barcode:'300',number:'C'},
 {productId:'13',barcode:'300',number:'C'},
 {productId:'12',barcode:'invalid',number:'D'}
];
test('groups by product and unique barcode, preserving order associations',()=>{
 const groups=groupSales(sales);
 assert.deepEqual(groups.map(g=>[g.productId,g.count,g.selected]),[['12',2,2],['13',1,1]]);
 assert.deepEqual(groups[0].barcodes[0].orders,['A','B']);
 assert.equal(groups[0].barcodes[0].sales,2);
});
test('exclusion applies to an individual barcode, not product or other orders',()=>{
 const groups=groupSales(sales,['12:200']);
 assert.equal(groups[0].selected,1);
 assert.equal(groups[1].selected,1);
 assert.equal(groups[0].barcodes[0].selected,false);
 assert.equal(groups[0].barcodes[1].selected,true);
 assert.equal(keyOf(sales[0]),'12:200');
});
test('rejects invalid records and handles empty input',()=>{
 assert.deepEqual(groupSales(null),[]);
 assert.deepEqual(groupSales([{productId:null,barcode:'1'},{productId:'3',barcode:''}]),[]);
});

test('completed Ozon inspection shows only present codes, keeping selections and sale evidence',()=>{
 const groups=groupSales(sales,['12:200']);
 const filtered=presentGroups(groups,{'12':['200','201'],'13':[]});
 assert.equal(filtered.length,1);
 assert.deepEqual(filtered[0].barcodes.map(unit=>unit.barcode),['200','201']);
 assert.equal(filtered[0].count,2);
 assert.equal(filtered[0].selected,1);
 assert.deepEqual(filtered[0].barcodes[0].orders,['A','B']);
});
test('Ozon inspection with no matching barcode displays no candidates',()=>{
 assert.deepEqual(presentGroups(groupSales(sales),{'12':[],'13':[]}),[]);
 assert.deepEqual(presentGroups(groupSales(sales),{}),[]);
});

test('selection list retains all source articles after Ozon reports zero matches',()=>{
 const excluded=new Set(['12:200','12:201','13:300']);
 const source=selectionGroups(sales,excluded);
 assert.deepEqual(source.map(group=>[group.productId,group.count,group.selected]),[['12',2,0],['13',1,0]]);
 assert.deepEqual(presentGroups(source,{}),[]);
 const selection=require('../core/sold-barcode-selection');
 assert.equal(selection.applySelection(excluded,source,true),true);
 assert.equal(excluded.size,0);
 assert.deepEqual(selectionGroups(sales,excluded).map(group=>group.selected),[2,1]);
});
