(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TWSoldOzonExclusion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const NOT_FOUND = 'resolve: ozon product source not found';
    function canManuallyExclude(row) {
        return !!row && /^\d+$/.test(String(row.productId || '')) && row.reason === NOT_FOUND;
    }
    function isFullyResolved(check) {
        if (!check || !Array.isArray(check.products) || !check.results || !Array.isArray(check.skipped)) return false;
        const ids = check.products.map(row => String(row.productId));
        if (new Set(ids).size !== ids.length) return false;
        const allowed = new Set(ids);
        const skipped = new Map();
        for (const row of check.skipped) {
            const id = String(row.productId);
            if (!allowed.has(id) || skipped.has(id) || !((row.confirmedAbsent === true && row.reason === 'catalogue-search-confirmed-empty') || (canManuallyExclude(row) && row.manuallyExcluded === true))) return false;
            skipped.set(id, true);
        }
        for (const [id, present] of Object.entries(check.results)) {
            if (!allowed.has(id) || skipped.has(id) || !Array.isArray(present)) return false;
            const target = check.products.find(row => String(row.productId) === id);
            if (!target || present.some(code => !target.barcodes.includes(code))) return false;
        }
        return ids.every(id => skipped.has(id) || Object.hasOwn(check.results, id));
    }
    function hasSafePartialResults(check) {
        if (!check || !Array.isArray(check.products) || !check.results || !Array.isArray(check.skipped)) return false;
        const ids=check.products.map(row=>String(row.productId));
        if (new Set(ids).size!==ids.length) return false;
        const allowed=new Set(ids), skipped=new Set();
        for(const row of check.skipped) {
            const id=String(row.productId);
            if (!allowed.has(id) || skipped.has(id) || Object.hasOwn(check.results,id)) return false;
            skipped.add(id);
        }
        for(const [id,present] of Object.entries(check.results)) {
            const target=check.products.find(row=>String(row.productId)===id);
            if(!target || !Array.isArray(present) || present.some(code=>!target.barcodes.includes(code))) return false;
        }
        return ids.every(id=>skipped.has(id) || Object.hasOwn(check.results,id));
    }
    return { canManuallyExclude, isFullyResolved, hasSafePartialResults };
});
