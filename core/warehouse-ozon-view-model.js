// Pure warehouse/Ozon view-model and result helpers.
// Loaded before content.js on warehouse pages and in content tests.

function formatWarehouseBarcodePreviewCount(value) {
    const number = Number(value);

    return Number.isFinite(number) && number >= 0 ? String(number) : '0';
}

function normalizeWarehouseOzonWriteMethod(value) {
    const method = normalizeWarehouseBridgeText(value).toLowerCase();

    if (method === 'api') {
        return 'API';
    }

    if (method === 'ui-fallback') {
        return 'UI fallback';
    }

    if (method === 'api-ui-fallback') {
        return 'API + UI fallback';
    }

    if (method === 'ui') {
        return 'UI';
    }

    return '';
}

function getWarehouseOzonWriteMethodFromDetails(details = null) {
    return normalizeWarehouseOzonWriteMethod(
        details?.writeMethod
        || details?.api?.details?.writeMethod
        || details?.api?.writeMethod
        || ''
    );
}

function getWarehouseOzonFallbackReasonFromDetails(details = null) {
    return normalizeWarehouseBridgeText(
        details?.fallbackReason
        || details?.api?.fallbackReason
        || details?.api?.error
        || ''
    );
}

function getWarehouseOzonVerifyUnconfirmedFromDetails(details = null) {
    return details?.verifyUnconfirmed === true
        || details?.api?.details?.verifyUnconfirmed === true
        || details?.uiFallback?.details?.verifyUnconfirmed === true;
}

function shouldShowWarehouseOzonApplyFallbackReason(product = {}) {
    const missingCount = Number(product.ozonApplyMissingCount) || 0;
    const verifiedCount = Number(product.ozonApplyVerifiedCount) || 0;
    const expectedCount = Number(product.eligibleCount) || 0;

    return missingCount > 0 || verifiedCount <= 0 || (expectedCount > 0 && verifiedCount < expectedCount);
}

function createWarehouseOzonApplyProductText(product = {}) {
    const applyPrefix = 'Ozon';
    const fallbackSuffix = product.ozonApplyFallbackReason && shouldShowWarehouseOzonApplyFallbackReason(product)
        ? `, fallback: ${product.ozonApplyFallbackReason}`
        : '';

    if (product.ozonApplyStatus === 'ready') {
        if (product.ozonApplyVerifyUnconfirmed) {
            return `${applyPrefix}: запись отправлена, проверка не подтвердила ${product.ozonApplyVerifiedCount}/${product.eligibleCount}`;
        }

        if (product.ozonApplyMissingCount > 0) {
            return `${applyPrefix}: проверено ${product.ozonApplyVerifiedCount}/${product.eligibleCount}, не найдено ${product.ozonApplyMissingCount}${fallbackSuffix}`;
        }

        if (product.ozonApplyVerifiedCount > 0) {
            return `${applyPrefix}: проверено ${product.ozonApplyVerifiedCount}/${product.eligibleCount}${fallbackSuffix}`;
        }

        return `${applyPrefix}: добавлено ${product.ozonApplyAddedCount}${fallbackSuffix}`;
    }

    if (product.ozonApplyStatus === 'loading') {
        return 'Ozon: добавляем...';
    }

    return `Ozon: ${product.ozonApplyError || 'ошибка записи'}`;
}

function getWarehouseBarcodePreviewOrderId(preview = {}) {
    return normalizeWarehouseBridgeText(
        preview?.shopOrder?.id
        || preview?.shopOrder?.number
        || preview?.extraction?.orderId
        || ''
    );
}

function getWarehouseOzonResolvePlanByProductId(resolvePreview = lastWarehouseOzonResolvePreview) {
    const plans = resolvePreview?.plan?.productPlans;

    if (!Array.isArray(plans)) {
        return {};
    }

    return plans.reduce((map, plan) => {
        const productId = normalizeWarehouseBridgeId(plan?.productId);

        if (productId) {
            map[productId] = plan;
        }

        return map;
    }, {});
}

function getWarehouseOzonApplyResultsByProductId(applyResult = lastWarehouseOzonUiApply) {
    const results = Array.isArray(applyResult?.productResults) && applyResult.productResults.length
        ? applyResult.productResults
        : applyResult?.productId
            ? [applyResult]
            : [];

    return results.reduce((map, result) => {
        const productId = normalizeWarehouseBridgeId(result?.productId);

        if (productId) {
            map[productId] = result;
        }

        return map;
    }, {});
}


function getWarehouseBarcodePreviewEntryBarcode(entry = {}) {
    return normalizeWarehouseBridgeId(entry?.barcode || entry?.bar_code || entry?.code || entry);
}

function createWarehouseBarcodePreviewBarcodeList(barcodes = []) {
    return Array.from(new Set(
        (Array.isArray(barcodes) ? barcodes : [])
            .map(getWarehouseBarcodePreviewEntryBarcode)
            .filter(Boolean)
    ));
}

function createWarehouseBarcodePreviewProductRows(productsById = {}, resolvePreview = lastWarehouseOzonResolvePreview) {
    const ozonPlansByProductId = getWarehouseOzonResolvePlanByProductId(resolvePreview);
    const applyResultsByProductId = getWarehouseOzonApplyResultsByProductId(lastWarehouseOzonUiApply);

    return Object.values(productsById || {})
        .filter(group => group && group.productId && group.productId !== '__unknown__')
        .map(group => {
            const productId = normalizeWarehouseBridgeId(group.productId);
            const ozonPlan = ozonPlansByProductId[productId] || null;
            const applyResult = applyResultsByProductId[productId] || null;

            return {
                productId,
                productTitle: normalizeWarehouseBridgeText(group.productTitle),
                barcodes: createWarehouseBarcodePreviewBarcodeList(group.eligibleBarcodes),
                skippedBarcodes: createWarehouseBarcodePreviewBarcodeList(group.skippedBarcodes),
                eligibleCount: Array.isArray(group.eligibleBarcodes) ? group.eligibleBarcodes.length : 0,
                skippedCount: Array.isArray(group.skippedBarcodes) ? group.skippedBarcodes.length : 0,
                ozonStatus: ozonPlan?.status || '',
                ozonReason: ozonPlan?.reason || '',
                ozonSku: normalizeWarehouseBridgeId(ozonPlan?.ozonSku),
                ozonToAddCount: Array.isArray(ozonPlan?.toAdd) ? ozonPlan.toAdd.length : 0,
                ozonAlreadyExistsCount: Array.isArray(ozonPlan?.alreadyExists) ? ozonPlan.alreadyExists.length : 0,
                ozonExistingCount: Array.isArray(ozonPlan?.existingBarcodes) ? ozonPlan.existingBarcodes.length : 0,
                ozonApplyStatus: applyResult ? lastWarehouseOzonUiApply?.status || '' : '',
                ozonApplyError: applyResult ? applyResult.error || '' : '',
                ozonApplyAddedCount: applyResult ? Number(applyResult.addedCount) || 0 : 0,
                ...(applyResult ? {
                    ozonApplyVerifiedCount: Number(applyResult.verifiedCount) || 0,
                    ozonApplyMissingCount: Number(applyResult.missingCount) || 0,
                    ozonApplyWriteMethod: applyResult.writeMethod || '',
                    ozonApplyFallbackReason: applyResult.fallbackReason || '',
                    ozonApplyVerifyUnconfirmed: applyResult.verifyUnconfirmed === true
                } : {})
            };
        })
        .sort((a, b) => a.productId.localeCompare(b.productId));
}

function createWarehouseBarcodePreviewViewModel(preview = lastWarehouseBarcodePreview) {
    const base = {
        title: 'tab_wanderer · Ozon barcodes',
        actionLabel: 'Записать в Ozon',
        actions: [],
        status: 'loading',
        message: 'Ищем данные сборки на странице склада. Ozon не изменяем.',
        metrics: [],
        products: [],
        ozon: lastWarehouseOzonResolvePreview || null,
        ozonApply: lastWarehouseOzonUiApply || null
    };

    if (!preview) {
        return base;
    }

    if (preview.status === 'loading' || preview.ok === null) {
        return {
            ...base,
            status: 'loading',
            message: preview.message || base.message
        };
    }

    if (!preview.ok) {
        return {
            ...base,
            status: 'error',
            message: preview.error || 'Не удалось прочитать данные сборки.'
        };
    }

    const summary = preview.summary || preview.extraction?.summary || {};
    const orderId = getWarehouseBarcodePreviewOrderId(preview) || '—';
    const ozon = lastWarehouseOzonResolvePreview || null;
    const ozonApply = lastWarehouseOzonUiApply || null;
    const ozonSummary = ozon?.plan?.summary || {};
    const products = createWarehouseBarcodePreviewProductRows(preview.extraction?.productsById || {}, ozon);
    const hasEligibleBarcodes = Number(summary.eligibleCount) > 0;
    const hasBarcodeList = products.some(product => product.barcodes.length > 0 || product.skippedBarcodes.length > 0);
    const isOzonBusy = ozon?.status === 'loading' || ozonApply?.status === 'loading';
    const actions = [
        ...(hasEligibleBarcodes ? [
            {
                id: 'ozon-ui-apply',
                label: ozonApply?.status === 'loading' ? 'Записываем в Ozon...' : 'Записать в Ozon',
                variant: 'primary',
                disabled: isOzonBusy
            },
            {
                id: 'ozon-resolve',
                label: ozon?.status === 'loading' ? 'Проверяем штрихкоды...' : 'Проверить штрихкоды',
                variant: 'secondary',
                disabled: isOzonBusy
            }
        ] : []),
        ...(hasBarcodeList ? [{
            id: 'barcode-list',
            label: warehouseBarcodeListExpanded ? 'Скрыть ШК' : 'Список ШК',
            variant: 'secondary',
            disabled: false
        }] : [])
    ];

    const metrics = [
        { label: 'Заказ', value: orderId },
        { label: 'Товаров', value: formatWarehouseBarcodePreviewCount(summary.productCount) },
        { label: 'Штрихкодов', value: formatWarehouseBarcodePreviewCount(summary.eligibleCount) },
        { label: 'Пропущено мультиштрихов', value: formatWarehouseBarcodePreviewCount(summary.skippedCount) }
    ];

    if (ozon?.status === 'ready') {
        metrics.push(
            { label: 'К записи', value: formatWarehouseBarcodePreviewCount(ozonSummary.toAddCount) },
            { label: 'Уже есть', value: formatWarehouseBarcodePreviewCount(ozonSummary.alreadyExistsCount) }
        );
    }

    if (ozonApply?.status === 'ready') {
        if (Number(ozonApply.verifiedCount) > 0 || ozonApply.details?.verify) {
            metrics.push({ label: 'Проверено', value: `${formatWarehouseBarcodePreviewCount(ozonApply.verifiedCount)}/${formatWarehouseBarcodePreviewCount(ozonApply.barcodes?.length)}` });
        } else {
            metrics.push({ label: 'Записано', value: formatWarehouseBarcodePreviewCount(ozonApply.addedCount) });
        }

        if (Number(ozonApply.productCount) > 1) {
            metrics.push({ label: 'Товаров Ozon', value: `${formatWarehouseBarcodePreviewCount(ozonApply.successCount)}/${formatWarehouseBarcodePreviewCount(ozonApply.productCount)}` });
        }

        if (Number(ozonApply.errorCount) > 0) {
            metrics.push({ label: 'Ошибки Ozon', value: formatWarehouseBarcodePreviewCount(ozonApply.errorCount) });
        }

        if (ozonApply.writeMethod) {
            metrics.push({ label: 'Метод', value: ozonApply.writeMethod });
        }
    }

    const ozonMessage = ozonApply?.status === 'loading'
        ? 'Добавляем штрихкоды в Ozon. Не закрывай Ozon worker tab.'
        : ozonApply?.status === 'error'
            ? `Ozon: ${ozonApply.error || 'ошибка записи'}`
            : ozonApply?.status === 'ready'
                ? ozonApply.verifyUnconfirmed
                    ? `Ozon: запись отправлена, проверка не подтвердила ${formatWarehouseBarcodePreviewCount(ozonApply.verifiedCount)}/${formatWarehouseBarcodePreviewCount(ozonApply.barcodes?.length)}.`
                    : Number(ozonApply.errorCount) > 0
                        ? `Ozon: проверено ${formatWarehouseBarcodePreviewCount(ozonApply.verifiedCount)}/${formatWarehouseBarcodePreviewCount(ozonApply.barcodes?.length)} после записи, ошибок: ${formatWarehouseBarcodePreviewCount(ozonApply.errorCount)}.`
                        : Number(ozonApply.verifiedCount) > 0 || ozonApply.details?.verify
                            ? `Ozon: проверено ${formatWarehouseBarcodePreviewCount(ozonApply.verifiedCount)}/${formatWarehouseBarcodePreviewCount(ozonApply.barcodes?.length)} после записи.`
                            : `Ozon: добавлено ${formatWarehouseBarcodePreviewCount(ozonApply.addedCount)}.`
                : ozon?.status === 'loading'
                    ? 'Проверяем карточки Ozon. Записи нет.'
                    : ozon?.status === 'error'
                        ? `Ozon: ${ozon.error || 'ошибка проверки'}`
                        : ozon?.status === 'ready'
                            ? 'Ozon проверен. Записи пока нет.'
                            : 'Локальный предпросмотр. Записи в Ozon пока нет.';
    return {
        ...base,
        status: ozonApply?.status === 'error' || ozon?.status === 'error' ? 'error' : 'ready',
        message: ozonMessage,
        actions,
        metrics,
        products,
        ozon,
        ozonApply,
        barcodeListExpanded: warehouseBarcodeListExpanded
    };
}


function createWarehouseOzonResolveLoading(message = 'Проверяем Ozon. Записи нет.') {
    return {
        status: 'loading',
        message
    };
}

function createWarehouseOzonResolveError(errorMessage = 'ozon resolve failed') {
    return {
        status: 'error',
        error: errorMessage
    };
}

function createWarehouseOzonResolveReady(plan = {}) {
    return {
        status: 'ready',
        plan
    };
}


function createWarehouseOzonUiApplyLoading(message = 'Добавляем штрихкоды в Ozon.') {
    return {
        status: 'loading',
        message
    };
}

function createWarehouseOzonUiApplyError(errorMessage = 'ozon UI apply failed', productId = '') {
    return {
        status: 'error',
        error: errorMessage,
        productId: normalizeWarehouseBridgeId(productId),
        addedCount: 0
    };
}

function normalizeWarehouseOzonUiApplyProductResult(result = {}) {
    const details = result.details || null;
    const verify = details?.verify && typeof details.verify === 'object' ? details.verify : null;
    const barcodes = Array.isArray(result.barcodes) ? result.barcodes.map(normalizeWarehouseBridgeId).filter(Boolean) : [];
    const verifiedCount = Object.prototype.hasOwnProperty.call(result, 'verifiedCount')
        ? Number(result.verifiedCount) || 0
        : Number(verify?.verifiedCount) || 0;
    const missingBarcodes = Array.isArray(result.missingBarcodes)
        ? result.missingBarcodes.map(normalizeWarehouseBridgeId).filter(Boolean)
        : Array.isArray(verify?.missingBarcodes)
            ? verify.missingBarcodes.map(normalizeWarehouseBridgeId).filter(Boolean)
            : [];

    return {
        ok: result.ok !== false,
        productId: normalizeWarehouseBridgeId(result.productId),
        productTitle: normalizeWarehouseBridgeText(result.productTitle),
        barcodes,
        addedCount: Number(result.addedCount) || 0,
        verifiedCount,
        missingBarcodes,
        missingCount: missingBarcodes.length,
        error: result.error || '',
        writeMethod: getWarehouseOzonWriteMethodFromDetails(details),
        fallbackReason: getWarehouseOzonFallbackReasonFromDetails(details),
        verifyUnconfirmed: getWarehouseOzonVerifyUnconfirmedFromDetails(details),
        details
    };
}

function createWarehouseOzonUiApplyReady(result = {}) {
    const details = result.details || null;
    const rawProductResults = Array.isArray(result.productResults)
        ? result.productResults
        : Array.isArray(details?.productResults)
            ? details.productResults
            : [];
    const productResults = rawProductResults.length
        ? rawProductResults.map(normalizeWarehouseOzonUiApplyProductResult)
        : [normalizeWarehouseOzonUiApplyProductResult(result)].filter(item => item.productId);
    const barcodes = Array.isArray(result.barcodes) && result.barcodes.length
        ? result.barcodes.map(normalizeWarehouseBridgeId).filter(Boolean)
        : productResults.flatMap(item => item.barcodes);
    const verifiedCount = Object.prototype.hasOwnProperty.call(result, 'verifiedCount')
        ? Number(result.verifiedCount) || 0
        : productResults.reduce((sum, item) => sum + (Number(item.verifiedCount) || 0), 0);
    const missingBarcodes = Array.isArray(result.missingBarcodes)
        ? result.missingBarcodes.map(normalizeWarehouseBridgeId).filter(Boolean)
        : productResults.flatMap(item => item.missingBarcodes || []);
    const addedCount = Object.prototype.hasOwnProperty.call(result, 'addedCount')
        ? Number(result.addedCount) || 0
        : productResults.reduce((sum, item) => sum + (Number(item.addedCount) || 0), 0);
    const errorCount = Object.prototype.hasOwnProperty.call(result, 'errorCount')
        ? Number(result.errorCount) || 0
        : productResults.filter(item => item.ok === false || (item.verifyUnconfirmed !== true && Number(item.missingCount) > 0)).length;
    const writeMethods = Array.from(new Set(productResults.map(item => item.writeMethod).filter(Boolean)));
    const writeMethod = writeMethods.length === 1
        ? writeMethods[0]
        : writeMethods.length > 1
            ? writeMethods.join(', ')
            : getWarehouseOzonWriteMethodFromDetails(details);
    const verifyUnconfirmed = getWarehouseOzonVerifyUnconfirmedFromDetails(details)
        || productResults.some(item => item.verifyUnconfirmed === true);

    return {
        status: 'ready',
        productId: normalizeWarehouseBridgeId(result.productId),
        productCount: Number(result.productCount) || productResults.length,
        successCount: Object.prototype.hasOwnProperty.call(result, 'successCount')
            ? Number(result.successCount) || 0
            : productResults.length - errorCount,
        errorCount,
        barcodes,
        addedCount,
        verifiedCount,
        missingCount: missingBarcodes.length,
        missingBarcodes,
        writeMethod,
        verifyUnconfirmed,
        productResults,
        details
    };
}
