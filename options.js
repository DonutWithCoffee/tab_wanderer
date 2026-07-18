const OPTIONS_DEFAULT_DEEP_SYNC_MAX_PAGES = 50;
const OPTIONS_MIN_DEEP_SYNC_MAX_PAGES = 1;
const OPTIONS_MAX_DEEP_SYNC_MAX_PAGES = 50;
const OPTIONS_DEFAULT_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES = 2;
const OPTIONS_MIN_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES = 2;
const OPTIONS_MAX_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES = 30;
const OPTIONS_WATCHED_ORDER_FOLLOW_UP_INTERVAL_OPTIONS = [2, 5, 10, 15, 30];
const OPTIONS_SCOPE_AUTOSAVE_DEBOUNCE_MS = 700;
const OPTIONS_WATCHED_ORDER_LIMIT = 100;

const OPTIONS_WATCHED_ORDER_STATUS_LABELS = {
    active: 'активен',
    unresolved: 'не найден'
};

const OPTIONS_DEFAULT_NOTIFICATION_TRIGGERS = {
    newOrders: true,
    changedOrders: true,
    changedFields: {
        status: true,
        delivery: true,
        payment: true,
        city: true
    }
};

const OPTIONS_DEFAULT_NOTIFICATION_SUPPRESSORS = {
    ignoreLegalEntityPayment: false,
    notifyLegalEntityPaymentOnly: false,
    ignoreOzon: false
};

const OPTIONS_NOTIFICATION_SUPPRESSOR_CONTROLS = [
    { key: 'ignoreLegalEntityPayment', id: 'optionsSuppressLegalEntityPayment' },
    { key: 'notifyLegalEntityPaymentOnly', id: 'optionsNotifyLegalEntityPaymentOnly' },
    { key: 'ignoreOzon', id: 'optionsSuppressOzon' }
];

const OPTIONS_VISIBLE_CHANGED_FIELDS = [
    { key: 'status', id: 'optionsNotifyFieldStatus' },
    { key: 'delivery', id: 'optionsNotifyFieldDelivery' },
    { key: 'payment', id: 'optionsNotifyFieldPayment' },
    { key: 'city', id: 'optionsNotifyFieldCity' }
];

const OPTIONS_SCOPE_GROUPS = [
    { key: 'status', title: 'Статус', dictionaryId: 'optionsScopeDictionaryStatus', containerId: 'optionsScopeStatusList' },
    { key: 'delivery', title: 'Доставка', dictionaryId: 'optionsScopeDictionaryDelivery', containerId: 'optionsScopeDeliveryList' },
    { key: 'payment', title: 'Оплата', dictionaryId: 'optionsScopeDictionaryPayment', containerId: 'optionsScopePaymentList' },
    { key: 'store', title: 'Склад', dictionaryId: 'optionsScopeDictionaryStore', containerId: 'optionsScopeStoreList' }
];

let currentConfig = {};
let currentDictionaries = {};
let currentMonitorStatus = {};
let lastDiagnosticLogText = '';
let scopeControlRefs = {};
let pendingMonitorScopeAutosaveTimer = null;
let pendingMonitorScopeAutosaveValue = null;

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
        el.value = String(value ?? '');
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

function clearElement(el) {
    if (!el) {
        return;
    }

    el.innerText = '';
    el.textContent = '';
    el.innerHTML = '';

    if (Array.isArray(el.children)) {
        el.children.length = 0;
    }
}

function appendText(el, text) {
    if (!el) {
        return;
    }

    if (document.createTextNode && el.appendChild) {
        el.appendChild(document.createTextNode(String(text)));
        return;
    }

    el.innerText = `${el.innerText || ''}${String(text)}`;
}

function getNumber(value, fallback = 0) {
    const numeric = Number(value);

    return Number.isFinite(numeric) ? numeric : fallback;
}

function getTextValue(value, fallback = '—') {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    return String(value);
}

function getYesNo(value) {
    return value ? 'да' : 'нет';
}

function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function getScopeList(values) {
    return Array.isArray(values) ? values.map((value) => String(value)) : [];
}

function getBooleanConfigValue(value, fallback) {
    return value === undefined ? fallback : Boolean(value);
}

function normalizeWatchedOrderId(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();
}

function isValidWatchedOrderId(value) {
    return /^\d{1,10}-\d{4,10}$/.test(normalizeWatchedOrderId(value));
}

function normalizeWatchedOrderTimestamp(value) {
    const numeric = Number(value);

    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeWatchedOrderStatus(value) {
    const status = String(value || '').trim();

    return status === 'unresolved' ? 'unresolved' : 'active';
}

function normalizeWatchedOrderItem(value) {
    const source = value && typeof value === 'object' ? value : { id: value };
    const id = normalizeWatchedOrderId(source.id);

    if (!isValidWatchedOrderId(id)) {
        return null;
    }

    return {
        id,
        status: normalizeWatchedOrderStatus(source.status),
        addedAt: normalizeWatchedOrderTimestamp(source.addedAt) || Date.now(),
        lastCheckedAt: normalizeWatchedOrderTimestamp(source.lastCheckedAt),
        lastEventAt: normalizeWatchedOrderTimestamp(source.lastEventAt),
        lastError: source.lastError ? String(source.lastError) : null
    };
}

function normalizeWatchedOrdersConfig(value = {}) {
    const rawItems = Array.isArray(value)
        ? value
        : Array.isArray(value?.items)
            ? value.items
            : Array.isArray(value?.orders)
                ? value.orders
                : [];
    const seenIds = new Set();
    const items = [];

    for (const rawItem of rawItems) {
        const item = normalizeWatchedOrderItem(rawItem);

        if (!item || seenIds.has(item.id)) {
            continue;
        }

        seenIds.add(item.id);
        items.push(item);

        if (items.length >= OPTIONS_WATCHED_ORDER_LIMIT) {
            break;
        }
    }

    return { items };
}

function getWatchedOrdersConfig(config = {}) {
    return normalizeWatchedOrdersConfig(config.watchedOrders);
}

function getWatchedOrdersSummary(config = {}) {
    const count = getWatchedOrdersConfig(config).items.length;
    const lastDigit = count % 10;
    const lastTwoDigits = count % 100;

    if (!count) {
        return 'нет';
    }

    if (lastDigit === 1 && lastTwoDigits !== 11) {
        return `${count} заказ`;
    }

    if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
        return `${count} заказа`;
    }

    return `${count} заказов`;
}

function getWatchedOrdersSummaryWithInterval(config = {}) {
    return `${getWatchedOrdersSummary(config)}; проверка: ${getWatchedOrderFollowUpIntervalLabel(config)}`;
}

function normalizeMonitorMode(value) {
    return String(value || 'windowed') === 'active' ? 'active' : 'windowed';
}

function normalizeWatchedOrderFollowUpIntervalMinutes(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return OPTIONS_DEFAULT_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES;
    }

    const integer = Math.floor(numeric);

    if (integer <= OPTIONS_MIN_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES) {
        return OPTIONS_MIN_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES;
    }

    if (integer >= OPTIONS_MAX_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES) {
        return OPTIONS_MAX_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES;
    }

    const exact = OPTIONS_WATCHED_ORDER_FOLLOW_UP_INTERVAL_OPTIONS.find((item) => item === integer);

    if (exact) {
        return exact;
    }

    return OPTIONS_WATCHED_ORDER_FOLLOW_UP_INTERVAL_OPTIONS.find((item) => item >= integer)
        || OPTIONS_DEFAULT_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES;
}

function getWatchedOrderFollowUpIntervalLabel(config = {}) {
    return `каждые ${normalizeWatchedOrderFollowUpIntervalMinutes(config.watchedOrderFollowUpIntervalMinutes)} мин.`;
}

function normalizeDeepSyncMaxPages(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return OPTIONS_DEFAULT_DEEP_SYNC_MAX_PAGES;
    }

    const integer = Math.floor(numeric);

    if (integer < OPTIONS_MIN_DEEP_SYNC_MAX_PAGES) {
        return OPTIONS_MIN_DEEP_SYNC_MAX_PAGES;
    }

    if (integer > OPTIONS_MAX_DEEP_SYNC_MAX_PAGES) {
        return OPTIONS_MAX_DEEP_SYNC_MAX_PAGES;
    }

    return integer;
}

function getNotificationSuppressors(config = {}) {
    const suppressors = config?.notificationSuppressors || {};

    return {
        ignoreLegalEntityPayment: getBooleanConfigValue(
            suppressors.ignoreLegalEntityPayment,
            OPTIONS_DEFAULT_NOTIFICATION_SUPPRESSORS.ignoreLegalEntityPayment
        ),
        notifyLegalEntityPaymentOnly: getBooleanConfigValue(
            suppressors.notifyLegalEntityPaymentOnly,
            OPTIONS_DEFAULT_NOTIFICATION_SUPPRESSORS.notifyLegalEntityPaymentOnly
        ),
        ignoreOzon: getBooleanConfigValue(
            suppressors.ignoreOzon,
            OPTIONS_DEFAULT_NOTIFICATION_SUPPRESSORS.ignoreOzon
        )
    };
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
            city: getBooleanConfigValue(changedFields.city, defaultChangedFields.city)
        }
    };
}

function getMonitorModeLabel(config = {}) {
    const mode = normalizeMonitorMode(config.monitorMode);

    if (mode === 'active') {
        return 'Только первая страница';
    }

    return 'Первая страница + глубокая проверка';
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

function normalizeDictionaryOptions(options) {
    return Array.isArray(options)
        ? options
            .map((item) => ({
                id: String(item?.id || '').trim(),
                label: String(item?.label || item?.name || item?.id || '').trim()
            }))
            .filter((item) => item.id && item.label)
        : [];
}

function getDictionaryLabels(options) {
    return normalizeDictionaryOptions(options).map((item) => item.label);
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
    for (const group of OPTIONS_SCOPE_GROUPS) {
        setText(group.dictionaryId, buildDictionaryText(group.title, dictionaries[group.key] || []));
    }
}

function getMonitorScope(config = {}) {
    const monitorScope = config.monitorScope || {};
    const result = {};

    for (const group of OPTIONS_SCOPE_GROUPS) {
        result[group.key] = getScopeList(monitorScope[group.key]);
    }

    return result;
}

function getScopeSummary(config = {}, dictionaries = {}) {
    const monitorScope = getMonitorScope(config);

    return OPTIONS_SCOPE_GROUPS
        .map((group) => buildScopeText(group.title, monitorScope[group.key], dictionaries[group.key] || []))
        .join('; ');
}

function getLegalEntityNotificationModeLabel(suppressors = {}) {
    if (suppressors.notifyLegalEntityPaymentOnly) {
        return 'только они';
    }

    return suppressors.ignoreLegalEntityPayment ? 'игнорируются' : 'уведомляются';
}

function getNotificationSummary(config = {}) {
    const triggers = getNotificationTriggers(config);
    const suppressors = getNotificationSuppressors(config);
    const enabledFields = Object.values(triggers.changedFields).filter(Boolean).length;

    return [
        `Новые заказы: ${triggers.newOrders ? 'включены' : 'выключены'}`,
        `Изменения заказов: ${triggers.changedOrders ? 'включены' : 'выключены'}`,
        `Поля изменений: ${enabledFields} включено`,
        `Юрики: ${getLegalEntityNotificationModeLabel(suppressors)}`,
        `ОЗОН: ${suppressors.notifyLegalEntityPaymentOnly
            ? 'фильтр не применяется'
            : (suppressors.ignoreOzon ? 'игнорируется' : 'уведомляется')}`
    ].join('; ');
}

function getScopeControlId(groupKey, index) {
    return `optionsScope_${groupKey}_${index}`;
}

function renderScopeFallback(container, text) {
    clearElement(container);

    const fallback = document.createElement('p');
    fallback.className = 'muted';
    fallback.innerText = text;

    if (container?.appendChild) {
        container.appendChild(fallback);
    } else if (container) {
        container.innerText = text;
    }
}

function renderScopeGroup(group, selectedIds, options) {
    const container = document.getElementById(group.containerId);
    const normalizedOptions = normalizeDictionaryOptions(options);
    const selectedSet = new Set(selectedIds.map(String));

    scopeControlRefs[group.key] = [];

    if (!container) {
        return;
    }

    if (!normalizedOptions.length) {
        renderScopeFallback(container, selectedIds.length
            ? `Список не загружен. Сохранено: ${selectedIds.length}.`
            : 'Список не загружен. Пусто = все.');
        return;
    }

    clearElement(container);

    for (const [index, option] of normalizedOptions.entries()) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        const text = document.createElement('span');

        label.className = 'checkbox-row';
        input.type = 'checkbox';
        input.id = getScopeControlId(group.key, index);
        input.name = input.id;
        input.autocomplete = 'off';
        input.value = option.id;
        input.checked = selectedSet.has(option.id);
        text.innerText = option.label;

        input.addEventListener('change', () => {
            scheduleMonitorScopeSaveFromUI();
        });

        scopeControlRefs[group.key].push({ input, value: option.id });

        if (label.appendChild) {
            label.appendChild(input);
            label.appendChild(text);
        } else {
            label.innerText = option.label;
        }

        if (container.appendChild) {
            container.appendChild(label);
        }
    }
}

function renderScopeControls(config = {}, dictionaries = {}) {
    const monitorScope = getMonitorScope(config);
    let loadedGroups = 0;

    scopeControlRefs = {};

    for (const group of OPTIONS_SCOPE_GROUPS) {
        const options = normalizeDictionaryOptions(dictionaries[group.key] || []);

        if (options.length) {
            loadedGroups += 1;
        }

        renderScopeGroup(group, monitorScope[group.key], options);
    }

    setText(
        'optionsScopeHint',
        loadedGroups
            ? 'Пусто в группе = все. Изменения сохраняются автоматически.'
            : 'Списки появятся после запуска мониторинга. Пока пусто = все.'
    );
}

function renderConfigSummary(config, dictionaries) {

    setText('optionsMonitorMode', getMonitorModeLabel(config));
    setText('optionsDeepSyncSummary', `${normalizeDeepSyncMaxPages(config.deepSyncMaxPages)} страниц`);
    setText('optionsScopeSummary', getScopeSummary(config, dictionaries));
    setText('optionsNotificationSummary', getNotificationSummary(config));
    setText('optionsWatchedOrdersSummary', getWatchedOrdersSummaryWithInterval(config));
    setText('optionsLoadStatus', 'Настройки загружены.');
}

function setNotificationFieldControlsDisabled(disabled) {
    for (const field of OPTIONS_VISIBLE_CHANGED_FIELDS) {
        setDisabled(field.id, disabled);
    }
}

function normalizeOptionsNotificationSuppressors(suppressors = {}) {
    const normalized = {
        ...OPTIONS_DEFAULT_NOTIFICATION_SUPPRESSORS,
        ...suppressors
    };

    if (normalized.notifyLegalEntityPaymentOnly) {
        normalized.ignoreLegalEntityPayment = false;
        normalized.ignoreOzon = false;
    }

    return normalized;
}

function renderSettings(config = {}) {
    const triggers = getNotificationTriggers(config);
    const suppressors = normalizeOptionsNotificationSuppressors(getNotificationSuppressors(config));

    setValue('optionsMonitorModeSelect', normalizeMonitorMode(config.monitorMode));
    setValue('optionsDeepSyncMaxPages', normalizeDeepSyncMaxPages(config.deepSyncMaxPages));
    renderScopeControls(config, currentDictionaries);
    renderWatchedOrders(config);

    setChecked('optionsNotifyNewOrders', triggers.newOrders);
    setChecked('optionsNotifyChangedOrders', triggers.changedOrders);

    for (const field of OPTIONS_VISIBLE_CHANGED_FIELDS) {
        setChecked(field.id, triggers.changedFields[field.key]);
    }

    for (const suppressor of OPTIONS_NOTIFICATION_SUPPRESSOR_CONTROLS) {
        setChecked(suppressor.id, suppressors[suppressor.key]);
    }

    setDisabled('optionsSuppressLegalEntityPayment', suppressors.notifyLegalEntityPaymentOnly);
    setDisabled('optionsSuppressOzon', suppressors.notifyLegalEntityPaymentOnly);
    setNotificationFieldControlsDisabled(!triggers.changedOrders);
}

function saveConfig(nextConfig, successMessage = 'Сохранено.') {
    const configToSave = cloneValue(nextConfig || {});

    setText('optionsSettingsSaveStatus', 'Сохраняем...');

    send({ type: 'UPDATE_CONFIG', userConfig: configToSave }, (res) => {
        if (!res?.ok) {
            setText('optionsSettingsSaveStatus', 'Ошибка сохранения настроек.');
            renderSettings(currentConfig);
            return;
        }

        currentConfig = res.userConfig || configToSave;
        renderSettings(currentConfig);
        renderConfigSummary(currentConfig, currentDictionaries);
        setText('optionsSettingsSaveStatus', successMessage);
        loadMonitorDiagnostics();
    });
}

function saveMonitorModeFromUI() {
    const nextConfig = {
        ...currentConfig,
        monitorMode: normalizeMonitorMode(getValue('optionsMonitorModeSelect'))
    };

    saveConfig(nextConfig, 'Режим мониторинга сохранён.');
}

function saveDeepSyncMaxPagesFromUI() {
    const nextConfig = {
        ...currentConfig,
        deepSyncMaxPages: normalizeDeepSyncMaxPages(getValue('optionsDeepSyncMaxPages'))
    };

    saveConfig(nextConfig, 'Глубина синхронизации сохранена.');
}

function collectMonitorScopeFromUI(baseConfig = {}) {
    const currentScope = getMonitorScope(baseConfig);
    const nextScope = {
        ...currentScope
    };

    for (const group of OPTIONS_SCOPE_GROUPS) {
        const controls = scopeControlRefs[group.key] || [];

        if (!controls.length) {
            nextScope[group.key] = currentScope[group.key];
            continue;
        }

        nextScope[group.key] = controls
            .filter((item) => item.input?.checked === true)
            .map((item) => item.value);
    }

    return nextScope;
}

function saveMonitorScopeFromUI(scopeValue = null) {
    const nextConfig = {
        ...currentConfig,
        monitorScope: scopeValue || collectMonitorScopeFromUI(currentConfig)
    };

    pendingMonitorScopeAutosaveValue = null;
    saveConfig(nextConfig, 'Область сбора сохранена. База обновится без лишних уведомлений.');
}

function scheduleMonitorScopeSaveFromUI() {
    pendingMonitorScopeAutosaveValue = collectMonitorScopeFromUI(currentConfig);

    const pendingConfig = {
        ...currentConfig,
        monitorScope: pendingMonitorScopeAutosaveValue
    };

    renderConfigSummary(pendingConfig, currentDictionaries);
    setText('optionsSettingsSaveStatus', 'Область сбора изменена. Скоро сохраним...');

    if (pendingMonitorScopeAutosaveTimer !== null && typeof clearTimeout === 'function') {
        clearTimeout(pendingMonitorScopeAutosaveTimer);
    }

    const runAutosave = () => {
        pendingMonitorScopeAutosaveTimer = null;
        saveMonitorScopeFromUI(pendingMonitorScopeAutosaveValue);
    };

    if (typeof setTimeout !== 'function') {
        runAutosave();
        return;
    }

    pendingMonitorScopeAutosaveTimer = setTimeout(runAutosave, OPTIONS_SCOPE_AUTOSAVE_DEBOUNCE_MS);
}


function getWatchedOrderStatusLabel(status) {
    return OPTIONS_WATCHED_ORDER_STATUS_LABELS[status] || status || 'активен';
}

function formatWatchedOrderTimestamp(value) {
    const timestamp = Number(value);

    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return '—';
    }

    return new Date(timestamp).toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function renderWatchedOrders(config = {}) {
    const listEl = document.getElementById('optionsWatchedOrdersList');
    const watchedOrders = getWatchedOrdersConfig(config);

    setText(
        'optionsWatchedOrdersStatus',
        watchedOrders.items.length
            ? `Отслеживается заказов: ${watchedOrders.items.length}. Они проверяются отдельно при включённом мониторинге.`
            : 'Список пуст. Добавьте номер заказа на странице отслеживания.'
    );

    if (!listEl) {
        return;
    }

    clearElement(listEl);

    if (!watchedOrders.items.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.innerText = 'Нет отслеживаемых заказов.';
        listEl.appendChild(empty);
        return;
    }

    for (const item of watchedOrders.items) {
        const row = document.createElement('div');
        const body = document.createElement('div');
        const title = document.createElement('strong');
        const meta = document.createElement('div');
        const removeButton = document.createElement('button');

        row.className = 'watched-order-row';
        body.className = 'watched-order-body';
        meta.className = 'watched-order-meta';
        title.innerText = `Заказ №${item.id}`;
        meta.innerText = [
            `статус: ${getWatchedOrderStatusLabel(item.status)}`,
            `добавлен: ${formatWatchedOrderTimestamp(item.addedAt)}`,
            `первая проверка: ${formatWatchedOrderTimestamp(item.lastBaselineAt)}`,
            `последняя проверка: ${formatWatchedOrderTimestamp(item.lastCheckedAt)}`,
            `последнее событие: ${formatWatchedOrderTimestamp(item.lastEventAt)}`,
            item.lastError ? `ошибка: ${item.lastError}` : null
        ].filter(Boolean).join('; ');
        removeButton.type = 'button';
        removeButton.innerText = 'Удалить';
        removeButton.addEventListener('click', () => {
            removeWatchedOrderFromUI(item.id);
        });

        body.appendChild(title);
        body.appendChild(meta);
        row.appendChild(body);
        row.appendChild(removeButton);
        listEl.appendChild(row);
    }
}

function saveWatchedOrdersFromUI(nextWatchedOrders, successMessage) {
    const nextConfig = {
        ...currentConfig,
        watchedOrders: normalizeWatchedOrdersConfig(nextWatchedOrders)
    };

    saveConfig(nextConfig, successMessage || 'Список отслеживаемых заказов сохранён.');
}

function addWatchedOrderFromUI() {
    const input = document.getElementById('optionsWatchedOrderInput');
    const id = normalizeWatchedOrderId(input?.value);

    if (!isValidWatchedOrderId(id)) {
        setText('optionsWatchedOrdersStatus', 'Введите номер заказа в формате 1234-110626.');
        return;
    }

    const watchedOrders = getWatchedOrdersConfig(currentConfig);

    if (watchedOrders.items.some(item => item.id === id)) {
        setText('optionsWatchedOrdersStatus', `Заказ №${id} уже есть в списке.`);
        return;
    }

    if (watchedOrders.items.length >= OPTIONS_WATCHED_ORDER_LIMIT) {
        setText('optionsWatchedOrdersStatus', `Достигнут лимит: ${OPTIONS_WATCHED_ORDER_LIMIT} заказов.`);
        return;
    }

    if (input) {
        input.value = '';
    }

    saveWatchedOrdersFromUI(
        {
            items: [
                ...watchedOrders.items,
                {
                    id,
                    status: 'active',
                    addedAt: Date.now(),
                    lastCheckedAt: null,
                    lastBaselineAt: null,
                    lastEventAt: null,
                    lastError: null
                }
            ]
        },
        'Отслеживаемый заказ добавлен. Первая успешная прямая проверка станет baseline без уведомления.'
    );
}

function removeWatchedOrderFromUI(orderId) {
    const id = normalizeWatchedOrderId(orderId);
    const watchedOrders = getWatchedOrdersConfig(currentConfig);

    saveWatchedOrdersFromUI(
        {
            items: watchedOrders.items.filter(item => item.id !== id)
        },
        `Заказ №${id} удалён из отслеживаемых.`
    );
}

function collectNotificationTriggersFromUI(baseConfig = {}) {
    const currentTriggers = getNotificationTriggers(baseConfig);
    const changedFields = { ...currentTriggers.changedFields };

    for (const field of OPTIONS_VISIBLE_CHANGED_FIELDS) {
        changedFields[field.key] = getChecked(field.id);
    }

    return {
        ...currentTriggers,
        newOrders: getChecked('optionsNotifyNewOrders'),
        changedOrders: getChecked('optionsNotifyChangedOrders'),
        changedFields
    };
}

function saveNotificationTriggersFromUI(successMessage = 'Уведомления сохранены.') {
    const nextTriggers = collectNotificationTriggersFromUI(currentConfig);
    const nextConfig = {
        ...currentConfig,
        notificationTriggers: nextTriggers
    };

    setNotificationFieldControlsDisabled(!nextTriggers.changedOrders);
    saveConfig(nextConfig, successMessage);
}

function collectNotificationSuppressorsFromUI(baseConfig = {}) {
    const suppressors = getNotificationSuppressors(baseConfig);

    for (const suppressor of OPTIONS_NOTIFICATION_SUPPRESSOR_CONTROLS) {
        suppressors[suppressor.key] = getChecked(suppressor.id);
    }

    return normalizeOptionsNotificationSuppressors(suppressors);
}

function saveNotificationSuppressorsFromUI(successMessage = 'Фильтры уведомлений сохранены.') {
    const nextConfig = {
        ...currentConfig,
        notificationSuppressors: collectNotificationSuppressorsFromUI(currentConfig)
    };

    saveConfig(nextConfig, successMessage);
}

function bindSettingsAutosave() {
    const monitorMode = document.getElementById('optionsMonitorModeSelect');
    const deepSyncMaxPages = document.getElementById('optionsDeepSyncMaxPages');

    if (monitorMode) {
        monitorMode.addEventListener('change', () => {
            saveMonitorModeFromUI();
        });
    }

    if (deepSyncMaxPages) {
        deepSyncMaxPages.addEventListener('change', () => {
            saveDeepSyncMaxPagesFromUI();
        });
    }

    const triggerControlIds = [
        'optionsNotifyNewOrders',
        'optionsNotifyChangedOrders',
        ...OPTIONS_VISIBLE_CHANGED_FIELDS.map((field) => field.id)
    ];
    const suppressorControlIds = OPTIONS_NOTIFICATION_SUPPRESSOR_CONTROLS.map((item) => item.id);


    for (const id of triggerControlIds) {
        const control = document.getElementById(id);

        if (control) {
            control.addEventListener('change', () => {
                saveNotificationTriggersFromUI();
            });
        }
    }

    for (const id of suppressorControlIds) {
        const control = document.getElementById(id);

        if (control) {
            control.addEventListener('change', () => {
                saveNotificationSuppressorsFromUI();
            });
        }
    }
}

function buildLastCollectionMetadataText(metadata) {
    if (!metadata) {
        return 'последний сбор: нет';
    }

    return [
        `последний сбор: ${getTextValue(metadata.syncReason || metadata.reason)}`,
        `страниц: ${getNumber(metadata.pagesCollected)}`,
        `заказов: ${getNumber(metadata.ordersCollected)}`,
        `завершён: ${getYesNo(metadata.isComplete === true)}`,
        `лимит: ${getNumber(metadata.maxPages)}`
    ].join('; ');
}

function buildCollectionSessionText(session) {
    if (!session) {
        return 'сессия: нет';
    }

    return [
        `сессия: ${getTextValue(session.mode)}`,
        `заказов: ${getNumber(session.ordersCount)}`,
        `текущая страница: ${getNumber(session.currentPage, 1)}`,
        `последняя страница: ${getNumber(session.lastCollectedPage)}`,
        `следующая: ${getNumber(session.nextPage, 1)}`,
        `попыток: ${getNumber(session.advanceAttempts)}`
    ].join('; ');
}

function renderMonitorDiagnostics(status = {}) {
    currentMonitorStatus = status || {};
    setText(
        'optionsDiagnosticsRuntime',
        [
            `работает: ${getYesNo(status.isRunning === true)}`,
            `состояние: ${getTextValue(status.monitorState, 'uninitialized')}`,
            `режим: ${getMonitorModeLabel({ monitorMode: status.monitorMode })}`,
            `глубина: ${getNumber(status.deepSyncMaxPages, OPTIONS_DEFAULT_DEEP_SYNC_MAX_PAGES)} страниц`,
            `отслеживаемые: каждые ${getNumber(status.watchedOrderFollowUpIntervalMinutes, OPTIONS_DEFAULT_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES)} мин.`
        ].join('; ')
    );

    setText(
        'optionsDiagnosticsWorker',
        [
            `основной worker: ${getYesNo(status.hasWorkerTab === true)}`,
            `tabId: ${status.workerTabId === null || status.workerTabId === undefined ? '—' : String(status.workerTabId)}`
        ].join('; ')
    );

    const directState = status.directFollowUpState || {};
    const addState = status.watchedOrderAddState || {};
    const directError = directState.lastError || addState.lastResult?.error || null;
    const directParts = [
        `worker: ${getYesNo(status.hasDirectWorkerTab === true)}`,
        `tabId: ${status.directWorkerTabId === null || status.directWorkerTabId === undefined ? '—' : String(status.directWorkerTabId)}`,
        `отслеживаемых: ${getNumber(status.watchedOrdersCount)}`,
        `интервал: ${getNumber(status.watchedOrderFollowUpIntervalMinutes, OPTIONS_DEFAULT_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES)} мин.`,
        `текущий заказ: ${getTextValue(directState.currentOrderId)}`,
        `добавление: ${addState.pending === true ? `проверяется ${getTextValue(addState.orderId)}` : 'нет'}`
    ];

    if (directError) {
        directParts.push(`последняя ошибка: ${getTextValue(directError)}`);
    }

    setText('optionsDiagnosticsDirect', directParts.join('; '));

    setText(
        'optionsDiagnosticsOrders',
        [
            `известно: ${getNumber(status.knownOrdersCount)}`,
            `окно: ${getNumber(status.windowOrdersCount)}`,
            `hashes: ${getNumber(status.knownHashesCount)} / ${getNumber(status.windowHashesCount)}`,
            `целей уведомлений: ${getNumber(status.notificationTargetsCount)}`
        ].join('; ')
    );

    setText(
        'optionsDiagnosticsJournal',
        [
            `история: ${getNumber(status.eventJournalCount)}`,
            `диагностика: ${getNumber(status.diagnosticLogCount)}`,
            `удалено: ${getNumber(status.eventJournalDroppedEntries)} / ${getNumber(status.diagnosticLogDroppedEntries)}`
        ].join('; ')
    );

    setText(
        'optionsDiagnosticsSync',
        [
            `ожидает перебазировки: ${getYesNo(status.pendingRebaseline === true)}`,
            `причина: ${getTextValue(status.pendingSyncReason)}`,
            `последний baseline: ${getTextValue(status.lastBaselineDate)}`,
            `последняя глубокая синхронизация: ${formatTimestamp(status.lastDeepSyncAt)}`
        ].join('; ')
    );

    setText(
        'optionsDiagnosticsCollection',
        [
            buildCollectionSessionText(status.collectionSession),
            buildLastCollectionMetadataText(status.lastCollectionMetadata)
        ].join('; ')
    );

    setText('optionsDiagnosticsStatus', 'Диагностика загружена.');
}

function loadMonitorDiagnostics() {
    setText('optionsDiagnosticsStatus', 'Загрузка диагностики...');

    send({ type: 'GET_MONITOR_STATUS' }, (res) => {
        if (!res?.ok) {
            setText('optionsDiagnosticsStatus', 'Не удалось загрузить диагностику.');
            return;
        }

        renderMonitorDiagnostics(res.status || {});
    });
}

function bindDiagnosticsActions() {
    const refreshBtn = document.getElementById('optionsRefreshDiagnostics');

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadMonitorDiagnostics();
        });
    }
}

function padDatePart(value) {
    return String(value).padStart(2, '0');
}

function formatTimestamp(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric) || numeric <= 0) {
        return '—';
    }

    const date = new Date(numeric);

    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    return [
        date.getFullYear(),
        '-',
        padDatePart(date.getMonth() + 1),
        '-',
        padDatePart(date.getDate()),
        ' ',
        padDatePart(date.getHours()),
        ':',
        padDatePart(date.getMinutes()),
        ':',
        padDatePart(date.getSeconds())
    ].join('');
}

function getExtensionVersion() {
    try {
        if (chrome?.runtime?.getManifest) {
            return chrome.runtime.getManifest().version || 'unknown';
        }
    } catch {}

    return 'unknown';
}

function getOptionalNumberText(value) {
    const numeric = Number(value);

    return Number.isFinite(numeric) ? String(numeric) : '—';
}

function getDiagnosticMonitorModeLabel(mode) {
    return String(mode || 'windowed') === 'active'
        ? 'Только первая страница'
        : 'Первая страница + глубокая проверка';
}

function getDiagnosticMonitorStateLabel(state) {
    const normalized = String(state || 'uninitialized');

    if (normalized === 'active') {
        return 'работает';
    }

    if (normalized === 'warming') {
        return 'стартовая синхронизация';
    }

    return normalized;
}

function stringifyDiagnosticDetails(details) {
    if (details === null || details === undefined) {
        return '';
    }

    if (typeof details === 'string') {
        return details;
    }

    try {
        return JSON.stringify(details);
    } catch {
        return String(details);
    }
}

function formatDiagnosticLogEntry(entry = {}) {
    const detailsText = stringifyDiagnosticDetails(entry.details);
    const base = [
        `[${formatTimestamp(entry.createdAt)}]`,
        getTextValue(entry.level, 'INFO'),
        getTextValue(entry.scope, 'GENERAL'),
        getTextValue(entry.message, '')
    ]
        .filter(Boolean)
        .join(' ');

    return detailsText ? `${base} ${detailsText}` : base;
}

function buildLastCollectionLogHeader(metadata = {}) {
    if (!metadata) {
        return 'Последний сбор: нет данных';
    }

    return [
        `Последний сбор: причина=${getTextValue(metadata.syncReason || metadata.reason)}`,
        `страниц=${getOptionalNumberText(metadata.pagesCollected)}`,
        `заказов=${getOptionalNumberText(metadata.ordersCollected)}`,
        `завершён=${getYesNo(metadata.isComplete === true)}`,
        `лимит=${getOptionalNumberText(metadata.maxPages)}`,
        `completion=${getTextValue(metadata.completionReason)}`
    ].join('; ');
}

function buildMonitorStatusLogHeader(status = {}) {
    const directState = status.directFollowUpState || {};

    return [
        'Диагностический лог tab_wanderer',
        `Версия расширения: ${getExtensionVersion()}`,
        `Сформирован: ${formatTimestamp(Date.now())}`,
        `Мониторинг: включён=${getYesNo(status.isRunning === true)}; состояние=${getDiagnosticMonitorStateLabel(status.monitorState)}; режим=${getDiagnosticMonitorModeLabel(status.monitorMode)}; глубина=${getOptionalNumberText(status.deepSyncMaxPages)} страниц`,
        `Основной worker: ${getYesNo(status.hasWorkerTab === true)}; tabId=${status.workerTabId === null || status.workerTabId === undefined ? '—' : String(status.workerTabId)}`,
        `Прямая проверка: worker=${getYesNo(status.hasDirectWorkerTab === true)}; tabId=${status.directWorkerTabId === null || status.directWorkerTabId === undefined ? '—' : String(status.directWorkerTabId)}; отслеживаемых=${getNumber(status.watchedOrdersCount)}; интервал=${getNumber(status.watchedOrderFollowUpIntervalMinutes, OPTIONS_DEFAULT_WATCHED_ORDER_FOLLOW_UP_INTERVAL_MINUTES)} мин.; текущий заказ=${getTextValue(directState.currentOrderId)}`,
        `Заказы: известно=${getNumber(status.knownOrdersCount)}; окно=${getNumber(status.windowOrdersCount)}; hash=${getNumber(status.knownHashesCount)} / ${getNumber(status.windowHashesCount)}; целей уведомлений=${getNumber(status.notificationTargetsCount)}`,
        `Журналы: диагностика=${getNumber(status.diagnosticLogCount)}; история=${getNumber(status.eventJournalCount)}; удалено диагностических=${getNumber(status.diagnosticLogDroppedEntries)}; удалено исторических=${getNumber(status.eventJournalDroppedEntries)}`,
        `Синхронизация: ожидает перебазировки=${getYesNo(status.pendingRebaseline === true)}; причина=${getTextValue(status.pendingSyncReason)}; последний baseline=${getTextValue(status.lastBaselineDate)}; последний deep sync=${formatTimestamp(status.lastDeepSyncAt)}`,
        buildLastCollectionLogHeader(status.lastCollectionMetadata)
    ];
}

function getChronologicalDiagnosticLogEntries(entries = []) {
    return Array.isArray(entries)
        ? entries.slice().sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
        : [];
}

function buildDiagnosticLogText(snapshot = {}, status = currentMonitorStatus || {}) {
    const entries = getChronologicalDiagnosticLogEntries(snapshot.entries);
    const fullMode = snapshot.mode === 'full';
    const droppedEntries = getNumber(snapshot.droppedEntries || snapshot.retention?.droppedEntries);
    const retention = snapshot.retention || {};
    const totalForMode = fullMode
        ? getNumber(snapshot.retainedTotal || snapshot.storedTotal || snapshot.total)
        : getNumber(snapshot.total);
    const header = [
        ...buildMonitorStatusLogHeader(status),
        fullMode
            ? `Экспорт: режим=полный; записей=${getNumber(snapshot.returned)} из ${totalForMode} сохранённых`
            : `Экспорт: режим=предпросмотр; записей=${getNumber(snapshot.returned)} из ${totalForMode}`,
        `Хранение: лимит=${getNumber(retention.maxEntries || snapshot.retentionMaxEntries || 5000)} записей; лимит=${getNumber(retention.maxBytes || snapshot.retentionMaxBytes || 2000000)} байт; удалено старых=${droppedEntries}`,
        droppedEntries > 0 ? 'Внимание: часть старых диагностических записей уже удалена политикой хранения.' : '',
        'Примечание: лог локальный; чувствительные поля скрываются; HTML, cookie, token и полный payload заказа не сохраняются.',
        ''
    ].filter(line => line !== '');

    if (!entries.length) {
        return [
            ...header,
            'Диагностических записей нет.'
        ].join('\n');
    }

    return [
        ...header,
        ...entries.map(formatDiagnosticLogEntry)
    ].join('\n');
}

function renderDiagnosticLog(snapshot = {}) {
    lastDiagnosticLogText = buildDiagnosticLogText(snapshot);
    setText('optionsDiagnosticLogPreview', lastDiagnosticLogText);
    setText('optionsDiagnosticLogStatus', `Лог загружен: ${getNumber(snapshot.returned)} из ${getNumber(snapshot.total)} записей.`);
}

function loadDiagnosticLog() {
    setText('optionsDiagnosticLogStatus', 'Загрузка лога...');

    send({
        type: 'GET_DIAGNOSTIC_LOG',
        options: {
            limit: 100,
            order: 'oldest-first'
        }
    }, (res) => {
        if (!res?.ok) {
            setText('optionsDiagnosticLogStatus', 'Не удалось загрузить лог.');
            return;
        }

        renderDiagnosticLog(res);
    });
}

function copyDiagnosticLog() {
    const text = lastDiagnosticLogText || '';

    if (!text) {
        setText('optionsDiagnosticLogStatus', 'Лог ещё не загружен.');
        return;
    }

    const clipboard = globalThis.navigator?.clipboard;

    if (!clipboard?.writeText) {
        setText('optionsDiagnosticLogStatus', 'Копирование недоступно. Скачайте .txt.');
        return;
    }

    clipboard.writeText(text)
        .then(() => {
            setText('optionsDiagnosticLogStatus', 'Лог скопирован в буфер обмена.');
        })
        .catch(() => {
            setText('optionsDiagnosticLogStatus', 'Не удалось скопировать лог. Скачайте .txt.');
        });
}

function buildDiagnosticLogFilename() {
    const stamp = formatTimestamp(Date.now())
        .replace(/[-:]/g, '')
        .replace(/\s+/g, '-');

    return `tab_wanderer-diagnostic-log-${stamp}.txt`;
}

function downloadTextFile(filename, text) {
    if (!document?.createElement) {
        return false;
    }

    const link = document.createElement('a');

    if (!link) {
        return false;
    }

    link.href = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
    link.download = filename;

    if (link.style) {
        link.style.display = 'none';
    }

    if (document.body?.appendChild) {
        document.body.appendChild(link);
    }

    if (typeof link.click === 'function') {
        link.click();
    }

    if (document.body?.removeChild) {
        document.body.removeChild(link);
    }

    return true;
}

function downloadDiagnosticLog() {
    setText('optionsDiagnosticLogStatus', 'Готовим полный лог...');

    send({
        type: 'GET_DIAGNOSTIC_LOG',
        options: {
            mode: 'full',
            order: 'oldest-first'
        }
    }, (res) => {
        if (!res?.ok) {
            setText('optionsDiagnosticLogStatus', 'Не удалось загрузить полный диагностический лог.');
            return;
        }

        const text = buildDiagnosticLogText(res);
        const downloaded = downloadTextFile(buildDiagnosticLogFilename(), text);

        setText('optionsDiagnosticLogStatus', downloaded ? 'Файл лога готов.' : 'Не удалось подготовить файл лога.');
    });
}

function clearDiagnosticLog() {
    send({ type: 'CLEAR_DIAGNOSTIC_LOG' }, (res) => {
        if (!res?.ok) {
            setText('optionsDiagnosticLogStatus', 'Не удалось очистить диагностический лог.');
            return;
        }

        loadDiagnosticLog();
        loadMonitorDiagnostics();
    });
}

function bindDiagnosticLogActions() {
    const refreshBtn = document.getElementById('optionsRefreshDiagnosticLog');
    const copyBtn = document.getElementById('optionsCopyDiagnosticLog');
    const downloadBtn = document.getElementById('optionsDownloadDiagnosticLog');
    const clearBtn = document.getElementById('optionsClearDiagnosticLog');

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            loadDiagnosticLog();
        });
    }

    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            copyDiagnosticLog();
        });
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            downloadDiagnosticLog();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearDiagnosticLog();
        });
    }
}

function loadConfigSummary() {
    setText('optionsLoadStatus', 'Загрузка текущих настроек...');
    setText('optionsSettingsSaveStatus', 'Загрузка настроек...');

    send({ type: 'GET_CONFIG' }, (res) => {
        if (!res?.ok) {
            setText('optionsLoadStatus', 'Не удалось загрузить текущие настройки.');
            setText('optionsSettingsSaveStatus', 'Ошибка загрузки настроек.');
            return;
        }

        currentConfig = res.userConfig || {};
        currentDictionaries = res.monitorDictionaries || {};

        renderSettings(currentConfig);
        renderConfigSummary(currentConfig, currentDictionaries);
        renderScopeDictionaries(currentDictionaries);
        setText('optionsSettingsSaveStatus', 'Настройки загружены. Изменения сохраняются автоматически.');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindSettingsAutosave();
    bindDiagnosticsActions();
    bindDiagnosticLogActions();
    loadConfigSummary();
    loadMonitorDiagnostics();
    loadDiagnosticLog();
});
