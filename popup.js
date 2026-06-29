let currentMonitorStatus = {
    isRunning: false,
    monitorState: 'uninitialized',
    monitorMode: 'windowed'
};

let currentPopupConfig = {
    notificationSuppressors: {
        ignoreLegalEntityPayment: false,
        ignoreOzon: false
    },
    watchedOrders: {
        items: []
    }
};

const POPUP_DEFAULT_NOTIFICATION_SUPPRESSORS = {
    ignoreLegalEntityPayment: false,
    ignoreOzon: false
};

const POPUP_SUPPRESSOR_CONTROLS = [
    { key: 'ignoreLegalEntityPayment', id: 'popupIgnoreLegalEntityPayment' },
    { key: 'ignoreOzon', id: 'popupIgnoreOzon' }
];

const POPUP_WATCHED_ORDER_LIMIT = 100;

function send(msg, cb) {
    chrome.runtime.sendMessage(msg, (res) => {
        console.log('[POPUP]', msg.type, res);
        if (cb) cb(res);
    });
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

function getBooleanConfigValue(value, fallback) {
    return value === undefined ? fallback : Boolean(value);
}

function getPopupNotificationSuppressors(config = {}) {
    const suppressors = config?.notificationSuppressors || {};

    return {
        ignoreLegalEntityPayment: getBooleanConfigValue(
            suppressors.ignoreLegalEntityPayment,
            POPUP_DEFAULT_NOTIFICATION_SUPPRESSORS.ignoreLegalEntityPayment
        ),
        ignoreOzon: getBooleanConfigValue(
            suppressors.ignoreOzon,
            POPUP_DEFAULT_NOTIFICATION_SUPPRESSORS.ignoreOzon
        )
    };
}

function setChecked(id, value) {
    const el = document.getElementById(id);

    if (el) {
        el.checked = Boolean(value);
    }
}

function updateQuickSuppressorControls(config = {}) {
    const suppressors = getPopupNotificationSuppressors(config);

    for (const control of POPUP_SUPPRESSOR_CONTROLS) {
        setChecked(control.id, suppressors[control.key]);
    }
}

function loadPopupConfig() {
    send({ type: 'GET_CONFIG' }, (res) => {
        if (!res?.ok) {
            setText('quickSuppressStatus', 'Не удалось загрузить быстрые фильтры.');
            return;
        }

        currentPopupConfig = res.userConfig || currentPopupConfig;
        updateQuickSuppressorControls(currentPopupConfig);
        setText('quickSuppressStatus', 'Быстрые фильтры управляют только уведомлениями.');
    });
}

function savePopupConfig(nextConfig, successMessage = 'Быстрые фильтры сохранены.') {
    setText('quickSuppressStatus', 'Сохраняем быстрые фильтры...');

    send({ type: 'UPDATE_CONFIG', userConfig: nextConfig }, (res) => {
        if (!res?.ok) {
            updateQuickSuppressorControls(currentPopupConfig);
            setText('quickSuppressStatus', 'Ошибка сохранения быстрых фильтров.');
            return;
        }

        currentPopupConfig = res.userConfig || nextConfig;
        updateQuickSuppressorControls(currentPopupConfig);
        setText('quickSuppressStatus', successMessage);
    });
}

function toggleQuickSuppressor(key) {
    const suppressors = getPopupNotificationSuppressors(currentPopupConfig);
    const nextConfig = {
        ...currentPopupConfig,
        notificationSuppressors: {
            ...suppressors,
            [key]: !suppressors[key]
        }
    };

    savePopupConfig(nextConfig);
}

function normalizePopupWatchedOrderId(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();
}

function isValidPopupWatchedOrderId(value) {
    return /^\d{4}-\d{4,10}$/.test(normalizePopupWatchedOrderId(value));
}

function getPopupWatchedOrdersConfig(config = {}) {
    const rawItems = Array.isArray(config?.watchedOrders?.items)
        ? config.watchedOrders.items
        : [];
    const seen = new Set();
    const items = [];

    for (const rawItem of rawItems) {
        const source = rawItem && typeof rawItem === 'object'
            ? rawItem
            : { id: rawItem };
        const id = normalizePopupWatchedOrderId(source.id);

        if (!isValidPopupWatchedOrderId(id) || seen.has(id)) {
            continue;
        }

        seen.add(id);
        items.push({
            id,
            status: source.status === 'unresolved' ? 'unresolved' : 'active',
            addedAt: Number(source.addedAt) > 0 ? Number(source.addedAt) : Date.now(),
            lastCheckedAt: Number(source.lastCheckedAt) > 0 ? Number(source.lastCheckedAt) : null,
            lastBaselineAt: Number(source.lastBaselineAt) > 0 ? Number(source.lastBaselineAt) : null,
            lastEventAt: Number(source.lastEventAt) > 0 ? Number(source.lastEventAt) : null,
            lastError: source.lastError ? String(source.lastError) : null
        });

        if (items.length >= POPUP_WATCHED_ORDER_LIMIT) {
            break;
        }
    }

    return { items };
}

function addWatchedOrderFromPopup() {
    const input = document.getElementById('popupWatchedOrderInput');
    const id = normalizePopupWatchedOrderId(input?.value);

    if (!isValidPopupWatchedOrderId(id)) {
        setText('popupWatchedOrderStatus', 'Введите полный номер заказа в формате 1234-110626.');
        return;
    }

    const watchedOrders = getPopupWatchedOrdersConfig(currentPopupConfig);

    if (watchedOrders.items.some(item => item.id === id)) {
        setText('popupWatchedOrderStatus', `Заказ №${id} уже отслеживается.`);
        return;
    }

    if (watchedOrders.items.length >= POPUP_WATCHED_ORDER_LIMIT) {
        setText('popupWatchedOrderStatus', `Достигнут лимит: ${POPUP_WATCHED_ORDER_LIMIT} заказов.`);
        return;
    }

    const nextConfig = {
        ...currentPopupConfig,
        watchedOrders: {
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
        }
    };

    setText('popupWatchedOrderStatus', 'Добавляем заказ в отслеживаемые...');

    send({ type: 'UPDATE_CONFIG', userConfig: nextConfig }, (res) => {
        if (!res?.ok) {
            setText('popupWatchedOrderStatus', 'Ошибка добавления заказа.');
            return;
        }

        currentPopupConfig = res.userConfig || nextConfig;

        if (input) {
            input.value = '';
        }

        setText('popupWatchedOrderStatus', `Заказ №${id} добавлен. Управление списком — на странице “Заказы”.`);
    });
}

function getStatusLabel(status = {}) {
    if (status.isRunning !== true) {
        return 'Статус: STOPPED';
    }

    const state = String(status.monitorState || 'active');

    if (state === 'warming') {
        return 'Статус: WARMING';
    }

    return 'Статус: RUNNING';
}

function updateStatus(status = {}) {
    currentMonitorStatus = {
        isRunning: status.isRunning === true,
        monitorState: String(status.monitorState || 'uninitialized'),
        monitorMode: String(status.monitorMode || 'windowed'),
        hasWorkerTab: status.hasWorkerTab === true,
        workerTabId: status.workerTabId ?? null,
        knownOrdersCount: getNumber(status.knownOrdersCount),
        windowOrdersCount: getNumber(status.windowOrdersCount),
        knownHashesCount: getNumber(status.knownHashesCount),
        windowHashesCount: getNumber(status.windowHashesCount),
        diagnosticLogCount: getNumber(status.diagnosticLogCount),
        eventJournalCount: getNumber(status.eventJournalCount)
    };

    const statusEl = document.getElementById('status');

    if (statusEl) {
        statusEl.innerText = getStatusLabel(currentMonitorStatus);
        statusEl.classList.remove('running', 'stopped', 'warming');

        if (currentMonitorStatus.isRunning && currentMonitorStatus.monitorState === 'warming') {
            statusEl.classList.add('warming');
        } else {
            statusEl.classList.add(currentMonitorStatus.isRunning ? 'running' : 'stopped');
        }
    }

    const toggleBtn = document.getElementById('toggleMonitor');

    if (toggleBtn) {
        toggleBtn.innerText = currentMonitorStatus.isRunning ? 'Stop monitoring' : 'Start monitoring';
    }
}

function loadMonitorStatus() {
    send({ type: 'GET_MONITOR_STATUS' }, (res) => {
        if (!res?.ok) {
            updateStatus({ isRunning: false, monitorState: 'uninitialized' });
            return;
        }

        updateStatus(res.status || {});
    });
}

function toggleMonitor() {
    const type = currentMonitorStatus.isRunning ? 'STOP' : 'START';

    send({ type }, () => {
        loadMonitorStatus();
    });
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
                mode: 'full',
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
    const toggleMonitorBtn = document.getElementById('toggleMonitor');
    const openOptionsBtn = document.getElementById('openOptions');
    const openHistoryBtn = document.getElementById('openHistory');
    const downloadDiagnosticLogBtn = document.getElementById('downloadDiagnosticLog');
    const popupIgnoreLegalEntityPayment = document.getElementById('popupIgnoreLegalEntityPayment');
    const popupIgnoreOzon = document.getElementById('popupIgnoreOzon');
    const popupAddWatchedOrder = document.getElementById('popupAddWatchedOrder');
    const popupWatchedOrderInput = document.getElementById('popupWatchedOrderInput');

    if (toggleMonitorBtn) {
        toggleMonitorBtn.addEventListener('click', () => {
            toggleMonitor();
        });
    }

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

    if (popupIgnoreLegalEntityPayment) {
        popupIgnoreLegalEntityPayment.addEventListener('change', () => {
            toggleQuickSuppressor('ignoreLegalEntityPayment');
        });
    }

    if (popupIgnoreOzon) {
        popupIgnoreOzon.addEventListener('change', () => {
            toggleQuickSuppressor('ignoreOzon');
        });
    }

    if (popupAddWatchedOrder) {
        popupAddWatchedOrder.addEventListener('click', addWatchedOrderFromPopup);
    }

    if (popupWatchedOrderInput) {
        popupWatchedOrderInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                addWatchedOrderFromPopup();
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const version = chrome.runtime.getManifest().version;
    setText('version', `v${version}`);

    bindNavigationActions();
    loadMonitorStatus();
    loadPopupConfig();
});
