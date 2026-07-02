(function installTabWandererOzonProductBridge() {
    const REQUEST_EVENT = 'tab_wanderer:ozon-product-request';
    const RESPONSE_EVENT = 'tab_wanderer:ozon-product-response';
    const DEBUG_KEY = '__TAB_WANDERER_OZON_PRODUCT_BRIDGE_DEBUG__';
    const MAX_ATTEMPTS = 20;
    const RETRY_DELAY_MS = 500;

    if (window[DEBUG_KEY]?.installed === true) {
        return;
    }

    const debug = {
        installed: true,
        installedAt: new Date().toISOString(),
        lastProductId: '',
        lastAttempt: 0,
        lastResult: '',
        lastError: '',
        lastSourceType: '',
        lastItemCount: 0,
        lastProductsListResponse: null
    };

    window[DEBUG_KEY] = debug;

    function normalizeId(value) {
        return String(value || '')
            .replace(/\s+/g, '')
            .trim();
    }

    function normalizeText(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeBarcode(value) {
        return String(value || '')
            .replace(/\s+/g, '')
            .trim();
    }

    function safeArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function sanitizeBarcodeList(value) {
        return safeArray(value).map(item => {
            if (item && typeof item === 'object') {
                return {
                    barcode: normalizeBarcode(item.barcode || item.value || item.code),
                    status: normalizeText(item.status),
                    error: normalizeText(item.error)
                };
            }

            return { barcode: normalizeBarcode(item) };
        }).filter(item => item.barcode);
    }

    function sanitizeSources(value) {
        return safeArray(value).map(source => ({
            sku: normalizeId(source?.sku || source?.ozonSku || source?.ozon_sku)
        })).filter(source => source.sku);
    }

    function sanitizeOzonProductItem(rawItem = {}) {
        if (!rawItem || typeof rawItem !== 'object') {
            return null;
        }

        const partItem = rawItem.part_item && typeof rawItem.part_item === 'object'
            ? rawItem.part_item
            : {};
        const partSources = rawItem.part_sources && typeof rawItem.part_sources === 'object'
            ? rawItem.part_sources
            : {};
        const partBarcodes = rawItem.part_barcodes && typeof rawItem.part_barcodes === 'object'
            ? rawItem.part_barcodes
            : {};

        return {
            id: normalizeId(rawItem.id),
            item_id: normalizeId(rawItem.item_id),
            sku: normalizeId(rawItem.sku),
            ozonSku: normalizeId(rawItem.ozonSku),
            ozon_sku: normalizeId(rawItem.ozon_sku),
            offerId: normalizeId(rawItem.offerId),
            offer_id: normalizeId(rawItem.offer_id),
            title: normalizeText(rawItem.title),
            name: normalizeText(rawItem.name),
            barcodes: sanitizeBarcodeList(rawItem.barcodes),
            part_item: {
                offer_id: normalizeId(partItem.offer_id),
                name: normalizeText(partItem.name)
            },
            part_sources: {
                sources: sanitizeSources(partSources.sources)
            },
            part_barcodes: {
                barcodes: sanitizeBarcodeList(partBarcodes.barcodes)
            }
        };
    }

    function hasMatchingProduct(items, productId) {
        const expectedProductId = normalizeId(productId);

        if (!expectedProductId) {
            return false;
        }

        return safeArray(items).some(item => {
            const offerId = normalizeId(item?.offerId || item?.offer_id || item?.part_item?.offer_id);
            return offerId === expectedProductId;
        });
    }

    function createSourceFromApiResponse(response) {
        const products = safeArray(response?.products)
            .map(sanitizeOzonProductItem)
            .filter(Boolean);

        if (!products.length) {
            return null;
        }

        return {
            sourceType: 'list-by-filter',
            source: { products },
            items: products
        };
    }

    function createSourceFromModuleState(moduleState) {
        const items = safeArray(moduleState?.products?.productList?.itemFrontItems)
            .map(sanitizeOzonProductItem)
            .filter(Boolean);

        if (!items.length) {
            return null;
        }

        return {
            sourceType: 'module-state',
            source: {
                productList: {
                    itemFrontItems: items
                }
            },
            items
        };
    }

    function createSourceFromWindowList(value, sourceType) {
        const items = safeArray(value)
            .map(sanitizeOzonProductItem)
            .filter(Boolean);

        if (!items.length) {
            return null;
        }

        return {
            sourceType,
            source: { products: items },
            items
        };
    }

    function findProductSource(productId) {
        const sources = [
            createSourceFromApiResponse(debug.lastProductsListResponse),
            createSourceFromModuleState(window.__MODULE_STATE__),
            createSourceFromModuleState(window.__INITIAL_STATE__),
            createSourceFromWindowList(window.__TAB_WANDERER_OZON_PRODUCTS__, 'window-products')
        ].filter(Boolean);

        for (const source of sources) {
            if (hasMatchingProduct(source.items, productId)) {
                return source;
            }
        }

        return sources[0] || null;
    }

    function dispatchResponse(detail) {
        window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail }));
    }

    function resolveProduct(productId, attempt = 1) {
        const normalizedProductId = normalizeId(productId);
        debug.lastProductId = normalizedProductId;
        debug.lastAttempt = attempt;
        debug.lastError = '';

        const productSource = findProductSource(normalizedProductId);

        if (productSource && hasMatchingProduct(productSource.items, normalizedProductId)) {
            debug.lastResult = 'product source found';
            debug.lastSourceType = productSource.sourceType;
            debug.lastItemCount = productSource.items.length;
            dispatchResponse({
                ok: true,
                productId: normalizedProductId,
                sourceType: productSource.sourceType,
                source: productSource.source
            });
            return true;
        }

        if (attempt >= MAX_ATTEMPTS) {
            debug.lastResult = 'product source not found';
            debug.lastSourceType = productSource?.sourceType || '';
            debug.lastItemCount = productSource?.items?.length || 0;
            dispatchResponse({
                ok: false,
                productId: normalizedProductId,
                error: 'ozon product source not found'
            });
            return false;
        }

        window.setTimeout(() => resolveProduct(normalizedProductId, attempt + 1), RETRY_DELAY_MS);
        return null;
    }

    function getFetchUrl(input) {
        if (typeof input === 'string') {
            return input;
        }

        return String(input?.url || '');
    }

    function installFetchCapture() {
        if (typeof window.fetch !== 'function' || window.fetch.__tabWandererOzonCapture === true) {
            return false;
        }

        const originalFetch = window.fetch.bind(window);

        function capturedFetch(input, init) {
            const responsePromise = originalFetch(input, init);
            const url = getFetchUrl(input);

            if (url.includes('/api/v1/products/list-by-filter')) {
                responsePromise.then(response => {
                    try {
                        response.clone().json().then(data => {
                            debug.lastProductsListResponse = data;
                        }).catch(() => {});
                    } catch {}
                }).catch(() => {});
            }

            return responsePromise;
        }

        capturedFetch.__tabWandererOzonCapture = true;
        window.fetch = capturedFetch;
        return true;
    }

    function handleRequest(event) {
        const productId = normalizeId(event?.detail?.productId);

        if (!productId) {
            debug.lastResult = 'product id missing';
            debug.lastError = 'productIdMissing';
            dispatchResponse({ ok: false, productId: '', error: 'productIdMissing' });
            return;
        }

        resolveProduct(productId, 1);
    }

    installFetchCapture();
    window.addEventListener(REQUEST_EVENT, handleRequest);
})();
