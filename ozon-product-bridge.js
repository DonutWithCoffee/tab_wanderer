(function installTabWandererOzonProductBridge() {
    const REQUEST_EVENT = 'tab_wanderer:ozon-product-request';
    const RESPONSE_EVENT = 'tab_wanderer:ozon-product-response';
    const UI_APPLY_REQUEST_EVENT = 'tab_wanderer:ozon-ui-apply-request';
    const UI_APPLY_RESPONSE_EVENT = 'tab_wanderer:ozon-ui-apply-response';
    const DEBUG_KEY = '__TAB_WANDERER_OZON_PRODUCT_BRIDGE_DEBUG__';
    const API_VERIFY_PENDING_KEY = 'tab_wanderer:ozon-api-verify-pending';
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
        lastProductsListResponse: null,
        lastSellerId: '',
        lastApiApply: null,
        lastUiApply: null
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

    function getSessionStorage() {
        try {
            return window.sessionStorage || null;
        } catch {
            return null;
        }
    }

    function normalizeBarcodeSet(value = []) {
        return Array.from(new Set(safeArray(value).map(normalizeBarcode).filter(Boolean))).sort();
    }

    function isSameBarcodeSet(left = [], right = []) {
        const leftSet = normalizeBarcodeSet(left);
        const rightSet = normalizeBarcodeSet(right);

        return leftSet.length === rightSet.length
            && leftSet.every((barcode, index) => barcode === rightSet[index]);
    }

    function readPendingApiVerify() {
        const storage = getSessionStorage();

        if (!storage) {
            return null;
        }

        try {
            const raw = storage.getItem(API_VERIFY_PENDING_KEY);
            if (!raw) {
                return null;
            }

            const pending = JSON.parse(raw);
            const createdAt = Number(pending?.createdAt) || 0;

            if (!createdAt || Date.now() - createdAt > 120000) {
                storage.removeItem(API_VERIFY_PENDING_KEY);
                return null;
            }

            return pending && typeof pending === 'object' ? pending : null;
        } catch {
            return null;
        }
    }

    function consumePendingApiVerify(productId, barcodes = []) {
        const storage = getSessionStorage();
        const pending = readPendingApiVerify();

        if (!storage || !pending) {
            return null;
        }

        const sameProduct = normalizeId(pending.productId) === normalizeId(productId);
        const sameBarcodes = isSameBarcodeSet(pending.barcodes || [], barcodes);

        if (!sameProduct || !sameBarcodes) {
            return null;
        }

        try {
            storage.removeItem(API_VERIFY_PENDING_KEY);
        } catch {}

        return pending;
    }

    function savePendingApiVerify(pending = {}) {
        const storage = getSessionStorage();

        if (!storage) {
            return false;
        }

        try {
            storage.setItem(API_VERIFY_PENDING_KEY, JSON.stringify({
                createdAt: Date.now(),
                productId: normalizeId(pending.productId),
                barcodes: normalizeBarcodeSet(pending.barcodes || []),
                sellerId: normalizeId(pending.sellerId),
                ozonSku: normalizeId(pending.ozonSku),
                apiResult: pending.apiResult || null
            }));
            return true;
        } catch {
            return false;
        }
    }

    function requestPageReloadForApiVerify() {
        try {
            if (typeof window.location?.reload !== 'function') {
                return false;
            }

            window.location.reload();
            return true;
        } catch {
            return false;
        }
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

    function createSourceFromDomRow(productId) {
        const resolvedProduct = resolveProductFromDomRow(productId);

        debug.lastDomRowCount = resolvedProduct.rowCount;
        debug.lastDomSku = resolvedProduct.product?.ozonSku || '';
        debug.lastDomResolveError = resolvedProduct.error || '';

        if (!resolvedProduct.ok || !resolvedProduct.product) {
            return null;
        }

        return {
            sourceType: 'dom-row',
            source: {
                products: [resolvedProduct.product]
            },
            items: [sanitizeOzonProductItem(resolvedProduct.product)].filter(Boolean)
        };
    }

    function findProductSource(productId, options = {}) {
        const includeDom = options.includeDom !== false;
        const includeCapturedSources = options.includeCapturedSources !== false;
        const sources = [
            includeDom ? createSourceFromDomRow(productId) : null,
            includeCapturedSources ? createSourceFromApiResponse(debug.lastProductsListResponse) : null,
            includeCapturedSources ? createSourceFromModuleState(window.__MODULE_STATE__) : null,
            includeCapturedSources ? createSourceFromModuleState(window.__INITIAL_STATE__) : null,
            includeCapturedSources ? createSourceFromWindowList(window.__TAB_WANDERER_OZON_PRODUCTS__, 'window-products') : null
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

    function getOzonProductFromSource(productSource, productId) {
        const expectedProductId = normalizeId(productId);
        const products = safeArray(productSource?.source?.products || productSource?.items);

        return products.find(product => normalizeId(product?.offerId || product?.offer_id || product?.part_item?.offer_id) === expectedProductId) || null;
    }

    function cloneProductSourceWithProduct(productSource, product) {
        const products = safeArray(productSource?.source?.products).map(item => {
            const offerId = normalizeId(item?.offerId || item?.offer_id || item?.part_item?.offer_id);
            const productOfferId = normalizeId(product?.offerId || product?.offer_id || product?.part_item?.offer_id);

            return offerId && offerId === productOfferId ? product : item;
        });

        return {
            ...productSource,
            source: {
                ...(productSource?.source || {}),
                products
            },
            items: products.map(sanitizeOzonProductItem).filter(Boolean)
        };
    }

    async function enrichDomProductSourceWithDrawerBarcodes(productSource, productId) {
        if (productSource?.sourceType !== 'dom-row') {
            return productSource;
        }

        const product = getOzonProductFromSource(productSource, productId);
        const visibleBarcodes = mergeUniqueBarcodes(product?.existingBarcodes || product?.barcodes || product?.part_barcodes?.barcodes || []);

        if (!product || visibleBarcodes.length === 0) {
            return productSource;
        }

        const fullBarcodeResult = await readFullExistingBarcodesFromDrawer(productId, product.ozonSku || product.sku, visibleBarcodes);

        debug.lastFullBarcodeRead = {
            ok: fullBarcodeResult.ok,
            error: fullBarcodeResult.error || '',
            visibleCount: visibleBarcodes.length,
            drawerCount: fullBarcodeResult.drawerBarcodes?.length || 0,
            existingCount: fullBarcodeResult.existingBarcodes.length,
            rowCount: fullBarcodeResult.rowCount || 0,
            trigger: getElementSummary(fullBarcodeResult.trigger)
        };

        if (!fullBarcodeResult.ok || fullBarcodeResult.existingBarcodes.length <= visibleBarcodes.length) {
            return productSource;
        }

        const existingBarcodes = fullBarcodeResult.existingBarcodes;
        const enrichedProduct = {
            ...product,
            existingBarcodes,
            barcodes: existingBarcodes,
            part_barcodes: {
                ...(product.part_barcodes || {}),
                barcodes: existingBarcodes
            },
            fullBarcodeSource: 'drawer'
        };

        return cloneProductSourceWithProduct(productSource, enrichedProduct);
    }

    async function resolveProduct(productId, attempt = 1) {
        const normalizedProductId = normalizeId(productId);
        debug.lastProductId = normalizedProductId;
        debug.lastAttempt = attempt;
        debug.lastError = '';

        const domProductSource = findProductSource(normalizedProductId, { includeCapturedSources: false });

        if (domProductSource && hasMatchingProduct(domProductSource.items, normalizedProductId)) {
            const enrichedProductSource = await enrichDomProductSourceWithDrawerBarcodes(domProductSource, normalizedProductId);

            debug.lastResult = 'product source found';
            debug.lastSourceType = enrichedProductSource.sourceType;
            debug.lastItemCount = enrichedProductSource.items.length;
            dispatchResponse({
                ok: true,
                productId: normalizedProductId,
                sourceType: enrichedProductSource.sourceType,
                source: enrichedProductSource.source
            });
            return true;
        }

        const fallbackProductSource = findProductSource(normalizedProductId, { includeDom: false });

        if (fallbackProductSource && hasMatchingProduct(fallbackProductSource.items, normalizedProductId)) {
            debug.lastFallbackSourceType = fallbackProductSource.sourceType;
            debug.lastFallbackItemCount = fallbackProductSource.items.length;
        }

        if (attempt >= MAX_ATTEMPTS && fallbackProductSource && hasMatchingProduct(fallbackProductSource.items, normalizedProductId)) {
            debug.lastResult = 'fallback product source found';
            debug.lastSourceType = fallbackProductSource.sourceType;
            debug.lastItemCount = fallbackProductSource.items.length;
            dispatchResponse({
                ok: true,
                productId: normalizedProductId,
                sourceType: fallbackProductSource.sourceType,
                source: fallbackProductSource.source
            });
            return true;
        }

        if (attempt >= MAX_ATTEMPTS) {
            debug.lastResult = 'product source not found';
            debug.lastSourceType = fallbackProductSource?.sourceType || '';
            debug.lastItemCount = fallbackProductSource?.items?.length || 0;
            dispatchResponse({
                ok: false,
                productId: normalizedProductId,
                error: 'ozon product source not found'
            });
            return false;
        }

        debug.lastResult = 'waiting for dom product source';
        debug.lastSourceType = domProductSource?.sourceType || '';
        debug.lastItemCount = domProductSource?.items?.length || 0;
        window.setTimeout(() => resolveProduct(normalizedProductId, attempt + 1), RETRY_DELAY_MS);
        return null;
    }

    function getFetchUrl(input) {
        if (typeof input === 'string') {
            return input;
        }

        return String(input?.url || '');
    }

    function getHeaderValue(headers, headerName) {
        const expectedName = String(headerName || '').toLowerCase();

        if (!headers || !expectedName) {
            return '';
        }

        try {
            if (typeof headers.get === 'function') {
                return normalizeId(headers.get(headerName));
            }
        } catch {}

        if (Array.isArray(headers)) {
            for (const entry of headers) {
                if (Array.isArray(entry) && String(entry[0] || '').toLowerCase() === expectedName) {
                    return normalizeId(entry[1]);
                }
            }
        }

        if (typeof headers === 'object') {
            for (const [key, value] of Object.entries(headers)) {
                if (String(key || '').toLowerCase() === expectedName) {
                    return normalizeId(value);
                }
            }
        }

        return '';
    }

    function captureSellerIdFromHeaders(...headersList) {
        const headerNames = ['x-o3-company-id', 'x-o3-seller-id', 'x-o3-account-id', 'x-company-id'];

        for (const headers of headersList) {
            for (const headerName of headerNames) {
                const sellerId = getHeaderValue(headers, headerName);

                if (/^\d{3,}$/.test(sellerId)) {
                    debug.lastSellerId = sellerId;
                    window.__TAB_WANDERER_OZON_SELLER_ID__ = sellerId;
                    return sellerId;
                }
            }
        }

        return '';
    }

    function findSellerIdInValue(value, depth = 0, seen = new Set()) {
        if (!value || depth > 5) {
            return '';
        }

        if (typeof value === 'string' || typeof value === 'number') {
            const normalizedValue = normalizeId(value);
            return /^\d{3,}$/.test(normalizedValue) ? normalizedValue : '';
        }

        if (typeof value !== 'object' || seen.has(value)) {
            return '';
        }

        seen.add(value);

        for (const [key, nestedValue] of Object.entries(value)) {
            const normalizedKey = String(key || '').toLowerCase();
            const keyLooksLikeSellerId = [
                'sellerid',
                'seller_id',
                'companyid',
                'company_id',
                'selectedcompanyid',
                'currentcompanyid'
            ].includes(normalizedKey);

            if (keyLooksLikeSellerId) {
                const sellerId = findSellerIdInValue(nestedValue, depth + 1, seen);

                if (sellerId) {
                    return sellerId;
                }
            }
        }

        for (const nestedValue of Object.values(value)) {
            if (!nestedValue || typeof nestedValue !== 'object') {
                continue;
            }

            const sellerId = findSellerIdInValue(nestedValue, depth + 1, seen);

            if (sellerId) {
                return sellerId;
            }
        }

        return '';
    }

    function getOzonSellerId() {
        const directSellerId = normalizeId(debug.lastSellerId || window.__TAB_WANDERER_OZON_SELLER_ID__);

        if (/^\d{3,}$/.test(directSellerId)) {
            return directSellerId;
        }

        const stateSellerId = findSellerIdInValue(window.__MODULE_STATE__)
            || findSellerIdInValue(window.__INITIAL_STATE__);

        if (/^\d{3,}$/.test(stateSellerId)) {
            debug.lastSellerId = stateSellerId;
            window.__TAB_WANDERER_OZON_SELLER_ID__ = stateSellerId;
            return stateSellerId;
        }

        try {
            const storage = window.localStorage;

            if (storage && typeof storage.length === 'number') {
                for (let index = 0; index < storage.length; index += 1) {
                    const key = String(storage.key(index) || '').toLowerCase();

                    if (!key.includes('seller') && !key.includes('company')) {
                        continue;
                    }

                    const value = storage.getItem(storage.key(index));
                    const sellerId = normalizeId(value);

                    if (/^\d{3,}$/.test(sellerId)) {
                        debug.lastSellerId = sellerId;
                        window.__TAB_WANDERER_OZON_SELLER_ID__ = sellerId;
                        return sellerId;
                    }

                    try {
                        const parsedSellerId = findSellerIdInValue(JSON.parse(value));

                        if (/^\d{3,}$/.test(parsedSellerId)) {
                            debug.lastSellerId = parsedSellerId;
                            window.__TAB_WANDERER_OZON_SELLER_ID__ = parsedSellerId;
                            return parsedSellerId;
                        }
                    } catch {}
                }
            }
        } catch {}

        return '';
    }

    function installFetchCapture() {
        if (typeof window.fetch !== 'function' || window.fetch.__tabWandererOzonCapture === true) {
            return false;
        }

        const originalFetch = window.fetch.bind(window);

        function capturedFetch(input, init) {
            captureSellerIdFromHeaders(input?.headers, init?.headers);

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


    function delay(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    function isVisibleElement(element) {
        if (!element || typeof element.getBoundingClientRect !== 'function') {
            return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle ? window.getComputedStyle(element) : null;

        return rect.width > 0
            && rect.height > 0
            && style?.display !== 'none'
            && style?.visibility !== 'hidden'
            && style?.opacity !== '0';
    }

    function getElementText(element) {
        return normalizeText(element?.innerText || element?.textContent || element?.getAttribute?.('aria-label') || '');
    }

    function createPointerEvent(type, options) {
        try {
            if (typeof PointerEvent === 'function') {
                return new PointerEvent(type, {
                    ...options,
                    pointerId: 1,
                    pointerType: 'mouse',
                    isPrimary: true,
                    buttons: type === 'pointerup' ? 0 : 1
                });
            }
        } catch {}

        return new MouseEvent(type, options);
    }

    function dispatchMouseClick(element) {
        if (!element) {
            return false;
        }

        try {
            element.scrollIntoView?.({ block: 'center', inline: 'center' });
        } catch {}

        const rect = element.getBoundingClientRect?.();
        const coordinates = rect
            ? {
                clientX: Math.round((rect.left + rect.right) / 2),
                clientY: Math.round((rect.top + rect.bottom) / 2),
                screenX: Math.round(window.screenX + (rect.left + rect.right) / 2),
                screenY: Math.round(window.screenY + (rect.top + rect.bottom) / 2)
            }
            : {};
        const options = { bubbles: true, cancelable: true, composed: true, view: window, ...coordinates };

        const target = rect
            ? document.elementFromPoint?.(coordinates.clientX, coordinates.clientY) || element
            : element;
        const clickableTarget = target?.closest?.('button, [role="button"], input, textarea, a') || element;

        try {
            clickableTarget.focus?.({ preventScroll: true });
        } catch {}

        try {
            clickableTarget.dispatchEvent(createPointerEvent('pointerover', options));
            clickableTarget.dispatchEvent(createPointerEvent('pointerenter', options));
            clickableTarget.dispatchEvent(createPointerEvent('pointerdown', options));
            clickableTarget.dispatchEvent(new MouseEvent('mouseover', options));
            clickableTarget.dispatchEvent(new MouseEvent('mouseenter', options));
            clickableTarget.dispatchEvent(new MouseEvent('mousedown', options));
            clickableTarget.dispatchEvent(new MouseEvent('mouseup', options));
            clickableTarget.dispatchEvent(createPointerEvent('pointerup', options));
            clickableTarget.dispatchEvent(new MouseEvent('click', options));
            clickableTarget.click?.();
        } catch {
            try {
                clickableTarget.click?.();
            } catch {
                return false;
            }
        }

        return true;
    }

    function dispatchMouseClickDirect(element) {
        if (!element) {
            return false;
        }

        try {
            element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        } catch {}

        const rect = element.getBoundingClientRect?.();
        const coordinates = rect
            ? {
                clientX: Math.round((rect.left + rect.right) / 2),
                clientY: Math.round((rect.top + rect.bottom) / 2),
                screenX: Math.round(window.screenX + (rect.left + rect.right) / 2),
                screenY: Math.round(window.screenY + (rect.top + rect.bottom) / 2)
            }
            : {};
        const options = { bubbles: true, cancelable: true, composed: true, view: window, ...coordinates };

        try {
            element.focus?.({ preventScroll: true });
        } catch {}

        try {
            element.dispatchEvent(createPointerEvent('pointerover', options));
            element.dispatchEvent(createPointerEvent('pointerenter', options));
            element.dispatchEvent(createPointerEvent('pointerdown', options));
            element.dispatchEvent(new MouseEvent('mouseover', options));
            element.dispatchEvent(new MouseEvent('mouseenter', options));
            element.dispatchEvent(new MouseEvent('mousedown', options));
            element.dispatchEvent(new MouseEvent('mouseup', options));
            element.dispatchEvent(createPointerEvent('pointerup', options));
            element.dispatchEvent(new MouseEvent('click', options));
            element.click?.();
            return true;
        } catch {
            try {
                element.click?.();
                return true;
            } catch {
                return false;
            }
        }
    }

    function dispatchMouseClickAtPoint(clientX, clientY) {
        const target = document.elementFromPoint?.(clientX, clientY);

        if (!target) {
            return { ok: false, target: null };
        }

        const clickableTarget = target.closest?.('button, [role="button"], [tabindex], a, svg') || target;
        const coordinates = {
            clientX: Math.round(clientX),
            clientY: Math.round(clientY),
            screenX: Math.round(window.screenX + clientX),
            screenY: Math.round(window.screenY + clientY)
        };
        const options = { bubbles: true, cancelable: true, composed: true, view: window, ...coordinates };

        try {
            clickableTarget.focus?.({ preventScroll: true });
        } catch {}

        try {
            clickableTarget.dispatchEvent(createPointerEvent('pointerover', options));
            clickableTarget.dispatchEvent(createPointerEvent('pointerenter', options));
            clickableTarget.dispatchEvent(createPointerEvent('pointerdown', options));
            clickableTarget.dispatchEvent(new MouseEvent('mouseover', options));
            clickableTarget.dispatchEvent(new MouseEvent('mouseenter', options));
            clickableTarget.dispatchEvent(new MouseEvent('mousedown', options));
            clickableTarget.dispatchEvent(new MouseEvent('mouseup', options));
            clickableTarget.dispatchEvent(createPointerEvent('pointerup', options));
            clickableTarget.dispatchEvent(new MouseEvent('click', options));
            clickableTarget.click?.();
            return { ok: true, target: clickableTarget };
        } catch {
            try {
                clickableTarget.click?.();
                return { ok: true, target: clickableTarget };
            } catch {
                return { ok: false, target: clickableTarget };
            }
        }
    }

    function setNativeInputValue(input, value) {
        if (!input) {
            return false;
        }

        const normalizedValue = String(value || '');
        const prototype = Object.getPrototypeOf(input);
        const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value') : null;

        function setValue(nextValue) {
            if (descriptor?.set) {
                descriptor.set.call(input, nextValue);
            } else {
                input.value = nextValue;
            }
        }

        try {
            input.focus?.({ preventScroll: true });
            input.select?.();

            setValue('');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));

            let currentValue = '';

            for (const char of normalizedValue) {
                input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: char }));

                try {
                    input.dispatchEvent(new InputEvent('beforeinput', {
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertText',
                        data: char
                    }));
                } catch {}

                currentValue += char;
                setValue(currentValue);

                try {
                    input.dispatchEvent(new InputEvent('input', {
                        bubbles: true,
                        inputType: 'insertText',
                        data: char
                    }));
                } catch {
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }

                input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
            }

            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } catch {
            input.value = normalizedValue;
            return true;
        }
    }

    function getElementSummary(element) {
        if (!element) {
            return null;
        }

        const rect = element.getBoundingClientRect?.();

        return {
            tag: element.tagName,
            text: getElementText(element).slice(0, 300),
            className: String(element.className || '').slice(0, 160),
            rect: rect ? {
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            } : null
        };
    }

    function scoreProductRowCandidate(node, expectedProductId) {
        const text = normalizeText(node.innerText || node.textContent);
        const lowerText = text.toLowerCase();
        let score = text.length;

        if (!text.includes(expectedProductId)) {
            return Number.POSITIVE_INFINITY;
        }

        if (/список товаров|скачать шаблоны|добавить товары/i.test(text)) {
            score += 5000;
        }

        if (/sku\s*\d+/i.test(text)) {
            score -= 1000;
        }

        if (findButtonByText(node, 'Добавить')) {
            score -= 1000;
        }

        if (lowerText.includes('штрихкод')) {
            score -= 250;
        }

        if (node.tagName === 'TR') {
            score -= 500;
        }

        return score;
    }

    function findProductRows(productId) {
        const expectedProductId = normalizeId(productId);

        if (!expectedProductId) {
            return [];
        }

        const candidateSelector = [
            'tbody tr',
            'tr',
            '[data-widget="@products/product-list-table-ods"] tr',
            '[data-widget="@products/product-list-table-ods"] div',
            '[data-widget="@products/product-list-table-ods"] [class]'
        ].join(', ');

        const candidates = Array.from(document.querySelectorAll(candidateSelector))
            .filter(isVisibleElement)
            .filter(node => normalizeText(node.innerText || node.textContent).includes(expectedProductId))
            .map(node => ({ node, score: scoreProductRowCandidate(node, expectedProductId) }))
            .filter(item => Number.isFinite(item.score))
            .sort((a, b) => a.score - b.score);

        if (!candidates.length) {
            return [];
        }

        const bestScore = candidates[0].score;
        const best = candidates.filter(item => item.score <= bestScore + 50).map(item => item.node);

        return best.slice(0, 3);
    }

    function extractOzonSkuFromDomText(text) {
        const normalizedText = normalizeText(text);
        const match = normalizedText.match(/(?:^|\s)sku\s*[:№#-]?\s*(\d{6,})/i);

        return normalizeId(match?.[1]);
    }

    function extractOzonTitleFromDomRow(row, productId) {
        const expectedProductId = normalizeId(productId);
        const lines = normalizeText(row?.innerText || row?.textContent)
            .split(/(?=Артикул\s+\d+)|(?=SKU\s+\d+)/i)
            .map(normalizeText)
            .filter(Boolean);

        const titleLine = lines.find(line => {
            const lowerLine = line.toLowerCase();

            return !line.includes(expectedProductId)
                && !/^sku\s+\d+/i.test(line)
                && !lowerLine.includes('штрихкод')
                && !lowerLine.includes('добавить')
                && line.length > 3;
        });

        return titleLine || '';
    }

    function pushUniqueBarcode(target, value, excludedValues = []) {
        const barcode = normalizeId(value);

        if (!barcode || barcode.length < 5 || excludedValues.includes(barcode) || target.includes(barcode)) {
            return false;
        }

        target.push(barcode);
        return true;
    }

    function mergeUniqueBarcodes(...lists) {
        const result = [];

        for (const list of lists) {
            for (const item of safeArray(list)) {
                const value = item && typeof item === 'object' ? item.barcode || item.value || item.code : item;
                pushUniqueBarcode(result, value);
            }
        }

        return result;
    }

    function extractVisibleTextBarcodes(root, excludedValues = []) {
        const barcodes = [];
        const nodes = Array.from(root?.querySelectorAll?.('span, div, td, li, p') || []);

        for (const node of nodes) {
            const text = normalizeText(node?.innerText || node?.textContent);
            const normalized = normalizeId(text);

            if (/^\d{5,}$/.test(normalized)) {
                pushUniqueBarcode(barcodes, normalized, excludedValues);
                continue;
            }

            for (const match of text.matchAll(/\b\d{5,}\b/g)) {
                pushUniqueBarcode(barcodes, match[0], excludedValues);
            }
        }

        return barcodes;
    }

    function extractVisibleOzonBarcodesFromDomRow(row, productId, ozonSku) {
        const existingBarcodes = [];
        const excludedValues = [normalizeId(productId), normalizeId(ozonSku)].filter(Boolean);

        for (const node of Array.from(row?.querySelectorAll?.('[data-style="text"]') || [])) {
            const text = normalizeText(node.innerText || node.textContent);
            pushUniqueBarcode(existingBarcodes, text, excludedValues);
        }

        for (const node of Array.from(row?.querySelectorAll?.('[data-style="count"]') || [])) {
            const container = node.parentElement || node.closest?.('td') || null;
            const textNode = container?.querySelector?.('[data-style="text"]');
            const text = normalizeText(textNode?.innerText || textNode?.textContent);
            pushUniqueBarcode(existingBarcodes, text, excludedValues);
        }

        return existingBarcodes;
    }

    function resolveProductFromDomRow(productId) {
        const expectedProductId = normalizeId(productId);

        if (!expectedProductId) {
            return {
                ok: false,
                error: 'productIdMissing',
                productId: expectedProductId,
                rowCount: 0,
                product: null
            };
        }

        const rows = findProductRows(expectedProductId);

        if (rows.length !== 1) {
            return {
                ok: false,
                error: rows.length > 1 ? 'productRowAmbiguous' : 'productRowNotFound',
                productId: expectedProductId,
                rowCount: rows.length,
                product: null
            };
        }

        const row = rows[0];
        const text = normalizeText(row.innerText || row.textContent);
        const ozonSku = extractOzonSkuFromDomText(text);

        if (!ozonSku) {
            return {
                ok: false,
                error: 'skuMissing',
                productId: expectedProductId,
                rowCount: rows.length,
                product: null
            };
        }

        const title = extractOzonTitleFromDomRow(row, expectedProductId);
        const existingBarcodes = extractVisibleOzonBarcodesFromDomRow(row, expectedProductId, ozonSku);
        const product = {
            offerId: expectedProductId,
            offer_id: expectedProductId,
            ozonSku,
            sku: ozonSku,
            title,
            name: title,
            existingBarcodes,
            barcodes: existingBarcodes,
            part_item: {
                offer_id: expectedProductId,
                name: title
            },
            part_sources: {
                sources: [{ sku: ozonSku }]
            },
            part_barcodes: {
                barcodes: existingBarcodes
            },
            source: 'dom-row'
        };

        return {
            ok: true,
            error: null,
            productId: expectedProductId,
            rowCount: rows.length,
            product
        };
    }

    function findButtonByText(root, text) {
        const expectedText = normalizeText(text).toLowerCase();
        const buttons = Array.from((root || document).querySelectorAll('button, [role="button"]'));

        return buttons.find(button => isVisibleElement(button) && getElementText(button).toLowerCase() === expectedText)
            || buttons.find(button => isVisibleElement(button) && getElementText(button).toLowerCase().includes(expectedText))
            || null;
    }

    function findExistingBarcodeCellTrigger(row) {
        const directBarcodeContainer = Array.from(row.querySelectorAll('[data-style="count"]'))
            .find(element => isVisibleElement(element) && /штрихкод/i.test(getElementText(element)));

        if (directBarcodeContainer) {
            let current = directBarcodeContainer.parentElement;

            while (current && current !== row) {
                const currentText = getElementText(current);
                const currentRect = current.getBoundingClientRect?.();

                if (currentRect
                    && currentRect.width > 0
                    && currentRect.height > 0
                    && currentText.includes('+')
                    && /штрихкод/i.test(currentText)
                    && /\d{6,}/.test(currentText)) {
                    return current;
                }

                current = current.parentElement;
            }

            return directBarcodeContainer.parentElement || directBarcodeContainer;
        }

        const barcodeCells = Array.from(row.querySelectorAll('td, [role="cell"]'))
            .filter(isVisibleElement)
            .filter(cell => {
                const text = getElementText(cell);
                return /\d{6,}/.test(text) && /штрихкод/i.test(text);
            })
            .sort((a, b) => getElementText(a).length - getElementText(b).length);

        for (const cell of barcodeCells) {
            const compactContainer = Array.from(cell.querySelectorAll('div, span'))
                .filter(isVisibleElement)
                .filter(element => {
                    const text = getElementText(element);
                    return /\d{6,}/.test(text) && /штрихкод/i.test(text);
                })
                .sort((a, b) => getElementText(a).length - getElementText(b).length)[0];

            if (compactContainer) {
                return compactContainer;
            }

            return cell;
        }

        return null;
    }

    function findBarcodeDrawerTriggerForProduct(productId) {
        const rows = findProductRows(productId);

        if (rows.length !== 1) {
            return {
                ok: false,
                error: rows.length > 1 ? 'Ozon product row is ambiguous' : 'Ozon product row not found',
                rowCount: rows.length,
                trigger: null,
                triggerType: ''
            };
        }

        const row = rows[0];
        const addButton = findButtonByText(row, 'Добавить');

        if (addButton) {
            return { ok: true, error: '', rowCount: rows.length, trigger: addButton, triggerType: 'add-button' };
        }

        const existingBarcodeTrigger = findExistingBarcodeCellTrigger(row);

        if (existingBarcodeTrigger) {
            return {
                ok: true,
                error: '',
                rowCount: rows.length,
                trigger: existingBarcodeTrigger,
                triggerType: 'existing-barcode-cell'
            };
        }

        return {
            ok: false,
            error: 'Ozon barcode drawer trigger not found',
            rowCount: rows.length,
            trigger: null,
            triggerType: ''
        };
    }

    function findExistingBarcodeDrawerTriggerForProduct(productId) {
        const rows = findProductRows(productId);

        if (rows.length !== 1) {
            return {
                ok: false,
                error: rows.length > 1 ? 'Ozon product row is ambiguous' : 'Ozon product row not found',
                rowCount: rows.length,
                trigger: null
            };
        }

        const trigger = findExistingBarcodeCellTrigger(rows[0]);

        if (!trigger) {
            return {
                ok: false,
                error: 'existing Ozon barcode drawer trigger not found',
                rowCount: rows.length,
                trigger: null
            };
        }

        return { ok: true, error: '', rowCount: rows.length, trigger };
    }

    function findBarcodeDrawerByTitle() {
        const drawerRoots = Array.from(document.querySelectorAll('#ods-window-target-container, .vue-portal-target, [tabindex="-1"], [role="dialog"], aside'))
            .filter(isVisibleElement)
            .filter(node => {
                const text = normalizeText(node.innerText || node.textContent).toLowerCase();

                return text.includes('добавить штрихкод')
                    || text.includes('выберите один из способов')
                    || text.includes('уникальный штрихкод ozon')
                    || (text.includes('штрихкод') && text.includes('сохранить'))
                    || (text.includes('штрихкод') && text.includes('удалить'))
                    || (text.includes('штрихкодов') && text.includes('добавить'));
            });

        return drawerRoots
            .sort((a, b) => normalizeText(a.innerText || a.textContent).length - normalizeText(b.innerText || b.textContent).length)[0] || null;
    }

    async function waitForBarcodeDrawerByTitle(timeoutMs = 5000) {
        const startedAt = Date.now();

        while (Date.now() - startedAt <= timeoutMs) {
            const drawer = findBarcodeDrawerByTitle();

            if (drawer) {
                return drawer;
            }

            await delay(250);
        }

        return null;
    }

    function extractOzonBarcodesFromDrawer(drawer, productId, ozonSku) {
        const excludedValues = [normalizeId(productId), normalizeId(ozonSku)].filter(Boolean);
        const barcodes = [];

        for (const node of Array.from(drawer?.querySelectorAll?.('[data-style="text"]') || [])) {
            const text = normalizeText(node.innerText || node.textContent);
            pushUniqueBarcode(barcodes, text, excludedValues);
        }

        for (const barcode of extractVisibleTextBarcodes(drawer, excludedValues)) {
            pushUniqueBarcode(barcodes, barcode, excludedValues);
        }

        return barcodes;
    }

    function getExistingBarcodeDrawerClickTargets(trigger) {
        const targets = [];

        function addTarget(element) {
            if (element && isVisibleElement(element) && !targets.includes(element)) {
                targets.push(element);
            }
        }

        addTarget(trigger?.querySelector?.('[data-style="count"]'));
        addTarget(trigger?.querySelector?.('[data-style="text"]'));
        addTarget(trigger);
        addTarget(trigger?.closest?.('td, [role="cell"]'));

        return targets;
    }

    async function openExistingBarcodeDrawerForRead(productId, timeoutMs = 8000) {
        const startedAt = Date.now();
        let lastTriggerResult = null;
        const attempts = [];

        while (Date.now() - startedAt <= timeoutMs) {
            const existingDrawer = findBarcodeDrawerByTitle();

            if (existingDrawer) {
                return { ok: true, drawer: existingDrawer, trigger: lastTriggerResult?.trigger || null, rowCount: lastTriggerResult?.rowCount || 0, attempts };
            }

            const triggerResult = findExistingBarcodeDrawerTriggerForProduct(productId);
            lastTriggerResult = triggerResult;

            if (!triggerResult.ok) {
                attempts.push({ ok: false, error: triggerResult.error, rowCount: triggerResult.rowCount || 0 });
                await delay(250);
                continue;
            }

            const targets = getExistingBarcodeDrawerClickTargets(triggerResult.trigger);

            for (const target of targets) {
                attempts.push({
                    ok: true,
                    target: getElementSummary(target),
                    trigger: getElementSummary(triggerResult.trigger)
                });

                dispatchMouseClickDirect(target);
                dispatchMouseClick(target);

                const drawer = await waitForBarcodeDrawerByTitle(1200);

                if (drawer) {
                    return { ok: true, drawer, trigger: triggerResult.trigger, rowCount: triggerResult.rowCount, attempts };
                }
            }

            await delay(350);
        }

        return {
            ok: false,
            drawer: null,
            trigger: lastTriggerResult?.trigger || null,
            rowCount: lastTriggerResult?.rowCount || 0,
            error: lastTriggerResult?.error || 'Ozon barcode drawer not found',
            attempts
        };
    }

    async function readFullExistingBarcodesFromDrawer(productId, ozonSku, visibleBarcodes = []) {
        const normalizedProductId = normalizeId(productId);
        const normalizedOzonSku = normalizeId(ozonSku);
        const openResult = await openExistingBarcodeDrawerForRead(normalizedProductId, 8000);

        debug.lastFullBarcodeDrawerOpen = {
            ok: openResult.ok,
            error: openResult.error || '',
            rowCount: openResult.rowCount || 0,
            trigger: getElementSummary(openResult.trigger),
            attempts: safeArray(openResult.attempts).slice(-8)
        };

        if (!openResult.ok || !openResult.drawer) {
            return {
                ok: false,
                error: openResult.error || 'Ozon barcode drawer not found',
                existingBarcodes: mergeUniqueBarcodes(visibleBarcodes),
                drawerBarcodes: [],
                trigger: openResult.trigger || null,
                rowCount: openResult.rowCount || 0
            };
        }

        await delay(500);

        const drawerBarcodes = extractOzonBarcodesFromDrawer(openResult.drawer, normalizedProductId, normalizedOzonSku);
        const existingBarcodes = mergeUniqueBarcodes(visibleBarcodes, drawerBarcodes);

        return {
            ok: true,
            error: '',
            existingBarcodes,
            drawerBarcodes,
            trigger: openResult.trigger,
            rowCount: openResult.rowCount
        };
    }

    async function verifyOzonBarcodesAfterUiApply(productId, expectedBarcodes = []) {
        const normalizedProductId = normalizeId(productId);
        const targetBarcodes = mergeUniqueBarcodes(safeArray(expectedBarcodes).map(normalizeBarcode).filter(Boolean));

        if (!normalizedProductId || !targetBarcodes.length) {
            return {
                ok: false,
                error: 'verify productId or barcodes missing',
                existingBarcodes: [],
                verifiedBarcodes: [],
                missingBarcodes: targetBarcodes,
                verifiedCount: 0,
                expectedCount: targetBarcodes.length,
                readOk: false
            };
        }

        await delay(1200);

        const domProduct = resolveProductFromDomRow(normalizedProductId);
        const visibleBarcodes = mergeUniqueBarcodes(domProduct.product?.existingBarcodes || []);
        const ozonSku = normalizeId(domProduct.product?.ozonSku || domProduct.product?.sku);
        const readResult = await readFullExistingBarcodesFromDrawer(normalizedProductId, ozonSku, visibleBarcodes);
        const existingBarcodes = mergeUniqueBarcodes(readResult.existingBarcodes || visibleBarcodes);
        const verifiedBarcodes = targetBarcodes.filter(barcode => existingBarcodes.includes(barcode));
        const missingBarcodes = targetBarcodes.filter(barcode => !existingBarcodes.includes(barcode));

        return {
            ok: missingBarcodes.length === 0,
            error: missingBarcodes.length === 0 ? '' : 'barcode verify failed after save',
            existingBarcodes,
            verifiedBarcodes,
            missingBarcodes,
            verifiedCount: verifiedBarcodes.length,
            expectedCount: targetBarcodes.length,
            readOk: readResult.ok === true,
            readError: readResult.error || '',
            rowCount: readResult.rowCount || domProduct.rowCount || 0,
            source: readResult.ok ? 'drawer' : 'visible-row'
        };
    }

    function isBarcodeSearchInput(input) {
        const placeholder = normalizeText(input?.getAttribute?.('placeholder')).toLowerCase();
        const value = normalizeText(input?.value).toLowerCase();
        const currentSearch = normalizeId(new URLSearchParams(location.search).get('search')).toLowerCase();

        return placeholder.includes('название')
            || placeholder.includes('артикул')
            || placeholder.includes('sku')
            || (currentSearch && value === currentSearch);
    }

    function getUsableBarcodeInputs(root) {
        return Array.from((root || document).querySelectorAll('input, textarea'))
            .filter(isVisibleElement)
            .filter(input => !input.disabled && input.getAttribute?.('disabled') === null)
            .filter(input => !isBarcodeSearchInput(input));
    }

    function findBarcodeInput() {
        const drawer = findBarcodeDrawerByTitle();

        if (!drawer) {
            return null;
        }

        const inputs = getUsableBarcodeInputs(drawer);

        const exactPlaceholder = inputs.find(input => normalizeText(input.getAttribute('placeholder')).toLowerCase() === 'штрихкод');

        if (exactPlaceholder) {
            return exactPlaceholder;
        }

        const barcodeLike = inputs.find(input => {
            const attrs = [
                input.getAttribute('placeholder'),
                input.getAttribute('aria-label'),
                input.getAttribute('name'),
                input.getAttribute('id'),
                input.getAttribute('data-testid')
            ].map(normalizeText).join(' ').toLowerCase();

            return attrs.includes('barcode') || attrs.includes('штрихкод');
        });

        if (barcodeLike) {
            return barcodeLike;
        }

        if (inputs.length === 1) {
            return inputs[0];
        }

        return null;
    }

    function findBarcodeDrawer() {
        const input = findBarcodeInput();

        if (input) {
            return input.closest?.('#ods-window-target-container, .vue-portal-target, [tabindex="-1"], [role="dialog"], aside') || document;
        }

        return findBarcodeDrawerByTitle();
    }

    function getVisibleOzonUiSnapshot() {
        const drawer = findBarcodeDrawerByTitle();
        const inputs = Array.from(document.querySelectorAll('input, textarea'))
            .filter(isVisibleElement)
            .map(input => ({
                tag: input.tagName,
                placeholder: normalizeText(input.getAttribute('placeholder')),
                value: normalizeText(input.value).slice(0, 120),
                className: String(input.className || '').slice(0, 120),
                disabled: !!input.disabled || input.getAttribute?.('disabled') !== null,
                rejectedAsSearchInput: isBarcodeSearchInput(input)
            }))
            .slice(0, 12);
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
            .filter(isVisibleElement)
            .map(button => ({
                text: getElementText(button).slice(0, 120),
                className: String(button.className || '').slice(0, 120),
                disabled: !!button.disabled || button.getAttribute?.('disabled') !== null
            }))
            .slice(0, 20);

        return {
            href: location.href,
            drawer: drawer ? getElementSummary(drawer) : null,
            inputs,
            buttons
        };
    }

    function findDrawerAddBarcodeButton() {
        const drawer = findBarcodeDrawerByTitle();

        if (!drawer) {
            return null;
        }

        const controls = Array.from(drawer.querySelectorAll('button, [role="button"]'))
            .map(getClickableElement)
            .filter(Boolean);

        return Array.from(new Set(controls))
            .filter(isVisibleElement)
            .filter(control => !isDisabledControl(control))
            .filter(control => {
                const text = getElementText(control).toLowerCase();

                return text === 'добавить штрихкод';
            })[0] || null;
    }

    async function waitForBarcodeInput(timeoutMs = 12000) {
        const startedAt = Date.now();
        let addBarcodeModeClicked = false;

        while (Date.now() - startedAt <= timeoutMs) {
            const input = findBarcodeInput();

            if (input) {
                return input;
            }

            if (!addBarcodeModeClicked) {
                const addBarcodeButton = findDrawerAddBarcodeButton();

                if (addBarcodeButton) {
                    addBarcodeModeClicked = true;
                    debug.lastUiApply = {
                        ...debug.lastUiApply,
                        intermediateAddBarcodeButton: getElementSummary(addBarcodeButton),
                        intermediateAddBarcodeButtonClicked: true
                    };
                    dispatchMouseClick(addBarcodeButton);
                    await delay(500);
                    continue;
                }
            }

            await delay(250);
        }

        return null;
    }

    function getClickableElement(element) {
        if (!element) {
            return null;
        }

        return element.closest?.('button, [role="button"], [tabindex], a') || element;
    }

    function isDisabledControl(element) {
        if (!element) {
            return true;
        }

        return !!element.disabled
            || element.getAttribute?.('disabled') !== null
            || element.getAttribute?.('aria-disabled') === 'true';
    }

    function getControlSearchText(element) {
        if (!element) {
            return '';
        }

        return normalizeText([
            element.innerText || element.textContent || '',
            element.getAttribute?.('aria-label') || '',
            element.getAttribute?.('title') || '',
            element.getAttribute?.('data-testid') || '',
            element.getAttribute?.('class') || ''
        ].join(' ')).toLowerCase();
    }

    function isRejectedBarcodeControl(element) {
        const text = getControlSearchText(element);

        return text.includes('сохранить')
            || text.includes('сгенерировать')
            || text.includes('gtin')
            || text.includes('закрыть')
            || text.includes('отмена')
            || text.includes('cancel')
            || text.includes('close');
    }

    function isOzonPlusIconPath(path) {
        const d = normalizeText(path?.getAttribute?.('d') || '');

        return d.includes('M12 4a1.5')
            && d.includes('v5h5')
            && d.includes('v-5h-5');
    }

    function getBarcodeInputContainer(input) {
        if (!input?.closest) {
            return null;
        }

        return input.closest('.ct1132-a')
            || input.closest('.dn0-bj')
            || input.parentElement?.parentElement?.parentElement?.parentElement
            || null;
    }

    function isPlusButtonForBarcodeInput(button, input) {
        const inputRect = input?.getBoundingClientRect?.();
        const buttonRect = button?.getBoundingClientRect?.();

        if (!inputRect || !buttonRect || !isVisibleElement(button) || isDisabledControl(button)) {
            return false;
        }

        if (isRejectedBarcodeControl(button)) {
            return false;
        }

        const hasPlusSvg = Array.from(button.querySelectorAll?.('svg path') || [])
            .some(isOzonPlusIconPath);

        if (!hasPlusSvg) {
            return false;
        }

        const isRightOfInput = buttonRect.left >= inputRect.right - 4 && buttonRect.left <= inputRect.right + 120;
        const overlapsInputY = buttonRect.bottom >= inputRect.top - 24 && buttonRect.top <= inputRect.bottom + 24;
        const isCompactButton = buttonRect.width > 0 && buttonRect.width <= 96 && buttonRect.height > 0 && buttonRect.height <= 96;

        return isRightOfInput && overlapsInputY && isCompactButton;
    }

    function findPlusButtonBySvgNearInput(input) {
        const container = getBarcodeInputContainer(input);
        const drawer = findBarcodeDrawer() || findBarcodeDrawerByTitle() || document;
        const searchRoots = Array.from(new Set([container, drawer, document].filter(Boolean)));
        const buttons = [];

        for (const root of searchRoots) {
            if (!root?.querySelectorAll) {
                continue;
            }

            for (const path of Array.from(root.querySelectorAll('button svg path'))) {
                if (!isOzonPlusIconPath(path)) {
                    continue;
                }

                const button = path.closest?.('button');

                if (button && !buttons.includes(button)) {
                    buttons.push(button);
                }
            }
        }

        return buttons
            .filter(button => isPlusButtonForBarcodeInput(button, input))
            .sort((a, b) => {
                const inputRect = input.getBoundingClientRect();
                const rectA = a.getBoundingClientRect();
                const rectB = b.getBoundingClientRect();
                const centerY = (inputRect.top + inputRect.bottom) / 2;
                const scoreA = Math.abs(((rectA.top + rectA.bottom) / 2) - centerY) + Math.max(0, rectA.left - inputRect.right);
                const scoreB = Math.abs(((rectB.top + rectB.bottom) / 2) - centerY) + Math.max(0, rectB.left - inputRect.right);

                return scoreA - scoreB;
            })[0] || null;
    }

    function findClosestPlusButton(input) {
        const rect = input?.getBoundingClientRect?.();
        const drawer = findBarcodeDrawer() || document;
        const svgPlusButton = findPlusButtonBySvgNearInput(input);

        if (svgPlusButton) {
            return svgPlusButton;
        }

        if (!rect) {
            return null;
        }

        const rawCandidates = Array.from(drawer.querySelectorAll('button, [role="button"]'))
            .map(getClickableElement)
            .filter(Boolean);
        const candidates = Array.from(new Set(rawCandidates))
            .filter(isVisibleElement)
            .filter(candidate => !isDisabledControl(candidate))
            .filter(candidate => !isRejectedBarcodeControl(candidate))
            .filter(candidate => {
                const candidateRect = candidate.getBoundingClientRect();
                const candidateText = getElementText(candidate);
                const searchText = getControlSearchText(candidate);
                const hasPlusSvg = Array.from(candidate.querySelectorAll?.('svg path') || []).some(isOzonPlusIconPath);
                const looksLikePlus = candidateText === '+' || hasPlusSvg || /(^|\s)(plus|add barcode|добавить штрихкод)(\s|$)/i.test(searchText);

                if (!looksLikePlus) {
                    return false;
                }

                return candidateRect.left >= rect.right - 8
                    && candidateRect.left <= rect.right + 160
                    && candidateRect.bottom >= rect.top - 32
                    && candidateRect.top <= rect.bottom + 32
                    && candidateRect.width > 0
                    && candidateRect.width <= 120
                    && candidateRect.height > 0
                    && candidateRect.height <= 120;
            });

        return candidates
            .sort((a, b) => {
                const rectA = a.getBoundingClientRect();
                const rectB = b.getBoundingClientRect();
                const centerY = (rect.top + rect.bottom) / 2;
                const scoreA = Math.abs(((rectA.top + rectA.bottom) / 2) - centerY) + Math.max(0, rectA.left - rect.right);
                const scoreB = Math.abs(((rectB.top + rectB.bottom) / 2) - centerY) + Math.max(0, rectB.left - rect.right);

                return scoreA - scoreB;
            })[0] || null;
    }

    async function waitForClosestPlusButton(input, timeoutMs = 5000) {
        const startedAt = Date.now();

        while (Date.now() - startedAt <= timeoutMs) {
            const button = findClosestPlusButton(input);

            if (button) {
                return button;
            }

            await delay(200);
        }

        return null;
    }

    function getCandidateRectsForPlusClick(input) {
        const rects = [];
        let node = input;

        while (node && node !== document.body) {
            const rect = node.getBoundingClientRect?.();

            if (rect && rect.width > 0 && rect.height > 0) {
                rects.push({ element: node, rect });
            }

            node = node.parentElement;

            if (rects.length >= 8) {
                break;
            }
        }

        return rects;
    }

    function isBarcodeAddedInDrawer(barcode) {
        const normalizedBarcode = normalizeBarcode(barcode);
        const drawer = findBarcodeDrawer() || findBarcodeDrawerByTitle();

        if (!drawer || !normalizedBarcode) {
            return false;
        }

        const text = normalizeBarcode(drawer.innerText || drawer.textContent);
        const input = findBarcodeInput();
        const inputValue = normalizeBarcode(input?.value);

        return text.includes(normalizedBarcode) && inputValue !== normalizedBarcode;
    }

    function shouldRejectPointClickTarget(target, input) {
        if (!target || target === input) {
            return true;
        }

        if (target.closest?.('input, textarea') === input) {
            return true;
        }

        const clickableTarget = getClickableElement(target) || target;

        if (!clickableTarget || isRejectedBarcodeControl(clickableTarget)) {
            return true;
        }

        const text = getControlSearchText(clickableTarget);

        return text.includes('название')
            || text.includes('артикул')
            || text.includes('sku')
            || text.includes('список товаров');
    }

    async function clickPlusByGeometryFallback(input, barcode, timeoutMs = 5000) {
        const inputRect = input?.getBoundingClientRect?.();

        if (!inputRect) {
            return null;
        }

        const startedAt = Date.now();
        const drawer = findBarcodeDrawer() || document;
        const drawerRect = drawer.getBoundingClientRect?.();
        const attempts = [];

        while (Date.now() - startedAt <= timeoutMs) {
            const rects = getCandidateRectsForPlusClick(input);
            const points = [];

            for (const { rect } of rects) {
                const yPoints = [
                    (rect.top + rect.bottom) / 2,
                    rect.top + Math.max(4, rect.height * 0.35),
                    rect.bottom - Math.max(4, rect.height * 0.35)
                ];
                const xPoints = [
                    rect.right - 12,
                    rect.right - 24,
                    rect.right - 40,
                    rect.right + 8,
                    rect.right + 18,
                    rect.right + 32,
                    rect.right + 48,
                    rect.right + 72
                ];

                for (const y of yPoints) {
                    for (const x of xPoints) {
                        points.push({ x, y });
                    }
                }
            }

            for (const { x, y } of points) {
                if (drawerRect && (x < drawerRect.left || x > drawerRect.right || y < drawerRect.top || y > drawerRect.bottom)) {
                    continue;
                }

                const target = document.elementFromPoint?.(x, y);
                const clickableTarget = getClickableElement(target) || target;

                attempts.push({
                    x: Math.round(x),
                    y: Math.round(y),
                    target: getElementSummary(clickableTarget || target)
                });

                if (shouldRejectPointClickTarget(target, input)) {
                    continue;
                }

                const clicked = dispatchMouseClickAtPoint(x, y);

                if (!clicked.ok) {
                    continue;
                }

                await delay(900);

                if (await waitForSaveButtonEnabled(900)) {
                    return { element: clicked.target || clickableTarget, attempts };
                }

                if (isBarcodeAddedInDrawer(barcode)) {
                    return { element: clicked.target || clickableTarget, attempts };
                }
            }

            await delay(200);
        }

        return { element: null, attempts };
    }

    function dispatchKeyboardEnter(input) {
        if (!input) {
            return false;
        }

        try {
            input.focus?.({ preventScroll: true });
            input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
            input.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
            return true;
        } catch {
            return false;
        }
    }

    function isEnabledButton(button) {
        return !!button
            && isVisibleElement(button)
            && !button.disabled
            && button.getAttribute?.('disabled') === null
            && button.getAttribute?.('aria-disabled') !== 'true';
    }

    function findBarcodeSaveButton({ allowDisabled = false } = {}) {
        const drawer = findBarcodeDrawerByTitle() || findBarcodeDrawer() || document;
        const drawerRect = drawer.getBoundingClientRect?.();
        const directFooterButtons = Array.from(drawer.querySelectorAll('.dn0-b8j button, .dn0-b8j [role="button"]'));
        const textButtons = Array.from(drawer.querySelectorAll('button, [role="button"], span, div'))
            .filter(isVisibleElement)
            .filter(node => normalizeText(node.innerText || node.textContent).toLowerCase() === 'сохранить')
            .map(node => node.closest?.('button, [role="button"]') || node)
            .filter(Boolean);
        const allButtons = Array.from(drawer.querySelectorAll('button, [role="button"]'));
        const uniqueButtons = Array.from(new Set([...directFooterButtons, ...textButtons, ...allButtons]))
            .map(getClickableElement)
            .filter(Boolean)
            .filter(isVisibleElement)
            .filter(button => normalizeText(button.innerText || button.textContent).toLowerCase() === 'сохранить');

        const candidates = (allowDisabled ? uniqueButtons : uniqueButtons.filter(isEnabledButton))
            .filter(button => {
                const rect = button.getBoundingClientRect?.();
                if (!rect || !drawerRect) {
                    return true;
                }

                return rect.left >= drawerRect.left
                    && rect.right <= drawerRect.right
                    && rect.top >= drawerRect.top
                    && rect.bottom <= drawerRect.bottom;
            });

        return candidates
            .sort((a, b) => {
                const footerA = a.closest?.('.dn0-b8j') ? 0 : 1;
                const footerB = b.closest?.('.dn0-b8j') ? 0 : 1;

                if (footerA !== footerB) {
                    return footerA - footerB;
                }

                const rectA = a.getBoundingClientRect?.();
                const rectB = b.getBoundingClientRect?.();

                return (rectB?.top || 0) - (rectA?.top || 0);
            })[0] || null;
    }

    async function waitForSaveButtonEnabled(timeoutMs = 12000) {
        const startedAt = Date.now();

        try {
            document.activeElement?.blur?.();
        } catch {}

        while (Date.now() - startedAt <= timeoutMs) {
            const button = findBarcodeSaveButton({ allowDisabled: false });

            if (button) {
                return button;
            }

            await delay(250);
        }

        return null;
    }

    async function clickSaveButtonAndWait() {
        const saveButton = await waitForSaveButtonEnabled();

        if (!saveButton) {
            return {
                ok: false,
                error: 'save button not enabled',
                button: findBarcodeSaveButton({ allowDisabled: true })
            };
        }

        const rect = saveButton.getBoundingClientRect?.();
        const clickTarget = rect
            ? document.elementFromPoint?.(Math.round((rect.left + rect.right) / 2), Math.round((rect.top + rect.bottom) / 2))
            : null;

        debug.lastUiApply = {
            ...debug.lastUiApply,
            saveButton: getElementSummary(saveButton),
            saveClickTarget: getElementSummary(clickTarget)
        };

        dispatchMouseClickDirect(saveButton);
        let drawerClosed = await waitForDrawerClosed(4500);

        if (!drawerClosed && findBarcodeSaveButton({ allowDisabled: false })) {
            await delay(500);
            dispatchMouseClickDirect(saveButton);
            drawerClosed = await waitForDrawerClosed(6000);
        }

        return { ok: true, button: saveButton, drawerClosed };
    }

    async function waitForDrawerClosed(timeoutMs = 5000) {
        const startedAt = Date.now();

        while (Date.now() - startedAt <= timeoutMs) {
            if (!findBarcodeInput()) {
                return true;
            }

            await delay(250);
        }

        return false;
    }

    function createOzonBarcodeAddPayload(sellerId, ozonSku, barcodes = []) {
        const normalizedSellerId = normalizeId(sellerId);
        const normalizedOzonSku = normalizeId(ozonSku);
        const normalizedBarcodes = mergeUniqueBarcodes(safeArray(barcodes).map(normalizeBarcode).filter(Boolean));

        return {
            seller_id: normalizedSellerId,
            barcodes: normalizedBarcodes.map(barcode => ({
                barcode,
                item_id: normalizedOzonSku
            }))
        };
    }

    async function sendOzonBarcodeAddApiRequest({ sellerId, ozonSku, barcodes = [] } = {}) {
        if (typeof window.fetch !== 'function') {
            return { ok: false, error: 'fetch unavailable' };
        }

        const payload = createOzonBarcodeAddPayload(sellerId, ozonSku, barcodes);

        if (!payload.seller_id) {
            return { ok: false, error: 'sellerId missing', payload };
        }

        if (!payload.barcodes.length || !payload.barcodes.every(item => item.item_id)) {
            return { ok: false, error: 'ozonSku or barcodes missing', payload };
        }

        try {
            const response = await window.fetch('/api/barcode-add-v2', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'content-type': 'application/json',
                    'x-o3-company-id': payload.seller_id,
                    'x-o3-seller-id': payload.seller_id
                },
                body: JSON.stringify(payload)
            });
            let body = null;

            try {
                body = await response.json();
            } catch {}

            const errors = safeArray(body?.errors).filter(Boolean);

            return {
                ok: response.ok === true && errors.length === 0,
                error: response.ok === true
                    ? errors.map(item => normalizeText(item?.message || item?.error || item)).filter(Boolean).join('; ')
                    : `barcode-add-v2 HTTP ${response.status || 0}`,
                status: Number(response.status) || 0,
                payload,
                response: body,
                errors
            };
        } catch (error) {
            return {
                ok: false,
                error: error?.message || 'barcode-add-v2 request failed',
                payload
            };
        }
    }

    async function applyOzonBarcodesViaApi({ productId, barcodes = [] } = {}) {
        const normalizedProductId = normalizeId(productId);
        const normalizedBarcodes = mergeUniqueBarcodes(safeArray(barcodes).map(normalizeBarcode).filter(Boolean));
        const domProduct = resolveProductFromDomRow(normalizedProductId);
        const sellerId = getOzonSellerId();
        const ozonSku = normalizeId(domProduct.product?.ozonSku || domProduct.product?.sku);

        debug.lastApiApply = {
            productId: normalizedProductId,
            barcodes: normalizedBarcodes,
            sellerId,
            ozonSku,
            startedAt: new Date().toISOString(),
            result: 'started'
        };

        if (!normalizedProductId || !normalizedBarcodes.length) {
            return { ok: false, error: 'productId or barcodes missing', fallbackReason: 'invalid-request' };
        }

        if (!domProduct.ok || !ozonSku) {
            debug.lastApiApply = {
                ...debug.lastApiApply,
                result: 'skipped',
                error: domProduct.error || 'ozonSku missing',
                rowCount: domProduct.rowCount || 0
            };
            return { ok: false, error: domProduct.error || 'ozonSku missing', fallbackReason: 'product-context-missing' };
        }

        if (!sellerId) {
            debug.lastApiApply = {
                ...debug.lastApiApply,
                result: 'skipped',
                error: 'sellerId missing'
            };
            return { ok: false, error: 'sellerId missing', fallbackReason: 'seller-id-missing', ozonSku };
        }

        const apiResult = await sendOzonBarcodeAddApiRequest({
            sellerId,
            ozonSku,
            barcodes: normalizedBarcodes
        });

        debug.lastApiApply = {
            ...debug.lastApiApply,
            result: apiResult.ok ? 'api-saved' : 'api-failed',
            error: apiResult.error || '',
            status: apiResult.status || 0,
            apiResponse: apiResult.response || null,
            payload: apiResult.payload || null
        };

        if (!apiResult.ok) {
            return {
                ok: false,
                error: apiResult.error || 'barcode-add-v2 failed',
                fallbackReason: 'api-write-failed',
                sellerId,
                ozonSku,
                apiResult
            };
        }

        const pendingSaved = savePendingApiVerify({
            productId: normalizedProductId,
            barcodes: normalizedBarcodes,
            sellerId,
            ozonSku,
            apiResult
        });

        if (pendingSaved && requestPageReloadForApiVerify()) {
            debug.lastApiApply = {
                ...debug.lastApiApply,
                result: 'api-saved-reloading-for-verify',
                finishedAt: new Date().toISOString()
            };

            return new Promise(() => {});
        }

        const verifyResult = await verifyOzonBarcodesAfterUiApply(normalizedProductId, normalizedBarcodes);

        debug.lastApiApply = {
            ...debug.lastApiApply,
            result: verifyResult.ok ? 'verified' : 'saved-unverified',
            verifiedCount: verifyResult.verifiedCount,
            missingBarcodes: verifyResult.missingBarcodes,
            verify: verifyResult,
            finishedAt: new Date().toISOString()
        };

        return {
            ok: verifyResult.ok,
            productId: normalizedProductId,
            barcodes: normalizedBarcodes,
            addedCount: normalizedBarcodes.length,
            verifiedCount: verifyResult.verifiedCount,
            missingBarcodes: verifyResult.missingBarcodes,
            error: verifyResult.ok ? '' : verifyResult.error || 'barcode verify failed after API write',
            details: {
                writeMethod: 'api',
                sellerId,
                ozonSku,
                api: apiResult,
                verify: verifyResult
            }
        };
    }

    async function applyOzonBarcodesViaDrawerUi({ productId, barcodes = [] } = {}) {
        const normalizedProductId = normalizeId(productId);
        const normalizedBarcodes = safeArray(barcodes).map(normalizeBarcode).filter(Boolean);

        debug.lastUiApply = {
            productId: normalizedProductId,
            barcodes: normalizedBarcodes,
            startedAt: new Date().toISOString(),
            result: 'started',
            writeMethod: 'ui'
        };

        if (!normalizedProductId || !normalizedBarcodes.length) {
            throw new Error('productId or barcodes missing');
        }

        let input = null;
        let addButtonResult = null;

        for (let openAttempt = 1; openAttempt <= 3; openAttempt += 1) {
            addButtonResult = findBarcodeDrawerTriggerForProduct(normalizedProductId);

            if (!addButtonResult.ok) {
                debug.lastUiApply = {
                    ...debug.lastUiApply,
                    result: 'failed',
                    error: addButtonResult.error,
                    rowCount: addButtonResult.rowCount,
                    openAttempt,
                    uiSnapshot: getVisibleOzonUiSnapshot()
                };
                throw new Error(addButtonResult.error);
            }

            debug.lastUiApply = {
                ...debug.lastUiApply,
                openAttempt,
                rowCount: addButtonResult.rowCount,
                drawerTrigger: getElementSummary(addButtonResult.trigger),
                drawerTriggerType: addButtonResult.triggerType
            };

            dispatchMouseClick(addButtonResult.trigger);
            input = await waitForBarcodeInput(openAttempt === 1 ? 5000 : 7000);

            if (input) {
                break;
            }

            await delay(500);
        }

        if (!input) {
            debug.lastUiApply = {
                ...debug.lastUiApply,
                result: 'failed',
                error: 'barcode input not found',
                uiSnapshot: getVisibleOzonUiSnapshot()
            };
            throw new Error('barcode input not found');
        }

        let addedCount = 0;

        for (const barcode of normalizedBarcodes) {
            const currentInput = findBarcodeInput() || input;

            if (!currentInput || isBarcodeSearchInput(currentInput)) {
                debug.lastUiApply = {
                    ...debug.lastUiApply,
                    result: 'failed',
                    error: 'barcode input not found',
                    barcode,
                    uiSnapshot: getVisibleOzonUiSnapshot()
                };
                throw new Error('barcode input not found');
            }

            setNativeInputValue(currentInput, barcode);
            await delay(250);

            if (normalizeBarcode(currentInput.value) !== barcode) {
                debug.lastUiApply = {
                    ...debug.lastUiApply,
                    result: 'failed',
                    error: 'barcode input value not set',
                    barcode,
                    input: getElementSummary(currentInput),
                    inputValue: normalizeText(currentInput.value),
                    uiSnapshot: getVisibleOzonUiSnapshot()
                };
                throw new Error('barcode input value not set');
            }

            let plusButton = await waitForClosestPlusButton(currentInput);
            let plusButtonClickedByGeometry = false;

            let plusClickAttempts = [];

            if (!plusButton) {
                const geometryResult = await clickPlusByGeometryFallback(currentInput, barcode);
                plusButton = geometryResult?.element || null;
                plusClickAttempts = geometryResult?.attempts || [];
                plusButtonClickedByGeometry = !!plusButton;
            }

            if (!plusButton) {
                dispatchKeyboardEnter(currentInput);
                await delay(900);

                const saveButtonAfterEnter = await waitForSaveButtonEnabled(1500);

                if (saveButtonAfterEnter || isBarcodeAddedInDrawer(barcode)) {
                    addedCount += 1;
                    continue;
                }

                debug.lastUiApply = {
                    ...debug.lastUiApply,
                    result: 'failed',
                    error: 'barcode plus button not found',
                    barcode,
                    plusClickAttempts: plusClickAttempts.slice(-20),
                    uiSnapshot: getVisibleOzonUiSnapshot()
                };
                throw new Error('barcode plus button not found');
            }

            debug.lastUiApply = {
                ...debug.lastUiApply,
                barcode,
                plusButton: getElementSummary(plusButton),
                plusButtonClickedByGeometry,
                plusClickAttempts: plusClickAttempts.slice(-20)
            };

            if (!plusButtonClickedByGeometry) {
                dispatchMouseClick(plusButton);
                await delay(900);

                if (!await waitForSaveButtonEnabled(900) && !isBarcodeAddedInDrawer(barcode)) {
                    const geometryResult = await clickPlusByGeometryFallback(currentInput, barcode, 2500);
                    plusClickAttempts = geometryResult?.attempts || plusClickAttempts;
                    plusButtonClickedByGeometry = !!geometryResult?.element;

                    debug.lastUiApply = {
                        ...debug.lastUiApply,
                        barcode,
                        plusButton: getElementSummary(geometryResult?.element || plusButton),
                        plusButtonClickedByGeometry,
                        plusClickAttempts: plusClickAttempts.slice(-20)
                    };
                }
            }

            if (!await waitForSaveButtonEnabled(1200) && !isBarcodeAddedInDrawer(barcode)) {
                dispatchKeyboardEnter(currentInput);
                await delay(900);
            }

            if (!await waitForSaveButtonEnabled(1200) && !isBarcodeAddedInDrawer(barcode)) {
                debug.lastUiApply = {
                    ...debug.lastUiApply,
                    result: 'failed',
                    error: 'barcode add was not accepted',
                    barcode,
                    plusButton: getElementSummary(plusButton),
                    plusButtonClickedByGeometry,
                    plusClickAttempts: plusClickAttempts.slice(-20),
                    uiSnapshot: getVisibleOzonUiSnapshot()
                };
                throw new Error('barcode add was not accepted');
            }

            addedCount += 1;
        }

        const saveResult = await clickSaveButtonAndWait();

        if (!saveResult.ok) {
            debug.lastUiApply = {
                ...debug.lastUiApply,
                result: 'failed',
                error: saveResult.error || 'save button not enabled',
                addedCount,
                saveButton: getElementSummary(saveResult.button),
                uiSnapshot: getVisibleOzonUiSnapshot()
            };
            throw new Error(saveResult.error || 'save button not enabled');
        }

        const verifyResult = await verifyOzonBarcodesAfterUiApply(normalizedProductId, normalizedBarcodes);

        debug.lastUiApply = {
            ...debug.lastUiApply,
            result: verifyResult.ok ? 'verified' : 'saved-unverified',
            addedCount,
            verifiedCount: verifyResult.verifiedCount,
            missingBarcodes: verifyResult.missingBarcodes,
            saveButton: getElementSummary(saveResult.button),
            drawerClosed: saveResult.drawerClosed,
            verify: verifyResult,
            finishedAt: new Date().toISOString()
        };

        return {
            ok: verifyResult.ok,
            productId: normalizedProductId,
            barcodes: normalizedBarcodes,
            addedCount,
            verifiedCount: verifyResult.verifiedCount,
            missingBarcodes: verifyResult.missingBarcodes,
            error: verifyResult.ok ? '' : verifyResult.error,
            details: {
                writeMethod: 'ui',
                drawerClosed: saveResult.drawerClosed,
                verify: verifyResult
            }
        };
    }

    async function completePendingApiVerifyAfterReload(pending = {}, productId, barcodes = []) {
        const normalizedProductId = normalizeId(productId);
        const normalizedBarcodes = safeArray(barcodes).map(normalizeBarcode).filter(Boolean);

        debug.lastApiApply = {
            ...(debug.lastApiApply || {}),
            productId: normalizedProductId,
            barcodes: normalizedBarcodes,
            sellerId: normalizeId(pending.sellerId),
            ozonSku: normalizeId(pending.ozonSku),
            result: 'verifying-after-reload',
            resumedAt: new Date().toISOString(),
            apiResponse: pending.apiResult?.response || null,
            payload: pending.apiResult?.payload || null
        };

        const verifyResult = await verifyOzonBarcodesAfterUiApply(normalizedProductId, normalizedBarcodes);

        debug.lastApiApply = {
            ...debug.lastApiApply,
            result: verifyResult.ok ? 'verified-after-reload' : 'reload-verify-failed',
            verifiedCount: verifyResult.verifiedCount,
            missingBarcodes: verifyResult.missingBarcodes,
            verify: verifyResult,
            finishedAt: new Date().toISOString()
        };

        if (verifyResult.ok) {
            return {
                ok: true,
                productId: normalizedProductId,
                barcodes: normalizedBarcodes,
                addedCount: normalizedBarcodes.length,
                verifiedCount: verifyResult.verifiedCount,
                missingBarcodes: verifyResult.missingBarcodes,
                error: '',
                details: {
                    writeMethod: 'api',
                    sellerId: normalizeId(pending.sellerId),
                    ozonSku: normalizeId(pending.ozonSku),
                    api: pending.apiResult || null,
                    verify: verifyResult,
                    verifyAfterReload: true
                }
            };
        }

        const uiResult = await applyOzonBarcodesViaDrawerUi({ productId: normalizedProductId, barcodes: normalizedBarcodes });

        return {
            ...uiResult,
            details: {
                ...(uiResult.details || {}),
                writeMethod: 'api-ui-fallback',
                api: pending.apiResult || null,
                fallbackReason: 'api-verify-after-reload-failed',
                apiVerify: verifyResult
            }
        };
    }

    async function applyOzonBarcodesWithFallback({ productId, barcodes = [] } = {}) {
        const normalizedProductId = normalizeId(productId);
        const normalizedBarcodes = safeArray(barcodes).map(normalizeBarcode).filter(Boolean);
        const pendingApiVerify = consumePendingApiVerify(normalizedProductId, normalizedBarcodes);

        if (pendingApiVerify) {
            return completePendingApiVerifyAfterReload(pendingApiVerify, normalizedProductId, normalizedBarcodes);
        }

        const apiResult = await applyOzonBarcodesViaApi({ productId: normalizedProductId, barcodes: normalizedBarcodes });

        if (apiResult.ok) {
            debug.lastUiApply = {
                productId: normalizedProductId,
                barcodes: normalizedBarcodes,
                startedAt: new Date().toISOString(),
                result: 'verified',
                writeMethod: 'api',
                api: debug.lastApiApply,
                verifiedCount: apiResult.verifiedCount,
                missingBarcodes: apiResult.missingBarcodes,
                finishedAt: new Date().toISOString()
            };
            return apiResult;
        }

        const uiResult = await applyOzonBarcodesViaDrawerUi({ productId: normalizedProductId, barcodes: normalizedBarcodes });

        return {
            ...uiResult,
            details: {
                ...(uiResult.details || {}),
                writeMethod: apiResult.details?.writeMethod === 'api' ? 'api-ui-fallback' : 'ui-fallback',
                api: apiResult,
                fallbackReason: apiResult.fallbackReason || apiResult.error || 'api-unavailable'
            }
        };
    }

    function handleUiApplyRequest(event) {
        const detail = event?.detail || {};
        const productId = normalizeId(detail.productId);
        const barcodes = safeArray(detail.barcodes).map(normalizeBarcode).filter(Boolean);

        applyOzonBarcodesWithFallback({ productId, barcodes })
            .then(result => {
                window.dispatchEvent(new CustomEvent(UI_APPLY_RESPONSE_EVENT, { detail: result }));
            })
            .catch(error => {
                window.dispatchEvent(new CustomEvent(UI_APPLY_RESPONSE_EVENT, {
                    detail: {
                        ok: false,
                        productId,
                        barcodes,
                        addedCount: 0,
                        error: error?.message || 'Ozon UI apply failed'
                    }
                }));
            });
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
    window.addEventListener(UI_APPLY_REQUEST_EVENT, handleUiApplyRequest);
})();
