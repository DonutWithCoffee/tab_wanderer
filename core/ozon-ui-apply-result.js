function getOzonUiApplyProductGroups(warehouseExtraction = {}) {
    return getOzonResolveProductGroups(warehouseExtraction)
        .map(group => ({
            ...group,
            productId: normalizeOzonResolveId(group?.productId),
            eligibleBarcodes: Array.isArray(group?.eligibleBarcodes) ? group.eligibleBarcodes : []
        }))
        .filter(group => group.productId && group.eligibleBarcodes.length > 0);
}

function getUniqueOzonUiApplyBarcodes(entries = []) {
    const seen = new Set();
    const result = [];

    for (const entry of entries) {
        const barcode = normalizeOzonResolveId(entry?.barcode || entry);

        if (!barcode || seen.has(barcode)) {
            continue;
        }

        seen.add(barcode);
        result.push(barcode);
    }

    return result;
}

function createOzonUiApplyRequestFromWarehouseExtraction(warehouseExtraction = {}) {
    const productRequests = getOzonUiApplyProductGroups(warehouseExtraction)
        .map(group => ({
            productId: group.productId,
            productTitle: String(group.productTitle || ''),
            barcodes: getUniqueOzonUiApplyBarcodes(group.eligibleBarcodes)
        }))
        .filter(request => request.productId && request.barcodes.length > 0);

    if (!productRequests.length) {
        return { ok: false, error: 'no eligible warehouse barcodes' };
    }

    return {
        ok: true,
        productRequests,
        productCount: productRequests.length,
        barcodeCount: productRequests.reduce((sum, request) => sum + request.barcodes.length, 0)
    };
}

function buildOzonUiApplyProductResult(productRequest = {}, msg = {}) {
    const details = msg.details || null;
    const verify = details?.verify && typeof details.verify === 'object' ? details.verify : null;
    const barcodes = Array.isArray(msg.barcodes) && msg.barcodes.length
        ? msg.barcodes.map(normalizeOzonResolveId).filter(Boolean)
        : Array.isArray(productRequest.barcodes)
            ? productRequest.barcodes
            : [];
    const missingBarcodes = Array.isArray(msg.missingBarcodes)
        ? msg.missingBarcodes.map(normalizeOzonResolveId).filter(Boolean)
        : Array.isArray(verify?.missingBarcodes)
            ? verify.missingBarcodes.map(normalizeOzonResolveId).filter(Boolean)
            : [];
    const verifiedCount = Object.prototype.hasOwnProperty.call(msg, 'verifiedCount')
        ? Number(msg.verifiedCount) || 0
        : Number(verify?.verifiedCount) || 0;

    return {
        ok: msg.ok === true,
        productId: normalizeOzonResolveId(productRequest.productId || msg.productId),
        productTitle: String(productRequest.productTitle || ''),
        barcodes,
        addedCount: Number(msg.addedCount) || 0,
        verifiedCount,
        missingBarcodes,
        missingCount: missingBarcodes.length,
        verifyUnconfirmed: details?.verifyUnconfirmed === true,
        error: msg.error || null,
        details
    };
}

function isOzonUiApplyProductError(result = {}) {
    if (result.verifyUnconfirmed === true || result.details?.verifyUnconfirmed === true) {
        return result.ok !== true;
    }

    return result.ok !== true || Number(result.missingCount) > 0;
}

function createOzonUiApplyFinalPayload(session = {}) {
    const productResults = Array.isArray(session?.results) ? session.results : [];
    const allBarcodes = getUniqueOzonUiApplyBarcodes(productResults.flatMap(result => result.barcodes || []));
    const missingBarcodes = getUniqueOzonUiApplyBarcodes(productResults.flatMap(result => result.missingBarcodes || []));
    const errorCount = productResults.filter(isOzonUiApplyProductError).length;
    const addedCount = productResults.reduce((sum, result) => sum + (Number(result.addedCount) || 0), 0);
    const verifiedCount = productResults.reduce((sum, result) => sum + (Number(result.verifiedCount) || 0), 0);

    return {
        ok: true,
        productId: productResults.length === 1 ? productResults[0].productId : '',
        productCount: productResults.length,
        successCount: productResults.length - errorCount,
        errorCount,
        barcodes: allBarcodes,
        addedCount,
        verifiedCount,
        missingBarcodes,
        error: errorCount > 0 ? `Ozon UI apply finished with ${errorCount} product error(s)` : null,
        details: {
            productResults,
            verify: {
                verifiedCount,
                missingBarcodes
            },
            verifyUnconfirmed: productResults.some(result => result.verifyUnconfirmed === true || result.details?.verifyUnconfirmed === true)
        },
        productResults
    };
}
