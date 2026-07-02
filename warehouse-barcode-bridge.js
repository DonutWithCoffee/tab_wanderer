(() => {
    const SCRIPT_ID = 'tab-wanderer-warehouse-barcode-bridge';
    const REQUEST_EVENT = 'tab_wanderer:warehouse-shop-order-request';
    const RESPONSE_EVENT = 'tab_wanderer:warehouse-shop-order-response';
    const MAX_SCOPES_TO_SCAN = 5000;
    const MAX_OBJECTS_TO_SCAN = 60000;
    const MAX_DEBUG_SAMPLES = 12;

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
        lastResult: ''
    };

    if (window.__TAB_WANDERER_WAREHOUSE_BRIDGE_INSTALLED__) {
        const node = document.getElementById(SCRIPT_ID);
        if (node) {
            node.dataset.installed = 'true';
        }
        return;
    }

    window.__TAB_WANDERER_WAREHOUSE_BRIDGE_INSTALLED__ = true;

    function getDebug() {
        return window.__TAB_WANDERER_WAREHOUSE_BRIDGE_DEBUG__;
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

    function collectScopeTree(rootScope, scopes, seenScopes) {
        const queue = [{ value: rootScope, path: '$rootScope' }];

        while (queue.length && scopes.length < MAX_SCOPES_TO_SCAN) {
            const { value: scope, path } = queue.shift();

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

    function collectAngularRoots() {
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
            collectScopeTree(entry.value, scopes, seenScopes);
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
            if (scopes.length >= MAX_SCOPES_TO_SCAN) {
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

    function scanObjectGraph(rootEntries, expectedOrder) {
        const visited = new Set();
        const queue = rootEntries.filter(entry => isObject(entry.value));
        const debug = getDebug();
        let scanned = 0;

        while (queue.length && scanned < MAX_OBJECTS_TO_SCAN) {
            const entry = queue.shift();
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

        debug.lastResult = scanned >= MAX_OBJECTS_TO_SCAN
            ? 'shopOrder not found: object scan limit reached'
            : 'shopOrder not found';
        return null;
    }

    function findShopOrderFromAngular() {
        const expectedOrder = getExpectedOrderFromUrl();
        const debug = getDebug();
        debug.lastExpectedOrder = expectedOrder;

        return scanObjectGraph(collectAngularRoots(), expectedOrder);
    }

    window.addEventListener(REQUEST_EVENT, () => {
        try {
            const shopOrder = findShopOrderFromAngular();

            window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
                detail: shopOrder
                    ? { ok: true, shopOrder, debug: getDebug() }
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
