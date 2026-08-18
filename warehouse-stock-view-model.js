const WAREHOUSE_STOCK_BRANCH_DEFAULT = 'default';
const WAREHOUSE_STOCK_BRANCH_SPB = 'spb';
const WAREHOUSE_STOCK_BRANCH_MOSCOW = 'moscow';
const WAREHOUSE_STOCK_BRANCHES = [
    WAREHOUSE_STOCK_BRANCH_DEFAULT,
    WAREHOUSE_STOCK_BRANCH_SPB,
    WAREHOUSE_STOCK_BRANCH_MOSCOW
];

function normalizeWarehouseStockBranch(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return WAREHOUSE_STOCK_BRANCHES.includes(normalized)
        ? normalized
        : WAREHOUSE_STOCK_BRANCH_DEFAULT;
}

function normalizeWarehouseStockNumber(value) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
}

function parseWarehouseStockLocationTitle(title = '') {
    const normalized = String(title || '').replace(/\s+/g, ' ').trim();
    let match = normalized.match(/^В наличии\s+СПб\s*\((.+)\)$/i);
    if (match) {
        return { city: 'spb', cityLabel: 'СПб', location: match[1].trim() };
    }

    match = normalized.match(/^Москва\s+ТГ\s*:\s*в наличии\s*\((.+)\)$/i);
    if (match) {
        return { city: 'moscow', cityLabel: 'Москва ТГ', location: match[1].trim() };
    }

    match = normalized.match(/^СПб\s*:\s*в наличии\s*\((.+)\)$/i);
    if (match) {
        return { city: 'spb', cityLabel: 'СПб', location: match[1].trim() };
    }

    return null;
}


function extractWarehouseIncomeProductIdsFromText(text = '') {
    const normalized = String(text || '');
    const ids = [];
    const seen = new Set();

    const collect = value => {
        const id = String(value || '').trim();
        if (!/^\d{5,}$/.test(id) || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    };

    // The selected income product card exposes the product identity as
    // "Артикул: ..., ID: ...". Prefer this shape so unrelated IDs elsewhere
    // on the Warehouse page do not become stock requests.
    const articleIdRegex = /Артикул\s*:\s*\d+\s*,?\s*ID\s*:\s*(\d{5,})/gi;
    let match;
    while ((match = articleIdRegex.exec(normalized))) {
        collect(match[1]);
    }

    if (ids.length) return ids;

    // Fallback for Warehouse layouts that omit the article number but still
    // render a plain "ID: ..." product line.
    const idRegex = /\bID\s*:\s*(\d{5,})\b/gi;
    while ((match = idRegex.exec(normalized))) {
        collect(match[1]);
    }

    return ids;
}

function isWarehouseStockResponseCurrent(productId, selectedProductIds = []) {
    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId || !Array.isArray(selectedProductIds)) return false;

    return selectedProductIds.some(id => String(id || '').trim() === normalizedProductId);
}

function normalizeWarehouseIncomeProductTitle(value = '') {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/^\s*Товар\s*:\s*/i, '')
        .trim();
}

function extractWarehouseIncomeProductTitleFromCardText(text = '') {
    const normalized = normalizeWarehouseIncomeProductTitle(text);
    if (!normalized) return '';

    const beforeId = normalized.split(/\bID\s*:\s*\d{5,}\b/i)[0] || '';
    return normalizeWarehouseIncomeProductTitle(
        beforeId.split(/(?:Поставщик|Артикул)\s*:/i)[0]
    );
}

function createWarehouseStockRows(payload = {}, branch = WAREHOUSE_STOCK_BRANCH_DEFAULT) {
    const selectedBranch = normalizeWarehouseStockBranch(branch);
    const available = Array.isArray(payload?.['1']) ? payload['1'] : [];

    return available
        .map(item => {
            const parsed = parseWarehouseStockLocationTitle(item?.title);
            if (!parsed) return null;

            const quantity = normalizeWarehouseStockNumber(item?.quantity);
            const reservedQuantity = normalizeWarehouseStockNumber(item?.reserved_quantity ?? item?.reservedQuantity);
            const totalQuantity = quantity - reservedQuantity;

            // The API's quantity is the physical quantity at the storage
            // location; reserved_quantity is already part of that quantity.
            // We expose only the quantity that is not reserved.
            if (totalQuantity <= 0) return null;
            if (selectedBranch !== WAREHOUSE_STOCK_BRANCH_DEFAULT && parsed.city !== selectedBranch) return null;

            return {
                id: String(item?.id ?? ''),
                city: parsed.city,
                cityLabel: parsed.cityLabel,
                location: parsed.location,
                quantity,
                reservedQuantity,
                totalQuantity
            };
        })
        .filter(Boolean);
}

function createWarehouseStockViewModel(
    payload = {},
    branch = WAREHOUSE_STOCK_BRANCH_DEFAULT,
    productId = '',
    productTitle = ''
) {
    const normalizedBranch = normalizeWarehouseStockBranch(branch);
    const rows = createWarehouseStockRows(payload, normalizedBranch);
    const totalQuantity = rows.reduce((sum, row) => sum + row.totalQuantity, 0);

    return {
        ok: true,
        productId: String(productId || ''),
        productTitle: String(productTitle || '').trim(),
        branch: normalizedBranch,
        rows,
        totalQuantity,
        message: rows.length ? 'Товар уже хранится здесь.' : 'Для выбранного филиала остатков не найдено.'
    };
}

globalThis.normalizeWarehouseStockBranch = normalizeWarehouseStockBranch;
globalThis.isWarehouseStockResponseCurrent = isWarehouseStockResponseCurrent;
globalThis.normalizeWarehouseIncomeProductTitle = normalizeWarehouseIncomeProductTitle;
globalThis.extractWarehouseIncomeProductTitleFromCardText = extractWarehouseIncomeProductTitleFromCardText;
globalThis.parseWarehouseStockLocationTitle = parseWarehouseStockLocationTitle;
globalThis.createWarehouseStockRows = createWarehouseStockRows;
globalThis.extractWarehouseIncomeProductIdsFromText = extractWarehouseIncomeProductIdsFromText;
globalThis.createWarehouseStockViewModel = createWarehouseStockViewModel;
