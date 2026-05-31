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
        contractor: false,
        date: false,
        shipmentDateText: true,
        hasOrderFlag: true,
        hasAutoreserve: true,
        tags: true
    }
};

const TRIGGER_FIELD_CONTROLS = [
    { field: 'status', id: 'triggerFieldStatus' },
    { field: 'delivery', id: 'triggerFieldDelivery' },
    { field: 'payment', id: 'triggerFieldPayment' },
    { field: 'shipmentDateText', id: 'triggerFieldShipmentDateText' },
    { field: 'hasOrderFlag', id: 'triggerFieldHasOrderFlag' },
    { field: 'hasAutoreserve', id: 'triggerFieldHasAutoreserve' },
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
            contractor: getBooleanConfigValue(changedFields.contractor, defaultChangedFields.contractor),
            date: getBooleanConfigValue(changedFields.date, defaultChangedFields.date),
            shipmentDateText: getBooleanConfigValue(changedFields.shipmentDateText, defaultChangedFields.shipmentDateText),
            hasOrderFlag: getBooleanConfigValue(changedFields.hasOrderFlag, defaultChangedFields.hasOrderFlag),
            hasAutoreserve: getBooleanConfigValue(changedFields.hasAutoreserve, defaultChangedFields.hasAutoreserve),
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

function bindNavigationActions() {
    const openOptionsBtn = document.getElementById('openOptions');

    if (openOptionsBtn) {
        openOptionsBtn.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
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