const NOTIFICATION_EVENT_FIELDS = [
    'status',
    'delivery',
    'payment',
    'city'
];

const NOTIFICATION_FIELD_LABELS = {
    status: 'Статус',
    delivery: 'Доставка',
    payment: 'Оплата',
    city: 'Город'
};

const NOTIFICATION_NEW_ORDER_FIELDS = [
    'status',
    'delivery',
    'payment'
];

function formatNotificationValue(value) {
    const normalizeDisplayText = (item) => {
        const text = String(item ?? '').trim();

        return typeof stripDynamicOrderText === 'function'
            ? stripDynamicOrderText(text)
            : text;
    };

    if (Array.isArray(value)) {
        const values = value
            .map(normalizeDisplayText)
            .filter(Boolean);

        return values.length ? values.join(', ') : '—';
    }

    const text = normalizeDisplayText(value);

    return text || '—';
}

function getOrderNotificationTag(order = {}) {
    const contractor = typeof normalize === 'function'
        ? normalize(order.contractor)
        : String(order.contractor || '').toLowerCase().trim();
    const payment = typeof normalize === 'function'
        ? normalize(order.payment)
        : String(order.payment || '').toLowerCase().trim();

    if (contractor === 'ozon (озон)') {
        return 'ОЗОН';
    }

    if (payment === 'безналичный расчет для юридических лиц') {
        return 'Юрик';
    }

    return '';
}

function getNotificationAllowedChangedFields(changedFields = []) {
    const allowed = new Set(NOTIFICATION_EVENT_FIELDS);

    return Array.isArray(changedFields)
        ? changedFields.map(field => String(field)).filter(field => allowed.has(field))
        : [];
}

function createNewOrderNotificationMessage(order = {}) {
    return NOTIFICATION_NEW_ORDER_FIELDS
        .map(field => `${NOTIFICATION_FIELD_LABELS[field]}: ${formatNotificationValue(order[field])}`)
        .join('\n');
}

function createChangedOrderNotificationMessage(order = {}, eventContext = {}) {
    const changedFields = getNotificationAllowedChangedFields(eventContext.changedFields);
    const prevOrder = eventContext.prevOrder || {};

    if (!changedFields.length) {
        return 'Изменения обнаружены.';
    }

    return changedFields
        .map(field => {
            const label = NOTIFICATION_FIELD_LABELS[field] || field;
            const before = formatNotificationValue(prevOrder[field]);
            const after = formatNotificationValue(order[field]);

            return `${label}: ${before} → ${after}`;
        })
        .join('\n');
}

function createOrderNotificationContent(order = {}, eventContext = {}) {
    const tag = getOrderNotificationTag(order);
    const tagSuffix = tag ? ` (${tag})` : '';
    const orderId = String(order.id || '');
    const isChangedOrder = eventContext?.eventType === 'order-changed';

    if (isChangedOrder) {
        return {
            tag,
            title: `Заказ №${orderId} изменён${tagSuffix}`,
            message: createChangedOrderNotificationMessage(order, eventContext)
        };
    }

    return {
        tag,
        title: `Заказ №${orderId}${tagSuffix}`,
        message: createNewOrderNotificationMessage(order)
    };
}

globalThis.NOTIFICATION_EVENT_FIELDS = NOTIFICATION_EVENT_FIELDS;
globalThis.NOTIFICATION_FIELD_LABELS = NOTIFICATION_FIELD_LABELS;
globalThis.NOTIFICATION_NEW_ORDER_FIELDS = NOTIFICATION_NEW_ORDER_FIELDS;
globalThis.formatNotificationValue = formatNotificationValue;
globalThis.getOrderNotificationTag = getOrderNotificationTag;
globalThis.getNotificationAllowedChangedFields = getNotificationAllowedChangedFields;
globalThis.createNewOrderNotificationMessage = createNewOrderNotificationMessage;
globalThis.createChangedOrderNotificationMessage = createChangedOrderNotificationMessage;
globalThis.createOrderNotificationContent = createOrderNotificationContent;
