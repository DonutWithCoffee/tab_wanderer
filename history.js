const HISTORY_DEFAULT_LIMIT = 100;

const EVENT_TYPE_LABELS = {
    'new-order': 'Первое обнаружение заказа',
    'order-changed': 'Изменение заказа',
    'scope-changed': 'Смена области мониторинга',
    'direct-follow-up': 'Direct follow-up'
};

const EVENT_KIND_LABELS = {
    live: 'Список заказов',
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
    'window-sync': 'Синхронизация окна',
    'direct-follow-up': 'Direct follow-up'
};

const FIELD_LABELS = {
    status: 'Статус',
    delivery: 'Доставка',
    payment: 'Оплата',
    city: 'Город',
    tags: 'Теги',
    phoneNormalized: 'Телефон',
    totalAmount: 'Сумма',
    manager: 'Менеджер',
    contractor: 'Контрагент'
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

function setInnerHtml(id, value) {
    const el = document.getElementById(id);

    if (el) {
        el.innerHTML = String(value || '');
    }
}

function setInnerText(id, value) {
    const el = document.getElementById(id);

    if (el) {
        el.innerText = String(value || '');
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

function buildLookupOptions(queryOverride) {
    const query = String(queryOverride || getElementValue('historyOrderQuery') || '').trim();

    return {
        query,
        limit: HISTORY_DEFAULT_LIMIT
    };
}

function renderDiff(diff) {
    const safeDiff = Array.isArray(diff) ? diff : [];

    if (!safeDiff.length) {
        return '<div class="history-empty">Изменения по полям не записаны</div>';
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

function renderCurrentState(context = {}) {
    const rows = [
        ['status', context.status],
        ['delivery', context.delivery],
        ['payment', context.payment],
        ['city', context.city],
        ['tags', context.tags]
    ].filter(([, value]) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length));

    if (!rows.length) {
        return '<div class="history-empty">Последнее состояние не записано</div>';
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
        return `<div class="history-diff">${renderCurrentState(entry.context || {})}</div>`;
    }

    return `<div class="history-diff">${renderDiff(entry.diff)}</div>`;
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
                ${escapeHtml(getEventTypeLabel(entry.eventType))}
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

function renderCandidate(candidate) {
    const context = candidate.context || {};
    const status = context.status ? `Статус: ${formatValue(context.status)}` : 'Статус неизвестен';
    const watched = candidate.isWatched ? ' · отслеживается' : '';

    return `
        <div class="candidate-item" data-order-id="${escapeHtml(candidate.orderId || '')}">
            <div>
                <strong>${escapeHtml(candidate.orderId || '')}</strong>
                <div class="candidate-meta">
                    ${escapeHtml(status)} · последнее событие: ${escapeHtml(formatTimestamp(candidate.lastSeenAt))}${escapeHtml(watched)}
                </div>
            </div>
            <button type="button" data-order-id="${escapeHtml(candidate.orderId || '')}">Открыть</button>
        </div>
    `;
}

function renderCandidates(response) {
    const candidates = Array.isArray(response.candidates) ? response.candidates : [];

    if (response.status !== 'multiple-candidates') {
        setInnerHtml('historyCandidates', '');
        return;
    }

    setInnerHtml('historyCandidates', `
        <section class="candidate-list">
            <div class="order-summary-title">Найдено несколько заказов с номером ${escapeHtml(response.query)}</div>
            <div class="hint">Выберите полный номер заказа.</div>
            ${candidates.map(renderCandidate).join('')}
        </section>
    `);
}

function renderOrderSummary(response) {
    const order = response.order || null;

    if (!order || response.status !== 'selected') {
        setInnerHtml('orderSummary', '');
        return;
    }

    const orderUrl = order.orderUrl
        ? `<a href="${escapeHtml(order.orderUrl)}" target="_blank" rel="noreferrer">Открыть в админке</a>`
        : '';
    const watched = order.isWatched ? 'Да' : 'Нет';

    setInnerHtml('orderSummary', `
        <section class="order-summary">
            <div class="order-summary-title">Заказ ${escapeHtml(order.orderId || response.selectedOrderId || '')}</div>
            <div class="order-summary-meta">
                Последнее известное событие: ${escapeHtml(formatTimestamp(order.lastSeenAt))}
                · Отслеживается: ${escapeHtml(watched)}
                ${orderUrl ? ` · ${orderUrl}` : ''}
            </div>
            <div class="history-diff">
                ${renderCurrentState(order.context || {})}
            </div>
            <p class="hint">
                Показаны только изменения, которые обнаружил плагин. Это не полная серверная история заказа.
            </p>
        </section>
    `);
}

function renderHistory(response) {
    if (!response?.ok) {
        setInnerText('historyStatus', 'Не удалось загрузить изменения по заказу');
        setInnerHtml('historyCandidates', '');
        setInnerHtml('orderSummary', '');
        setInnerHtml('historyList', '');
        return;
    }

    const status = String(response.status || 'idle');
    const entries = Array.isArray(response.entries) ? response.entries : [];

    if (status === 'idle') {
        setInnerText('historyStatus', 'Введите номер заказа для поиска');
        setInnerHtml('historyCandidates', '');
        setInnerHtml('orderSummary', '');
        setInnerHtml('historyList', '');
        return;
    }

    if (status === 'invalid-query') {
        setInnerText('historyStatus', 'Введите полный номер заказа или первые 4 цифры до дефиса');
        setInnerHtml('historyCandidates', '');
        setInnerHtml('orderSummary', '');
        setInnerHtml('historyList', '');
        return;
    }

    if (status === 'not-found') {
        setInnerText('historyStatus', `Заказ ${response.query || ''} не найден в локальных данных плагина`);
        setInnerHtml('historyCandidates', '');
        setInnerHtml('orderSummary', '');
        setInnerHtml('historyList', '<div class="history-empty">Плагин показывает только заказы, которые уже видел.</div>');
        return;
    }

    renderCandidates(response);
    renderOrderSummary(response);

    if (status === 'multiple-candidates') {
        setInnerText('historyStatus', `Найдено несколько заказов: ${(response.candidates || []).length}`);
        setInnerHtml('orderSummary', '');
        setInnerHtml('historyList', '');
        return;
    }

    setInnerText('historyStatus', `Заказ найден: ${response.selectedOrderId || ''}. Событий: ${entries.length}`);

    if (!entries.length) {
        setInnerHtml('historyList', '<div class="history-empty">Изменений по этому заказу пока не записано</div>');
        return;
    }

    setInnerHtml('historyList', entries.map(renderEntry).join(''));
}

function loadOrderHistory(queryOverride) {
    const statusEl = document.getElementById('historyStatus');

    if (statusEl) {
        statusEl.innerText = 'Поиск...';
    }

    sendMessage({
        type: 'GET_ORDER_LOOKUP',
        options: buildLookupOptions(queryOverride)
    }, renderHistory);
}

function resetHistorySearch() {
    setElementValue('historyOrderQuery', '');
    renderHistory({ ok: true, status: 'idle' });
}

function bindHistoryControls() {
    const searchBtn = document.getElementById('searchHistory');
    const resetBtn = document.getElementById('resetHistorySearch');
    const queryInput = document.getElementById('historyOrderQuery');
    const candidatesEl = document.getElementById('historyCandidates');

    if (searchBtn) {
        searchBtn.addEventListener('click', () => loadOrderHistory());
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', resetHistorySearch);
    }

    if (queryInput) {
        queryInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                loadOrderHistory();
            }
        });
    }

    if (candidatesEl) {
        candidatesEl.addEventListener('click', (event) => {
            const orderId = event?.target?.dataset?.orderId;

            if (!orderId) {
                return;
            }

            setElementValue('historyOrderQuery', orderId);
            loadOrderHistory(orderId);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    bindHistoryControls();
    renderHistory({ ok: true, status: 'idle' });
});
