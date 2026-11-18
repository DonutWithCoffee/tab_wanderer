const test=require('node:test');
const assert=require('node:assert/strict');
const {createPreview}=require('../core/sold-ozon-cleanup-preview');
const sales=[{productId:'12',barcode:'200',number:'A'},{productId:'12',barcode:'200',number:'B'},
 {productId:'12',barcode:'201',number:'C'},{productId:'13',barcode:'300',number:'D'},
 {productId:'14',barcode:'400',number:'E'}];
const products=[{productId:'12',barcodes:['200','201']},{productId:'13',barcodes:['300']},
 {productId:'14',barcodes:['400']}];
const inspection={complete:true,snapshotId:'scan-1',savedAt:'inspection-1',products,
 results:{'12':['200'],'13':[]},skipped:[{productId:'14',confirmedAbsent:true,reason:'catalogue-search-confirmed-empty'}]};
const run=(override={})=>createPreview({sales,excludedKeys:[],inspection,snapshotId:'scan-1',currentProducts:products,...override});
test('read-only preview includes only confirmed Ozon matches with sale evidence',()=>{
 const result=run();assert.equal(result.ok,true);assert.equal(result.preview.mode,'read-only-preview');
 assert.equal(result.preview.candidateBarcodes,1);assert.equal(result.preview.candidateProducts,1);
 assert.deepEqual(result.preview.rows,[{productId:'12',barcode:'200',orders:['A','B'],sales:2,status:'present-in-ozon'}]);
});
test('zero-match inspection generates empty safe preview',()=>{
 const result=run({inspection:{...inspection,results:{'12':[],'13':[]}}});
 assert.equal(result.ok,true);assert.equal(result.preview.candidateBarcodes,0);
});
test('stale scan or changed selection rejects preview',()=>{
 assert.equal(run({snapshotId:'scan-2'}).ok,false);
 assert.equal(run({currentProducts:[products[0]]}).ok,false);
 assert.equal(run({inspection:{...inspection,complete:false}}).ok,false);
});
test('unaccounted or unexpected Ozon product rejects preview',()=>{
 assert.equal(run({inspection:{...inspection,results:{'12':['200']}}}).ok,false);
 assert.equal(run({inspection:{...inspection,results:{'12':['200'],'13':[],'99':[]}}}).ok,false);
 assert.equal(run({inspection:{...inspection,results:{'12':['999'],'13':[]}}}).ok,false);
});
test('selected barcode must have sale evidence and cannot be excluded',()=>{
 assert.equal(run({excludedKeys:['12:200']}).ok,false);
 assert.equal(run({sales:sales.filter(row=>row.barcode!=='200')}).ok,false);
});
test('skipped articles never contribute candidates even if listed in original sales',()=>{
 const result=run();assert.equal(result.preview.rows.some(row=>row.productId==='14'),false);
});
