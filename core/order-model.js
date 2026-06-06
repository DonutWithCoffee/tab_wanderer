const ORDER_EVENT_FIELDS = [
    'status',
    'delivery',
    'payment',
    'city',
    'tags'
];

function normalize(value) {
    return (value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[–-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDateForHash(value) {
    const raw = String(value || '');
    const firstLine = raw.split('\n')[0] || '';

    return normalize(firstLine);
}

function normalizeTagsForDiff(tags) {
    if (!Array.isArray(tags)) {
        return '';
    }

    return tags
        .map(tag => normalize(tag))
        .filter(Boolean)
        .sort()
        .join('|');
}

function normalizeOrderEventField(order, fieldName) {
    if (fieldName === 'tags') {
        return normalizeTagsForDiff(order?.tags);
    }

    return normalize(order?.[fieldName]);
}

function getOrderEventFingerprint(order) {
    return ORDER_EVENT_FIELDS
        .map(fieldName => normalizeOrderEventField(order, fieldName))
        .join('|');
}

function getHash(order) {
    return getOrderEventFingerprint(order);
}

function getChangedFields(prevOrder, nextOrder) {
    if (!prevOrder || !nextOrder) {
        return [];
    }

    return ORDER_EVENT_FIELDS
        .map(fieldName => ({
            name: fieldName,
            prev: normalizeOrderEventField(prevOrder, fieldName),
            next: normalizeOrderEventField(nextOrder, fieldName)
        }))
        .filter(field => field.prev !== field.next)
        .map(field => field.name);
}

function areStoredOrdersEqual(prevOrder, nextOrder) {
    return JSON.stringify(prevOrder || null) === JSON.stringify(nextOrder || null);
}

globalThis.ORDER_EVENT_FIELDS = ORDER_EVENT_FIELDS;
globalThis.normalize = normalize;
globalThis.normalizeDateForHash = normalizeDateForHash;
globalThis.normalizeTagsForDiff = normalizeTagsForDiff;
globalThis.normalizeOrderEventField = normalizeOrderEventField;
globalThis.getOrderEventFingerprint = getOrderEventFingerprint;
globalThis.getHash = getHash;
globalThis.getChangedFields = getChangedFields;
globalThis.areStoredOrdersEqual = areStoredOrdersEqual;
