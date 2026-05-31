const OPTIONS_DEFAULT_NOTIFICATION_TRIGGERS = {
    newOrders: true,
    changedOrders: true,
    changedFields: {
        status: true,
        delivery: true,
        payment: true,
        contractor: false,
        date: false,
        shipmentDateText: true,
        hasOrderFlag: true,
        hasAutoreserve: true,
        tags: true
    }
};

function send(msg, cb) {
    chrome.runtime.sendMessage(msg, (res) => {
        console.log('[OPTIONS]', msg.type, res);
        if (cb) cb(res);
    });
}

function setText(id, value) {
    const el = document.getElementById(id);

    if (el) {
        el.innerText = String(value || '');
    }
}

function getScopeList(values) {
    return Array.isArray(values) ? values.map((value) => String(value)) : [];
}

function getBooleanConfigValue(value, fallback) {
    return value === undefined ? fallback : Boolean(value);
}

function getNotificationTriggers(config = {}) {
    const triggers = config?.notificationTriggers || {};
    const changedFields = triggers.changedFields || {};
    const defaultTriggers = OPTIONS_DEFAULT_NOTIFICATION_TRIGGERS;
    const defaultChangedFields = defaultTriggers.changedFields;

    return {
        newOrders: getBooleanConfigValue(triggers.newOrders, defaultTriggers.newOrders),
        changedOrders: getBooleanConfigValue(triggers.changedOrders, defaultTriggers.changedOrders),
        changedFields: {
            status: getBooleanConfigValue(changedFields.status, defaultChangedFields.status),
            delivery: getBooleanConfigValue(changedFields.delivery, defaultChangedFields.delivery),
            payment: getBooleanConfigValue(changedFields.payment, defaultChangedFields.payment),
            contractor: getBooleanConfigValue(changedFields.contractor, defaultChangedFields.contractor),
            date: getBooleanConfigValue(changedFields.date, defaultChangedFields.date),
            shipmentDateText: getBooleanConfigValue(changedFields.shipmentDateText, defaultChangedFields.shipmentDateText),
            hasOrderFlag: getBooleanConfigValue(changedFields.hasOrderFlag, defaultChangedFields.hasOrderFlag),
            hasAutoreserve: getBooleanConfigValue(changedFields.hasAutoreserve, defaultChangedFields.hasAutoreserve),
            tags: getBooleanConfigValue(changedFields.tags, defaultChangedFields.tags)
        }
    };
}

function getMonitorModeLabel(config = {}) {
    const mode = String(config.monitorMode || 'windowed');

    if (mode === 'active') {
        return 'Active: только первая страница';
    }

    return 'Windowed: первая страница + deep sync';
}

function buildScopeText(title, selectedIds, options) {
    if (!selectedIds.length) {
        return `${title}: все`;
    }

    const selectedSet = new Set(selectedIds.map(String));
    const selectedLabels = (options || [])
        .filter((item) => selectedSet.has(String(item.id)))
        .map((item) => item.label);

    if (!selectedLabels.length) {
        return `${title}: ${selectedIds.length} выбрано`;
    }

    if (selectedLabels.length <= 2) {
        return `${title}: ${selectedLabels.join(', ')}`;
    }

    return `${title}: ${selectedLabels.slice(0, 2).join(', ')} +${selectedLabels.length - 2}`;
}

function getScopeSummary(config = {}, dictionaries = {}) {
    const monitorScope = config.monitorScope || {};

    return [
        buildScopeText('Статус', getScopeList(monitorScope.status), dictionaries.status || []),
        buildScopeText('Доставка', getScopeList(monitorScope.delivery), dictionaries.delivery || []),
        buildScopeText('Оплата', getScopeList(monitorScope.payment), dictionaries.payment || [])
    ].join('; ');
}

function getNotificationSummary(config = {}) {
    const triggers = getNotificationTriggers(config);
    const enabledFields = Object.values(triggers.changedFields).filter(Boolean).length;

    return [
        `Новые заказы: ${triggers.newOrders ? 'включены' : 'выключены'}`,
        `Изменения заказов: ${triggers.changedOrders ? 'включены' : 'выключены'}`,
        `Поля изменений: ${enabledFields} включено`
    ].join('; ');
}

function renderConfigSummary(config, dictionaries) {
    setText('optionsMonitorMode', getMonitorModeLabel(config));
    setText('optionsScopeSummary', getScopeSummary(config, dictionaries));
    setText('optionsNotificationSummary', getNotificationSummary(config));
    setText('optionsLoadStatus', 'Текущие настройки загружены. Страница пока работает в режиме чтения.');
}

function loadConfigSummary() {
    setText('optionsLoadStatus', 'Загрузка текущих настроек...');

    send({ type: 'GET_CONFIG' }, (res) => {
        if (!res?.ok) {
            setText('optionsLoadStatus', 'Не удалось загрузить текущие настройки.');
            return;
        }

        renderConfigSummary(res.userConfig || {}, res.monitorDictionaries || {});
    });
}

document.addEventListener('DOMContentLoaded', () => {
    loadConfigSummary();
});