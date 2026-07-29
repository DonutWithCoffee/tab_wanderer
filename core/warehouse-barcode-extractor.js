const WAREHOUSE_BARCODE_DECISIONS = {
    ELIGIBLE: 'eligible',
    SKIPPED: 'skipped'
};

const MAX_WAREHOUSE_OZON_PRODUCTS = 100;
const MAX_WAREHOUSE_OZON_ENTRIES_PER_PRODUCT = 500;
const MAX_WAREHOUSE_OZON_TOTAL_ENTRIES = 2000;
const MAX_WAREHOUSE_BARCODE_LENGTH = 80;
const MAX_WAREHOUSE_PRODUCT_ID_LENGTH = 80;
const MAX_WAREHOUSE_PRODUCT_TITLE_LENGTH = 500;

const WAREHOUSE_BARCODE_SKIP_REASONS = {
    MISSING_BARCODE: 'missingBarcode',
    MISSING_PRODUCT_ID: 'missingProductId',
    ITEM_TYPE_UNKNOWN: 'itemTypeUnknown',
    MULTI_BARCODE_TYPE: 'multiBarcodeType',
    NON_UNIT_ASSEMBLY_QUANTITY: 'nonUnitAssemblyQuantity',
    NON_UNIT_RESERVED_QUANTITY: 'nonUnitReservedQuantity',
    DUPLICATE_BARCODE: 'duplicateBarcode'
};

function normalizeWarehouseScalarString(value, maxLength = 500) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return '';
    }

    return String(value)
        .slice(0, maxLength)
        .trim();
}

function normalizeWarehouseBarcodeValue(value) {
    return normalizeWarehouseScalarString(value, MAX_WAREHOUSE_BARCODE_LENGTH)
        .replace(/\s+/g, '');
}

function normalizeWarehouseProductId(value) {
    return normalizeWarehouseScalarString(value, MAX_WAREHOUSE_PRODUCT_ID_LENGTH)
        .replace(/\s+/g, '');
}

function normalizeWarehouseText(value) {
    return normalizeWarehouseScalarString(value, MAX_WAREHOUSE_PRODUCT_TITLE_LENGTH)
        .replace(/\s+/g, ' ');
}

function firstDefinedWarehouseValue(...values) {
    return values.find(value => value !== undefined && value !== null && value !== '') ?? null;
}

function normalizeWarehouseNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    if (!normalized || !/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
        return null;
    }

    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
}

function isWarehouseNumberProvided(value) {
    return value !== undefined && value !== null && value !== '';
}

function isWarehouseNumberInvalid(value) {
    return isWarehouseNumberProvided(value) && normalizeWarehouseNumber(value) === null;
}


function isWarehouseScalarWithinLimit(value, maxLength) {
    if (value === undefined || value === null || value === '') {
        return true;
    }

    return (typeof value === 'string' || typeof value === 'number')
        && String(value).length <= maxLength;
}

function validateWarehouseBarcodeExtractionBounds(extraction = {}) {
    const safeExtraction = extraction && typeof extraction === 'object' && !Array.isArray(extraction)
        ? extraction
        : {};
    const groupsObject = safeExtraction.productsById;

    if (!groupsObject || typeof groupsObject !== 'object' || Array.isArray(groupsObject)) {
        return { ok: true, productCount: 0, totalEntryCount: 0 };
    }

    const productKeys = Object.keys(groupsObject);
    if (productKeys.length > MAX_WAREHOUSE_OZON_PRODUCTS) {
        return {
            ok: false,
            error: `warehouse payload has too many products (${productKeys.length})`,
            productCount: productKeys.length,
            totalEntryCount: 0
        };
    }

    let totalEntryCount = 0;

    for (const key of productKeys) {
        const group = groupsObject[key];
        if (!group || typeof group !== 'object' || Array.isArray(group)) {
            return { ok: false, error: 'warehouse payload contains an invalid product group' };
        }

        if (!isWarehouseScalarWithinLimit(group.productId || key, MAX_WAREHOUSE_PRODUCT_ID_LENGTH)
            || !isWarehouseScalarWithinLimit(group.productTitle, MAX_WAREHOUSE_PRODUCT_TITLE_LENGTH)) {
            return { ok: false, error: 'warehouse payload contains oversized product metadata' };
        }

        const eligible = Array.isArray(group.eligibleBarcodes) ? group.eligibleBarcodes : [];
        const skipped = Array.isArray(group.skippedBarcodes) ? group.skippedBarcodes : [];
        const groupEntryCount = eligible.length + skipped.length;

        if (groupEntryCount > MAX_WAREHOUSE_OZON_ENTRIES_PER_PRODUCT) {
            return {
                ok: false,
                error: `warehouse payload has too many barcode rows for product ${normalizeWarehouseProductId(group.productId || key)}`,
                productCount: productKeys.length,
                totalEntryCount: totalEntryCount + groupEntryCount
            };
        }

        totalEntryCount += groupEntryCount;
        if (totalEntryCount > MAX_WAREHOUSE_OZON_TOTAL_ENTRIES) {
            return {
                ok: false,
                error: `warehouse payload has too many barcode rows (${totalEntryCount})`,
                productCount: productKeys.length,
                totalEntryCount
            };
        }

        for (const entry of eligible.concat(skipped)) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                return { ok: false, error: 'warehouse payload contains an invalid barcode row' };
            }

            if (!isWarehouseScalarWithinLimit(entry.barcode, MAX_WAREHOUSE_BARCODE_LENGTH)
                || !isWarehouseScalarWithinLimit(entry.productId || group.productId || key, MAX_WAREHOUSE_PRODUCT_ID_LENGTH)
                || !isWarehouseScalarWithinLimit(entry.productTitle, MAX_WAREHOUSE_PRODUCT_TITLE_LENGTH)) {
                return { ok: false, error: 'warehouse payload contains oversized barcode metadata' };
            }
        }
    }

    return {
        ok: true,
        productCount: productKeys.length,
        totalEntryCount
    };
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

    const rawItemType = productItem.type;
    const rawAssemblyQuantity = firstDefinedWarehouseValue(entry.quantity, entry.assembly_quantity, entry.assemblyQuantity);
    const rawReservedQuantity = firstDefinedWarehouseValue(productItem.reserved_quantity, productItem.reservedQuantity);
    const rawStockQuantity = firstDefinedWarehouseValue(productItem.quantity, productItem.stockQuantity);

    return {
        barcode,
        productId,
        productTitle: getWarehouseProductTitle(entry, productItem),
        productItemId: normalizeWarehouseProductId(productItem.id || productItem.item_id || productItem.itemId),
        assemblyId: normalizeWarehouseProductId(entry.id || entry.assembly_id || entry.assemblyId),
        itemType: normalizeWarehouseNumber(rawItemType),
        itemTypeInvalid: Boolean(productItem.type_invalid || productItem.typeInvalid) || isWarehouseNumberInvalid(rawItemType),
        assemblyQuantity: normalizeWarehouseNumber(rawAssemblyQuantity),
        assemblyQuantityInvalid: Boolean(entry.quantity_invalid || entry.quantityInvalid) || isWarehouseNumberInvalid(rawAssemblyQuantity),
        reservedQuantity: normalizeWarehouseNumber(rawReservedQuantity),
        reservedQuantityInvalid: Boolean(productItem.reserved_quantity_invalid || productItem.reservedQuantityInvalid) || isWarehouseNumberInvalid(rawReservedQuantity),
        stockQuantity: normalizeWarehouseNumber(rawStockQuantity),
        stockQuantityInvalid: Boolean(productItem.quantity_invalid || productItem.quantityInvalid) || isWarehouseNumberInvalid(rawStockQuantity),
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
        itemTypeInvalid: entry.itemTypeInvalid === true,
        assemblyQuantity: entry.assemblyQuantity,
        assemblyQuantityInvalid: entry.assemblyQuantityInvalid === true,
        reservedQuantity: entry.reservedQuantity,
        reservedQuantityInvalid: entry.reservedQuantityInvalid === true,
        stockQuantity: entry.stockQuantity,
        stockQuantityInvalid: entry.stockQuantityInvalid === true,
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

    if (normalized.itemType === null || normalized.itemTypeInvalid) {
        return createWarehouseBarcodeResult(
            WAREHOUSE_BARCODE_DECISIONS.SKIPPED,
            normalized,
            WAREHOUSE_BARCODE_SKIP_REASONS.ITEM_TYPE_UNKNOWN
        );
    }

    if (normalized.itemType !== 0) {
        return createWarehouseBarcodeResult(
            WAREHOUSE_BARCODE_DECISIONS.SKIPPED,
            normalized,
            WAREHOUSE_BARCODE_SKIP_REASONS.MULTI_BARCODE_TYPE
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


function createWarehouseRawEntryFromExtractionEntry(entry = {}, productGroup = {}) {
    const safeEntry = entry && typeof entry === 'object' ? entry : {};
    const safeGroup = productGroup && typeof productGroup === 'object' ? productGroup : {};
    const productId = normalizeWarehouseProductId(safeEntry.productId || safeGroup.productId);
    const productTitle = normalizeWarehouseText(safeEntry.productTitle || safeGroup.productTitle);

    return {
        id: normalizeWarehouseProductId(safeEntry.assemblyId),
        quantity: normalizeWarehouseNumber(safeEntry.assemblyQuantity),
        quantity_invalid: safeEntry.assemblyQuantityInvalid === true,
        product_item: {
            id: normalizeWarehouseProductId(safeEntry.productItemId),
            barcode: normalizeWarehouseBarcodeValue(safeEntry.barcode),
            type: normalizeWarehouseNumber(safeEntry.itemType),
            type_invalid: safeEntry.itemTypeInvalid === true,
            quantity: normalizeWarehouseNumber(safeEntry.stockQuantity),
            quantity_invalid: safeEntry.stockQuantityInvalid === true,
            reserved_quantity: normalizeWarehouseNumber(safeEntry.reservedQuantity),
            reserved_quantity_invalid: safeEntry.reservedQuantityInvalid === true,
            product_id: productId,
            product: {
                id: productId,
                title: productTitle
            },
            state: safeEntry.stateTitle
                ? { title: normalizeWarehouseText(safeEntry.stateTitle) }
                : null
        }
    };
}

function normalizeWarehouseSkippedExtractionEntry(entry = {}, productGroup = {}) {
    const classified = classifyWarehouseBarcodeEntry(
        createWarehouseRawEntryFromExtractionEntry(entry, productGroup)
    );

    return {
        ...classified,
        decision: WAREHOUSE_BARCODE_DECISIONS.SKIPPED,
        reason: normalizeWarehouseText(entry?.reason) || classified.reason || WAREHOUSE_BARCODE_SKIP_REASONS.ITEM_TYPE_UNKNOWN
    };
}

function revalidateWarehouseBarcodeExtraction(extraction = {}) {
    const bounds = validateWarehouseBarcodeExtractionBounds(extraction);
    if (!bounds.ok) {
        return {
            orderId: '',
            productsById: {},
            eligibleBarcodes: [],
            skippedBarcodes: [],
            summary: { productCount: 0, eligibleCount: 0, skippedCount: 0 },
            revalidation: {
                sourceEligibleCount: 0,
                eligibleCount: 0,
                rejectedEligibleCount: 0,
                rejectionReasons: {},
                limitsExceeded: true,
                error: bounds.error || 'warehouse payload limits exceeded'
            }
        };
    }

    const safeExtraction = extraction && typeof extraction === 'object' ? extraction : {};
    const sourceGroups = safeExtraction.productsById && typeof safeExtraction.productsById === 'object'
        ? Object.values(safeExtraction.productsById)
        : [];
    const productsById = {};
    const eligibleBarcodes = [];
    const skippedBarcodes = [];
    const seenProductBarcodes = new Set();
    const rejectionReasons = {};
    let sourceEligibleCount = 0;

    for (const sourceGroup of sourceGroups) {
        if (!sourceGroup || typeof sourceGroup !== 'object') {
            continue;
        }

        const productId = normalizeWarehouseProductId(sourceGroup.productId);
        if (!productId || productId === '__unknown__') {
            continue;
        }

        const group = createWarehouseBarcodeProductGroup(
            productId,
            normalizeWarehouseText(sourceGroup.productTitle)
        );
        productsById[productId] = group;

        const sourceEligible = Array.isArray(sourceGroup.eligibleBarcodes)
            ? sourceGroup.eligibleBarcodes
            : [];
        const sourceSkipped = Array.isArray(sourceGroup.skippedBarcodes)
            ? sourceGroup.skippedBarcodes
            : [];

        sourceEligibleCount += sourceEligible.length;

        for (const sourceEntry of sourceEligible) {
            let result = classifyWarehouseBarcodeEntry(
                createWarehouseRawEntryFromExtractionEntry(sourceEntry, sourceGroup)
            );

            if (result.decision === WAREHOUSE_BARCODE_DECISIONS.ELIGIBLE) {
                const duplicateKey = `${result.productId}:${result.barcode}`;

                if (seenProductBarcodes.has(duplicateKey)) {
                    result = {
                        ...result,
                        decision: WAREHOUSE_BARCODE_DECISIONS.SKIPPED,
                        reason: WAREHOUSE_BARCODE_SKIP_REASONS.DUPLICATE_BARCODE
                    };
                } else {
                    seenProductBarcodes.add(duplicateKey);
                    group.eligibleBarcodes.push(result);
                    eligibleBarcodes.push(result);
                    continue;
                }
            }

            const reason = result.reason || WAREHOUSE_BARCODE_SKIP_REASONS.ITEM_TYPE_UNKNOWN;
            rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
            group.skippedBarcodes.push(result);
            skippedBarcodes.push(result);
        }

        for (const sourceEntry of sourceSkipped) {
            const result = normalizeWarehouseSkippedExtractionEntry(sourceEntry, sourceGroup);
            group.skippedBarcodes.push(result);
            skippedBarcodes.push(result);
        }
    }

    return {
        orderId: normalizeWarehouseText(safeExtraction.orderId),
        productsById,
        eligibleBarcodes,
        skippedBarcodes,
        summary: {
            productCount: Object.keys(productsById).length,
            eligibleCount: eligibleBarcodes.length,
            skippedCount: skippedBarcodes.length
        },
        revalidation: {
            sourceEligibleCount,
            eligibleCount: eligibleBarcodes.length,
            rejectedEligibleCount: Math.max(0, sourceEligibleCount - eligibleBarcodes.length),
            rejectionReasons
        }
    };
}

globalThis.MAX_WAREHOUSE_OZON_PRODUCTS = MAX_WAREHOUSE_OZON_PRODUCTS;
globalThis.MAX_WAREHOUSE_OZON_ENTRIES_PER_PRODUCT = MAX_WAREHOUSE_OZON_ENTRIES_PER_PRODUCT;
globalThis.MAX_WAREHOUSE_OZON_TOTAL_ENTRIES = MAX_WAREHOUSE_OZON_TOTAL_ENTRIES;
globalThis.WAREHOUSE_BARCODE_DECISIONS = WAREHOUSE_BARCODE_DECISIONS;
globalThis.WAREHOUSE_BARCODE_SKIP_REASONS = WAREHOUSE_BARCODE_SKIP_REASONS;
globalThis.normalizeWarehouseBarcodeValue = normalizeWarehouseBarcodeValue;
globalThis.normalizeWarehouseProductId = normalizeWarehouseProductId;
globalThis.normalizeWarehouseText = normalizeWarehouseText;
globalThis.firstDefinedWarehouseValue = firstDefinedWarehouseValue;
globalThis.normalizeWarehouseNumber = normalizeWarehouseNumber;
globalThis.isWarehouseNumberProvided = isWarehouseNumberProvided;
globalThis.isWarehouseNumberInvalid = isWarehouseNumberInvalid;
globalThis.validateWarehouseBarcodeExtractionBounds = validateWarehouseBarcodeExtractionBounds;
globalThis.getWarehouseProductItem = getWarehouseProductItem;
globalThis.getWarehouseProductId = getWarehouseProductId;
globalThis.getWarehouseProductTitle = getWarehouseProductTitle;
globalThis.normalizeWarehouseBarcodeEntry = normalizeWarehouseBarcodeEntry;
globalThis.classifyWarehouseBarcodeEntry = classifyWarehouseBarcodeEntry;
globalThis.extractWarehouseAssemblyBarcodes = extractWarehouseAssemblyBarcodes;
globalThis.createWarehouseRawEntryFromExtractionEntry = createWarehouseRawEntryFromExtractionEntry;
globalThis.revalidateWarehouseBarcodeExtraction = revalidateWarehouseBarcodeExtraction;
