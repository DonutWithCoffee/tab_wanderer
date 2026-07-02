(function installTabWandererOzonProductBridge() {
    const REQUEST_EVENT = 'tab_wanderer:ozon-product-request';
    const RESPONSE_EVENT = 'tab_wanderer:ozon-product-response';
    const UI_APPLY_REQUEST_EVENT = 'tab_wanderer:ozon-ui-apply-request';
    const UI_APPLY_RESPONSE_EVENT = 'tab_wanderer:ozon-ui-apply-response';
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
        lastProductsListResponse: null,
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

    function findButtonByText(root, text) {
        const expectedText = normalizeText(text).toLowerCase();
        const buttons = Array.from((root || document).querySelectorAll('button, [role="button"]'));

        return buttons.find(button => isVisibleElement(button) && getElementText(button).toLowerCase() === expectedText)
            || buttons.find(button => isVisibleElement(button) && getElementText(button).toLowerCase().includes(expectedText))
            || null;
    }

    function findAddBarcodeButtonForProduct(productId) {
        const rows = findProductRows(productId);

        if (rows.length !== 1) {
            return { ok: false, error: rows.length > 1 ? 'Ozon product row is ambiguous' : 'Ozon product row not found', rowCount: rows.length, button: null };
        }

        const row = rows[0];
        const button = findButtonByText(row, 'Добавить');

        if (!button) {
            return { ok: false, error: 'Ozon barcode add button not found', rowCount: rows.length, button: null };
        }

        return { ok: true, error: '', rowCount: rows.length, button };
    }

    function findBarcodeDrawerByTitle() {
        const drawerRoots = Array.from(document.querySelectorAll('#ods-window-target-container, .vue-portal-target, [tabindex="-1"], [role="dialog"], aside'))
            .filter(isVisibleElement)
            .filter(node => /добавить штрихкод|выберите один из способов|уникальный штрихкод ozon/i.test(normalizeText(node.innerText || node.textContent)));

        return drawerRoots
            .sort((a, b) => normalizeText(a.innerText || a.textContent).length - normalizeText(b.innerText || b.textContent).length)[0] || null;
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

    async function waitForBarcodeInput(timeoutMs = 12000) {
        const startedAt = Date.now();

        while (Date.now() - startedAt <= timeoutMs) {
            const input = findBarcodeInput();

            if (input) {
                return input;
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

    async function applyOzonBarcodesViaUi({ productId, barcodes = [] } = {}) {
        const normalizedProductId = normalizeId(productId);
        const normalizedBarcodes = safeArray(barcodes).map(normalizeBarcode).filter(Boolean);

        debug.lastUiApply = {
            productId: normalizedProductId,
            barcodes: normalizedBarcodes,
            startedAt: new Date().toISOString(),
            result: 'started'
        };

        if (!normalizedProductId || !normalizedBarcodes.length) {
            throw new Error('productId or barcodes missing');
        }

        let input = null;
        let addButtonResult = null;

        for (let openAttempt = 1; openAttempt <= 3; openAttempt += 1) {
            addButtonResult = findAddBarcodeButtonForProduct(normalizedProductId);

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
                addButton: getElementSummary(addButtonResult.button)
            };

            dispatchMouseClick(addButtonResult.button);
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

        debug.lastUiApply = {
            ...debug.lastUiApply,
            result: 'saved',
            addedCount,
            saveButton: getElementSummary(saveResult.button),
            drawerClosed: saveResult.drawerClosed,
            finishedAt: new Date().toISOString()
        };

        return {
            ok: true,
            productId: normalizedProductId,
            barcodes: normalizedBarcodes,
            addedCount,
            details: { drawerClosed }
        };
    }

    function handleUiApplyRequest(event) {
        const detail = event?.detail || {};
        const productId = normalizeId(detail.productId);
        const barcodes = safeArray(detail.barcodes).map(normalizeBarcode).filter(Boolean);

        applyOzonBarcodesViaUi({ productId, barcodes })
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
