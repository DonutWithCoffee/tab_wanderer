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

function getWarehouseBarcodeCountNoun(value) {
    const count = Math.abs(Number(value) || 0);
    const lastTwoDigits = count % 100;
    const lastDigit = count % 10;

    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
        return 'штрихкодов';
    }

    if (lastDigit === 1) {
        return 'штрихкод';
    }

    if (lastDigit >= 2 && lastDigit <= 4) {
        return 'штрихкода';
    }

    return 'штрихкодов';
}

function formatWarehouseBarcodeCountText(value) {
    const count = Number(value) || 0;

    return `${formatWarehouseBarcodePreviewCount(count)} ${getWarehouseBarcodeCountNoun(count)}`;
}

const WAREHOUSE_BARCODE_SKIP_CATEGORY_META = {
    multiBarcode: {
        label: 'Мультиштрихкоды',
        summaryLabel: 'мультиштрихкоды'
    },
    nonUnitQuantity: {
        label: 'Неединичные позиции',
        summaryLabel: 'неединичные позиции'
    },
    duplicate: {
        label: 'Дубликаты',
        summaryLabel: 'дубликаты'
    },
    missingBarcode: {
        label: 'Без штрихкода',
        summaryLabel: 'без штрихкода'
    },
    missingProductId: {
        label: 'Без ID товара',
        summaryLabel: 'без ID товара'
    },
    other: {
        label: 'Другие пропуски',
        summaryLabel: 'другие причины'
    }
};

function getWarehouseBarcodeSkipCategory(reason = '') {
    switch (normalizeWarehouseBridgeText(reason)) {
        case 'multiBarcodeType':
            return 'multiBarcode';
        case 'nonUnitAssemblyQuantity':
        case 'nonUnitReservedQuantity':
            return 'nonUnitQuantity';
        case 'duplicateBarcode':
            return 'duplicate';
        case 'missingBarcode':
            return 'missingBarcode';
        case 'missingProductId':
            return 'missingProductId';
        default:
            return 'other';
    }
}

function createWarehouseBarcodeSkippedGroups(entries = []) {
    const groups = new Map();

    for (const entry of Array.isArray(entries) ? entries : []) {
        const category = getWarehouseBarcodeSkipCategory(entry?.reason);
        const meta = WAREHOUSE_BARCODE_SKIP_CATEGORY_META[category] || WAREHOUSE_BARCODE_SKIP_CATEGORY_META.other;
        const current = groups.get(category) || {
            category,
            label: meta.label,
            summaryLabel: meta.summaryLabel,
            count: 0,
            barcodes: []
        };
        const barcode = getWarehouseBarcodePreviewEntryBarcode(entry);

        current.count += 1;

        if (barcode && !current.barcodes.includes(barcode)) {
            current.barcodes.push(barcode);
        }

        groups.set(category, current);
    }

    return Array.from(groups.values());
}

function createWarehouseBarcodeProductSummaryText(product = {}) {
    const eligibleCount = Number(product.eligibleCount) || 0;
    const skippedCount = Number(product.skippedCount) || 0;
    const skippedGroups = Array.isArray(product.skippedBarcodeGroups) ? product.skippedBarcodeGroups : [];
    const parts = [];

    if (eligibleCount > 0) {
        parts.push(formatWarehouseBarcodeCountText(eligibleCount));
    }

    if (skippedGroups.length > 0) {
        parts.push(skippedGroups
            .map(group => `${group.summaryLabel}: ${formatWarehouseBarcodePreviewCount(group.count)}`)
            .join(', '));
    } else if (skippedCount > 0) {
        parts.push(`пропущено: ${formatWarehouseBarcodePreviewCount(skippedCount)}`);
    }

    return parts.join(' · ');
}

function createWarehouseOzonResolveProductText(product = {}) {
    const toAddCount = Number(product.ozonToAddCount) || 0;
    const alreadyExistsCount = Number(product.ozonAlreadyExistsCount) || 0;

    if (product.ozonStatus === 'error') {
        return 'Не удалось проверить в Ozon';
    }

    if (toAddCount > 0 && alreadyExistsCount > 0) {
        return `Готово к записи: ${formatWarehouseBarcodeCountText(toAddCount)} · уже в Ozon: ${formatWarehouseBarcodeCountText(alreadyExistsCount)}`;
    }

    if (toAddCount > 0) {
        return `Готово к записи: ${formatWarehouseBarcodeCountText(toAddCount)}`;
    }

    if (alreadyExistsCount > 0) {
        return `Подтверждено в Ozon: ${formatWarehouseBarcodeCountText(alreadyExistsCount)}`;
    }

    return '';
}

function createWarehouseOzonApplyProductText(product = {}) {
    const verifiedCount = Number(product.ozonApplyVerifiedCount) || 0;
    const expectedCount = Number(product.ozonApplyExpectedCount) || Number(product.ozonApplyAddedCount) || 0;

    if (product.ozonApplyStatus === 'loading') {
        return 'Записываем в Ozon...';
    }

    if (product.ozonApplyStatus === 'error') {
        return 'Не удалось записать в Ozon';
    }

    if (product.ozonApplyStatus !== 'ready') {
        return '';
    }

    if (product.ozonApplyVerifyUnconfirmed) {
        return 'Не удалось подтвердить запись';
    }

    if (Number(product.ozonApplyMissingCount) > 0) {
        return expectedCount > 0
            ? `Подтверждено в Ozon: ${formatWarehouseBarcodePreviewCount(verifiedCount)} из ${formatWarehouseBarcodePreviewCount(expectedCount)}`
            : 'Не удалось подтвердить запись';
    }

    if (verifiedCount > 0) {
        return `Подтверждено в Ozon: ${formatWarehouseBarcodeCountText(verifiedCount)}`;
    }

    return 'Запись не подтверждена';
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

function getWarehouseOzonPlanBarcodeList(entries = []) {
    return createWarehouseBarcodePreviewBarcodeList(entries);
}

function reconcileWarehouseOzonUiApplyProductResultWithPlan(result = {}, plan = null) {
    if (!plan || plan.status === 'error') {
        return result;
    }

    const expectedBarcodes = createWarehouseBarcodePreviewBarcodeList(result.barcodes);

    if (!expectedBarcodes.length) {
        return result;
    }

    const existingBarcodes = new Set([
        ...getWarehouseOzonPlanBarcodeList(plan.existingBarcodes),
        ...getWarehouseOzonPlanBarcodeList(plan.alreadyExists)
    ]);
    const missingBarcodes = expectedBarcodes.filter(barcode => !existingBarcodes.has(barcode));

    return {
        ...result,
        verifiedCount: expectedBarcodes.length - missingBarcodes.length,
        missingBarcodes,
        missingCount: missingBarcodes.length,
        error: '',
        verifyUnconfirmed: false
    };
}

function reconcileWarehouseOzonUiApplyWithResolvePlan(applyResult = null, resolvePreview = null) {
    if (!applyResult || resolvePreview?.status !== 'ready') {
        return applyResult;
    }

    if (applyResult.status === 'error') {
        return null;
    }

    if (applyResult.status !== 'ready') {
        return applyResult;
    }

    const plansByProductId = getWarehouseOzonResolvePlanByProductId(resolvePreview);
    const productResults = (Array.isArray(applyResult.productResults) ? applyResult.productResults : [])
        .map(result => reconcileWarehouseOzonUiApplyProductResultWithPlan(
            result,
            plansByProductId[normalizeWarehouseBridgeId(result?.productId)] || null
        ));

    if (!productResults.length) {
        return applyResult;
    }

    const missingBarcodes = createWarehouseBarcodePreviewBarcodeList(
        productResults.flatMap(result => result.missingBarcodes || [])
    );
    const verifiedCount = productResults.reduce((sum, result) => sum + (Number(result.verifiedCount) || 0), 0);
    const errorCount = productResults.filter(result => (
        result.ok === false
        || (result.verifyUnconfirmed !== true && Number(result.missingCount) > 0)
    )).length;
    const verifyUnconfirmed = productResults.some(result => result.verifyUnconfirmed === true);
    const productCount = Number(applyResult.productCount) || productResults.length;

    return {
        ...applyResult,
        productCount,
        successCount: Math.max(0, productCount - errorCount),
        errorCount,
        verifiedCount,
        missingBarcodes,
        missingCount: missingBarcodes.length,
        verifyUnconfirmed,
        productResults
    };
}

function hasWarehouseOzonApplyProductProblem(result = null) {
    if (!result) {
        return false;
    }

    const expectedCount = Array.isArray(result.barcodes) && result.barcodes.length
        ? result.barcodes.length
        : Number(result.addedCount) || 0;

    return result.ok === false
        || result.verifyUnconfirmed === true
        || Number(result.missingCount) > 0
        || (expectedCount > 0 && Number(result.verifiedCount) < expectedCount);
}

function hasWarehouseOzonApplyProblem(applyResult = null) {
    if (!applyResult) {
        return false;
    }

    if (applyResult.status === 'error') {
        return true;
    }

    if (applyResult.status !== 'ready') {
        return false;
    }

    const expectedCount = Array.isArray(applyResult.barcodes) && applyResult.barcodes.length
        ? applyResult.barcodes.length
        : Number(applyResult.addedCount) || 0;

    return applyResult.verifyUnconfirmed === true
        || Number(applyResult.errorCount) > 0
        || Number(applyResult.missingCount) > 0
        || (expectedCount > 0 && Number(applyResult.verifiedCount) < expectedCount);
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
            const skippedBarcodeGroups = createWarehouseBarcodeSkippedGroups(group.skippedBarcodes);

            return {
                productId,
                productTitle: normalizeWarehouseBridgeText(group.productTitle),
                barcodes: createWarehouseBarcodePreviewBarcodeList(group.eligibleBarcodes),
                skippedBarcodes: skippedBarcodeGroups.flatMap(groupEntry => groupEntry.barcodes),
                skippedBarcodeGroups,
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
                ozonApplyHasProblem: hasWarehouseOzonApplyProductProblem(applyResult),
                ozonApplyAddedCount: applyResult ? Number(applyResult.addedCount) || 0 : 0,
                ...(applyResult ? {
                    ozonApplyExpectedCount: Array.isArray(applyResult.barcodes) && applyResult.barcodes.length
                        ? applyResult.barcodes.length
                        : Number(applyResult.addedCount) || 0,
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

function createWarehouseOzonApplyAction(summary = {}, ozon = null, ozonApply = null, isOzonBusy = false) {
    const eligibleCount = Number(summary.eligibleCount) || 0;
    const ozonSummary = ozon?.plan?.summary || {};
    const expectedApplyCount = Array.isArray(ozonApply?.barcodes) && ozonApply.barcodes.length
        ? ozonApply.barcodes.length
        : eligibleCount;
    const applyVerified = ozonApply?.status === 'ready'
        && ozonApply.verifyUnconfirmed !== true
        && Number(ozonApply.errorCount) === 0
        && Number(ozonApply.missingCount) === 0
        && expectedApplyCount > 0
        && Number(ozonApply.verifiedCount) >= expectedApplyCount;
    const allAlreadyExists = ozon?.status === 'ready'
        && Number(ozonSummary.errorProductCount) === 0
        && Number(ozonSummary.toAddCount) === 0
        && eligibleCount > 0
        && Number(ozonSummary.alreadyExistsCount) >= eligibleCount;

    if (ozonApply?.status === 'loading') {
        return {
            id: 'ozon-ui-apply',
            label: 'Записываем в Ozon...',
            variant: 'loading',
            disabled: true
        };
    }

    if (ozonApply?.status === 'error') {
        return {
            id: 'ozon-ui-apply',
            label: 'Ошибка записи — повторить',
            variant: 'danger',
            disabled: false
        };
    }

    if (ozonApply?.status === 'ready') {
        if (applyVerified) {
            return {
                id: 'ozon-ui-apply',
                label: 'Записано и проверено',
                variant: 'success',
                disabled: true
            };
        }

        return {
            id: 'ozon-ui-apply',
            label: ozonApply.verifyUnconfirmed === true
                ? 'Не удалось проверить — повторить'
                : 'Не все штрихкоды найдены — повторить',
            variant: 'danger',
            disabled: false
        };
    }

    if (allAlreadyExists) {
        return {
            id: 'ozon-ui-apply',
            label: 'Штрихкоды уже есть в Ozon',
            variant: 'success',
            disabled: true
        };
    }

    if (ozon?.status === 'error' || Number(ozonSummary.errorProductCount) > 0) {
        return {
            id: 'ozon-ui-apply',
            label: 'Не удалось проверить — повторить',
            variant: 'danger',
            disabled: false
        };
    }

    return {
        id: 'ozon-ui-apply',
        label: 'Записать в Ozon',
        variant: 'primary',
        disabled: isOzonBusy
    };
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
            createWarehouseOzonApplyAction(summary, ozon, ozonApply, isOzonBusy),
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
        { label: 'Штрихкодов', value: formatWarehouseBarcodePreviewCount(summary.eligibleCount) }
    ];

    if (Number(summary.skippedCount) > 0) {
        metrics.push({
            label: 'Пропущено',
            value: formatWarehouseBarcodePreviewCount(summary.skippedCount)
        });
    }

    const expectedApplyCount = Array.isArray(ozonApply?.barcodes) && ozonApply.barcodes.length
        ? ozonApply.barcodes.length
        : Number(ozonApply?.addedCount) || 0;
    const ozonMessage = ozonApply?.status === 'loading'
        ? 'Записываем штрихкоды в Ozon...'
        : ozonApply?.status === 'error'
            ? 'Не удалось записать штрихкоды в Ozon.'
            : ozonApply?.status === 'ready'
                ? ozonApply.verifyUnconfirmed
                    ? 'Запись отправлена, но результат не подтверждён.'
                    : Number(ozonApply.errorCount) > 0 || Number(ozonApply.missingCount) > 0
                        ? expectedApplyCount > 0
                            ? `Подтверждено в Ozon: ${formatWarehouseBarcodePreviewCount(ozonApply.verifiedCount)} из ${formatWarehouseBarcodePreviewCount(expectedApplyCount)}.`
                            : 'Не удалось подтвердить запись в Ozon.'
                        : Number(ozonApply.verifiedCount) > 0
                            ? `Подтверждено в Ozon: ${formatWarehouseBarcodeCountText(ozonApply.verifiedCount)}.`
                            : 'Запись завершена, но результат не подтверждён.'
                : ozon?.status === 'loading'
                    ? 'Проверяем штрихкоды в Ozon...'
                    : ozon?.status === 'error'
                        ? 'Не удалось проверить штрихкоды в Ozon.'
                        : ozon?.status === 'ready'
                            ? Number(ozonSummary.errorProductCount) > 0
                                ? 'Не удалось проверить часть штрихкодов в Ozon.'
                                : Number(ozonSummary.toAddCount) > 0
                                    ? `Готово к записи: ${formatWarehouseBarcodeCountText(ozonSummary.toAddCount)}.`
                                    : Number(summary.eligibleCount) > 0
                                        && Number(ozonSummary.alreadyExistsCount) >= Number(summary.eligibleCount)
                                        ? 'Все штрихкоды подтверждены в Ozon.'
                                        : Number(ozonSummary.alreadyExistsCount) > 0
                                            ? `Подтверждено в Ozon: ${formatWarehouseBarcodeCountText(ozonSummary.alreadyExistsCount)}.`
                                            : 'Проверка Ozon завершена.'
                            : 'Готово к проверке Ozon.';
    return {
        ...base,
        status: hasWarehouseOzonApplyProblem(ozonApply)
            || ozon?.status === 'error'
            || Number(ozonSummary.errorProductCount) > 0
            ? 'error'
            : 'ready',
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
