const HISTORY_DEFAULT_LIMIT = 50;

const EVENT_TYPE_LABELS = {
    'new-order': 'Новый заказ',
    'order-changed': 'Изменение заказа'
};

const EVENT_KIND_LABELS = {
    live: 'live',
    'catch-up': 'catch-up',
    'scope-catch-up': 'scope catch-up'
};

const FIELD_LABELS = {
    status: 'Статус',
    delivery: 'Доставка',
    payment: 'Оплата',
    city: 'Город',
    tags: 'Теги'
};

function sendMessage(message, callback) {
    chrome.runtime.sendMessage(message, (response) => {
        if (typeof callback === 'function') {
            callback(response);
        }
    });
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
        return 'unknown time';
    }

    return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16);
}

function formatValue(value) {
    if (value === undefined || value === null || value === '') {
        return '—';
    }

    if (Array.isArray(value)) {
        return value.length ? value.join(', ') : '—';
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
    return EVENT_TYPE_LABELS[eventType] || eventType || 'event';
}

function getEventKindLabel(eventKind) {
    return EVENT_KIND_LABELS[eventKind] || eventKind || 'unknown';
}

function renderDiff(diff) {
    const safeDiff = Array.isArray(diff) ? diff : [];

    if (!safeDiff.length) {
        return '<div class="history-empty">Нет diff</div>';
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

function renderOrderLink(entry) {
    const orderId = escapeHtml(entry.orderId || 'unknown');

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
        ? 'уведомление: да'
        : `уведомление: нет${entry.notification?.reason ? ` (${entry.notification.reason})` : ''}`;

    return `
        <article class="history-entry" data-event-id="${escapeHtml(entry.id || '')}">
            <div class="history-entry-title">
                ${renderOrderLink(entry)} — ${escapeHtml(getEventTypeLabel(entry.eventType))}
            </div>

            <div class="history-entry-meta">
                ${escapeHtml(formatTimestamp(entry.createdAt))}
                · ${escapeHtml(getEventKindLabel(entry.eventKind))}
                · ${escapeHtml(entry.syncReason || 'normal')}
            </div>

            <div class="history-entry-context">
                Поля: ${escapeHtml(changedFields)}
                · ${escapeHtml(notificationText)}
            </div>

            <div class="history-diff">
                ${renderDiff(entry.diff)}
            </div>
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
        statusEl.innerText = 'Failed to load history';
        listEl.innerHTML = '';
        return;
    }

    const entries = Array.isArray(response.entries) ? response.entries : [];

    statusEl.innerText = `Events: ${response.total || 0}, shown: ${entries.length}`;

    if (!entries.length) {
        listEl.innerHTML = '<div class="history-empty">История пока пуста</div>';
        return;
    }

    listEl.innerHTML = entries.map(renderEntry).join('');
}

function loadHistory() {
    const statusEl = document.getElementById('historyStatus');

    if (statusEl) {
        statusEl.innerText = 'Loading...';
    }

    sendMessage({
        type: 'GET_EVENT_JOURNAL',
        options: {
            limit: HISTORY_DEFAULT_LIMIT
        }
    }, renderHistory);
}

function bindHistoryControls() {
    const refreshBtn = document.getElementById('refreshHistory');

    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadHistory);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    bindHistoryControls();
    loadHistory();
});
