const WAREHOUSE_BARCODE_DECISIONS = {
    ELIGIBLE: 'eligible',
    SKIPPED: 'skipped'
};

const WAREHOUSE_BARCODE_SKIP_REASONS = {
    MISSING_BARCODE: 'missingBarcode',
    MISSING_PRODUCT_ID: 'missingProductId',
    MULTI_BARCODE_TYPE: 'multiBarcodeType',
    NON_UNIT_ASSEMBLY_QUANTITY: 'nonUnitAssemblyQuantity',
    NON_UNIT_RESERVED_QUANTITY: 'nonUnitReservedQuantity',
    DUPLICATE_BARCODE: 'duplicateBarcode'
};

function normalizeWarehouseBarcodeValue(value) {
    return String(value || '')
        .replace(/\s+/g, '')
        .trim();
}

function normalizeWarehouseProductId(value) {
    return String(value || '')
        .replace(/\s+/g, '')
        .trim();
}

function normalizeWarehouseText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeWarehouseNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const numeric = Number(value);

    return Number.isFinite(numeric) ? numeric : null;
}

function getWarehouseProductItem(entry = {}) {
    if (entry.product_item && typeof entry.product_item === 'object') {
        return entry.product_item;
    }

    if (entry.productItem && typeof entry.productItem === 'object') {
        return entry.productItem;
    }

    return {};
}

function getWarehouseProductId(entry = {}, productItem = getWarehouseProductItem(entry)) {
    return normalizeWarehouseProductId(
        productItem.product_id ||
        productItem.productId ||
        productItem.product?.id ||
        entry.product_id ||
        entry.productId ||
        entry.product?.id
    );
}

function getWarehouseProductTitle(entry = {}, productItem = getWarehouseProductItem(entry)) {
    return normalizeWarehouseText(
        productItem.product?.title ||
        productItem.product_title ||
        productItem.productTitle ||
        entry.product?.title ||
        entry.product_title ||
        entry.productTitle ||
        ''
    );
}

function normalizeWarehouseBarcodeEntry(entry = {}) {
    const productItem = getWarehouseProductItem(entry);
    const productId = getWarehouseProductId(entry, productItem);
    const barcode = normalizeWarehouseBarcodeValue(
        productItem.barcode ||
        productItem.bar_code ||
        productItem.code ||
        entry.barcode ||
        entry.bar_code ||
        entry.code
    );

    return {
        barcode,
        productId,
        productTitle: getWarehouseProductTitle(entry, productItem),
        productItemId: normalizeWarehouseProductId(productItem.id || productItem.item_id || productItem.itemId),
        assemblyId: normalizeWarehouseProductId(entry.id || entry.assembly_id || entry.assemblyId),
        itemType: normalizeWarehouseNumber(productItem.type),
        assemblyQuantity: normalizeWarehouseNumber(entry.quantity || entry.assembly_quantity || entry.assemblyQuantity),
        reservedQuantity: normalizeWarehouseNumber(productItem.reserved_quantity || productItem.reservedQuantity),
        stockQuantity: normalizeWarehouseNumber(productItem.quantity || productItem.stockQuantity),
        stateTitle: normalizeWarehouseText(productItem.state?.title || productItem.state_title || productItem.stateTitle)
    };
}

function createWarehouseBarcodeResult(decision, entry, reason = null) {
    return {
        decision,
        reason,
        barcode: entry.barcode,
        productId: entry.productId,
        productTitle: entry.productTitle,
        productItemId: entry.productItemId,
        assemblyId: entry.assemblyId,
        itemType: entry.itemType,
        assemblyQuantity: entry.assemblyQuantity,
        reservedQuantity: entry.reservedQuantity,
        stockQuantity: entry.stockQuantity,
        stateTitle: entry.stateTitle
    };
}

function classifyWarehouseBarcodeEntry(entry = {}) {
    const normalized = normalizeWarehouseBarcodeEntry(entry);

    if (!normalized.barcode) {
        return createWarehouseBarcodeResult(
            WAREHOUSE_BARCODE_DECISIONS.SKIPPED,
            normalized,
            WAREHOUSE_BARCODE_SKIP_REASONS.MISSING_BARCODE
        );
    }

    if (!normalized.productId) {
        return createWarehouseBarcodeResult(
            WAREHOUSE_BARCODE_DECISIONS.SKIPPED,
            normalized,
            WAREHOUSE_BARCODE_SKIP_REASONS.MISSING_PRODUCT_ID
        );
    }

    if (normalized.itemType !== null && normalized.itemType !== 0) {
        return createWarehouseBarcodeResult(
            WAREHOUSE_BARCODE_DECISIONS.SKIPPED,
            normalized,
            WAREHOUSE_BARCODE_SKIP_REASONS.MULTI_BARCODE_TYPE
        );
    }

    if (normalized.assemblyQuantity !== null && normalized.assemblyQuantity !== 1) {
        return createWarehouseBarcodeResult(
            WAREHOUSE_BARCODE_DECISIONS.SKIPPED,
            normalized,
            WAREHOUSE_BARCODE_SKIP_REASONS.NON_UNIT_ASSEMBLY_QUANTITY
        );
    }

    if (normalized.reservedQuantity !== null && normalized.reservedQuantity !== 1) {
        return createWarehouseBarcodeResult(
            WAREHOUSE_BARCODE_DECISIONS.SKIPPED,
            normalized,
            WAREHOUSE_BARCODE_SKIP_REASONS.NON_UNIT_RESERVED_QUANTITY
        );
    }

    return createWarehouseBarcodeResult(WAREHOUSE_BARCODE_DECISIONS.ELIGIBLE, normalized, null);
}

function getWarehouseAssemblyRows(shopOrder = {}) {
    if (Array.isArray(shopOrder.assembly)) {
        return shopOrder.assembly;
    }

    if (Array.isArray(shopOrder.assemblies)) {
        return shopOrder.assemblies;
    }

    return [];
}

function createWarehouseBarcodeProductGroup(productId, productTitle = '') {
    return {
        productId,
        productTitle,
        eligibleBarcodes: [],
        skippedBarcodes: []
    };
}

function getOrCreateWarehouseBarcodeProductGroup(groups, productId, productTitle = '') {
    if (!groups[productId]) {
        groups[productId] = createWarehouseBarcodeProductGroup(productId, productTitle);
    }

    if (!groups[productId].productTitle && productTitle) {
        groups[productId].productTitle = productTitle;
    }

    return groups[productId];
}

function extractWarehouseAssemblyBarcodes(shopOrder = {}) {
    const productsById = {};
    const eligibleBarcodes = [];
    const skippedBarcodes = [];
    const seenProductBarcodes = new Set();

    for (const rawEntry of getWarehouseAssemblyRows(shopOrder)) {
        const result = classifyWarehouseBarcodeEntry(rawEntry);
        const productId = result.productId || '__unknown__';
        const group = getOrCreateWarehouseBarcodeProductGroup(productsById, productId, result.productTitle);

        if (result.decision === WAREHOUSE_BARCODE_DECISIONS.ELIGIBLE) {
            const duplicateKey = `${result.productId}:${result.barcode}`;

            if (seenProductBarcodes.has(duplicateKey)) {
                const duplicateResult = {
                    ...result,
                    decision: WAREHOUSE_BARCODE_DECISIONS.SKIPPED,
                    reason: WAREHOUSE_BARCODE_SKIP_REASONS.DUPLICATE_BARCODE
                };

                group.skippedBarcodes.push(duplicateResult);
                skippedBarcodes.push(duplicateResult);
                continue;
            }

            seenProductBarcodes.add(duplicateKey);
            group.eligibleBarcodes.push(result);
            eligibleBarcodes.push(result);
            continue;
        }

        group.skippedBarcodes.push(result);
        skippedBarcodes.push(result);
    }

    return {
        orderId: normalizeWarehouseText(shopOrder.id || shopOrder.order_id || shopOrder.orderId),
        productsById,
        eligibleBarcodes,
        skippedBarcodes,
        summary: {
            productCount: Object.keys(productsById).filter(productId => productId !== '__unknown__').length,
            eligibleCount: eligibleBarcodes.length,
            skippedCount: skippedBarcodes.length
        }
    };
}

globalThis.WAREHOUSE_BARCODE_DECISIONS = WAREHOUSE_BARCODE_DECISIONS;
globalThis.WAREHOUSE_BARCODE_SKIP_REASONS = WAREHOUSE_BARCODE_SKIP_REASONS;
globalThis.normalizeWarehouseBarcodeValue = normalizeWarehouseBarcodeValue;
globalThis.normalizeWarehouseProductId = normalizeWarehouseProductId;
globalThis.normalizeWarehouseText = normalizeWarehouseText;
globalThis.normalizeWarehouseNumber = normalizeWarehouseNumber;
globalThis.getWarehouseProductItem = getWarehouseProductItem;
globalThis.getWarehouseProductId = getWarehouseProductId;
globalThis.getWarehouseProductTitle = getWarehouseProductTitle;
globalThis.normalizeWarehouseBarcodeEntry = normalizeWarehouseBarcodeEntry;
globalThis.classifyWarehouseBarcodeEntry = classifyWarehouseBarcodeEntry;
globalThis.extractWarehouseAssemblyBarcodes = extractWarehouseAssemblyBarcodes;
