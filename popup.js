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

function parseScopeList(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(v => /^\d+$/.test(v));
}

function formatScopeList(values) {
    return Array.isArray(values) ? values.join(',') : '';
}

function updateConfigUI(userConfig) {
    const rules = userConfig?.rules || {};
    const monitorScope = userConfig?.monitorScope || {};

    const ignoreOzon = document.getElementById('ignoreOzon');
    const ignoreJurics = document.getElementById('ignoreJurics');

    const scopeStatus = document.getElementById('scopeStatus');
    const scopeDelivery = document.getElementById('scopeDelivery');
    const scopePayment = document.getElementById('scopePayment');

    if (ignoreOzon) {
        ignoreOzon.checked = Boolean(rules.ignoreOzon);
    }

    if (ignoreJurics) {
        ignoreJurics.checked = Boolean(rules.ignoreLegalEntityBankTransfer);
    }

    if (scopeStatus) {
        scopeStatus.value = formatScopeList(monitorScope.status);
    }

    if (scopeDelivery) {
        scopeDelivery.value = formatScopeList(monitorScope.delivery);
    }

    if (scopePayment) {
        scopePayment.value = formatScopeList(monitorScope.payment);
    }
}

function collectConfigFromUI(currentConfig = {}) {
    const safeConfig = currentConfig || {};

    const ignoreOzon = document.getElementById('ignoreOzon');
    const ignoreJurics = document.getElementById('ignoreJurics');

    const scopeStatus = document.getElementById('scopeStatus');
    const scopeDelivery = document.getElementById('scopeDelivery');
    const scopePayment = document.getElementById('scopePayment');

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
            status: parseScopeList(scopeStatus?.value),
            delivery: parseScopeList(scopeDelivery?.value),
            payment: parseScopeList(scopePayment?.value),
            predicates: {
                ...currentPredicates
            }
        }
    };
}

function loadConfig() {
    send({ type: 'GET_CONFIG' }, (res) => {
        if (!res?.ok) return;
        updateConfigUI(res.userConfig || {});
    });
}

function bindConfigControls() {
    const ignoreOzon = document.getElementById('ignoreOzon');
    const ignoreJurics = document.getElementById('ignoreJurics');

    const scopeStatus = document.getElementById('scopeStatus');
    const scopeDelivery = document.getElementById('scopeDelivery');
    const scopePayment = document.getElementById('scopePayment');

    const onChange = () => {
        send({ type: 'GET_CONFIG' }, (res) => {
            if (!res?.ok) return;

            const nextConfig = collectConfigFromUI(res.userConfig || {});

            send({
                type: 'UPDATE_CONFIG',
                userConfig: nextConfig
            });
        });
    };

    if (ignoreOzon) {
        ignoreOzon.addEventListener('change', onChange);
    }

    if (ignoreJurics) {
        ignoreJurics.addEventListener('change', onChange);
    }

    if (scopeStatus) {
        scopeStatus.addEventListener('change', onChange);
    }

    if (scopeDelivery) {
        scopeDelivery.addEventListener('change', onChange);
    }

    if (scopePayment) {
        scopePayment.addEventListener('change', onChange);
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
    init();
});