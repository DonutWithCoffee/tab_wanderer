/* Narrow, read-only sales discovery for assembly-time Ozon cleanup.
 * Never treats a warehouse sale alone as evidence of a completed Ozon order.
 * Ozon catalogue membership is the barcode-type boundary for this flow;
 * the warehouse history API does not supply productItem.type.
 */
(function(root) {
    'use strict';
    const scan = root.TWSoldBarcodeScan || (typeof require === 'function' ? require('./sold-barcode-scan.js') : null);
    function normalizeBarcode(value) {
        const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
        return /^\d{5,80}$/.test(text) ? text : '';
    }
    function saleHistoryMatchingOzonBarcodes(history, productId, ozonExistingBarcodes, newBarcodes = []) {
        const existing = new Set((Array.isArray(ozonExistingBarcodes) ? ozonExistingBarcodes : [])
            .map(normalizeBarcode).filter(Boolean));
        const blocked = new Set((Array.isArray(newBarcodes) ? newBarcodes : [])
            .map(normalizeBarcode).filter(Boolean));
        if (existing.size > 500) throw new Error('Unbounded Ozon barcode list');
        return (Array.isArray(history) ? history : []).filter(event => {
            const code = normalizeBarcode(event?.productItem?.barcode);
            return Number(event?.action?.type) === 3
                && String(event?.product?.id) === String(productId)
                && code && existing.has(code) && !blocked.has(code);
        });
    }
    // Temporary diagnostics only: explain each rejection before the read-only
    // Ozon-first filter. Never influence candidate selection or authorize writes.
    function diagnoseHistoryIntersection(history, productId, ozonExistingBarcodes, newBarcodes = []) {
        const rows = Array.isArray(history) ? history : [];
        const ozon = [...new Set((Array.isArray(ozonExistingBarcodes) ? ozonExistingBarcodes : [])
            .map(normalizeBarcode).filter(Boolean))];
        const ozonSet = new Set(ozon);
        const blocked = new Set((Array.isArray(newBarcodes) ? newBarcodes : [])
            .map(normalizeBarcode).filter(Boolean));
        const histogram = {};
        const counts = { events: rows.length, saleEvents: 0, saleProductMatched: 0,
            saleWithBarcode: 0, saleWithUnitType: 0, saleBarcodeInOzon: 0,
            anyBarcodeInOzon: 0, saleWithOrder: 0, finalFilterMatches: 0,
            saleMissingBarcode: 0, saleMissingItemType: 0, saleWrongProduct: 0,
            saleMultiItem: 0, saleNoOzonMatch: 0, saleCurrentBarcode: 0 };
        const fieldPresence = { 'productItem.barcode': 0, 'productItem.id': 0,
            'productItem.type': 0, 'product.id': 0, 'attributes.shop_order.number': 0 };
        const saleSamples = [];
        const ozonSamples = ozon.slice(0, 8);
        const intersectionSamples = [];
        const rejectionSamples = [];
        for (const event of rows) {
            const action = event?.action?.type;
            const actionName = action === undefined || action === null ? 'missing' : String(action).slice(0, 24);
            histogram[actionName] = (histogram[actionName] || 0) + 1;
            const product = String(event?.product?.id ?? '');
            const barcode = normalizeBarcode(event?.productItem?.barcode);
            const rawBarcode = event?.productItem?.barcode;
            const type = event?.productItem?.type;
            const number = String(event?.attributes?.shop_order?.number ?? '');
            if (rawBarcode !== undefined && rawBarcode !== null && String(rawBarcode).trim()) fieldPresence['productItem.barcode']++;
            if (event?.productItem?.id != null) fieldPresence['productItem.id']++;
            if (type !== undefined && type !== null) fieldPresence['productItem.type']++;
            if (product) fieldPresence['product.id']++;
            if (number) fieldPresence['attributes.shop_order.number']++;
            if (barcode && ozonSet.has(barcode)) {
                counts.anyBarcodeInOzon++;
                if (intersectionSamples.length < 8) intersectionSamples.push({ barcode, actionType: actionName, itemType: type ?? null });
            }
            if (Number(action) !== 3) continue;
            counts.saleEvents++;
            if (saleSamples.length < 8) saleSamples.push({
                barcode: typeof rawBarcode === 'string' || typeof rawBarcode === 'number' ? String(rawBarcode).slice(0, 80) : null,
                itemIdAvailable: event?.productItem?.id != null,
                itemType: type ?? null,
                productId: product.slice(0, 32),
                orderAvailable: /^\d{4}-\d{6}$/.test(number),
                fields: Object.keys(event || {}).slice(0, 12),
                itemFields: Object.keys(event?.productItem || {}).slice(0, 12)
            });
            let rejection = '';
            if (product !== String(productId)) { counts.saleWrongProduct++; rejection = 'wrong-product'; }
            else {
                counts.saleProductMatched++;
                if (number) counts.saleWithOrder++;
                if (!barcode) { counts.saleMissingBarcode++; rejection = 'missing-or-invalid-barcode'; }
                else {
                    counts.saleWithBarcode++;
                    // Item type is diagnostic only: warehouse history often omits it.
                    if (type === undefined || type === null) counts.saleMissingItemType++;
                    else if (Number(type) !== 0) counts.saleMultiItem++;
                    else counts.saleWithUnitType++;
                    if (!ozonSet.has(barcode)) { counts.saleNoOzonMatch++; rejection = 'barcode-not-in-ozon'; }
                    else {
                        counts.saleBarcodeInOzon++;
                        if (blocked.has(barcode)) { counts.saleCurrentBarcode++; rejection = 'current-assembly-barcode'; }
                        else counts.finalFilterMatches++;
                    }
                }
            }
            if (rejectionSamples.length < 8 && rejection) rejectionSamples.push({reason:rejection, barcode: barcode || null, actionType:actionName, itemType:type ?? null});
        }
        return { counts, actionTypes: histogram, fieldPresence, ozonSamples,
            saleSamples, intersectionSamples, rejectionSamples };
    }
    function eligibleSaleOrderNumbers(history, productId, newBarcodes = []) {
        const blocked = new Set(newBarcodes.map(normalizeBarcode).filter(Boolean));
        const orders = new Set();
        for (const event of history || []) {
            if (Number(event?.action?.type) !== 3 || String(event?.product?.id) !== String(productId)) continue;
            const number = String(event?.attributes?.shop_order?.number || '');
            const code = normalizeBarcode(event?.productItem?.barcode);
            // Do not fetch every other order's details if we cannot even establish a candidate code.
            // Missing barcodes are resolved separately by product-item ID, and are never silently accepted.
            if (/^\d{4}-\d{6}$/.test(number) && (!code || !blocked.has(code))) orders.add(number);
        }
        return [...orders];
    }
    async function collectConfirmedSold(productId, history, loadDetails, loadProductItem, newBarcodes = [], currentOrderId = '') {
        if (!/^\d+$/.test(String(productId)) || !Array.isArray(history) || typeof loadDetails !== 'function') {
            throw new Error('Invalid automatic cleanup input');
        }
        const excluded = new Set(newBarcodes.map(normalizeBarcode).filter(Boolean));
        const details = {};
        const numbers = eligibleSaleOrderNumbers(history, productId, newBarcodes)
            .filter(number => number !== currentOrderId);
        // Each network query is bounded; one missing order cannot authorize its barcodes.
        let cursor = 0, failedOrders = 0;
        const failedOrderNumbers = [];
        // Two workers avoid a serial request per sale without overwhelming Amperkot.
        await Promise.all(Array.from({length: Math.min(2, numbers.length)}, async () => {
            while (cursor < numbers.length) {
                const number = numbers[cursor++];
                try {
                    const raw = await loadDetails(number);
                    details[number] = scan.parseDetails(raw, number);
                } catch (_) {
                    failedOrders += 1;
                    failedOrderNumbers.push(number);
                    // Unconfirmed orders must never contribute candidates.
                }
            }
        }));
        // The manual scanner still resolves item types and excludes multibarcode
        // units.  Automatic Ozon-first cleanup has a different trusted input:
        // only an exact barcode that is already present in the Ozon catalogue.
        // Do not add product-item API calls solely to recover a missing type.
        const verified = new Set();
        const evidence = [];
        const seenEvents = new Set();
        for (const event of history) {
            if (Number(event?.action?.type) !== 3 || String(event?.product?.id) !== String(productId)) continue;
            const number = String(event?.attributes?.shop_order?.number || '');
            const order = details[number];
            if (!order || !order.products.includes(String(productId))) continue;
            if (order.id && event?.attributes?.shop_order?.id != null &&
                String(event.attributes.shop_order.id) !== order.id) continue;
            if (!/^\d+$/.test(String(event?.productItem?.id ?? ''))) continue;
            const barcode = normalizeBarcode(event?.productItem?.barcode);
            if (!barcode || excluded.has(barcode)) continue;
            const eventKey = String(event.id || `${number}:${productId}:${barcode}:${event.created_at}`);
            if (seenEvents.has(eventKey)) continue;
            seenEvents.add(eventKey);
            if (!verified.has(barcode)) {
                verified.add(barcode);
                // Diagnostic evidence only. Keep the same order and the same
                // authorized barcodes; do not alter deletion decisions.
                evidence.push({barcode, orderNumber:number});
            }
        }
        return { productId: String(productId), barcodes: [...verified],
            completedOrders: Object.keys(details).length, failedOrders,
            failedOrderNumbers: failedOrderNumbers.sort(), evidence,
            excludedMulti: 0, unknownType: 0 };
    }
    const api = { normalizeBarcode, eligibleSaleOrderNumbers, saleHistoryMatchingOzonBarcodes, diagnoseHistoryIntersection, collectConfirmedSold };
    root.TWSoldAutoCleanup = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
