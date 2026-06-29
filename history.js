const HISTORY_DEFAULT_LIMIT = 100;
const ORDERS_WATCHED_ORDER_LIMIT = 100;

let currentOrdersConfig = {
    watchedOrders: {
        items: []
    }
};

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

function normalizeOrdersWatchedOrderId(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();
}

function isValidOrdersWatchedOrderId(value) {
    return /^\d{4}-\d{4,10}$/.test(normalizeOrdersWatchedOrderId(value));
}

function normalizeOrdersTimestamp(value) {
    const numeric = Number(value);

    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeOrdersWatchedOrderItem(value, now = Date.now()) {
    const source = value && typeof value === 'object'
        ? value
        : { id: value };
    const id = normalizeOrdersWatchedOrderId(source.id);

    if (!isValidOrdersWatchedOrderId(id)) {
        return null;
    }

    return {
        id,
        status: source.status === 'unresolved' ? 'unresolved' : 'active',
        addedAt: normalizeOrdersTimestamp(source.addedAt) || now,
        lastCheckedAt: normalizeOrdersTimestamp(source.lastCheckedAt),
        lastBaselineAt: normalizeOrdersTimestamp(source.lastBaselineAt),
        lastEventAt: normalizeOrdersTimestamp(source.lastEventAt),
        lastError: source.lastError ? String(source.lastError) : null
    };
}

function normalizeOrdersWatchedOrdersConfig(value = {}, now = Date.now()) {
    const rawItems = Array.isArray(value?.items)
        ? value.items
        : Array.isArray(value?.orders)
            ? value.orders
            : Array.isArray(value)
                ? value
                : [];
    const seen = new Set();
    const items = [];

    for (const rawItem of rawItems) {
        const item = normalizeOrdersWatchedOrderItem(rawItem, now);

        if (!item || seen.has(item.id)) {
            continue;
        }

        seen.add(item.id);
        items.push(item);

        if (items.length >= ORDERS_WATCHED_ORDER_LIMIT) {
            break;
        }
    }

    return { items };
}

function getOrdersWatchedOrdersConfig(config = {}) {
    return normalizeOrdersWatchedOrdersConfig(config?.watchedOrders);
}

function isOrderWatched(orderId) {
    const id = normalizeOrdersWatchedOrderId(orderId);

    return getOrdersWatchedOrdersConfig(currentOrdersConfig).items.some(item => item.id === id);
}

function getWatchedOrderStatusLabel(status) {
    if (status === 'unresolved') {
        return 'не найден / ошибка';
    }

    return 'активен';
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

    const orderId = order.orderId || response.selectedOrderId || '';
    const orderUrl = order.orderUrl
        ? `<a href="${escapeHtml(order.orderUrl)}" target="_blank" rel="noreferrer">Открыть в админке</a>`
        : '';
    const watched = isOrderWatched(orderId) || order.isWatched === true;
    const watchedLabel = watched ? 'Да' : 'Нет';
    const watchButton = watched
        ? `<button type="button" data-watch-action="remove" data-order-id="${escapeHtml(orderId)}">Убрать из отслеживания</button>`
        : `<button type="button" data-watch-action="add" data-order-id="${escapeHtml(orderId)}">Отслеживать</button>`;

    setInnerHtml('orderSummary', `
        <section class="order-summary">
            <div class="order-summary-title">Заказ ${escapeHtml(orderId)}</div>
            <div class="order-summary-meta">
                Последнее известное событие: ${escapeHtml(formatTimestamp(order.lastSeenAt))}
                · Отслеживается: ${escapeHtml(watchedLabel)}
                ${orderUrl ? ` · ${orderUrl}` : ''}
            </div>
            <div class="actions-row">${watchButton}</div>
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


function renderWatchedOrders(config = currentOrdersConfig) {
    const watchedOrders = getOrdersWatchedOrdersConfig(config);

    setInnerText(
        'ordersWatchedStatus',
        watchedOrders.items.length
            ? `Отслеживается заказов: ${watchedOrders.items.length}`
            : 'Список отслеживаемых заказов пуст.'
    );

    if (!watchedOrders.items.length) {
        setInnerHtml('ordersWatchedList', '<div class="history-empty">Добавьте полный номер заказа, чтобы включить direct follow-up.</div>');
        return;
    }

    setInnerHtml('ordersWatchedList', watchedOrders.items.map((item) => `
        <article class="watched-order-row" data-order-id="${escapeHtml(item.id)}">
            <div>
                <strong>${escapeHtml(item.id)}</strong>
                <div class="watched-order-meta">
                    статус: ${escapeHtml(getWatchedOrderStatusLabel(item.status))};
                    добавлен: ${escapeHtml(formatTimestamp(item.addedAt))};
                    первая проверка: ${escapeHtml(formatTimestamp(item.lastBaselineAt))};
                    последняя проверка: ${escapeHtml(formatTimestamp(item.lastCheckedAt))};
                    последнее событие: ${escapeHtml(formatTimestamp(item.lastEventAt))}
                    ${item.lastError ? `; ошибка: ${escapeHtml(item.lastError)}` : ''}
                </div>
            </div>
            <div class="watched-order-actions">
                <button type="button" data-watch-action="open" data-order-id="${escapeHtml(item.id)}">Открыть</button>
                <button type="button" data-watch-action="remove" data-order-id="${escapeHtml(item.id)}">Удалить</button>
            </div>
        </article>
    `).join(''));
}

function loadOrdersConfig() {
    sendMessage({ type: 'GET_CONFIG' }, (response) => {
        if (!response?.ok) {
            setInnerText('ordersWatchedStatus', 'Не удалось загрузить отслеживаемые заказы.');
            return;
        }

        currentOrdersConfig = response.userConfig || currentOrdersConfig;
        renderWatchedOrders(currentOrdersConfig);
    });
}

function saveOrdersConfig(nextConfig, successMessage) {
    sendMessage({ type: 'UPDATE_CONFIG', userConfig: nextConfig }, (response) => {
        if (!response?.ok) {
            setInnerText('ordersWatchedStatus', 'Не удалось сохранить отслеживаемые заказы.');
            renderWatchedOrders(currentOrdersConfig);
            return;
        }

        currentOrdersConfig = response.userConfig || nextConfig;
        renderWatchedOrders(currentOrdersConfig);
        setInnerText('ordersWatchedStatus', successMessage || 'Список отслеживаемых заказов сохранён.');
    });
}

function addWatchedOrder(orderId, source = 'orders-page') {
    const id = normalizeOrdersWatchedOrderId(orderId);

    if (!isValidOrdersWatchedOrderId(id)) {
        setInnerText('ordersWatchedStatus', 'Введите полный номер заказа в формате 1234-110626.');
        return;
    }

    const watchedOrders = getOrdersWatchedOrdersConfig(currentOrdersConfig);

    if (watchedOrders.items.some(item => item.id === id)) {
        setInnerText('ordersWatchedStatus', `Заказ №${id} уже отслеживается.`);
        return;
    }

    if (watchedOrders.items.length >= ORDERS_WATCHED_ORDER_LIMIT) {
        setInnerText('ordersWatchedStatus', `Достигнут лимит: ${ORDERS_WATCHED_ORDER_LIMIT} заказов.`);
        return;
    }

    const nextConfig = {
        ...currentOrdersConfig,
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

    saveOrdersConfig(nextConfig, source === 'summary'
        ? `Заказ №${id} добавлен в отслеживаемые.`
        : `Заказ №${id} добавлен. Первая direct follow-up проверка станет baseline без уведомления.`);
}

function removeWatchedOrder(orderId) {
    const id = normalizeOrdersWatchedOrderId(orderId);
    const watchedOrders = getOrdersWatchedOrdersConfig(currentOrdersConfig);

    const nextConfig = {
        ...currentOrdersConfig,
        watchedOrders: {
            items: watchedOrders.items.filter(item => item.id !== id)
        }
    };

    saveOrdersConfig(nextConfig, `Заказ №${id} удалён из отслеживаемых.`);
}

function addWatchedOrderFromInput() {
    const input = document.getElementById('ordersWatchedOrderInput');
    const id = normalizeOrdersWatchedOrderId(input?.value);

    addWatchedOrder(id);

    if (isValidOrdersWatchedOrderId(id) && input) {
        input.value = '';
    }
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
    const orderSummaryEl = document.getElementById('orderSummary');
    const watchedListEl = document.getElementById('ordersWatchedList');
    const addWatchedBtn = document.getElementById('ordersAddWatchedOrder');
    const watchedInput = document.getElementById('ordersWatchedOrderInput');

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

    if (orderSummaryEl) {
        orderSummaryEl.addEventListener('click', (event) => {
            const action = event?.target?.dataset?.watchAction;
            const orderId = event?.target?.dataset?.orderId;

            if (action === 'add') {
                addWatchedOrder(orderId, 'summary');
            } else if (action === 'remove') {
                removeWatchedOrder(orderId);
            }
        });
    }

    if (watchedListEl) {
        watchedListEl.addEventListener('click', (event) => {
            const action = event?.target?.dataset?.watchAction;
            const orderId = event?.target?.dataset?.orderId;

            if (action === 'open') {
                setElementValue('historyOrderQuery', orderId);
                loadOrderHistory(orderId);
            } else if (action === 'remove') {
                removeWatchedOrder(orderId);
            }
        });
    }

    if (addWatchedBtn) {
        addWatchedBtn.addEventListener('click', addWatchedOrderFromInput);
    }

    if (watchedInput) {
        watchedInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                addWatchedOrderFromInput();
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    bindHistoryControls();
    renderHistory({ ok: true, status: 'idle' });
    loadOrdersConfig();
});
