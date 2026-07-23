(() => {
    const SCRIPT_ID = 'tab-wanderer-warehouse-barcode-bridge';
    const REQUEST_EVENT = 'tab_wanderer:warehouse-shop-order-request';
    const RESPONSE_EVENT = 'tab_wanderer:warehouse-shop-order-response';
    const MAX_SCOPES_TO_SCAN = 5000;
    const MAX_OBJECTS_TO_SCAN = 60000;
    const SCAN_TIME_BUDGET_MS = 80;
    const MAX_DEBUG_SAMPLES = 12;
    const API_CAPTURE_ARM_EVENT = 'tab_wanderer:warehouse-api-capture-arm';
    const API_CAPTURE_WINDOW_MS = 12000;
    const API_RESPONSE_MAX_TEXT_LENGTH = 2000000;
    const API_SHOP_ORDER_SNAPSHOT_TTL_MS = 15000;
    const WAREHOUSE_API_URL_PATTERN = /shop|order|assembly|barcode|product[_-]?item|warehouse|wh/i;
    const DEBUG_STORAGE_KEY = 'tab_wanderer_warehouse_bridge_debug_v1';

    function readStoredDebug() {
        try {
            const value = window.sessionStorage?.getItem?.(DEBUG_STORAGE_KEY);
            return value ? JSON.parse(value) : null;
        } catch {
            return null;
        }
    }

    function persistDebug() {
        try {
            const debug = window.__TAB_WANDERER_WAREHOUSE_BRIDGE_DEBUG__;
            if (debug) {
                window.sessionStorage?.setItem?.(DEBUG_STORAGE_KEY, JSON.stringify(debug));
            }
        } catch {}
    }

    const previousDebugRun = readStoredDebug();

    window.__TAB_WANDERER_WAREHOUSE_BRIDGE_DEBUG__ = {
        installedAt: new Date().toISOString(),
        lastScopeCount: 0,
        lastRootScopeFound: false,
        lastScannedObjects: 0,
        lastCandidateCount: 0,
        lastCandidateSamples: [],
        lastExpectedOrder: '',
        lastMatchedPath: '',
        lastError: '',
        lastResult: '',
        lastApiCaptureArmedUntil: 0,
        lastApiResponseCount: 0,
        lastApiCandidateUrl: '',
        lastApiMatchedUrl: '',
        lastApiMatchedPath: '',
        lastApiResult: '',
        lastApiError: '',
        fetchPatched: false,
        xhrPatched: false,
        lastApiEvents: [],
        previousRun: previousDebugRun ? {
            installedAt: previousDebugRun.installedAt || '',
            lastExpectedOrder: previousDebugRun.lastExpectedOrder || '',
            lastMatchedPath: previousDebugRun.lastMatchedPath || '',
            lastResult: previousDebugRun.lastResult || '',
            lastCandidateCount: Number(previousDebugRun.lastCandidateCount) || 0,
            lastApiCaptureArmedUntil: Number(previousDebugRun.lastApiCaptureArmedUntil) || 0,
            lastApiResponseCount: Number(previousDebugRun.lastApiResponseCount) || 0,
            lastApiCandidateUrl: previousDebugRun.lastApiCandidateUrl || '',
            lastApiMatchedUrl: previousDebugRun.lastApiMatchedUrl || '',
            lastApiMatchedPath: previousDebugRun.lastApiMatchedPath || '',
            lastApiResult: previousDebugRun.lastApiResult || '',
            lastApiError: previousDebugRun.lastApiError || '',
            fetchPatched: !!previousDebugRun.fetchPatched,
            xhrPatched: !!previousDebugRun.xhrPatched,
            lastApiEvents: Array.isArray(previousDebugRun.lastApiEvents) ? previousDebugRun.lastApiEvents.slice(-20) : []
        } : null
    };
    persistDebug();

    if (window.__TAB_WANDERER_WAREHOUSE_BRIDGE_INSTALLED__) {
        const node = document.getElementById(SCRIPT_ID);
        if (node) {
            node.dataset.installed = 'true';
        }
        return;
    }

    window.__TAB_WANDERER_WAREHOUSE_BRIDGE_INSTALLED__ = true;

    let warehouseApiCaptureArmedUntil = 0;
    let warehouseApiCaptureGeneration = 0;
    let lastApiShopOrderSnapshot = null;

    function getDebug() {
        return window.__TAB_WANDERER_WAREHOUSE_BRIDGE_DEBUG__;
    }

    function pushApiDebugEvent(event = {}) {
        const debug = getDebug();
        const events = Array.isArray(debug.lastApiEvents) ? debug.lastApiEvents : [];

        events.push({
            at: new Date().toISOString(),
            ...event
        });

        debug.lastApiEvents = events.slice(-20);
        persistDebug();
    }

    function normalizeText(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeId(value) {
        return String(value || '')
            .replace(/\s+/g, '')
            .trim();
    }

    function getExpectedOrderFromUrl() {
        try {
            const hash = String(window.location.hash || '');
            const hashOrderMatch = hash.match(/[?&]order=([^&]+)/);

            if (hashOrderMatch) {
                return decodeURIComponent(hashOrderMatch[1] || '').trim();
            }

            return new URL(window.location.href).searchParams.get('order') || '';
        } catch {
            return '';
        }
    }

    function isObject(value) {
        return !!value && typeof value === 'object';
    }

    function isDomLike(value) {
        return !!value && (
            value === window
            || value === document
            || value.nodeType
            || value.window === value
        );
    }

    function getOwnKeys(value) {
        if (!isObject(value) || isDomLike(value)) {
            return [];
        }

        try {
            return Object.keys(value);
        } catch {
            return [];
        }
    }

    function addDebugCandidate(path, value, reason) {
        const debug = getDebug();
        debug.lastCandidateCount += 1;

        if (debug.lastCandidateSamples.length >= MAX_DEBUG_SAMPLES) {
            return;
        }

        const keys = getOwnKeys(value).slice(0, 20);
        const sample = {
            path,
            reason,
            keys,
            id: normalizeText(value?.id || value?.number || value?.order_id || value?.orderId || value?.order_number || value?.orderNumber),
            hasAssembly: Array.isArray(value?.assembly),
            assemblyLength: Array.isArray(value?.assembly) ? value.assembly.length : null,
            hasNestedAssembly: hasNestedAssembly(value),
            hasProductItems: asArray(value?.product_items || value?.productItems).length > 0,
            productItemsLength: asArray(value?.product_items || value?.productItems).length || null,
            hasItems: Array.isArray(value?.items),
            itemsLength: Array.isArray(value?.items) ? value.items.length : null,
            hasShopOrderItems: Array.isArray(value?.shop_order_items),
            shopOrderItemsLength: Array.isArray(value?.shop_order_items) ? value.shop_order_items.length : null
        };

        debug.lastCandidateSamples.push(sample);
    }

    function valueMatchesExpectedOrder(value, expectedOrder) {
        if (!expectedOrder || !isObject(value)) {
            return true;
        }

        const expected = normalizeId(expectedOrder);
        const directValues = [
            value.number,
            value.order_number,
            value.orderNumber,
            value.id,
            value.order_id,
            value.orderId,
            value.barcode
        ].map(normalizeId).filter(Boolean);

        return directValues.includes(expected);
    }

    function firstValue(...values) {
        return values.find(value => value !== undefined && value !== null && value !== '') || '';
    }

    function normalizeNumber(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function asArray(value) {
        if (Array.isArray(value)) {
            return value;
        }

        if (!isObject(value) || isDomLike(value)) {
            return [];
        }

        try {
            return Object.values(value).filter(item => isObject(item));
        } catch {
            return [];
        }
    }

    function normalizeProduct(value = {}, fallback = {}) {
        const product = isObject(value) ? value : {};
        const fallbackProduct = isObject(fallback) ? fallback : {};

        return {
            id: normalizeId(firstValue(product.id, product.product_id, product.productId, fallbackProduct.id, fallbackProduct.product_id, fallbackProduct.productId)),
            title: normalizeText(firstValue(product.title, product.name, fallbackProduct.title, fallbackProduct.name))
        };
    }

    function normalizeOrderItemForBridge(item = {}) {
        const orderItem = isObject(item) ? item : {};

        return {
            id: normalizeId(firstValue(orderItem.id, orderItem.order_item_id, orderItem.orderItemId)),
            item_id: normalizeId(firstValue(orderItem.item_id, orderItem.itemId, orderItem.product_id, orderItem.productId)),
            title: normalizeText(firstValue(orderItem.title, orderItem.name)),
            quantity: normalizeNumber(orderItem.quantity),
            assembled_quantity: normalizeNumber(firstValue(orderItem.assembled_quantity, orderItem.assembledQuantity)),
            assemble_status: normalizeText(firstValue(orderItem.assemble_status, orderItem.assembleStatus, orderItem.status))
        };
    }

    function normalizeProductItemForBridge(productItem = {}, orderItem = {}) {
        const item = isObject(productItem) ? productItem : {};
        const normalizedOrderItem = normalizeOrderItemForBridge(orderItem);
        const product = normalizeProduct(item.product || {}, {
            id: firstValue(item.product_id, item.productId, normalizedOrderItem.item_id),
            title: normalizedOrderItem.title
        });

        return {
            id: normalizeId(firstValue(item.id, item.item_id, item.itemId)),
            barcode: normalizeId(firstValue(item.barcode, item.bar_code, item.code)),
            type: normalizeNumber(item.type),
            quantity: normalizeNumber(item.quantity),
            reserved_quantity: normalizeNumber(firstValue(item.reserved_quantity, item.reservedQuantity)),
            product_id: normalizeId(firstValue(item.product_id, item.productId, product.id, normalizedOrderItem.item_id)),
            product,
            state: isObject(item.state)
                ? {
                    id: normalizeId(item.state.id),
                    title: normalizeText(firstValue(item.state.title, item.state.name)),
                    type: normalizeNumber(item.state.type)
                }
                : null
        };
    }

    function normalizeAssemblyEntryForBridge(entry = {}, orderItem = {}) {
        const assemblyEntry = isObject(entry) ? entry : {};
        const sourceOrderItem = isObject(assemblyEntry.order_item || assemblyEntry.orderItem)
            ? (assemblyEntry.order_item || assemblyEntry.orderItem)
            : orderItem;

        return {
            id: normalizeId(firstValue(assemblyEntry.id, assemblyEntry.assembly_id, assemblyEntry.assemblyId)),
            quantity: normalizeNumber(firstValue(assemblyEntry.quantity, assemblyEntry.assembly_quantity, assemblyEntry.assemblyQuantity)),
            product_item: normalizeProductItemForBridge(
                firstValue(assemblyEntry.product_item, assemblyEntry.productItem, assemblyEntry.product_item_data, assemblyEntry.productItemData) || {},
                sourceOrderItem
            ),
            order_item: normalizeOrderItemForBridge(sourceOrderItem)
        };
    }

    function getProductItemCandidatesFromOrderItem(orderItem = {}) {
        if (!isObject(orderItem)) {
            return [];
        }

        const directProductItems = [
            orderItem.product_items,
            orderItem.productItems,
            orderItem.items
        ].flatMap(asArray);

        const nestedProductItems = asArray(orderItem.assembly)
            .concat(asArray(orderItem.assemblies))
            .flatMap(row => asArray(row?.product_items || row?.productItems));

        return directProductItems.concat(nestedProductItems);
    }

    function normalizeProductItemAssemblyEntryForBridge(productItem = {}, orderItem = {}) {
        const source = isObject(productItem) ? productItem : {};
        const sourceProductItem = isObject(source.product_item || source.productItem)
            ? (source.product_item || source.productItem)
            : source;
        const normalizedProductItem = normalizeProductItemForBridge(sourceProductItem, orderItem);
        const sourceOrderItem = isObject(source.order_item || source.orderItem)
            ? (source.order_item || source.orderItem)
            : orderItem;

        return {
            id: normalizeId(firstValue(source.id, source.assembly_id, source.assemblyId, normalizedProductItem.id)),
            quantity: normalizeNumber(firstValue(source.quantity, source.assembly_quantity, source.assemblyQuantity, 1)),
            product_item: normalizedProductItem,
            order_item: normalizeOrderItemForBridge(sourceOrderItem)
        };
    }

    function collectAssemblyEntriesFromOrderItems(items = []) {
        const result = [];

        if (!Array.isArray(items)) {
            return result;
        }

        items.forEach(orderItem => {
            if (!isObject(orderItem)) {
                return;
            }

            const assemblyRows = asArray(orderItem.assembly).length
                ? asArray(orderItem.assembly)
                : asArray(orderItem.assemblies);

            assemblyRows.forEach(row => {
                const normalized = normalizeAssemblyEntryForBridge(row, orderItem);

                if (normalized.product_item?.barcode || normalized.product_item?.product_id) {
                    result.push(normalized);
                }
            });

            if (assemblyRows.length) {
                return;
            }

            getProductItemCandidatesFromOrderItem(orderItem).forEach(productItem => {
                const normalized = normalizeProductItemAssemblyEntryForBridge(productItem, orderItem);

                if (normalized.product_item?.barcode || normalized.product_item?.product_id) {
                    result.push(normalized);
                }
            });
        });

        return result;
    }

    function createBridgeShopOrderSnapshot(shopOrder = {}, controller = null) {
        const sourceOrder = isObject(shopOrder) ? shopOrder : {};
        const sourceController = isObject(controller) ? controller : {};
        const sourceItems = Array.isArray(sourceOrder.items)
            ? sourceOrder.items
            : Array.isArray(sourceController.shop_order_items)
                ? sourceController.shop_order_items
                : [];
        const directAssembly = Array.isArray(sourceOrder.assembly)
            ? sourceOrder.assembly.map(row => normalizeAssemblyEntryForBridge(row))
            : [];
        const nestedAssembly = collectAssemblyEntriesFromOrderItems(sourceItems);
        const assembly = directAssembly.length ? directAssembly : nestedAssembly;

        return {
            id: normalizeText(firstValue(sourceOrder.number, sourceOrder.id, sourceOrder.order_id, sourceOrder.orderId, sourceOrder.order_number, sourceOrder.orderNumber)),
            internalId: normalizeId(firstValue(sourceOrder.id, sourceOrder.internalId)),
            number: normalizeText(firstValue(sourceOrder.number, sourceOrder.order_number, sourceOrder.orderNumber)),
            total_quantity: normalizeNumber(firstValue(sourceOrder.total_quantity, sourceOrder.totalQuantity)),
            assembled_quantity: normalizeNumber(firstValue(sourceOrder.assembled_quantity, sourceOrder.assembledQuantity)),
            items: sourceItems.map(normalizeOrderItemForBridge),
            assembly
        };
    }

    function hasNestedAssembly(value) {
        if (!Array.isArray(value?.items)) {
            return false;
        }

        return value.items.some(item => {
            if (Array.isArray(item?.assembly) && item.assembly.length > 0) {
                return true;
            }

            if (Array.isArray(item?.assemblies) && item.assemblies.length > 0) {
                return true;
            }

            return asArray(item?.product_items || item?.productItems).length > 0;
        });
    }

    function isShopOrderIdentity(value, expectedOrder = '') {
        if (!isObject(value)) {
            return false;
        }

        const hasItems = Array.isArray(value.items);
        const hasOrderIdentity = !!normalizeText(
            value.number
            || value.order_number
            || value.orderNumber
            || value.id
            || value.order_id
            || value.orderId
        );

        return (hasItems || hasOrderIdentity)
            && valueMatchesExpectedOrder(value, expectedOrder);
    }

    function findShopOrderSnapshotInController(value, expectedOrder = '', path = 'candidate') {
        if (!isObject(value)) {
            return null;
        }

        const directShopOrder = isObject(value.shopOrder) ? value.shopOrder : null;

        if (directShopOrder && isShopOrderIdentity(directShopOrder, expectedOrder)) {
            getDebug().lastMatchedPath = `${path}.shopOrder`;
            return createBridgeShopOrderSnapshot(directShopOrder, value);
        }

        if (isShopOrderIdentity(value, expectedOrder)) {
            getDebug().lastMatchedPath = path;
            return createBridgeShopOrderSnapshot(value, null);
        }

        return null;
    }

    function isShopOrder(value, expectedOrder = '') {
        if (!isObject(value)) {
            return false;
        }

        const hasAssembly = Array.isArray(value.assembly) || hasNestedAssembly(value);
        const hasItems = Array.isArray(value.items);
        const hasOrderIdentity = !!normalizeText(
            value.number
            || value.order_number
            || value.orderNumber
            || value.id
            || value.order_id
            || value.orderId
        );

        return hasAssembly
            && (hasItems || hasOrderIdentity)
            && valueMatchesExpectedOrder(value, expectedOrder);
    }

    function hasShopOrder(value, expectedOrder = '') {
        return isObject(value)
            && isShopOrder(value.shopOrder, expectedOrder);
    }

    function findShopOrderInCandidate(value, expectedOrder = '', path = 'candidate') {
        if (!isObject(value)) {
            return null;
        }

        const controllerSnapshot = findShopOrderSnapshotInController(value, expectedOrder, path);

        if (controllerSnapshot) {
            return controllerSnapshot;
        }

        if (isShopOrder(value, expectedOrder)) {
            getDebug().lastMatchedPath = path;
            return createBridgeShopOrderSnapshot(value, null);
        }

        if (hasShopOrder(value, expectedOrder)) {
            getDebug().lastMatchedPath = `${path}.shopOrder`;
            return createBridgeShopOrderSnapshot(value.shopOrder, value);
        }

        const likelyKeys = [
            'shopOrder',
            'shop_order',
            'shopOrderData',
            'shop_order_data',
            'currentShopOrder',
            'order',
            'currentOrder',
            'targetOrderData',
            'orderData',
            'ctrl',
            '$ctrl',
            'vm',
            'assemblyForm',
            'warehouseAssembly',
            'orderAssembly',
            'model',
            'data'
        ];

        for (const key of likelyKeys) {
            const child = value[key];

            if (!isObject(child)) {
                continue;
            }

            const childSnapshot = findShopOrderSnapshotInController(child, expectedOrder, `${path}.${key}`);

            if (childSnapshot) {
                return childSnapshot;
            }

            if (isShopOrder(child, expectedOrder)) {
                getDebug().lastMatchedPath = `${path}.${key}`;
                return createBridgeShopOrderSnapshot(child, value);
            }

            if (hasShopOrder(child, expectedOrder)) {
                getDebug().lastMatchedPath = `${path}.${key}.shopOrder`;
                return createBridgeShopOrderSnapshot(child.shopOrder, child);
            }
        }

        return null;
    }

    function addRoot(roots, seen, value, path) {
        if (isObject(value) && !isDomLike(value) && !seen.has(value)) {
            seen.add(value);
            roots.push({ value, path });
        }
    }

    function addScope(scopes, seenScopes, scope, path) {
        if (isObject(scope) && !seenScopes.has(scope)) {
            seenScopes.add(scope);
            scopes.push({ value: scope, path });
        }
    }

    function getAngularWrapped(node) {
        try {
            if (!window.angular || typeof window.angular.element !== 'function' || !node) {
                return null;
            }

            return window.angular.element(node);
        } catch {
            return null;
        }
    }

    function collectRootScopes(seenScopes) {
        const roots = [];
        const nodes = [document.body, document.documentElement].filter(Boolean);

        for (const node of nodes) {
            try {
                const injector = getAngularWrapped(node)?.injector?.();
                const rootScope = injector?.get?.('$rootScope');

                if (isObject(rootScope) && !seenScopes.has(rootScope)) {
                    roots.push({ value: rootScope, path: '$rootScope' });
                    getDebug().lastRootScopeFound = true;
                }
            } catch {}
        }

        return roots;
    }

    function createScanDeadline(budgetMs = SCAN_TIME_BUDGET_MS) {
        return getCurrentTime() + Math.max(10, Number(budgetMs) || SCAN_TIME_BUDGET_MS);
    }

    function isScanDeadlineExceeded(deadline) {
        return Number.isFinite(deadline) && getCurrentTime() > deadline;
    }

    function collectScopeTree(rootScope, scopes, seenScopes, deadline = createScanDeadline()) {
        const queue = [{ value: rootScope, path: '$rootScope' }];
        let queueIndex = 0;

        while (queueIndex < queue.length && scopes.length < MAX_SCOPES_TO_SCAN && !isScanDeadlineExceeded(deadline)) {
            const { value: scope, path } = queue[queueIndex++];

            if (!isObject(scope)) {
                continue;
            }

            addScope(scopes, seenScopes, scope, path);

            if (isObject(scope.$$childHead)) {
                queue.push({ value: scope.$$childHead, path: `${path}.$$childHead` });
            }

            if (isObject(scope.$$nextSibling)) {
                queue.push({ value: scope.$$nextSibling, path: `${path}.$$nextSibling` });
            }
        }
    }

    function collectAngularRoots(deadline = createScanDeadline()) {
        const roots = [];
        const seenRoots = new Set();
        const scopes = [];
        const seenScopes = new Set();
        const debug = getDebug();

        debug.lastRootScopeFound = false;
        debug.lastScopeCount = 0;
        debug.lastCandidateCount = 0;
        debug.lastCandidateSamples = [];
        debug.lastScannedObjects = 0;
        debug.lastMatchedPath = '';
        debug.lastResult = '';
        debug.lastError = '';

        if (!window.angular || typeof window.angular.element !== 'function') {
            return roots;
        }

        const rootScopeEntries = collectRootScopes(seenScopes);

        for (const entry of rootScopeEntries) {
            collectScopeTree(entry.value, scopes, seenScopes, deadline);
        }

        const selector = [
            '[ng-controller]',
            '[data-ng-controller]',
            '[ui-view]',
            '[ng-view]',
            '.ng-scope',
            '.ng-isolate-scope'
        ].join(',');

        const nodes = [
            document.documentElement,
            document.body,
            ...Array.from(document.querySelectorAll(selector) || []),
            ...Array.from(document.querySelectorAll('*') || []).slice(0, 1500)
        ].filter(Boolean);

        for (const node of nodes) {
            if (scopes.length >= MAX_SCOPES_TO_SCAN || isScanDeadlineExceeded(deadline)) {
                break;
            }

            try {
                const wrapped = getAngularWrapped(node);

                if (!wrapped) {
                    continue;
                }

                addScope(scopes, seenScopes, wrapped.scope?.(), 'dom.scope');
                addScope(scopes, seenScopes, wrapped.isolateScope?.(), 'dom.isolateScope');

                const data = typeof wrapped.data === 'function' ? wrapped.data() : null;
                addRoot(roots, seenRoots, data, 'dom.data');

                if (data && typeof data === 'object') {
                    for (const key of Object.keys(data)) {
                        addRoot(roots, seenRoots, data[key], `dom.data.${key}`);
                    }
                }

                addRoot(roots, seenRoots, wrapped.controller?.(), 'dom.controller');
                addRoot(roots, seenRoots, wrapped.controller?.('ngController'), 'dom.controller.ngController');
            } catch {}
        }

        for (const entry of scopes) {
            addRoot(roots, seenRoots, entry.value, entry.path);

            for (const key of ['ctrl', '$ctrl', 'vm', 'assemblyForm', 'warehouseAssembly', 'orderAssembly']) {
                addRoot(roots, seenRoots, entry.value?.[key], `${entry.path}.${key}`);
            }
        }

        debug.lastScopeCount = scopes.length;
        return roots;
    }

    function getPriorityKeys(current) {
        const keys = getOwnKeys(current);
        const exactPriority = [
            'shopOrder',
            'shop_order',
            'shopOrderData',
            'shop_order_data',
            'currentShopOrder',
            'order',
            'currentOrder',
            'targetOrderData',
            'orderData',
            'ctrl',
            '$ctrl',
            'vm',
            'assemblyForm',
            'warehouseAssembly',
            'orderAssembly',
            'items',
            'assembly',
            '$parent',
            '$$childHead',
            '$$childTail',
            '$$nextSibling',
            '$$prevSibling'
        ];
        const result = [];
        const seen = new Set();

        function push(key) {
            if (!seen.has(key) && (key in current)) {
                seen.add(key);
                result.push(key);
            }
        }

        exactPriority.forEach(push);

        keys
            .filter(key => !seen.has(key))
            .filter(key => /shop|order|assembly|ctrl|item|barcode|product/i.test(key))
            .forEach(push);

        keys
            .filter(key => !seen.has(key))
            .forEach(push);

        return result;
    }

    function shouldSkipKey(key) {
        if (!key) {
            return true;
        }

        if (key.startsWith('$$') && !['$$childHead', '$$childTail', '$$nextSibling', '$$prevSibling'].includes(key)) {
            return true;
        }

        return [
            '$injector',
            '$$watchers',
            '$$listeners',
            '$$listenerCount',
            '$$asyncQueue',
            '$$postDigestQueue',
            '$$applyAsyncQueue'
        ].includes(key);
    }

    function scanObjectGraph(rootEntries, expectedOrder, deadline = createScanDeadline()) {
        const visited = new Set();
        const queue = rootEntries.filter(entry => isObject(entry.value));
        const debug = getDebug();
        let scanned = 0;
        let queueIndex = 0;

        while (queueIndex < queue.length && scanned < MAX_OBJECTS_TO_SCAN && !isScanDeadlineExceeded(deadline)) {
            const entry = queue[queueIndex++];
            const current = entry.value;
            const path = entry.path || 'root';

            if (!isObject(current) || isDomLike(current) || visited.has(current)) {
                continue;
            }

            visited.add(current);
            scanned += 1;
            debug.lastScannedObjects = scanned;

            const directShopOrder = findShopOrderInCandidate(current, expectedOrder, path);

            if (directShopOrder) {
                debug.lastResult = 'shopOrder found';
                return directShopOrder;
            }

            const isCandidate = Array.isArray(current.assembly)
                || Array.isArray(current.items)
                || isObject(current.shopOrder)
                || valueMatchesExpectedOrder(current, expectedOrder) && /order|shop|assembly/i.test(getOwnKeys(current).join(' '));

            if (isCandidate) {
                addDebugCandidate(path, current, 'candidate');
            }

            for (const key of getPriorityKeys(current)) {
                if (shouldSkipKey(key)) {
                    continue;
                }

                let value;

                try {
                    value = current[key];
                } catch {
                    continue;
                }

                if (isObject(value) && !visited.has(value) && !isDomLike(value)) {
                    queue.push({ value, path: `${path}.${key}` });
                }
            }
        }

        debug.lastResult = isScanDeadlineExceeded(deadline)
            ? 'shopOrder not found: scan time budget reached'
            : scanned >= MAX_OBJECTS_TO_SCAN
                ? 'shopOrder not found: object scan limit reached'
                : 'shopOrder not found';
        return null;
    }


    function getCurrentTime() {
        return typeof Date?.now === 'function' ? Date.now() : new Date().getTime();
    }

    function armWarehouseApiCapture(durationMs = API_CAPTURE_WINDOW_MS) {
        warehouseApiCaptureGeneration += 1;
        warehouseApiCaptureArmedUntil = getCurrentTime() + Math.max(1000, Number(durationMs) || API_CAPTURE_WINDOW_MS);
        lastApiShopOrderSnapshot = null;
        getDebug().lastApiCaptureArmedUntil = warehouseApiCaptureArmedUntil;
        getDebug().lastApiResult = 'armed';
        pushApiDebugEvent({
            type: 'capture-armed',
            durationMs: Math.max(1000, Number(durationMs) || API_CAPTURE_WINDOW_MS),
            generation: warehouseApiCaptureGeneration
        });
        persistDebug();
        return warehouseApiCaptureArmedUntil;
    }

    function isWarehouseApiCaptureArmed() {
        return getCurrentTime() <= warehouseApiCaptureArmedUntil;
    }

    function getRequestUrl(input) {
        try {
            if (typeof input === 'string') {
                return input;
            }

            if (input?.url) {
                return String(input.url);
            }
        } catch {}

        return '';
    }

    function isWarehouseApiUrlCandidate(url = '') {
        return !!url && WAREHOUSE_API_URL_PATTERN.test(String(url));
    }

    function shouldInspectWarehouseApiResponse(url = '') {
        return isWarehouseApiCaptureArmed() && isWarehouseApiUrlCandidate(url);
    }

    function isSuccessfulWarehouseApiStatus(value) {
        if (value === undefined || value === null || value === '') {
            return true;
        }

        const status = Number(value);
        return Number.isFinite(status) && status >= 200 && status < 300;
    }

    function parseJsonPayload(text) {
        if (!text || typeof text !== 'string' || text.length > API_RESPONSE_MAX_TEXT_LENGTH) {
            return null;
        }

        const trimmed = text.trim();

        if (!trimmed || !/^[{[]/.test(trimmed)) {
            return null;
        }

        try {
            return JSON.parse(trimmed);
        } catch {
            return null;
        }
    }

    function storeApiShopOrderSnapshot(shopOrder, url = '') {
        if (!shopOrder) {
            return null;
        }

        lastApiShopOrderSnapshot = {
            capturedAt: getCurrentTime(),
            url: String(url || ''),
            shopOrder
        };

        return lastApiShopOrderSnapshot;
    }

    function getStoredApiShopOrderSnapshot() {
        if (!lastApiShopOrderSnapshot?.shopOrder) {
            return null;
        }

        if (getCurrentTime() - Number(lastApiShopOrderSnapshot.capturedAt) > API_SHOP_ORDER_SNAPSHOT_TTL_MS) {
            lastApiShopOrderSnapshot = null;
            return null;
        }

        const expectedOrder = getExpectedOrderFromUrl();

        if (!valueMatchesExpectedOrder(lastApiShopOrderSnapshot.shopOrder, expectedOrder)) {
            return null;
        }

        return lastApiShopOrderSnapshot.shopOrder;
    }

    function hasBridgeShopOrderBarcodeSnapshot(shopOrder = {}) {
        return asArray(shopOrder?.assembly).some(entry => {
            const productItem = entry?.product_item || entry?.productItem || {};
            const barcode = normalizeId(productItem.barcode || productItem.bar_code || productItem.code);
            const productId = normalizeId(productItem.product_id || productItem.productId || productItem.product?.id);

            return !!barcode && !!productId;
        });
    }

    function dispatchShopOrderFromApiResponse(shopOrder, url = '') {
        const debug = getDebug();
        debug.lastApiMatchedUrl = String(url || '');
        debug.lastApiMatchedPath = debug.lastMatchedPath || 'api.response';
        storeApiShopOrderSnapshot(shopOrder, url);

        if (!hasBridgeShopOrderBarcodeSnapshot(shopOrder)) {
            debug.lastApiResult = 'shopOrder found in API response without barcode snapshot';
            pushApiDebugEvent({
                type: 'api-shop-order-no-barcodes',
                url: String(url || ''),
                assemblyLength: asArray(shopOrder?.assembly).length
            });
            persistDebug();
            return;
        }

        debug.lastApiResult = 'shopOrder found in API response';
        persistDebug();

        window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
            detail: {
                ok: true,
                source: 'warehouse-api-response',
                shopOrder,
                debug
            }
        }));
    }

    function findShopOrderInApiPayload(payload, url = '') {
        if (!isObject(payload)) {
            return null;
        }

        const expectedOrder = getExpectedOrderFromUrl();
        const debug = getDebug();
        debug.lastExpectedOrder = expectedOrder;
        debug.lastApiCandidateUrl = String(url || '');
        debug.lastMatchedPath = '';
        debug.lastApiMatchedPath = '';

        return scanObjectGraph([{ value: payload, path: 'api.response' }], expectedOrder, createScanDeadline());
    }

    function inspectWarehouseApiPayload(payload, url = '') {
        try {
            const shopOrder = findShopOrderInApiPayload(payload, url);

            if (!shopOrder) {
                getDebug().lastApiResult = 'API response inspected: shopOrder not found';
                pushApiDebugEvent({ type: 'payload-inspected', url: String(url || ''), result: 'shopOrder-not-found' });
                return false;
            }

            pushApiDebugEvent({ type: 'payload-inspected', url: String(url || ''), result: 'shopOrder-found', matchedPath: getDebug().lastMatchedPath || '' });
            dispatchShopOrderFromApiResponse(shopOrder, url);
            return true;
        } catch (error) {
            getDebug().lastApiError = String(error?.message || error);
            return false;
        }
    }

    async function inspectFetchResponseForShopOrder(response, url = '', captureGeneration = 0) {
        const responseUrl = String(url || response?.url || '');

        if (!response) {
            return false;
        }

        if (!captureGeneration
            || captureGeneration !== warehouseApiCaptureGeneration
            || !isWarehouseApiUrlCandidate(responseUrl)) {
            if (isWarehouseApiCaptureArmed()) {
                pushApiDebugEvent({ type: 'fetch-skip', url: responseUrl, reason: 'request-not-captured' });
            }
            return false;
        }

        const debug = getDebug();
        debug.lastApiResponseCount += 1;
        debug.lastApiCandidateUrl = responseUrl;
        pushApiDebugEvent({ type: 'fetch-inspect', url: responseUrl, status: response.status || 0 });

        if (!isSuccessfulWarehouseApiStatus(response.status)) {
            debug.lastApiResult = 'API response skipped: unsuccessful status';
            pushApiDebugEvent({
                type: 'fetch-skip',
                url: responseUrl,
                reason: 'unsuccessful-status',
                status: Number(response.status) || 0
            });
            return false;
        }

        try {
            const clone = response.clone?.();
            const text = await clone?.text?.();
            const payload = parseJsonPayload(text);

            if (!payload) {
                debug.lastApiResult = 'API response skipped: non-json or too large';
                pushApiDebugEvent({ type: 'fetch-skip', url: responseUrl, reason: 'non-json-or-too-large' });
                return false;
            }

            return inspectWarehouseApiPayload(payload, responseUrl);
        } catch (error) {
            debug.lastApiError = String(error?.message || error);
            return false;
        }
    }

    function inspectXhrResponseForShopOrder(xhr, url = '', captureGeneration = 0) {
        const responseUrl = String(url || xhr?.responseURL || '');

        if (!xhr) {
            return false;
        }

        if (!captureGeneration
            || captureGeneration !== warehouseApiCaptureGeneration
            || !isWarehouseApiUrlCandidate(responseUrl)) {
            if (isWarehouseApiCaptureArmed()) {
                pushApiDebugEvent({ type: 'xhr-skip', url: responseUrl, reason: 'request-not-captured' });
            }
            return false;
        }

        const debug = getDebug();
        debug.lastApiResponseCount += 1;
        debug.lastApiCandidateUrl = responseUrl;
        pushApiDebugEvent({ type: 'xhr-inspect', url: responseUrl, status: xhr.status || 0 });

        if (!isSuccessfulWarehouseApiStatus(xhr.status)) {
            debug.lastApiResult = 'XHR response skipped: unsuccessful status';
            pushApiDebugEvent({
                type: 'xhr-skip',
                url: responseUrl,
                reason: 'unsuccessful-status',
                status: Number(xhr.status) || 0
            });
            return false;
        }

        try {
            const payload = typeof xhr.response === 'object' && xhr.response !== null
                ? xhr.response
                : parseJsonPayload(String(xhr.responseText || ''));

            if (!payload) {
                debug.lastApiResult = 'XHR response skipped: non-json or too large';
                pushApiDebugEvent({ type: 'xhr-skip', url: responseUrl, reason: 'non-json-or-too-large' });
                return false;
            }

            return inspectWarehouseApiPayload(payload, responseUrl);
        } catch (error) {
            debug.lastApiError = String(error?.message || error);
            return false;
        }
    }

    function patchWarehouseFetchCapture() {
        if (typeof window.fetch !== 'function' || window.fetch.__tabWandererWarehousePatched) {
            return false;
        }

        const originalFetch = window.fetch;

        function patchedFetch(input, init) {
            const url = getRequestUrl(input);
            const captureGeneration = shouldInspectWarehouseApiResponse(url)
                ? warehouseApiCaptureGeneration
                : 0;

            return originalFetch.apply(this, arguments)
                .then(response => {
                    inspectFetchResponseForShopOrder(
                        response,
                        url || response?.url || '',
                        captureGeneration
                    );
                    return response;
                });
        }

        patchedFetch.__tabWandererWarehousePatched = true;
        patchedFetch.__tabWandererOriginalFetch = originalFetch;
        window.fetch = patchedFetch;
        getDebug().fetchPatched = true;
        pushApiDebugEvent({ type: 'fetch-patched' });
        return true;
    }

    function patchWarehouseXhrCapture() {
        if (typeof window.XMLHttpRequest !== 'function') {
            return false;
        }

        const proto = window.XMLHttpRequest.prototype;

        if (proto.__tabWandererWarehousePatched) {
            return false;
        }

        const originalOpen = proto.open;
        const originalSend = proto.send;

        proto.open = function patchedOpen(method, url) {
            this.__tabWandererWarehouseUrl = String(url || '');
            return originalOpen.apply(this, arguments);
        };

        proto.send = function patchedSend() {
            const requestUrl = this.__tabWandererWarehouseUrl || this.responseURL || '';
            const captureGeneration = shouldInspectWarehouseApiResponse(requestUrl)
                ? warehouseApiCaptureGeneration
                : 0;

            try {
                this.addEventListener?.('loadend', () => {
                    inspectXhrResponseForShopOrder(
                        this,
                        this.__tabWandererWarehouseUrl || this.responseURL || '',
                        captureGeneration
                    );
                });
            } catch {}

            return originalSend.apply(this, arguments);
        };

        proto.__tabWandererWarehousePatched = true;
        getDebug().xhrPatched = true;
        pushApiDebugEvent({ type: 'xhr-patched' });
        return true;
    }


    function getElementText(element) {
        return normalizeText(element?.innerText || element?.textContent || '');
    }

    function getElementNodes(selector) {
        try {
            return Array.from(document.querySelectorAll(selector) || []);
        } catch {
            return [];
        }
    }

    function extractWarehouseDomProductId(text = '') {
        const match = normalizeText(text).match(/(?:^|\s)ID\s*:\s*(\d{5,})\b/i);
        return normalizeId(match?.[1]);
    }

    function extractWarehouseDomProductTitle(text = '', productId = '') {
        const normalized = normalizeText(text);
        const expectedProductId = normalizeId(productId);
        const beforeId = normalized.split(/\bID\s*:\s*\d{5,}\b/i)[0] || '';
        const title = normalizeText(beforeId)
            .replace(/^Заказ\s*№?\s*\S+\s*/i, '')
            .trim();

        if (title) {
            return title;
        }

        return normalizeText(normalized
            .replace(new RegExp(`\\bID\\s*:\\s*${expectedProductId}\\b`, 'i'), '')
            .split(/Собрано\s+\d+\s*\/\s*\d+/i)[0] || '');
    }

    function findWarehouseDomProductCards() {
        const elements = getElementNodes('div, section, article, li, tr, tbody, [class*="panel"], [class*="item"], [class*="product"]');
        const productCards = [];
        const usedProductIds = new Set();

        elements
            .map(element => ({ element, text: getElementText(element) }))
            .filter(entry => /\bID\s*:\s*\d{5,}\b/i.test(entry.text))
            .filter(entry => /Собрано\s+\d+\s*\/\s*\d+/i.test(entry.text) || /штрихкод|barcode|\b\d{5,14}\b/i.test(entry.text))
            .sort((a, b) => a.text.length - b.text.length)
            .forEach(entry => {
                const productId = extractWarehouseDomProductId(entry.text);

                if (!productId || usedProductIds.has(productId)) {
                    return;
                }

                const nestedProductIds = Array.from(entry.element.querySelectorAll('*') || [])
                    .map(child => extractWarehouseDomProductId(getElementText(child)))
                    .filter(Boolean);
                const uniqueNestedProductIds = Array.from(new Set(nestedProductIds));

                if (uniqueNestedProductIds.length > 1) {
                    return;
                }

                productCards.push({
                    element: entry.element,
                    productId,
                    title: extractWarehouseDomProductTitle(entry.text, productId)
                });
                usedProductIds.add(productId);
            });

        return productCards;
    }

    function collectWarehouseDomBarcodeCandidates(card, productId = '') {
        const expectedProductId = normalizeId(productId);
        const candidates = [];
        const seen = new Set();

        function push(barcode, element) {
            const normalizedBarcode = normalizeId(barcode);

            if (!normalizedBarcode
                || normalizedBarcode === expectedProductId
                || normalizedBarcode.length < 5
                || normalizedBarcode.length > 14
                || seen.has(normalizedBarcode)) {
                return;
            }

            const text = getElementText(element);

            if (/\bID\s*:/i.test(text) || /Собрано\s+\d+\s*\/\s*\d+/i.test(text)) {
                return;
            }

            seen.add(normalizedBarcode);
            candidates.push(normalizedBarcode);
        }

        getElementNodesFrom(card.element, '*').forEach(element => {
            const text = getElementText(element);

            if (/^\D{0,3}\d{5,14}\D{0,3}$/.test(text)) {
                const match = text.match(/\d{5,14}/);
                push(match?.[0], element);
            }
        });

        return candidates;
    }

    function getElementNodesFrom(root, selector) {
        try {
            return Array.from(root?.querySelectorAll?.(selector) || []);
        } catch {
            return [];
        }
    }

    function collectWarehouseProductMetaFromShopOrder(shopOrder = {}) {
        const result = {};

        function merge(productId, patch = {}) {
            const normalizedProductId = normalizeId(productId);

            if (!normalizedProductId) {
                return;
            }

            result[normalizedProductId] = {
                ...(result[normalizedProductId] || {}),
                ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined && value !== null && value !== ''))
            };
        }

        asArray(shopOrder.items).forEach(item => {
            const productId = normalizeId(firstValue(item.item_id, item.itemId, item.product_id, item.productId));
            merge(productId, {
                orderItem: normalizeOrderItemForBridge(item),
                title: normalizeText(firstValue(item.title, item.name))
            });
        });

        asArray(shopOrder.assembly).forEach(entry => {
            const normalized = normalizeAssemblyEntryForBridge(entry);
            const productItem = normalized.product_item || {};
            const productId = normalizeId(productItem.product_id || productItem.product?.id);
            merge(productId, {
                productItem,
                orderItem: normalized.order_item,
                title: normalizeText(productItem.product?.title || normalized.order_item?.title)
            });
        });

        return result;
    }

    function createWarehouseDomAssemblyEntry(card, barcode, meta = {}) {
        const productId = normalizeId(card.productId);
        const productItem = meta.productItem || {};
        const orderItem = meta.orderItem || {};
        const productTitle = normalizeText(card.title || meta.title || productItem.product?.title || orderItem.title);

        return {
            id: normalizeId(`${productId}-${barcode}`),
            quantity: 1,
            product_item: {
                id: normalizeId(productItem.id),
                barcode: normalizeId(barcode),
                type: normalizeNumber(productItem.type ?? 0),
                quantity: normalizeNumber(productItem.quantity ?? 1),
                reserved_quantity: normalizeNumber(productItem.reserved_quantity ?? productItem.reservedQuantity ?? 1),
                product_id: productId,
                product: {
                    id: productId,
                    title: productTitle
                },
                state: productItem.state || null
            },
            order_item: {
                id: normalizeId(orderItem.id),
                item_id: productId,
                title: productTitle,
                quantity: normalizeNumber(orderItem.quantity),
                assembled_quantity: normalizeNumber(orderItem.assembled_quantity ?? orderItem.assembledQuantity),
                assemble_status: normalizeText(orderItem.assemble_status || orderItem.assembleStatus)
            }
        };
    }

    function findShopOrderFromVisibleDom(angularShopOrder = null) {
        const cards = findWarehouseDomProductCards();

        if (!cards.length) {
            return null;
        }

        const productMeta = collectWarehouseProductMetaFromShopOrder(angularShopOrder || {});
        const assembly = [];

        cards.forEach(card => {
            const barcodes = collectWarehouseDomBarcodeCandidates(card, card.productId);
            const meta = productMeta[card.productId] || {};

            barcodes.forEach(barcode => {
                assembly.push(createWarehouseDomAssemblyEntry(card, barcode, meta));
            });
        });

        if (!assembly.length) {
            return null;
        }

        const debug = getDebug();
        debug.lastMatchedPath = 'dom.visible.product-cards';
        debug.lastResult = 'visible DOM barcode snapshot found';
        debug.lastCandidateCount = assembly.length;
        persistDebug();

        return {
            id: normalizeText(firstValue(angularShopOrder?.id, angularShopOrder?.number, getExpectedOrderFromUrl())),
            internalId: normalizeId(angularShopOrder?.internalId),
            number: normalizeText(firstValue(angularShopOrder?.number, getExpectedOrderFromUrl())),
            total_quantity: normalizeNumber(angularShopOrder?.total_quantity),
            assembled_quantity: normalizeNumber(angularShopOrder?.assembled_quantity),
            items: Array.isArray(angularShopOrder?.items) ? angularShopOrder.items : [],
            assembly
        };
    }

    function findShopOrderFromAngular() {
        const expectedOrder = getExpectedOrderFromUrl();
        const debug = getDebug();
        debug.lastExpectedOrder = expectedOrder;

        const deadline = createScanDeadline();
        return scanObjectGraph(collectAngularRoots(deadline), expectedOrder, deadline);
    }

    window.addEventListener(API_CAPTURE_ARM_EVENT, event => {
        armWarehouseApiCapture(event?.detail?.durationMs || API_CAPTURE_WINDOW_MS);
    });

    patchWarehouseFetchCapture();
    patchWarehouseXhrCapture();

    window.addEventListener(REQUEST_EVENT, () => {
        try {
            const storedApiShopOrder = getStoredApiShopOrderSnapshot();
            const apiShopOrder = hasBridgeShopOrderBarcodeSnapshot(storedApiShopOrder) ? storedApiShopOrder : null;
            const visibleDomShopOrder = apiShopOrder ? null : findShopOrderFromVisibleDom(null);
            const angularShopOrder = apiShopOrder || visibleDomShopOrder ? null : findShopOrderFromAngular();
            const domShopOrder = visibleDomShopOrder || (angularShopOrder ? findShopOrderFromVisibleDom(angularShopOrder) : null);
            const shopOrder = apiShopOrder || domShopOrder || angularShopOrder || storedApiShopOrder;
            const source = apiShopOrder
                ? 'warehouse-api-response'
                : domShopOrder
                    ? 'warehouse-dom-visible'
                    : angularShopOrder
                        ? 'angular-snapshot'
                        : 'warehouse-api-response-empty';

            if (apiShopOrder) {
                const debug = getDebug();
                debug.lastMatchedPath = debug.lastMatchedPath || 'api.response.shop_order';
                debug.lastResult = 'using stored API shopOrder snapshot';
                persistDebug();
            } else if (storedApiShopOrder) {
                const debug = getDebug();
                debug.lastMatchedPath = debug.lastMatchedPath || 'api.response.shop_order';
                debug.lastResult = domShopOrder
                    ? 'stored API shopOrder had no barcodes; using visible DOM fallback'
                    : angularShopOrder
                        ? 'stored API shopOrder had no barcodes; using Angular fallback'
                        : 'stored API shopOrder had no barcodes';
                persistDebug();
            }

            window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
                detail: shopOrder
                    ? { ok: true, shopOrder, source, debug: getDebug() }
                    : { ok: false, error: 'warehouse shopOrder not found', debug: getDebug() }
            }));
        } catch (error) {
            getDebug().lastError = String(error && error.message ? error.message : error);
            window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
                detail: {
                    ok: false,
                    error: getDebug().lastError,
                    debug: getDebug()
                }
            }));
        }
    });

    const node = document.getElementById(SCRIPT_ID);

    if (node) {
        node.dataset.installed = 'true';
    }
})();
