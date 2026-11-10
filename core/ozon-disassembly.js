// Fail-closed normalization for confirmed Warehouse 3 disassembly events.
const OZON_DISASSEMBLY_MAX_ITEMS = 150;
const OZON_DISASSEMBLY_MAX_BARCODES = 1000;

function normalizeOzonDisassemblyId(value, limit = 80) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const normalized = String(value).trim();
    return normalized.length <= limit && /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized : '';
}

function validateOzonDisassemblyEvent(event = {}) {
    const orderId = normalizeOzonSessionOrderId(event.orderId);
    const actionId = normalizeOzonDisassemblyId(event.actionId, 24);
    const rows = event.rows;
    if (!orderId || !actionId || event.confirmed !== true || event.source !== 'OZON'
        || !Array.isArray(rows) || !rows.length || rows.length > OZON_DISASSEMBLY_MAX_BARCODES) {
        return { ok: false, error: 'Invalid or unconfirmed warehouse disassembly event' };
    }
    const seen = new Set();
    const groups = new Map();
    for (const entry of rows) {
        const productId = normalizeOzonDisassemblyId(entry?.productId);
        const productItemId = normalizeOzonDisassemblyId(entry?.productItemId);
        const barcode = normalizeOzonDisassemblyId(entry?.barcode);
        if (!/^\d{5,}$/.test(productId) || !/^\d+$/.test(productItemId)
            || !barcode || barcode.length < 5 || entry?.type !== 0) {
            return { ok: false, error: 'Unverified unit barcode in disassembly' };
        }
        const key = `${productId}:${barcode}`;
        if (seen.has(key)) return { ok: false, error: 'Duplicate disassembly barcode' };
        seen.add(key);
        if (!groups.has(productId)) groups.set(productId, []);
        groups.get(productId).push(barcode);
    }
    if (groups.size > OZON_DISASSEMBLY_MAX_ITEMS) {
        return { ok: false, error: 'Too many disassembly products' };
    }
    return {
        ok: true,
        orderId,
        actionId,
        rows: rows.map(row => ({
            productId: normalizeOzonDisassemblyId(row.productId),
            productItemId: normalizeOzonDisassemblyId(row.productItemId),
            barcode: normalizeOzonDisassemblyId(row.barcode),
            type: 0
        })),
        productRequests: Array.from(groups, ([productId, barcodes]) => ({ productId, barcodes })),
        barcodeCount: rows.length
    };
}

globalThis.validateOzonDisassemblyEvent = validateOzonDisassemblyEvent;
