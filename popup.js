let currentConfig = {};
let draftConfig = {};
let currentDictionaries = null;
let isDirty = false;

const POPUP_DEFAULT_NOTIFICATION_TRIGGERS = {
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

const TRIGGER_FIELD_CONTROLS = [
    { field: 'status', id: 'triggerFieldStatus' },
    { field: 'delivery', id: 'triggerFieldDelivery' },
    { field: 'payment', id: 'triggerFieldPayment' },
    { field: 'city', id: 'triggerFieldCity' },
    { field: 'tags', id: 'triggerFieldTags' }
];

function send(msg, cb) {
    chrome.runtime.sendMessage(msg, (res) => {
        console.log('[POPUP]', msg.type, res);
        if (cb) cb(res);
    });
}

// ---------- STATUS ----------
function updateStatus(isRunning) {
    const el = document.getElementById('status');

    if (!el) return;

    el.innerText = isRunning ? 'Status: RUNNING' : 'Status: STOPPED';

    el.classList.remove('running', 'stopped');
    el.classList.add(isRunning ? 'running' : 'stopped');
}

// ---------- HELPERS ----------
function getScopeList(values) {
    return Array.isArray(values) ? values.map((value) => String(value)) : [];
}

function getSelectedMonitorMode() {
    const windowed = document.getElementById('monitorModeWindowed');
    const active = document.getElementById('monitorModeActive');

    if (active?.checked) {
        return 'active';
    }

    if (windowed?.checked) {
        return 'windowed';
    }

    return 'windowed';
}

function getBooleanConfigValue(value, fallback) {
    return value === undefined ? fallback : Boolean(value);
}

function getNotificationTriggers(config = {}) {
    const triggers = config?.notificationTriggers || {};
    const changedFields = triggers.changedFields || {};
    const defaultTriggers = POPUP_DEFAULT_NOTIFICATION_TRIGGERS;
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

function setCheckboxChecked(id, checked) {
    const el = document.getElementById(id);

    if (el) {
        el.checked = Boolean(checked);
    }
}

function isCheckboxChecked(id) {
    return Boolean(document.getElementById(id)?.checked);
}

function setCheckboxDisabled(id, disabled) {
    const el = document.getElementById(id);

    if (el) {
        el.disabled = Boolean(disabled);
    }
}

function updateChangedFieldControlState(changedOrdersEnabled) {
    const disabled = !changedOrdersEnabled;

    for (const control of TRIGGER_FIELD_CONTROLS) {
        setCheckboxDisabled(control.id, disabled);
    }
}

function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function updateDirtyState() {
    isDirty = !deepEqual(currentConfig, draftConfig);

    const el = document.getElementById('configStatus');
    if (!el) return;

    el.innerText = isDirty ? 'Unsaved changes' : 'No changes';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getSelectedScopeValues(groupName) {
    return Array.from(document.querySelectorAll(`input[data-scope-group="${groupName}"]:checked`))
        .map((input) => input.value)
        .filter(Boolean);
}

function buildSummaryText(title, selectedIds, options) {
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

// ---------- SCOPE RENDER ----------
function renderScopeGroup(groupName, title, options, selectedIds) {
    const container = document.getElementById(`scope${groupName}Options`);
    const summary = document.getElementById(`scope${groupName}Summary`);

    if (!container || !summary) return;

    const safeOptions = Array.isArray(options) ? options : [];
    const selectedSet = new Set((selectedIds || []).map(String));

    container.innerHTML = safeOptions.map((item) => {
        const id = String(item.id);
        const label = String(item.label || '');
        const checked = selectedSet.has(id) ? ' checked' : '';

        return `
            <label class="scope-option">
                <input
                    type="checkbox"
                    data-scope-group="${groupName}"
                    value="${escapeHtml(id)}"${checked}
                >
                <span>${escapeHtml(label)}</span>
            </label>
        `;
    }).join('');

    summary.innerText = buildSummaryText(title, selectedIds || [], safeOptions);
}

function renderScopeOptions(config, dictionaries) {
    const monitorScope = config?.monitorScope || {};
    const safeDictionaries = dictionaries || {};

    renderScopeGroup(
        'Status',
        'Статус',
        safeDictionaries.status || [],
        getScopeList(monitorScope.status)
    );

    renderScopeGroup(
        'Delivery',
        'Доставка',
        safeDictionaries.delivery || [],
        getScopeList(monitorScope.delivery)
    );

    renderScopeGroup(
        'Payment',
        'Оплата',
        safeDictionaries.payment || [],
        getScopeList(monitorScope.payment)
    );
}

function renderNotificationTriggers(config) {
    const triggers = getNotificationTriggers(config);

    setCheckboxChecked('triggerNewOrders', triggers.newOrders);
    setCheckboxChecked('triggerChangedOrders', triggers.changedOrders);

    for (const control of TRIGGER_FIELD_CONTROLS) {
        setCheckboxChecked(control.id, triggers.changedFields[control.field]);
    }

    updateChangedFieldControlState(triggers.changedOrders);
}

// ---------- CONFIG UI ----------
function updateConfigUI(userConfig) {
    const monitorMode = String(userConfig?.monitorMode || 'windowed');

    const monitorModeWindowed = document.getElementById('monitorModeWindowed');
    const monitorModeActive = document.getElementById('monitorModeActive');

    if (monitorModeWindowed) {
        monitorModeWindowed.checked = monitorMode === 'windowed';
    }

    if (monitorModeActive) {
        monitorModeActive.checked = monitorMode === 'active';
    }

    renderScopeOptions(userConfig, currentDictionaries);
    renderNotificationTriggers(userConfig);
}

function collectNotificationTriggersFromUI(baseConfig = {}) {
    const currentTriggers = getNotificationTriggers(baseConfig);
    const changedFields = { ...currentTriggers.changedFields };

    for (const control of TRIGGER_FIELD_CONTROLS) {
        changedFields[control.field] = isCheckboxChecked(control.id);
    }

    return {
        ...currentTriggers,
        newOrders: isCheckboxChecked('triggerNewOrders'),
        changedOrders: isCheckboxChecked('triggerChangedOrders'),
        changedFields
    };
}

function collectConfigFromUI(baseConfig = {}) {
    const safeConfig = baseConfig || {};
    const configWithoutRules = { ...safeConfig };

    delete configWithoutRules.rules;

    const currentMonitorScope = safeConfig.monitorScope || {};
    const currentPredicates = currentMonitorScope.predicates || {};

    return {
        ...configWithoutRules,
        monitorMode: getSelectedMonitorMode(),
        notificationTriggers: collectNotificationTriggersFromUI(safeConfig),
        monitorScope: {
            ...currentMonitorScope,
            status: getSelectedScopeValues('Status'),
            delivery: getSelectedScopeValues('Delivery'),
            payment: getSelectedScopeValues('Payment'),
            predicates: {
                ...currentPredicates
            }
        }
    };
}

function loadConfig() {
    send({ type: 'GET_CONFIG' }, (res) => {
        if (!res?.ok) return;

        currentConfig = res.userConfig || {};
        draftConfig = JSON.parse(JSON.stringify(currentConfig));
        currentDictionaries = res.monitorDictionaries || null;

        updateConfigUI(draftConfig);
        updateDirtyState();
    });
}

function bindConfigControls() {
    const monitorModeWindowed = document.getElementById('monitorModeWindowed');
    const monitorModeActive = document.getElementById('monitorModeActive');

    const onChange = () => {
        draftConfig = collectConfigFromUI(draftConfig);
        updateConfigUI(draftConfig);
        updateDirtyState();
    };

    if (monitorModeWindowed) {
        monitorModeWindowed.addEventListener('change', onChange);
    }

    if (monitorModeActive) {
        monitorModeActive.addEventListener('change', onChange);
    }

    const triggerControlIds = [
        'triggerNewOrders',
        'triggerChangedOrders',
        ...TRIGGER_FIELD_CONTROLS.map((control) => control.id)
    ];

    for (const id of triggerControlIds) {
        const control = document.getElementById(id);

        if (control) {
            control.addEventListener('change', onChange);
        }
    }

    document.addEventListener('change', (event) => {
        const target = event.target;

        if (!(target instanceof HTMLInputElement)) return;
        if (!target.matches('input[data-scope-group]')) return;

        onChange();
    });
}

function bindConfigActions() {
    const applyBtn = document.getElementById('applyConfig');
    const resetBtn = document.getElementById('resetConfig');

    if (applyBtn) {
        applyBtn.addEventListener('click', () => {
            if (!isDirty) return;

            send({
                type: 'UPDATE_CONFIG',
                userConfig: draftConfig
            }, (res) => {
                if (!res?.ok) return;

                currentConfig = res.userConfig || draftConfig;
                draftConfig = JSON.parse(JSON.stringify(currentConfig));

                updateDirtyState();
            });
        });
    }

       if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            draftConfig = JSON.parse(JSON.stringify(currentConfig));
            updateConfigUI(draftConfig);
            updateDirtyState();
        });
    }
}


function setText(id, value) {
    const el = document.getElementById(id);

    if (el) {
        el.innerText = String(value || '');
    }
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

function getChronologicalDiagnosticLogEntries(entries = []) {
    return Array.isArray(entries)
        ? entries.slice().sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
        : [];
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

function buildDiagnosticLogText(snapshot = {}, status = {}) {
    const entries = getChronologicalDiagnosticLogEntries(snapshot.entries);
    const header = [
        'tab_wanderer diagnostic log',
        ...buildMonitorStatusLogHeader(status),
        `Returned log entries: ${getNumber(snapshot.returned)} / ${getNumber(snapshot.total)}`,
        ''
    ];

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

function downloadDiagnosticLogFromPopup() {
    setText('diagnosticLogStatus', 'Preparing diagnostic log...');

    send({ type: 'GET_MONITOR_STATUS' }, (statusRes) => {
        if (!statusRes?.ok) {
            setText('diagnosticLogStatus', 'Failed to load monitor status.');
            return;
        }

        send({
            type: 'GET_DIAGNOSTIC_LOG',
            options: {
                limit: 100,
                order: 'oldest-first'
            }
        }, (logRes) => {
            if (!logRes?.ok) {
                setText('diagnosticLogStatus', 'Failed to load diagnostic log.');
                return;
            }

            const text = buildDiagnosticLogText(logRes, statusRes.status || {});
            const downloaded = downloadTextFile(buildDiagnosticLogFilename(), text);

            setText(
                'diagnosticLogStatus',
                downloaded ? 'Diagnostic log prepared.' : 'Failed to prepare diagnostic log.'
            );
        });
    });
}

function bindNavigationActions() {
    const openOptionsBtn = document.getElementById('openOptions');
    const openHistoryBtn = document.getElementById('openHistory');
    const downloadDiagnosticLogBtn = document.getElementById('downloadDiagnosticLog');

    if (openOptionsBtn) {
        openOptionsBtn.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });
    }

    if (openHistoryBtn) {
        openHistoryBtn.addEventListener('click', () => {
            chrome.tabs.create({
                url: chrome.runtime.getURL('history.html'),
                active: true
            });
        });
    }

    if (downloadDiagnosticLogBtn) {
        downloadDiagnosticLogBtn.addEventListener('click', () => {
            downloadDiagnosticLogFromPopup();
        });
    }
}

// ---------- INIT ----------
function init() {
    chrome.runtime.sendMessage({ type: 'CHECK_WORKER' }, (res) => {
        updateStatus(res?.isRunning);
    });

    loadConfig();
}

// ---------- CONTROLS ----------
document.getElementById('start').onclick = () => {
    send({ type: 'START' }, () => init());
};

document.getElementById('stop').onclick = () => {
    send({ type: 'STOP' }, () => init());
};

// ---------- DOM READY ----------
document.addEventListener('DOMContentLoaded', () => {
    const version = chrome.runtime.getManifest().version;
    document.getElementById('version').innerText = `v${version}`;

    bindConfigControls();
    bindConfigActions();
    bindNavigationActions();
    init();
});