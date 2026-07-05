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
const POPUP_WATCHED_ORDER_NOTE_LIMIT = 300;
const POPUP_WATCHED_ORDER_ADD_POLL_INTERVAL_MS = 1000;
const POPUP_WATCHED_ORDER_ADD_MAX_POLLS = 60;


function send(msg, cb) {
    chrome.runtime.sendMessage(msg, (res) => {
        const runtimeError = chrome.runtime.lastError;
        const response = runtimeError
            ? { ok: false, error: runtimeError.message || 'Ошибка связи с background.' }
            : res;

        console.log('[POPUP]', msg.type, response);
        if (cb) cb(response);
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
            setText('quickSuppressStatus', 'Не удалось загрузить фильтры.');
            return;
        }

        currentPopupConfig = res.userConfig || currentPopupConfig;
        updateQuickSuppressorControls(currentPopupConfig);
        setText('quickSuppressStatus', 'Фильтры скрывают только уведомления. Заказы всё равно обновляются.');
    });
}

function savePopupConfig(nextConfig, successMessage = 'Фильтры сохранены.') {
    setText('quickSuppressStatus', 'Сохраняем фильтры...');

    send({ type: 'UPDATE_CONFIG', userConfig: nextConfig }, (res) => {
        if (!res?.ok) {
            updateQuickSuppressorControls(currentPopupConfig);
            setText('quickSuppressStatus', 'Не удалось сохранить фильтры.');
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

function normalizePopupWatchedOrderNote(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, POPUP_WATCHED_ORDER_NOTE_LIMIT);
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
            note: normalizePopupWatchedOrderNote(source.note),
            addedAt: Number(source.addedAt) > 0 ? Number(source.addedAt) : Date.now(),
            lastCheckedAt: Number(source.lastCheckedAt) > 0 ? Number(source.lastCheckedAt) : null,
            lastBaselineAt: Number(source.lastBaselineAt) > 0 ? Number(source.lastBaselineAt) : null,
            lastEventAt: Number(source.lastEventAt) > 0 ? Number(source.lastEventAt) : null,
            lastError: source.lastError ? String(source.lastError) : null,
            reminder: source.reminder && typeof source.reminder === 'object' ? source.reminder : null
        });

        if (items.length >= POPUP_WATCHED_ORDER_LIMIT) {
            break;
        }
    }

    return { items };
}


function getPopupWatchedOrderItem(config = {}, orderId = '') {
    const id = normalizePopupWatchedOrderId(orderId);

    return getPopupWatchedOrdersConfig(config).items.find(item => item.id === id) || null;
}

function getPopupWatchedOrderAddError(status = {}, orderId = '') {
    const id = normalizePopupWatchedOrderId(orderId);
    const addState = status?.watchedOrderAddState || null;
    let error = '';

    if (addState?.lastResult?.orderId === id && addState.lastResult.ok === false) {
        error = addState.lastResult.error || '';
    } else if (status?.directFollowUpState?.lastError) {
        error = status.directFollowUpState.lastError;
    }

    if (error === 'direct order parse failed') {
        return `Заказ №${id} не найден в админке. В список не добавлен.`;
    }

    return error || 'Заказ не найден или не проверен.';
}

function pollPopupWatchedOrderAddResult(orderId, attempt = 0) {
    if (typeof setTimeout !== 'function') {
        return;
    }

    const id = normalizePopupWatchedOrderId(orderId);

    setTimeout(() => {
        send({ type: 'GET_CONFIG' }, (configResponse) => {
            if (configResponse?.ok && getPopupWatchedOrderItem(configResponse.userConfig, id)) {
                currentPopupConfig = configResponse.userConfig || currentPopupConfig;

                const input = document.getElementById('popupWatchedOrderInput');
                const noteInput = document.getElementById('popupWatchedOrderNote');

                if (input && normalizePopupWatchedOrderId(input.value) === id) {
                    input.value = '';
                }

                if (noteInput) {
                    noteInput.value = '';
                }

                setText('popupWatchedOrderStatus', `Заказ №${id} добавлен в отслеживание.`);
                return;
            }

            send({ type: 'GET_MONITOR_STATUS' }, (statusResponse) => {
                const status = statusResponse?.status || {};
                const addState = status.watchedOrderAddState || null;
                const isStillPending = addState?.pending === true && addState.orderId === id;
                const isDirectCheckStillRunning = status.directFollowUpState?.currentOrderId === id;

                const hasMatchingFailure = addState?.lastResult?.orderId === id && addState.lastResult.ok === false;

                if (hasMatchingFailure) {
                    setText('popupWatchedOrderStatus', getPopupWatchedOrderAddError(status, id));
                    return;
                }

                if (isStillPending || isDirectCheckStillRunning || attempt + 1 < POPUP_WATCHED_ORDER_ADD_MAX_POLLS) {
                    if (attempt + 1 < POPUP_WATCHED_ORDER_ADD_MAX_POLLS) {
                        pollPopupWatchedOrderAddResult(id, attempt + 1);
                    } else {
                        setText('popupWatchedOrderStatus', 'Проверка затянулась. Попробуйте ещё раз или откройте список заказов.');
                    }
                    return;
                }

                setText('popupWatchedOrderStatus', getPopupWatchedOrderAddError(status, id));
            });
        });
    }, POPUP_WATCHED_ORDER_ADD_POLL_INTERVAL_MS);
}

function addWatchedOrderFromPopup() {
    const input = document.getElementById('popupWatchedOrderInput');
    const noteInput = document.getElementById('popupWatchedOrderNote');
    const id = normalizePopupWatchedOrderId(input?.value);
    const note = normalizePopupWatchedOrderNote(noteInput?.value);

    if (!isValidPopupWatchedOrderId(id)) {
        setText('popupWatchedOrderStatus', 'Введите полный номер: 1234-110626.');
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

    setText('popupWatchedOrderStatus', 'Проверяем заказ...');

    send({
        type: 'ADD_WATCHED_ORDER',
        orderId: id,
        note
    }, (res) => {
        if (!res?.ok) {
            setText('popupWatchedOrderStatus', res?.error || 'Заказ не найден или не проверен.');
            return;
        }

        currentPopupConfig = res.userConfig || currentPopupConfig;

        if (res.validating === true) {
            setText('popupWatchedOrderStatus', `Проверяем заказ №${id}...`);
            pollPopupWatchedOrderAddResult(id);
            return;
        }

        if (input) {
            input.value = '';
        }

        if (noteInput) {
            noteInput.value = '';
        }

        setText('popupWatchedOrderStatus', `Заказ №${id} добавлен в отслеживание.`);
    });
}

function getStatusLabel(status = {}) {
    if (status.isRunning !== true) {
        return 'Статус: выключен';
    }

    const state = String(status.monitorState || 'active');

    if (state === 'warming') {
        return 'Статус: запускается';
    }

    return 'Статус: работает';
}


function getMonitorModeLabel(value) {
    return value === 'active' ? 'активный' : 'по фильтрам админки';
}

function buildStatusDetails(status = {}) {
    if (status.isRunning !== true) {
        return 'Мониторинг выключен. Уведомлений не будет.';
    }

    const parts = [
        `режим: ${getMonitorModeLabel(status.monitorMode)}`,
        `окно: ${getNumber(status.windowOrdersCount)}`,
        `известно: ${getNumber(status.knownOrdersCount)}`,
        `worker: ${status.hasWorkerTab === true ? 'есть' : 'нет'}`
    ];

    if (String(status.monitorState || '') === 'warming') {
        parts.unshift('идёт стартовая синхронизация без лишних уведомлений');
    }

    return parts.join(' · ');
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

    setText('statusDetails', buildStatusDetails(currentMonitorStatus));

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
        toggleBtn.innerText = currentMonitorStatus.isRunning ? 'Остановить мониторинг' : 'Включить мониторинг';
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

function getOptionalNumberText(value) {
    const numeric = Number(value);

    return Number.isFinite(numeric) ? String(numeric) : '—';
}

function getDiagnosticMonitorModeLabel(mode) {
    return String(mode || 'windowed') === 'active'
        ? 'Быстрый: только первая страница'
        : 'Общий: первая страница + глубокая синхронизация';
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
        `Прямая проверка: worker=${getYesNo(status.hasDirectWorkerTab === true)}; tabId=${status.directWorkerTabId === null || status.directWorkerTabId === undefined ? '—' : String(status.directWorkerTabId)}; отслеживаемых=${getNumber(status.watchedOrdersCount)}; текущий заказ=${getTextValue(directState.currentOrderId)}`,
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

function buildDiagnosticLogText(snapshot = {}, status = {}) {
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
    setText('diagnosticLogStatus', 'Готовим лог...');

    send({ type: 'GET_MONITOR_STATUS' }, (statusRes) => {
        if (!statusRes?.ok) {
            setText('diagnosticLogStatus', 'Не удалось загрузить состояние мониторинга.');
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
                setText('diagnosticLogStatus', 'Не удалось загрузить лог.');
                return;
            }

            const text = buildDiagnosticLogText(logRes, statusRes.status || {});
            const downloaded = downloadTextFile(buildDiagnosticLogFilename(), text);

            setText(
                'diagnosticLogStatus',
                downloaded ? 'Лог готов.' : 'Не удалось подготовить диагностический лог.'
            );
        });
    });
}

function bindNavigationActions() {
    const toggleMonitorBtn = document.getElementById('toggleMonitor');
    const openOptionsBtn = document.getElementById('openOptions');
    const openWatchedOrdersBtn = document.getElementById('openWatchedOrders');
    const downloadDiagnosticLogBtn = document.getElementById('downloadDiagnosticLog');
    const popupIgnoreLegalEntityPayment = document.getElementById('popupIgnoreLegalEntityPayment');
    const popupIgnoreOzon = document.getElementById('popupIgnoreOzon');
    const popupAddWatchedOrder = document.getElementById('popupAddWatchedOrder');
    const popupWatchedOrderInput = document.getElementById('popupWatchedOrderInput');
    const popupWatchedOrderNote = document.getElementById('popupWatchedOrderNote');

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

    if (openWatchedOrdersBtn) {
        openWatchedOrdersBtn.addEventListener('click', () => {
            chrome.tabs.create({
                url: chrome.runtime.getURL('watched-orders.html'),
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

    if (popupWatchedOrderNote) {
        popupWatchedOrderNote.addEventListener('keydown', (event) => {
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
