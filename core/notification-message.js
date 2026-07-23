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

const NOTIFICATION_CONTEXT_FIELDS = [
    'status',
    'payment',
    'delivery'
];

const NOTIFICATION_NEW_ORDER_FIELDS = NOTIFICATION_CONTEXT_FIELDS;

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
    const classification = typeof classifyOrderForNotifications === 'function'
        ? classifyOrderForNotifications(order)
        : {
            isOzon: typeof isOzonOrder === 'function' && isOzonOrder(order),
            isLegalEntityPayment: typeof isLegalEntityPaymentOrder === 'function' && isLegalEntityPaymentOrder(order)
        };

    if (classification.isOzon) {
        return 'ОЗОН';
    }

    if (classification.isLegalEntityPayment) {
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

function createCurrentStateNotificationLine(order = {}, field) {
    const label = NOTIFICATION_FIELD_LABELS[field] || field;

    return `${label}: ${formatNotificationValue(order[field])}`;
}

function createChangedStateNotificationLine(order = {}, prevOrder = {}, field) {
    const label = NOTIFICATION_FIELD_LABELS[field] || field;
    const before = formatNotificationValue(prevOrder[field]);
    const after = formatNotificationValue(order[field]);

    return `${label}: ${before} → ${after}`;
}

function createNewOrderNotificationMessage(order = {}) {
    return NOTIFICATION_NEW_ORDER_FIELDS
        .map(field => createCurrentStateNotificationLine(order, field))
        .join('\n');
}

function createChangedOrderNotificationMessage(order = {}, eventContext = {}) {
    const changedFields = getNotificationAllowedChangedFields(eventContext.changedFields);
    const changedFieldSet = new Set(changedFields);
    const prevOrder = eventContext.prevOrder || {};
    const lines = NOTIFICATION_CONTEXT_FIELDS.map(field => (
        changedFieldSet.has(field)
            ? createChangedStateNotificationLine(order, prevOrder, field)
            : createCurrentStateNotificationLine(order, field)
    ));

    changedFields
        .filter(field => !NOTIFICATION_CONTEXT_FIELDS.includes(field))
        .forEach(field => {
            lines.push(createChangedStateNotificationLine(order, prevOrder, field));
        });

    return lines.join('\n');
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
globalThis.NOTIFICATION_CONTEXT_FIELDS = NOTIFICATION_CONTEXT_FIELDS;
globalThis.NOTIFICATION_NEW_ORDER_FIELDS = NOTIFICATION_NEW_ORDER_FIELDS;
globalThis.formatNotificationValue = formatNotificationValue;
globalThis.getOrderNotificationTag = getOrderNotificationTag;
globalThis.getNotificationAllowedChangedFields = getNotificationAllowedChangedFields;
globalThis.createCurrentStateNotificationLine = createCurrentStateNotificationLine;
globalThis.createChangedStateNotificationLine = createChangedStateNotificationLine;
globalThis.createNewOrderNotificationMessage = createNewOrderNotificationMessage;
globalThis.createChangedOrderNotificationMessage = createChangedOrderNotificationMessage;
globalThis.createOrderNotificationContent = createOrderNotificationContent;
