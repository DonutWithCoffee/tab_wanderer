const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('../core/sold-ozon-exclusion.js');
function makeCheck() {return {products:[{productId:'1',barcodes:['ABC123']},{productId:'2',barcodes:['DEF456']}],results:{'2':['DEF456']},skipped:[{productId:'1',reason:'resolve: ozon product source not found'}]};}
test('only source-not-found is eligible for manual exclusion',()=>{
    assert.equal(m.canManuallyExclude({productId:'1',reason:'resolve: ozon product source not found'}),true);
    assert.equal(m.canManuallyExclude({productId:'1',reason:'offerId mismatch'}),false);
    assert.equal(m.canManuallyExclude({productId:'1',reason:'Ozon SKU missing/invalid'}),false);
    assert.equal(m.canManuallyExclude({productId:'1',reason:'resolve: timeout'}),false);
});
test('partial inspection cannot become complete until an explicit exclusion',()=>{
    const c=makeCheck();assert.equal(m.isFullyResolved(c),false);
    c.skipped[0].manuallyExcluded=true;assert.equal(m.isFullyResolved(c),true);
});
test('missing another result cannot be overridden by an exclusion',()=>{
    const c=makeCheck();c.skipped[0].manuallyExcluded=true;delete c.results['2'];
    assert.equal(m.isFullyResolved(c),false);
});
test('wrong or duplicated results and skipped product remain blocked',()=>{
    const c=makeCheck();c.skipped[0].manuallyExcluded=true;c.results['2']=['WRONG'];
    assert.equal(m.isFullyResolved(c),false);
    c.results['2']=['DEF456'];c.skipped.push({...c.skipped[0]});
    assert.equal(m.isFullyResolved(c),false);
});
test('mismatch cannot be manually excluded, even when marked',()=>{
    const c=makeCheck();c.skipped[0].reason='offerId mismatch';c.skipped[0].manuallyExcluded=true;
    assert.equal(m.isFullyResolved(c),false);
});
test('confirmed empty Ozon catalogue search permits excluding only that product',()=>{
    const c=makeCheck();c.skipped[0]={productId:'1',reason:'catalogue-search-confirmed-empty',confirmedAbsent:true};
    assert.equal(m.isFullyResolved(c),true);
    c.skipped[0].confirmedAbsent=false;
    assert.equal(m.isFullyResolved(c),false);
    c.skipped[0].confirmedAbsent=true;c.skipped[0].reason='resolve: timeout';
    assert.equal(m.isFullyResolved(c),false);
});
test('partial results accept an explicitly skipped product without certifying its barcodes',()=>{
    const c=makeCheck();
    assert.equal(m.hasSafePartialResults(c),true);
    assert.equal(m.isFullyResolved(c),false);
    assert.deepEqual(c.results,{'2':['DEF456']});
});
test('partial results require every product to be accounted for',()=>{
    const c=makeCheck();c.skipped=[];
    assert.equal(m.hasSafePartialResults(c),false);
});
test('partial results reject mismatched, duplicate and conflicting entries',()=>{
    const c=makeCheck();
    c.results['2']=['WRONG'];assert.equal(m.hasSafePartialResults(c),false);
    c.results['2']=['DEF456'];c.results['1']=[];
    assert.equal(m.hasSafePartialResults(c),false);
    delete c.results['1'];c.skipped.push({...c.skipped[0]});
    assert.equal(m.hasSafePartialResults(c),false);
});
