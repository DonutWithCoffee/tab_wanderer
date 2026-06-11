const OPTIONS_DEFAULT_DEEP_SYNC_MAX_PAGES = 50;
const OPTIONS_MIN_DEEP_SYNC_MAX_PAGES = 1;
const OPTIONS_MAX_DEEP_SYNC_MAX_PAGES = 50;

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
    { key: 'orderFlags', title: 'Флаги', dictionaryId: 'optionsScopeDictionaryOrderFlags', containerId: 'optionsScopeOrderFlagsList' },
    { key: 'store', title: 'Склад', dictionaryId: 'optionsScopeDictionaryStore', containerId: 'optionsScopeStoreList' },
    { key: 'reserve', title: 'Резерв', dictionaryId: 'optionsScopeDictionaryReserve', containerId: 'optionsScopeReserveList' },
    { key: 'assemblyStatus', title: 'Комплектация', dictionaryId: 'optionsScopeDictionaryAssemblyStatus', containerId: 'optionsScopeAssemblyStatusList' }
];

let currentConfig = {};
let currentDictionaries = {};
let currentMonitorStatus = {};
let lastDiagnosticLogText = '';
let scopeControlRefs = {};

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

function normalizeMonitorMode(value) {
    return String(value || 'windowed') === 'active' ? 'active' : 'windowed';
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

    result.predicates = {
        ozonOnly: Boolean(monitorScope.predicates?.ozonOnly),
        juridicalOnly: Boolean(monitorScope.predicates?.juridicalOnly)
    };

    return result;
}

function getScopeSummary(config = {}, dictionaries = {}) {
    const monitorScope = getMonitorScope(config);

    return OPTIONS_SCOPE_GROUPS
        .map((group) => buildScopeText(group.title, monitorScope[group.key], dictionaries[group.key] || []))
        .join('; ');
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
            ? `Справочник не загружен. Сохранено значений: ${selectedIds.length}.`
            : 'Справочник не загружен. Пусто = все.');
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
        input.value = option.id;
        input.checked = selectedSet.has(option.id);
        text.innerText = option.label;

        input.addEventListener('change', () => {
            saveMonitorScopeFromUI();
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
            ? 'Пустой выбор в группе означает “все”. Изменения сохраняются автоматически.'
            : 'Справочники появятся после запуска мониторинга.'
    );
}

function renderConfigSummary(config, dictionaries) {

    setText('optionsMonitorMode', getMonitorModeLabel(config));
    setText('optionsDeepSyncSummary', `${normalizeDeepSyncMaxPages(config.deepSyncMaxPages)} страниц`);
    setText('optionsScopeSummary', getScopeSummary(config, dictionaries));
    setText('optionsNotificationSummary', getNotificationSummary(config));
    setText('optionsLoadStatus', 'Текущие настройки загружены.');
}

function setNotificationFieldControlsDisabled(disabled) {
    for (const field of OPTIONS_VISIBLE_CHANGED_FIELDS) {
        setDisabled(field.id, disabled);
    }
}

function renderSettings(config = {}) {
    const triggers = getNotificationTriggers(config);

    setValue('optionsMonitorModeSelect', normalizeMonitorMode(config.monitorMode));
    setValue('optionsDeepSyncMaxPages', normalizeDeepSyncMaxPages(config.deepSyncMaxPages));
    renderScopeControls(config, currentDictionaries);

    setChecked('optionsNotifyNewOrders', triggers.newOrders);
    setChecked('optionsNotifyChangedOrders', triggers.changedOrders);

    for (const field of OPTIONS_VISIBLE_CHANGED_FIELDS) {
        setChecked(field.id, triggers.changedFields[field.key]);
    }

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

    saveConfig(nextConfig, 'Глубина deep sync сохранена.');
}

function collectMonitorScopeFromUI(baseConfig = {}) {
    const currentScope = getMonitorScope(baseConfig);
    const nextScope = {
        ...currentScope,
        predicates: { ...currentScope.predicates }
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

function saveMonitorScopeFromUI() {
    const nextConfig = {
        ...currentConfig,
        monitorScope: collectMonitorScopeFromUI(currentConfig)
    };

    saveConfig(nextConfig, 'Область мониторинга сохранена. Будет выполнена безопасная перебазировка без потока уведомлений.');
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

function saveNotificationTriggersFromUI(successMessage = 'Настройки уведомлений сохранены.') {
    const nextTriggers = collectNotificationTriggersFromUI(currentConfig);
    const nextConfig = {
        ...currentConfig,
        notificationTriggers: nextTriggers
    };

    setNotificationFieldControlsDisabled(!nextTriggers.changedOrders);
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

    for (const id of triggerControlIds) {
        const control = document.getElementById(id);

        if (control) {
            control.addEventListener('change', () => {
                saveNotificationTriggersFromUI();
            });
        }
    }
}

function buildLastCollectionMetadataText(metadata) {
    if (!metadata) {
        return 'last collection: нет';
    }

    return [
        `last collection: ${getTextValue(metadata.syncReason || metadata.reason)}`,
        `pages: ${getNumber(metadata.pagesCollected)}`,
        `orders: ${getNumber(metadata.ordersCollected)}`,
        `complete: ${getYesNo(metadata.isComplete === true)}`,
        `max pages: ${getNumber(metadata.maxPages)}`
    ].join('; ');
}

function buildCollectionSessionText(session) {
    if (!session) {
        return 'session: нет';
    }

    return [
        `session: ${getTextValue(session.mode)}`,
        `orders: ${getNumber(session.ordersCount)}`,
        `current page: ${getNumber(session.currentPage, 1)}`,
        `last page: ${getNumber(session.lastCollectedPage)}`,
        `next: ${getNumber(session.nextPage, 1)}`,
        `attempts: ${getNumber(session.advanceAttempts)}`
    ].join('; ');
}

function renderMonitorDiagnostics(status = {}) {
    currentMonitorStatus = status || {};
    setText(
        'optionsDiagnosticsRuntime',
        [
            `running: ${getYesNo(status.isRunning === true)}`,
            `state: ${getTextValue(status.monitorState, 'uninitialized')}`,
            `mode: ${getTextValue(status.monitorMode, 'windowed')}`,
            `deep pages: ${getNumber(status.deepSyncMaxPages, OPTIONS_DEFAULT_DEEP_SYNC_MAX_PAGES)}`
        ].join('; ')
    );

    setText(
        'optionsDiagnosticsWorker',
        [
            `worker: ${getYesNo(status.hasWorkerTab === true)}`,
            `tabId: ${status.workerTabId === null || status.workerTabId === undefined ? '—' : String(status.workerTabId)}`
        ].join('; ')
    );

    setText(
        'optionsDiagnosticsOrders',
        [
            `known: ${getNumber(status.knownOrdersCount)}`,
            `window: ${getNumber(status.windowOrdersCount)}`,
            `hashes: ${getNumber(status.knownHashesCount)} / ${getNumber(status.windowHashesCount)}`,
            `notifications: ${getNumber(status.notificationTargetsCount)}`
        ].join('; ')
    );

    setText(
        'optionsDiagnosticsJournal',
        [
            `history: ${getNumber(status.eventJournalCount)}`,
            `diagnostic: ${getNumber(status.diagnosticLogCount)}`
        ].join('; ')
    );

    setText(
        'optionsDiagnosticsSync',
        [
            `pending rebaseline: ${getYesNo(status.pendingRebaseline === true)}`,
            `reason: ${getTextValue(status.pendingSyncReason)}`,
            `last baseline: ${getTextValue(status.lastBaselineDate)}`,
            `last deep sync: ${getNumber(status.lastDeepSyncAt)}`
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

function buildMonitorStatusLogHeader(status = {}) {
    return [
        `Version: ${getExtensionVersion()}`,
        `Generated: ${formatTimestamp(Date.now())}`,
        `Monitor: running=${getYesNo(status.isRunning === true)}; state=${getTextValue(status.monitorState, 'uninitialized')}; mode=${getTextValue(status.monitorMode, 'windowed')}`,
        `Worker: ${getYesNo(status.hasWorkerTab === true)}; tabId=${status.workerTabId === null || status.workerTabId === undefined ? '—' : String(status.workerTabId)}`,
        `Orders: known=${getNumber(status.knownOrdersCount)}; window=${getNumber(status.windowOrdersCount)}; hashes=${getNumber(status.knownHashesCount)} / ${getNumber(status.windowHashesCount)}`,
        `Logs: diagnostic=${getNumber(status.diagnosticLogCount)}; history=${getNumber(status.eventJournalCount)}`
    ];
}

function getChronologicalDiagnosticLogEntries(entries = []) {
    return Array.isArray(entries)
        ? entries.slice().sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
        : [];
}

function buildDiagnosticLogText(snapshot = {}, status = currentMonitorStatus || {}) {
    const entries = getChronologicalDiagnosticLogEntries(snapshot.entries);
    const mode = snapshot.mode === 'full' ? 'full' : 'preview';
    const droppedEntries = getNumber(snapshot.droppedEntries || snapshot.retention?.droppedEntries);
    const retention = snapshot.retention || {};
    const header = [
        'tab_wanderer diagnostic log',
        ...buildMonitorStatusLogHeader(status),
        mode === 'full'
            ? `Exported log entries: ${getNumber(snapshot.returned)} / ${getNumber(snapshot.retainedTotal || snapshot.total)} retained`
            : `Returned log entries: ${getNumber(snapshot.returned)} / ${getNumber(snapshot.total)}`,
        `Preview limit: ${getNumber(snapshot.previewLimit || 100)}`,
        `Retention entries limit: ${getNumber(retention.maxEntries || snapshot.retentionMaxEntries || 5000)}`,
        `Retention bytes limit: ${getNumber(retention.maxBytes || snapshot.retentionMaxBytes || 2000000)}`,
        `Dropped old entries: ${droppedEntries}`,
        droppedEntries > 0 ? 'Note: older diagnostic entries were removed by retention policy.' : '',
        ''
    ].filter(line => line !== '');

    if (!entries.length) {
        return [
            ...header,
            'No diagnostic log entries.'
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
    setText('optionsDiagnosticLogStatus', 'Загрузка диагностического лога...');

    send({
        type: 'GET_DIAGNOSTIC_LOG',
        options: {
            limit: 100,
            order: 'oldest-first'
        }
    }, (res) => {
        if (!res?.ok) {
            setText('optionsDiagnosticLogStatus', 'Не удалось загрузить диагностический лог.');
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
        setText('optionsDiagnosticLogStatus', 'Копирование недоступно в этом браузере. Используй Download .txt.');
        return;
    }

    clipboard.writeText(text)
        .then(() => {
            setText('optionsDiagnosticLogStatus', 'Лог скопирован в буфер обмена.');
        })
        .catch(() => {
            setText('optionsDiagnosticLogStatus', 'Не удалось скопировать лог. Используй Download .txt.');
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
    setText('optionsDiagnosticLogStatus', 'Подготовка полного диагностического лога...');

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

        setText('optionsDiagnosticLogStatus', downloaded ? 'Полный файл лога подготовлен для скачивания.' : 'Не удалось подготовить файл лога.');
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
