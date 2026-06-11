const HISTORY_DEFAULT_LIMIT = 100;

const EVENT_TYPE_LABELS = {
    'new-order': 'Новый заказ',
    'order-changed': 'Изменение заказа',
    'scope-changed': 'Смена области мониторинга',
    'direct-follow-up': 'Direct follow-up'
};

const EVENT_KIND_LABELS = {
    live: 'Живое наблюдение',
    'catch-up': 'Catch-up после запуска',
    'scope-catch-up': 'Catch-up после смены области',
    'scope-change': 'Смена области',
    'direct-follow-up': 'Direct follow-up'
};

const SYNC_REASON_LABELS = {
    normal: 'Обычный цикл',
    initial: 'Первичный baseline',
    'manual-start': 'Ручной запуск',
    recovery: 'Восстановление',
    'stale-resume': 'Возврат после долгого перерыва',
    'scope-change': 'Смена области мониторинга',
    'mode-change': 'Смена режима мониторинга',
    'window-sync': 'Синхронизация окна'
};

const FIELD_LABELS = {
    status: 'Статус',
    delivery: 'Доставка',
    payment: 'Оплата',
    city: 'Город',
    tags: 'Теги',
    scope: 'Область мониторинга',
    'scope.status': 'Область: статус',
    'scope.delivery': 'Область: доставка',
    'scope.payment': 'Область: оплата',
    'scope.orderFlags': 'Область: флаги',
    'scope.store': 'Область: склад',
    'scope.reserve': 'Область: резерв',
    'scope.assemblyStatus': 'Область: комплектация'
};

function sendMessage(message, callback) {
    chrome.runtime.sendMessage(message, (response) => {
        if (typeof callback === 'function') {
            callback(response);
        }
    });
}

function getElementValue(id) {
    const el = document.getElementById(id);

    return el ? String(el.value || '').trim() : '';
}

function setElementValue(id, value) {
    const el = document.getElementById(id);

    if (el) {
        el.value = String(value || '');
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatTimestamp(value) {
    const timestamp = Number(value);

    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return 'Время неизвестно';
    }

    return new Date(timestamp).toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatValue(value) {
    if (value === undefined || value === null || value === '') {
        return '—';
    }

    if (Array.isArray(value)) {
        return value.length ? value.map(formatValue).join(', ') : '—';
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}

function getFieldLabel(field) {
    return FIELD_LABELS[field] || field;
}

function getEventTypeLabel(eventType) {
    return EVENT_TYPE_LABELS[eventType] || eventType || 'Событие';
}

function getEventKindLabel(eventKind) {
    return EVENT_KIND_LABELS[eventKind] || eventKind || 'Источник неизвестен';
}

function getSyncReasonLabel(syncReason) {
    return SYNC_REASON_LABELS[syncReason] || syncReason || 'Обычный цикл';
}

function getPeriodSince(period) {
    const now = Date.now();
    const value = String(period || 'all');

    if (value === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today.getTime();
    }

    if (value === '24h') {
        return now - 24 * 60 * 60 * 1000;
    }

    if (value === '7d') {
        return now - 7 * 24 * 60 * 60 * 1000;
    }

    return null;
}

function buildHistoryFilters() {
    const options = {
        limit: HISTORY_DEFAULT_LIMIT
    };

    const orderQuery = getElementValue('historyOrderQuery');
    const eventType = getElementValue('historyEventType');
    const eventKind = getElementValue('historyEventKind');
    const changedField = getElementValue('historyChangedField');
    const period = getElementValue('historyPeriod') || 'all';
    const watchedOnly = getElementValue('historyWatchedOnly') === '1';
    const since = getPeriodSince(period);

    if (orderQuery) {
        options.orderQuery = orderQuery;
    }

    if (eventType) {
        options.eventType = eventType;
    }

    if (eventKind) {
        options.eventKind = eventKind;
    }

    if (changedField) {
        options.changedField = changedField;
    }

    if (since) {
        options.since = since;
    }

    if (watchedOnly) {
        options.watchedOnly = true;
    }

    return options;
}

function renderDiff(diff) {
    const safeDiff = Array.isArray(diff) ? diff : [];

    if (!safeDiff.length) {
        return '<div class="history-empty">Diff не записан</div>';
    }

    return safeDiff.map((item) => `
        <div class="history-diff-row">
            <span class="history-field">${escapeHtml(getFieldLabel(item.field))}</span>:
            <span>${escapeHtml(formatValue(item.before))}</span>
            →
            <span>${escapeHtml(formatValue(item.after))}</span>
        </div>
    `).join('');
}

function renderCurrentState(entry) {
    const context = entry.context || {};
    const rows = [
        ['status', context.status],
        ['delivery', context.delivery],
        ['payment', context.payment],
        ['city', context.city],
        ['tags', context.tags]
    ].filter(([, value]) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length));

    if (!rows.length) {
        return '<div class="history-empty">Текущие данные не записаны</div>';
    }

    return rows.map(([field, value]) => `
        <div class="history-current-row">
            <span class="history-field">${escapeHtml(getFieldLabel(field))}</span>:
            <span>${escapeHtml(formatValue(value))}</span>
        </div>
    `).join('');
}

function renderEntryBody(entry) {
    if (entry.eventType === 'new-order') {
        return `<div class="history-diff">${renderCurrentState(entry)}</div>`;
    }

    return `<div class="history-diff">${renderDiff(entry.diff)}</div>`;
}

function renderOrderLink(entry) {
    const orderId = escapeHtml(entry.orderId || '—');

    if (entry.eventType === 'scope-changed') {
        return 'Область мониторинга';
    }

    if (!entry.orderUrl) {
        return `Заказ №${orderId}`;
    }

    return `<a href="${escapeHtml(entry.orderUrl)}" target="_blank" rel="noreferrer">Заказ №${orderId}</a>`;
}

function renderEntry(entry) {
    const changedFields = Array.isArray(entry.changedFields) && entry.changedFields.length
        ? entry.changedFields.map(getFieldLabel).join(', ')
        : '—';

    const notificationText = entry.notification?.notify
        ? 'Уведомление: да'
        : `Уведомление: нет${entry.notification?.reason ? ` (${entry.notification.reason})` : ''}`;

    return `
        <article class="history-entry" data-event-id="${escapeHtml(entry.id || '')}" data-event-type="${escapeHtml(entry.eventType || '')}">
            <div class="history-entry-title">
                ${renderOrderLink(entry)} — ${escapeHtml(getEventTypeLabel(entry.eventType))}
            </div>

            <div class="history-entry-meta">
                ${escapeHtml(formatTimestamp(entry.createdAt))}
                · ${escapeHtml(getEventKindLabel(entry.eventKind))}
                · ${escapeHtml(getSyncReasonLabel(entry.syncReason))}
            </div>

            <div class="history-entry-context">
                Поля: ${escapeHtml(changedFields)}
            </div>

            <div class="history-entry-notification">
                ${escapeHtml(notificationText)}
            </div>

            ${renderEntryBody(entry)}
        </article>
    `;
}

function renderHistory(response) {
    const statusEl = document.getElementById('historyStatus');
    const listEl = document.getElementById('historyList');

    if (!statusEl || !listEl) {
        return;
    }

    if (!response?.ok) {
        statusEl.innerText = 'Не удалось загрузить историю';
        listEl.innerHTML = '';
        return;
    }

    const entries = Array.isArray(response.entries) ? response.entries : [];

    statusEl.innerText = `Событий найдено: ${response.total || 0}; показано: ${entries.length}; всего сохранено: ${response.storedTotal || 0}`;

    if (!entries.length) {
        listEl.innerHTML = '<div class="history-empty">По выбранным фильтрам событий нет</div>';
        return;
    }

    listEl.innerHTML = entries.map(renderEntry).join('');
}

function loadHistory() {
    const statusEl = document.getElementById('historyStatus');

    if (statusEl) {
        statusEl.innerText = 'Загрузка...';
    }

    sendMessage({
        type: 'GET_EVENT_JOURNAL',
        options: buildHistoryFilters()
    }, renderHistory);
}

function resetHistoryFilters() {
    setElementValue('historyOrderQuery', '');
    setElementValue('historyEventType', '');
    setElementValue('historyEventKind', '');
    setElementValue('historyChangedField', '');
    setElementValue('historyPeriod', 'all');
    setElementValue('historyWatchedOnly', '');
    loadHistory();
}

function bindHistoryControls() {
    const refreshBtn = document.getElementById('refreshHistory');
    const resetBtn = document.getElementById('resetHistoryFilters');
    const filterIds = [
        'historyOrderQuery',
        'historyEventType',
        'historyEventKind',
        'historyChangedField',
        'historyPeriod',
        'historyWatchedOnly'
    ];

    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadHistory);
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', resetHistoryFilters);
    }

    filterIds.forEach((id) => {
        const el = document.getElementById(id);

        if (!el) {
            return;
        }

        el.addEventListener('change', loadHistory);

        if (id === 'historyOrderQuery') {
            el.addEventListener('input', loadHistory);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindHistoryControls();
    loadHistory();
});
