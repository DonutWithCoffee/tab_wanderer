const OZON_PRODUCT_SEARCH_ERRORS = {
    PRODUCT_ID_MISSING: 'productIdMissing',
    PRODUCT_NOT_FOUND: 'productNotFound',
    PRODUCT_AMBIGUOUS: 'productAmbiguous',
    OFFER_ID_MISMATCH: 'offerIdMismatch',
    SKU_MISSING: 'skuMissing'
};

function normalizeOzonText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeOzonId(value) {
    return String(value || '')
        .replace(/\s+/g, '')
        .trim();
}

function normalizeOzonBarcode(value) {
    return String(value || '')
        .replace(/\s+/g, '')
        .trim();
}

function buildOzonProductSearchUrl(productId, baseUrl = 'https://seller.ozon.ru/app/products') {
    const id = normalizeOzonId(productId);
    const url = new URL(baseUrl);

    url.searchParams.set('search', id);

    return url.toString();
}

function normalizeOzonBarcodeList(value) {
    const source = Array.isArray(value) ? value : [];
    const seen = new Set();
    const result = [];

    for (const item of source) {
        const barcode = normalizeOzonBarcode(
            typeof item === 'object' && item !== null
                ? item.barcode || item.value || item.code
                : item
        );

        if (!barcode || seen.has(barcode)) {
            continue;
        }

        seen.add(barcode);
        result.push(barcode);
    }

    return result;
}

function extractOzonSkuFromApiProduct(product = {}) {
    const candidates = [
        product.sku,
        product.ozonSku,
        product.ozon_sku,
        product.part_sources?.sources?.[0]?.sku,
        product.part_stocks?.stocks?.[0]?.sku,
        product.part_availability?.availabilities?.[0]?.sku,
        product.part_price_indexes_full?.price_indexes?.[0]?.sku
    ];

    for (const candidate of candidates) {
        const sku = normalizeOzonId(candidate);

        if (sku) {
            return sku;
        }
    }

    return '';
}

function normalizeOzonProductItem(rawItem = {}) {
    const offerId = normalizeOzonId(rawItem.offerId || rawItem.offer_id || rawItem.part_item?.offer_id);
    const ozonSku = normalizeOzonId(rawItem.ozonSku || rawItem.ozon_sku || rawItem.sku || extractOzonSkuFromApiProduct(rawItem));
    const internalItemId = normalizeOzonId(rawItem.id || rawItem.item_id);
    const title = normalizeOzonText(rawItem.title || rawItem.name || rawItem.part_item?.name);
    const existingBarcodes = normalizeOzonBarcodeList(
        rawItem.barcodes ||
        rawItem.part_barcodes?.barcodes ||
        []
    );

    return {
        offerId,
        ozonSku,
        internalItemId,
        title,
        existingBarcodes,
        rawItem
    };
}

function extractOzonProductSearchItems(source = {}) {
    const productList = source.productList || source.products?.productList || source.__MODULE_STATE__?.products?.productList;

    if (Array.isArray(productList?.itemFrontItems)) {
        return productList.itemFrontItems.map(normalizeOzonProductItem);
    }

    if (Array.isArray(source.itemFrontItems)) {
        return source.itemFrontItems.map(normalizeOzonProductItem);
    }

    if (Array.isArray(source.products)) {
        return source.products.map(normalizeOzonProductItem);
    }

    if (Array.isArray(source.items)) {
        return source.items.map(normalizeOzonProductItem);
    }

    return [];
}

function resolveOzonProductSearchResult(source = {}, productId) {
    const expectedProductId = normalizeOzonId(productId);
    const items = extractOzonProductSearchItems(source);

    if (!expectedProductId) {
        return {
            ok: false,
            error: OZON_PRODUCT_SEARCH_ERRORS.PRODUCT_ID_MISSING,
            productId: expectedProductId,
            items,
            product: null
        };
    }

    const matchedItems = items.filter(item => item.offerId === expectedProductId);

    if (matchedItems.length === 0) {
        return {
            ok: false,
            error: OZON_PRODUCT_SEARCH_ERRORS.PRODUCT_NOT_FOUND,
            productId: expectedProductId,
            items,
            product: null
        };
    }

    if (matchedItems.length > 1) {
        return {
            ok: false,
            error: OZON_PRODUCT_SEARCH_ERRORS.PRODUCT_AMBIGUOUS,
            productId: expectedProductId,
            items,
            product: null
        };
    }

    const product = matchedItems[0];

    if (!product.ozonSku) {
        return {
            ok: false,
            error: OZON_PRODUCT_SEARCH_ERRORS.SKU_MISSING,
            productId: expectedProductId,
            items,
            product
        };
    }

    return {
        ok: true,
        error: null,
        productId: expectedProductId,
        items,
        product
    };
}

globalThis.OZON_PRODUCT_SEARCH_ERRORS = OZON_PRODUCT_SEARCH_ERRORS;
globalThis.normalizeOzonText = normalizeOzonText;
globalThis.normalizeOzonId = normalizeOzonId;
globalThis.normalizeOzonBarcode = normalizeOzonBarcode;
globalThis.buildOzonProductSearchUrl = buildOzonProductSearchUrl;
globalThis.normalizeOzonBarcodeList = normalizeOzonBarcodeList;
globalThis.normalizeOzonProductItem = normalizeOzonProductItem;
globalThis.extractOzonProductSearchItems = extractOzonProductSearchItems;
globalThis.resolveOzonProductSearchResult = resolveOzonProductSearchResult;
