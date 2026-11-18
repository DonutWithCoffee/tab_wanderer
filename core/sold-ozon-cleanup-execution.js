(function(root,factory){
    const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
    else root.TWSoldOzonCleanupExecution=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    function createBatch(preview, selected, currentPreview){
        if(!preview||!currentPreview||preview.mode!=='read-only-preview'
            ||JSON.stringify(preview)!==JSON.stringify(currentPreview))return {ok:false,reason:'stale-preview'};
        if(!Array.isArray(preview.rows)||!Array.isArray(selected)||!selected.length)return {ok:false,reason:'empty-selection'};
        const available=new Set(preview.rows.map(row=>`${row.productId}:${row.barcode}`));
        if(available.size!==preview.rows.length)return {ok:false,reason:'duplicate-preview'};
        const keys=new Set(),groups=new Map();
        for(const key of selected){
            if(typeof key!=='string'||!available.has(key)||keys.has(key))return {ok:false,reason:'invalid-selection'};
            keys.add(key);
            const row=preview.rows.find(item=>`${item.productId}:${item.barcode}`===key);
            if(!/^\d+$/.test(row.productId)||!/^\d{5,80}$/.test(row.barcode)||row.status!=='present-in-ozon'
                ||!Array.isArray(row.orders)||!row.orders.length||!(row.sales>0))return {ok:false,reason:'invalid-evidence'};
            if(!groups.has(row.productId))groups.set(row.productId,[]);
            groups.get(row.productId).push(row.barcode);
        }
        return {ok:true,products:[...groups].map(([productId,barcodes])=>({productId,barcodes})),barcodes:keys.size};
    }
    return {createBatch};
});
