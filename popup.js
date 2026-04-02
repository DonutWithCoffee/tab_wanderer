let currentConfig = {};
let draftConfig = {};
let currentDictionaries = null;
let isDirty = false;

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

function getScopeList(values) {
    return Array.isArray(values) ? values.map(v => String(v)) : [];
}

function formatScopeList(values) {
    return Array.isArray(values) ? values.join(',') : '';
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
            <label>
                <input
                    type="checkbox"
                    data-scope-group="${groupName}"
                    value="${escapeHtml(id)}"${checked}
                >
                ${escapeHtml(label)}
            </label>
            <br>
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

function updateConfigUI(userConfig) {
    const rules = userConfig?.rules || {};

    const ignoreOzon = document.getElementById('ignoreOzon');
    const ignoreJurics = document.getElementById('ignoreJurics');

    if (ignoreOzon) {
        ignoreOzon.checked = Boolean(rules.ignoreOzon);
    }

    if (ignoreJurics) {
        ignoreJurics.checked = Boolean(rules.ignoreLegalEntityBankTransfer);
    }

    renderScopeOptions(userConfig, currentDictionaries);
}

function collectConfigFromUI(baseConfig = {}) {
    const safeConfig = baseConfig || {};

    const ignoreOzon = document.getElementById('ignoreOzon');
    const ignoreJurics = document.getElementById('ignoreJurics');

    const currentMonitorScope = safeConfig.monitorScope || {};
    const currentPredicates = currentMonitorScope.predicates || {};

    return {
        ...safeConfig,
        rules: {
            ...(safeConfig.rules || {}),
            ignoreOzon: Boolean(ignoreOzon?.checked),
            ignoreLegalEntityBankTransfer: Boolean(ignoreJurics?.checked)
        },
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
    const ignoreOzon = document.getElementById('ignoreOzon');
    const ignoreJurics = document.getElementById('ignoreJurics');

    const onChange = () => {
        draftConfig = collectConfigFromUI(draftConfig);
        updateConfigUI(draftConfig);
        updateDirtyState();
    };

    if (ignoreOzon) {
        ignoreOzon.addEventListener('change', onChange);
    }

    if (ignoreJurics) {
        ignoreJurics.addEventListener('change', onChange);
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
    init();
});