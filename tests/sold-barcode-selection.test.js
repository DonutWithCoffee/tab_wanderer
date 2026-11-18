'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {selectionState,applySelection,visibleAfterOzonAbsence,hiddenAfterInspection,partitionInspection}=require('../core/sold-barcode-selection');
const groups=[
 {productId:'1',barcodes:[{key:'1:a',selected:true},{key:'1:b',selected:false}]},
 {productId:'2',barcodes:[{key:'2:c',selected:true}]}
];
test('global checkbox state supports partial and full selection',()=>{
 assert.deepEqual(selectionState(groups),{total:3,selected:2,checked:false,indeterminate:true});
 assert.deepEqual(selectionState([]),{total:0,selected:0,checked:false,indeterminate:false});
 assert.equal(selectionState([{barcodes:[{selected:true}]}]).checked,true);
});
test('all-article toggle excludes and restores all barcode keys',()=>{
 const excluded=new Set(['1:b']);
 assert.equal(applySelection(excluded,groups,false),true);
 assert.deepEqual([...excluded].sort(),['1:a','1:b','2:c']);
 assert.equal(applySelection(excluded,groups,false),false);
 assert.equal(applySelection(excluded,groups,true),true);
 assert.equal(excluded.size,0);
});
test('per-article selection does not affect other articles',()=>{
 const excluded=new Set();
 applySelection(excluded,[groups[0]],false);
 assert.deepEqual([...excluded].sort(),['1:a','1:b']);
 applySelection(excluded,[groups[0]],true);
 assert.equal(excluded.size,0);
});

test('only confirmed missing articles are hidden from review; source groups are preserved',()=>{
 const source=[{productId:'39785649',barcodes:[{key:'a'}]},{productId:'42739090',barcodes:[{key:'b'}]}];
 assert.deepEqual(visibleAfterOzonAbsence(source,['39785649'],'scan-1','scan-1').map(g=>g.productId),['42739090']);
 assert.equal(source.length,2);
 assert.equal(visibleAfterOzonAbsence(source,['39785649'],'scan-1','scan-2').length,2);
 assert.equal(visibleAfterOzonAbsence(source,['39785649'],'scan-1','scan-1',true).length,2);
 assert.equal(visibleAfterOzonAbsence(source,[],'scan-1','scan-1').length,2);
});

test('hide successfully inspected products with zero matching sold barcodes',()=>{
 const inspection={complete:true,products:[
  {productId:'10',barcodes:['a']},{productId:'11',barcodes:['b']},
  {productId:'12',barcodes:['c']},{productId:'13',barcodes:['d']},
  {productId:'14',barcodes:['e']}
 ],results:{'10':[],'11':['b'],'14':[]},skipped:[
  {productId:'12',confirmedAbsent:true},
  {productId:'13',reason:'request-failed'},
  {productId:'14',reason:'manual',manuallyExcluded:true}
 ]};
 assert.deepEqual(hiddenAfterInspection(inspection,[]),['10','12']);
 assert.deepEqual(hiddenAfterInspection(inspection,['10','11','99']),['10','12','99']);
 assert.deepEqual(hiddenAfterInspection({...inspection,complete:false},['99']),['99']);
});
test('a checked product returns to the visible list when a matching barcode is confirmed',()=>{
 const inspection={complete:true,products:[{productId:'20',barcodes:['a']}],results:{'20':['a']},skipped:[]};
 assert.deepEqual(hiddenAfterInspection(inspection,['20']),[]);
});

test('one working list retains only confirmed barcode intersections, with separate removed evidence',()=>{
 const source=[
  {productId:'10',barcodes:[{key:'10:111',barcode:'111',selected:true,orders:[],sales:1},{key:'10:112',barcode:'112',selected:true,orders:[],sales:1}]},
  {productId:'11',barcodes:[{key:'11:221',barcode:'221',selected:true,orders:[],sales:1}]},
  {productId:'12',barcodes:[{key:'12:331',barcode:'331',selected:true,orders:[],sales:1}]},
  {productId:'13',barcodes:[{key:'13:441',barcode:'441',selected:true,orders:[],sales:1}]},
 ];
 const inspection={complete:true,snapshotId:'snapshot',products:source.map(row=>({productId:row.productId,barcodes:row.barcodes.map(b=>b.barcode)})),
  results:{'10':['111'],'11':[]},skipped:[{productId:'12',confirmedAbsent:true},{productId:'13',reason:'timeout'}]};
 const result=partitionInspection(source,inspection,'snapshot');
 assert.equal(result.ready,true);
 assert.deepEqual(result.working.map(g=>[g.productId,g.barcodes.map(u=>u.barcode)]),[['10',['111']]]);
 assert.deepEqual(result.removed.map(r=>[r.group.productId,r.group.barcodes.map(b=>b.barcode)]),[
  ['10',['112']],['11',['221']],['12',['331']],['13',['441']]]);
 assert.match(result.removed[3].reason,/timeout/);
 assert.equal(source[0].barcodes.length,2);
 assert.equal(partitionInspection(source,{...inspection,snapshotId:'old'},'snapshot').ready,false);
});

test('unselected source barcodes cannot become deletion candidates',()=>{
 const source=[{productId:'10',barcodes:[{key:'10:111',barcode:'111',selected:true},{key:'10:112',barcode:'112',selected:false}]}];
 const inspection={complete:true,snapshotId:'s',products:[{productId:'10',barcodes:['111']}],results:{'10':['111']},skipped:[]};
 const result=partitionInspection(source,inspection,'s');
 assert.deepEqual(result.working[0].barcodes.map(u=>u.key),['10:111']);
 assert.equal(result.removed.length,0);
});
