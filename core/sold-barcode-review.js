(function(root) {
    'use strict';
    const keyOf = sale => `${String(sale.productId)}:${String(sale.barcode)}`;
    function groupSales(sales, excludedKeys = []) {
        const excluded = new Set(excludedKeys);
        const products = new Map();
        for (const sale of Array.isArray(sales) ? sales : []) {
            const productId = String(sale?.productId ?? '');
            const barcode = String(sale?.barcode ?? '');
            if (!/^\d+$/.test(productId) || !/^\d+$/.test(barcode)) continue;
            let product = products.get(productId);
            if (!product) {
                product = { productId, barcodes: new Map(), count: 0, selected: 0 };
                products.set(productId, product);
            }
            if (!product.barcodes.has(barcode)) {
                product.barcodes.set(barcode, { barcode, productId, key: `${productId}:${barcode}`,
                    selected: !excluded.has(`${productId}:${barcode}`), orders: new Set(), sales: 0 });
            }
            const unit = product.barcodes.get(barcode);
            if (sale.number) unit.orders.add(String(sale.number));
            unit.sales++;
        }
        return [...products.values()].map(product => {
            const barcodes = [...product.barcodes.values()].map(unit => ({ ...unit, orders: [...unit.orders].sort() }));
            barcodes.sort((a,b) => a.barcode.localeCompare(b.barcode,'ru',{numeric:true}));
            return { productId:product.productId, barcodes, count:barcodes.length,
                selected:barcodes.filter(unit=>unit.selected).length };
        }).sort((a,b)=> b.count-a.count || a.productId.localeCompare(b.productId,'ru',{numeric:true}));
    }
    // Filter only when a complete Ozon snapshot is available; never trust partial results.
    function presentGroups(groups, results) {
        return groups.map(group => {
            const present = new Set(results?.[group.productId] || []);
            const barcodes = group.barcodes.filter(unit => present.has(unit.barcode));
            return { ...group, barcodes, count:barcodes.length,
                selected:barcodes.filter(unit => unit.selected).length };
        }).filter(group => group.count);
    }
    // Selection UI must never depend on Ozon inspection results. A zero-match
    // inspection must still allow re-selecting every source barcode.
    function selectionGroups(sales,excludedKeys) {return groupSales(sales,excludedKeys);}
    const api={groupSales,keyOf,presentGroups,selectionGroups};
    root.TWSoldBarcodeReview=api;
    if(typeof module !== 'undefined' && module.exports) module.exports=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
