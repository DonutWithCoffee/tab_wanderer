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

// ---------- INIT ----------
function init() {
    chrome.runtime.sendMessage({ type: 'CHECK_WORKER' }, (res) => {
        updateStatus(res?.isRunning);
    });
}

// ---------- CONTROLS ----------

// start
document.getElementById('start').onclick = () => {
    send({ type: 'START' }, () => init());
};

// stop
document.getElementById('stop').onclick = () => {
    send({ type: 'STOP' }, () => init());
};

// test
document.getElementById('test').onclick = () => {

    const testOrders = [
        {
            id: 'TEST-1',
            status: 'Новый',
            delivery: 'Курьер',
            payment: 'Наличные'
        },
        {
            id: 'TEST-2',
            status: 'В обработке',
            delivery: 'Самовывоз',
            payment: 'Онлайн'
        },
        {
            id: 'TEST-3',
            status: 'Новый',
            delivery: 'Курьер',
            payment: '–'
        }
    ];

    send({
        type: 'ORDERS',
        data: testOrders,
        isTest: true
    });
};

// ---------- DOM READY ----------
document.addEventListener('DOMContentLoaded', () => {
    const version = chrome.runtime.getManifest().version;
    document.getElementById('version').innerText = `v${version}`;

    init();
});