const OPTIONS_DEFAULT_NOTIFICATION_TRIGGERS = {
    newOrders: true,
    changedOrders: true,
    changedFields: {
        status: true,
        delivery: true,
        payment: true,
        city: true,
        tags: true
    }
};

const OPTIONS_VISIBLE_CHANGED_FIELDS = [
    { key: 'status', id: 'optionsNotifyFieldStatus' },
    { key: 'delivery', id: 'optionsNotifyFieldDelivery' },
    { key: 'payment', id: 'optionsNotifyFieldPayment' },
    { key: 'city', id: 'optionsNotifyFieldCity' },
    { key: 'tags', id: 'optionsNotifyFieldTags' }
];

let currentConfig = {};
let currentDictionaries = {};
let draftMonitorMode = 'windowed';
let draftNotificationTriggers = getNotificationTriggers({});

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

function setValue(id, value) {
    const el = document.getElementById(id);

    if (el) {
        el.value = String(value || '');
    }
}

function getValue(id) {
    const el = document.getElementById(id);

    return el ? String(el.value || '') : '';
}

function setChecked(id, value) {
    const el = document.getElementById(id);

    if (el) {
        el.checked = Boolean(value);
    }
}

function getChecked(id) {
    const el = document.getElementById(id);

    return el ? Boolean(el.checked) : false;
}

function setDisabled(id, value) {
    const el = document.getElementById(id);

    if (el) {
        el.disabled = Boolean(value);
    }
}

function cloneNotificationTriggers(triggers) {
    return JSON.parse(JSON.stringify(triggers));
}

function areNotificationTriggersEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function getScopeList(values) {
    return Array.isArray(values) ? values.map((value) => String(value)) : [];
}

function getBooleanConfigValue(value, fallback) {
    return value === undefined ? fallback : Boolean(value);
}

function normalizeMonitorMode(value) {
    return String(value || 'windowed') === 'active' ? 'active' : 'windowed';
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
            city: getBooleanConfigValue(changedFields.city, defaultChangedFields.city),
            tags: getBooleanConfigValue(changedFields.tags, defaultChangedFields.tags)
        }
    };
}

function getMonitorModeLabel(config = {}) {
    const mode = normalizeMonitorMode(config.monitorMode);

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

function getDictionaryLabels(options) {
    return Array.isArray(options)
        ? options
            .map((item) => String(item?.label || item?.name || item?.id || '').trim())
            .filter(Boolean)
        : [];
}

function buildDictionaryText(title, options) {
    const labels = getDictionaryLabels(options);

    if (!labels.length) {
        return `${title}: справочник не загружен`;
    }

    if (labels.length <= 3) {
        return `${title}: ${labels.join(', ')}`;
    }

    return `${title}: ${labels.slice(0, 3).join(', ')} +${labels.length - 3}`;
}

function renderScopeDictionaries(dictionaries = {}) {
    setText(
        'optionsScopeDictionaryStatus',
        buildDictionaryText('Статус', dictionaries.status || [])
    );
    setText(
        'optionsScopeDictionaryDelivery',
        buildDictionaryText('Доставка', dictionaries.delivery || [])
    );
    setText(
        'optionsScopeDictionaryPayment',
        buildDictionaryText('Оплата', dictionaries.payment || [])
    );
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
    setText('optionsLoadStatus', 'Текущие настройки загружены.');
}

function renderMonitorModeEditor(config = {}) {
    draftMonitorMode = normalizeMonitorMode(config.monitorMode);
    setValue('optionsMonitorModeSelect', draftMonitorMode);
    setText('optionsMonitorModeEditStatus', 'Изменений нет.');
}

function updateMonitorModeDirtyState() {
    const currentMode = normalizeMonitorMode(currentConfig.monitorMode);

    if (draftMonitorMode === currentMode) {
        setText('optionsMonitorModeEditStatus', 'Изменений нет.');
        return;
    }

    setText('optionsMonitorModeEditStatus', 'Есть несохранённые изменения режима мониторинга.');
}

function applyMonitorMode() {
    const currentMode = normalizeMonitorMode(currentConfig.monitorMode);

    if (draftMonitorMode === currentMode) {
        setText('optionsMonitorModeEditStatus', 'Изменений нет.');
        return;
    }

    const nextConfig = {
        ...currentConfig,
        monitorMode: draftMonitorMode
    };

    send({ type: 'UPDATE_CONFIG', userConfig: nextConfig }, (res) => {
        if (!res?.ok) {
            setText('optionsMonitorModeEditStatus', 'Не удалось сохранить режим мониторинга.');
            return;
        }

        currentConfig = nextConfig;
        renderConfigSummary(currentConfig, currentDictionaries);
        renderMonitorModeEditor(currentConfig);
        setText('optionsMonitorModeEditStatus', 'Режим мониторинга сохранён.');
    });
}

function resetMonitorModeDraft() {
    renderMonitorModeEditor(currentConfig);
}

function bindMonitorModeEditor() {
    const select = document.getElementById('optionsMonitorModeSelect');
    const applyBtn = document.getElementById('optionsApplyMonitorMode');
    const resetBtn = document.getElementById('optionsResetMonitorMode');

    if (select) {
        select.addEventListener('change', () => {
            draftMonitorMode = normalizeMonitorMode(getValue('optionsMonitorModeSelect'));
            updateMonitorModeDirtyState();
        });
    }

    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            applyMonitorMode();
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetMonitorModeDraft();
        });
    }
}

function setNotificationFieldControlsDisabled(disabled) {
    for (const field of OPTIONS_VISIBLE_CHANGED_FIELDS) {
        setDisabled(field.id, disabled);
    }
}

function renderNotificationTriggersEditor(config = {}) {
    draftNotificationTriggers = cloneNotificationTriggers(getNotificationTriggers(config));

    setChecked('optionsNotifyNewOrders', draftNotificationTriggers.newOrders);
    setChecked('optionsNotifyChangedOrders', draftNotificationTriggers.changedOrders);

    for (const field of OPTIONS_VISIBLE_CHANGED_FIELDS) {
        setChecked(field.id, draftNotificationTriggers.changedFields[field.key]);
    }

    setNotificationFieldControlsDisabled(!draftNotificationTriggers.changedOrders);
    setText('optionsNotificationEditStatus', 'Изменений нет.');
}

function updateNotificationTriggersDirtyState() {
    const currentTriggers = getNotificationTriggers(currentConfig);

    if (areNotificationTriggersEqual(draftNotificationTriggers, currentTriggers)) {
        setText('optionsNotificationEditStatus', 'Изменений нет.');
        return;
    }

    setText('optionsNotificationEditStatus', 'Есть несохранённые изменения уведомлений.');
}

function applyNotificationTriggers() {
    const currentTriggers = getNotificationTriggers(currentConfig);

    if (areNotificationTriggersEqual(draftNotificationTriggers, currentTriggers)) {
        setText('optionsNotificationEditStatus', 'Изменений нет.');
        return;
    }

    const nextConfig = {
        ...currentConfig,
        notificationTriggers: cloneNotificationTriggers(draftNotificationTriggers)
    };

    send({ type: 'UPDATE_CONFIG', userConfig: nextConfig }, (res) => {
        if (!res?.ok) {
            setText('optionsNotificationEditStatus', 'Не удалось сохранить настройки уведомлений.');
            return;
        }

        currentConfig = nextConfig;
        renderConfigSummary(currentConfig, currentDictionaries);
        renderNotificationTriggersEditor(currentConfig);
        setText('optionsNotificationEditStatus', 'Настройки уведомлений сохранены.');
    });
}

function resetNotificationTriggersDraft() {
    renderNotificationTriggersEditor(currentConfig);
}

function bindNotificationTriggersEditor() {
    const newOrders = document.getElementById('optionsNotifyNewOrders');
    const changedOrders = document.getElementById('optionsNotifyChangedOrders');
    const applyBtn = document.getElementById('optionsApplyNotificationTriggers');
    const resetBtn = document.getElementById('optionsResetNotificationTriggers');

    if (newOrders) {
        newOrders.addEventListener('change', () => {
            draftNotificationTriggers.newOrders = getChecked('optionsNotifyNewOrders');
            updateNotificationTriggersDirtyState();
        });
    }

    if (changedOrders) {
        changedOrders.addEventListener('change', () => {
            draftNotificationTriggers.changedOrders = getChecked('optionsNotifyChangedOrders');
            setNotificationFieldControlsDisabled(!draftNotificationTriggers.changedOrders);
            updateNotificationTriggersDirtyState();
        });
    }

    for (const field of OPTIONS_VISIBLE_CHANGED_FIELDS) {
        const el = document.getElementById(field.id);

        if (el) {
            el.addEventListener('change', () => {
                draftNotificationTriggers.changedFields[field.key] = getChecked(field.id);
                updateNotificationTriggersDirtyState();
            });
        }
    }

    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            applyNotificationTriggers();
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetNotificationTriggersDraft();
        });
    }
}

function loadConfigSummary() {
    setText('optionsLoadStatus', 'Загрузка текущих настроек...');

    send({ type: 'GET_CONFIG' }, (res) => {
        if (!res?.ok) {
            setText('optionsLoadStatus', 'Не удалось загрузить текущие настройки.');
            return;
        }

        currentConfig = res.userConfig || {};
        currentDictionaries = res.monitorDictionaries || {};

        renderConfigSummary(currentConfig, currentDictionaries);
        renderScopeDictionaries(currentDictionaries);
        renderMonitorModeEditor(currentConfig);
        renderNotificationTriggersEditor(currentConfig);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindMonitorModeEditor();
    bindNotificationTriggersEditor();
    loadConfigSummary();
});