(function (root, factory) {
    const api=factory();
    if (typeof module === 'object' && module.exports) module.exports=api;
    else root.TWSoldOzonCleanupPreview=api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const numeric=value=>typeof value==='string' && /^\d+$/.test(value);
    function createPreview({sales, excludedKeys, inspection, snapshotId, currentProducts}) {
        if (!numeric(snapshotId) && (typeof snapshotId!=='string' || !snapshotId)) return {ok:false,reason:'missing-scan-snapshot'};
        if (!inspection || inspection.complete!==true || inspection.snapshotId!==snapshotId
            || !Array.isArray(inspection.products) || !inspection.results || typeof inspection.results!=='object'
            || Array.isArray(inspection.results) || !Array.isArray(inspection.skipped))
            return {ok:false,reason:'inspection-incomplete-or-stale'};
        if (!Array.isArray(currentProducts)) return {ok:false,reason:'selection-unavailable'};
        const normalizeRows=rows=>rows.map(row=>({productId:String(row?.productId||''),barcodes:row?.barcodes}));
        const checked=normalizeRows(inspection.products), selected=normalizeRows(currentProducts);
        if (JSON.stringify(checked)!==JSON.stringify(selected)) return {ok:false,reason:'selection-changed'};
        const productIds=new Set();
        for(const row of checked) {
            if(!numeric(row.productId) || !Array.isArray(row.barcodes) || !row.barcodes.length
                || row.barcodes.some(code=>!numeric(code)) || new Set(row.barcodes).size!==row.barcodes.length
                || productIds.has(row.productId)) return {ok:false,reason:'invalid-inspection-products'};
            productIds.add(row.productId);
        }
        const skipped=new Set();
        for(const row of inspection.skipped) {
            const id=String(row?.productId||'');
            if(!productIds.has(id) || skipped.has(id) || Object.hasOwn(inspection.results,id))
                return {ok:false,reason:'invalid-skipped-product'};
            skipped.add(id);
        }
        const matched=new Map();
        for(const [id,codes] of Object.entries(inspection.results)) {
            const product=checked.find(row=>row.productId===id);
            if(!product || skipped.has(id) || !Array.isArray(codes) || codes.some(code=>!numeric(code) || !product.barcodes.includes(code))
                || new Set(codes).size!==codes.length) return {ok:false,reason:'invalid-inspection-result'};
            matched.set(id,new Set(codes));
        }
        if(checked.some(row=>!skipped.has(row.productId) && !matched.has(row.productId)))
            return {ok:false,reason:'unaccounted-product'};
        const excluded=new Set(excludedKeys||[]);
        const sources=new Map();
        for(const sale of Array.isArray(sales)?sales:[]) {
            const id=String(sale?.productId||''), code=String(sale?.barcode||'');
            if(!numeric(id)||!numeric(code)||excluded.has(`${id}:${code}`)) continue;
            const key=`${id}:${code}`;
            if(!sources.has(key)) sources.set(key,{productId:id,barcode:code,orders:new Set(),sales:0});
            const source=sources.get(key);source.sales++;
            if(sale.number!==undefined && sale.number!==null && String(sale.number)) source.orders.add(String(sale.number));
        }
        const rows=[];
        for(const row of checked) {
            if(skipped.has(row.productId)) continue;
            for(const code of row.barcodes) {
                if(!matched.get(row.productId).has(code)) continue;
                const source=sources.get(`${row.productId}:${code}`);
                if(!source) return {ok:false,reason:'missing-sale-evidence'};
                rows.push({productId:source.productId,barcode:source.barcode,
                    orders:[...source.orders].sort(),sales:source.sales,status:'present-in-ozon'});
            }
        }
        return {ok:true,preview:{version:1,mode:'read-only-preview',snapshotId,
            inspectionSavedAt:inspection.savedAt||null,products:checked.length,
            skippedProducts:skipped.size,candidateProducts:new Set(rows.map(row=>row.productId)).size,
            candidateBarcodes:rows.length,rows}};
    }
    return {createPreview};
});
