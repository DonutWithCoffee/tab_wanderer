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
}

function collectConfigFromUI(currentConfig = {}) {
    const safeConfig = currentConfig || {};

    const ignoreOzon = document.getElementById('ignoreOzon');
    const ignoreJurics = document.getElementById('ignoreJurics');

    return {
        ...safeConfig,
        rules: {
            ...(safeConfig.rules || {}),
            ignoreOzon: Boolean(ignoreOzon?.checked),
            ignoreLegalEntityBankTransfer: Boolean(ignoreJurics?.checked)
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