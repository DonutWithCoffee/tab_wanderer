const OZON_BARCODE_BINDING_STATUS = {
    READY: 'ready',
    SKIPPED: 'skipped',
    ERROR: 'error'
};

const OZON_BARCODE_BINDING_REASONS = {
    ALREADY_EXISTS: 'alreadyExists',
    NO_ELIGIBLE_BARCODES: 'noEligibleBarcodes',
    OZON_PRODUCT_NOT_RESOLVED: 'ozonProductNotResolved',
    SELLER_ID_MISSING: 'sellerIdMissing'
};

const OZON_BARCODE_BINDING_DEFAULT_CHUNK_SIZE = 20;

function normalizeOzonBindingId(value) {
    return String(value || '')
        .replace(/\s+/g, '')
        .trim();
}

function normalizeOzonBindingBarcode(value) {
    return String(value || '')
        .replace(/\s+/g, '')
        .trim();
}

function uniqueOzonBindingBarcodes(values = []) {
    const seen = new Set();
    const result = [];

    for (const value of values) {
        const barcode = normalizeOzonBindingBarcode(value);

        if (!barcode || seen.has(barcode)) {
            continue;
        }

        seen.add(barcode);
        result.push(barcode);
    }

    return result;
}

function getOzonBindingProductGroups(warehouseExtraction = {}) {
    const groups = warehouseExtraction.productsById || {};

    return Object.values(groups)
        .filter(group => group && group.productId && group.productId !== '__unknown__');
}

function resolveOzonBindingProduct(productGroup, ozonProductsByProductId = {}) {
    const productId = normalizeOzonBindingId(productGroup?.productId);
    const directProduct = ozonProductsByProductId[productId];

    if (!directProduct) {
        return null;
    }

    if (directProduct.ok === true && directProduct.product) {
        return directProduct.product;
    }

    if (directProduct.offerId || directProduct.ozonSku || directProduct.existingBarcodes) {
        return directProduct;
    }

    return null;
}

function createOzonBarcodeAddPayload(sellerId, ozonSku, barcodes = []) {
    const normalizedSellerId = normalizeOzonBindingId(sellerId);
    const normalizedOzonSku = normalizeOzonBindingId(ozonSku);
    const normalizedBarcodes = uniqueOzonBindingBarcodes(barcodes);

    return {
        seller_id: normalizedSellerId,
        barcodes: normalizedBarcodes.map(barcode => ({
            barcode,
            item_id: normalizedOzonSku
        }))
    };
}

function chunkOzonBarcodes(barcodes = [], chunkSize = OZON_BARCODE_BINDING_DEFAULT_CHUNK_SIZE) {
    const normalizedChunkSize = Math.max(1, Number(chunkSize) || OZON_BARCODE_BINDING_DEFAULT_CHUNK_SIZE);
    const uniqueBarcodes = uniqueOzonBindingBarcodes(barcodes);
    const chunks = [];

    for (let index = 0; index < uniqueBarcodes.length; index += normalizedChunkSize) {
        chunks.push(uniqueBarcodes.slice(index, index + normalizedChunkSize));
    }

    return chunks;
}

function createOzonBarcodeAddRequests({ sellerId, ozonSku, barcodes = [], chunkSize = OZON_BARCODE_BINDING_DEFAULT_CHUNK_SIZE } = {}) {
    return chunkOzonBarcodes(barcodes, chunkSize).map(chunk => ({
        url: '/api/barcode-add-v2',
        method: 'POST',
        payload: createOzonBarcodeAddPayload(sellerId, ozonSku, chunk)
    }));
}

function createOzonBindingProductPlan(productGroup, ozonProduct, options = {}) {
    const sellerId = normalizeOzonBindingId(options.sellerId);
    const productId = normalizeOzonBindingId(productGroup.productId);
    const existingBarcodes = new Set(uniqueOzonBindingBarcodes(ozonProduct?.existingBarcodes || []));
    const eligibleBarcodeEntries = Array.isArray(productGroup.eligibleBarcodes) ? productGroup.eligibleBarcodes : [];
    const skippedWarehouseBarcodes = Array.isArray(productGroup.skippedBarcodes) ? productGroup.skippedBarcodes : [];
    const toAdd = [];
    const alreadyExists = [];

    if (!sellerId) {
        return {
            status: OZON_BARCODE_BINDING_STATUS.ERROR,
            reason: OZON_BARCODE_BINDING_REASONS.SELLER_ID_MISSING,
            productId,
            productTitle: productGroup.productTitle || '',
            ozonSku: normalizeOzonBindingId(ozonProduct?.ozonSku),
            existingBarcodes: [...existingBarcodes],
            toAdd,
            alreadyExists,
            skippedWarehouseBarcodes,
            requests: []
        };
    }

    if (!ozonProduct || !normalizeOzonBindingId(ozonProduct.ozonSku)) {
        return {
            status: OZON_BARCODE_BINDING_STATUS.ERROR,
            reason: OZON_BARCODE_BINDING_REASONS.OZON_PRODUCT_NOT_RESOLVED,
            productId,
            productTitle: productGroup.productTitle || '',
            ozonSku: '',
            existingBarcodes: [...existingBarcodes],
            toAdd,
            alreadyExists,
            skippedWarehouseBarcodes,
            requests: []
        };
    }

    const seenToAdd = new Set();

    for (const entry of eligibleBarcodeEntries) {
        const barcode = normalizeOzonBindingBarcode(entry?.barcode);

        if (!barcode) {
            continue;
        }

        if (existingBarcodes.has(barcode)) {
            alreadyExists.push({ ...entry, barcode, reason: OZON_BARCODE_BINDING_REASONS.ALREADY_EXISTS });
            continue;
        }

        if (seenToAdd.has(barcode)) {
            continue;
        }

        seenToAdd.add(barcode);
        toAdd.push({ ...entry, barcode });
    }

    if (toAdd.length === 0) {
        return {
            status: OZON_BARCODE_BINDING_STATUS.SKIPPED,
            reason: OZON_BARCODE_BINDING_REASONS.NO_ELIGIBLE_BARCODES,
            productId,
            productTitle: productGroup.productTitle || ozonProduct.title || '',
            ozonSku: normalizeOzonBindingId(ozonProduct.ozonSku),
            existingBarcodes: [...existingBarcodes],
            toAdd,
            alreadyExists,
            skippedWarehouseBarcodes,
            requests: []
        };
    }

    const ozonSku = normalizeOzonBindingId(ozonProduct.ozonSku);
    const requests = createOzonBarcodeAddRequests({
        sellerId,
        ozonSku,
        barcodes: toAdd.map(entry => entry.barcode),
        chunkSize: options.chunkSize
    });

    return {
        status: OZON_BARCODE_BINDING_STATUS.READY,
        reason: null,
        productId,
        productTitle: productGroup.productTitle || ozonProduct.title || '',
        ozonSku,
        existingBarcodes: [...existingBarcodes],
        toAdd,
        alreadyExists,
        skippedWarehouseBarcodes,
        requests
    };
}



function createOzonBarcodeBindingPreviewProductPlan(productGroup, ozonProductResult = {}) {
    const productId = normalizeOzonBindingId(productGroup?.productId);
    const eligibleBarcodeEntries = Array.isArray(productGroup?.eligibleBarcodes) ? productGroup.eligibleBarcodes : [];
    const skippedWarehouseBarcodes = Array.isArray(productGroup?.skippedBarcodes) ? productGroup.skippedBarcodes : [];

    if (!ozonProductResult || ozonProductResult.ok !== true || !ozonProductResult.product) {
        return {
            status: OZON_BARCODE_BINDING_STATUS.ERROR,
            reason: ozonProductResult?.error || OZON_BARCODE_BINDING_REASONS.OZON_PRODUCT_NOT_RESOLVED,
            productId,
            productTitle: productGroup?.productTitle || '',
            ozonSku: '',
            existingBarcodes: [],
            toAdd: [],
            alreadyExists: [],
            skippedWarehouseBarcodes
        };
    }

    const ozonProduct = ozonProductResult.product;
    const existingBarcodes = new Set(uniqueOzonBindingBarcodes(ozonProduct.existingBarcodes || []));
    const toAdd = [];
    const alreadyExists = [];
    const seenToAdd = new Set();

    for (const entry of eligibleBarcodeEntries) {
        const barcode = normalizeOzonBindingBarcode(entry?.barcode);

        if (!barcode) {
            continue;
        }

        if (existingBarcodes.has(barcode)) {
            alreadyExists.push({ ...entry, barcode, reason: OZON_BARCODE_BINDING_REASONS.ALREADY_EXISTS });
            continue;
        }

        if (seenToAdd.has(barcode)) {
            continue;
        }

        seenToAdd.add(barcode);
        toAdd.push({ ...entry, barcode });
    }

    return {
        status: toAdd.length > 0 ? OZON_BARCODE_BINDING_STATUS.READY : OZON_BARCODE_BINDING_STATUS.SKIPPED,
        reason: toAdd.length > 0 ? null : OZON_BARCODE_BINDING_REASONS.NO_ELIGIBLE_BARCODES,
        productId,
        productTitle: productGroup?.productTitle || ozonProduct.title || '',
        ozonSku: normalizeOzonBindingId(ozonProduct.ozonSku),
        existingBarcodes: [...existingBarcodes],
        toAdd,
        alreadyExists,
        skippedWarehouseBarcodes
    };
}

function createOzonBarcodeBindingPreviewPlan({ warehouseExtraction = {}, ozonProductsByProductId = {} } = {}) {
    const productPlans = getOzonBindingProductGroups(warehouseExtraction).map(productGroup => createOzonBarcodeBindingPreviewProductPlan(
        productGroup,
        ozonProductsByProductId[normalizeOzonBindingId(productGroup.productId)]
    ));

    return {
        orderId: warehouseExtraction.orderId || '',
        productPlans,
        summary: {
            productCount: productPlans.length,
            readyProductCount: productPlans.filter(plan => plan.status === OZON_BARCODE_BINDING_STATUS.READY).length,
            errorProductCount: productPlans.filter(plan => plan.status === OZON_BARCODE_BINDING_STATUS.ERROR).length,
            skippedProductCount: productPlans.filter(plan => plan.status === OZON_BARCODE_BINDING_STATUS.SKIPPED).length,
            toAddCount: productPlans.reduce((total, plan) => total + plan.toAdd.length, 0),
            alreadyExistsCount: productPlans.reduce((total, plan) => total + plan.alreadyExists.length, 0),
            skippedWarehouseCount: productPlans.reduce((total, plan) => total + plan.skippedWarehouseBarcodes.length, 0)
        }
    };
}

function createOzonBarcodeBindingPlan({ warehouseExtraction = {}, ozonProductsByProductId = {}, sellerId = '', chunkSize = OZON_BARCODE_BINDING_DEFAULT_CHUNK_SIZE } = {}) {
    const productPlans = getOzonBindingProductGroups(warehouseExtraction).map(productGroup => createOzonBindingProductPlan(
        productGroup,
        resolveOzonBindingProduct(productGroup, ozonProductsByProductId),
        { sellerId, chunkSize }
    ));

    return {
        orderId: warehouseExtraction.orderId || '',
        sellerId: normalizeOzonBindingId(sellerId),
        productPlans,
        summary: {
            productCount: productPlans.length,
            readyProductCount: productPlans.filter(plan => plan.status === OZON_BARCODE_BINDING_STATUS.READY).length,
            errorProductCount: productPlans.filter(plan => plan.status === OZON_BARCODE_BINDING_STATUS.ERROR).length,
            skippedProductCount: productPlans.filter(plan => plan.status === OZON_BARCODE_BINDING_STATUS.SKIPPED).length,
            toAddCount: productPlans.reduce((total, plan) => total + plan.toAdd.length, 0),
            alreadyExistsCount: productPlans.reduce((total, plan) => total + plan.alreadyExists.length, 0),
            skippedWarehouseCount: productPlans.reduce((total, plan) => total + plan.skippedWarehouseBarcodes.length, 0),
            requestCount: productPlans.reduce((total, plan) => total + plan.requests.length, 0)
        }
    };
}

globalThis.OZON_BARCODE_BINDING_STATUS = OZON_BARCODE_BINDING_STATUS;
globalThis.OZON_BARCODE_BINDING_REASONS = OZON_BARCODE_BINDING_REASONS;
globalThis.OZON_BARCODE_BINDING_DEFAULT_CHUNK_SIZE = OZON_BARCODE_BINDING_DEFAULT_CHUNK_SIZE;
globalThis.normalizeOzonBindingId = normalizeOzonBindingId;
globalThis.normalizeOzonBindingBarcode = normalizeOzonBindingBarcode;
globalThis.uniqueOzonBindingBarcodes = uniqueOzonBindingBarcodes;
globalThis.createOzonBarcodeAddPayload = createOzonBarcodeAddPayload;
globalThis.chunkOzonBarcodes = chunkOzonBarcodes;
globalThis.createOzonBarcodeAddRequests = createOzonBarcodeAddRequests;
globalThis.createOzonBindingProductPlan = createOzonBindingProductPlan;
globalThis.createOzonBarcodeBindingPreviewProductPlan = createOzonBarcodeBindingPreviewProductPlan;
globalThis.createOzonBarcodeBindingPreviewPlan = createOzonBarcodeBindingPreviewPlan;
globalThis.createOzonBarcodeBindingPlan = createOzonBarcodeBindingPlan;
