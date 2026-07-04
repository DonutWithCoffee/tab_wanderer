const HISTORY_DEFAULT_LIMIT = 100;
const ORDERS_WATCHED_ORDER_LIMIT = 100;
const ORDERS_WATCHED_ORDER_REMINDER_NOTE_LIMIT = 200;


let currentOrdersConfig = {
    watchedOrders: {
        items: []
    }
};

const EVENT_TYPE_LABELS = {
    'new-order': 'Заказ впервые увиден',
    'order-changed': 'Изменение заказа',
    'scope-changed': 'Смена области мониторинга',
    'direct-follow-up': 'Прямая проверка заказа'
};

const EVENT_KIND_LABELS = {
    live: 'Список заказов',
    'catch-up': 'Синхронизация после запуска',
    'scope-catch-up': 'Синхронизация после смены области',
    'scope-change': 'Смена области',
    'direct-follow-up': 'Прямая проверка'
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
    'direct-follow-up': 'Прямая проверка'
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

function normalizeOrdersWatchedOrderReminderStatus(value) {
    const status = String(value || '').trim();

    if (status === 'done') {
        return 'done';
    }

    if (status === 'cancelled') {
        return 'cancelled';
    }

    return 'pending';
}

function normalizeOrdersWatchedOrderReminderNote(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, ORDERS_WATCHED_ORDER_REMINDER_NOTE_LIMIT);
}

function normalizeOrdersWatchedOrderReminder(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const remindAt = normalizeOrdersTimestamp(value.remindAt);

    if (!remindAt) {
        return null;
    }

    return {
        status: normalizeOrdersWatchedOrderReminderStatus(value.status),
        remindAt,
        note: normalizeOrdersWatchedOrderReminderNote(value.note),
        createdAt: normalizeOrdersTimestamp(value.createdAt),
        updatedAt: normalizeOrdersTimestamp(value.updatedAt),
        completedAt: normalizeOrdersTimestamp(value.completedAt),
        cancelledAt: normalizeOrdersTimestamp(value.cancelledAt)
    };
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
        lastError: source.lastError ? String(source.lastError) : null,
        reminder: normalizeOrdersWatchedOrderReminder(source.reminder)
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
        return 'требует внимания';
    }

    return 'активен';
}

function getWatchedOrderStatusBadgeClass(status) {
    return status === 'unresolved' ? 'badge-warning' : 'badge-positive';
}

function getWatchedOrderReminderStatusLabel(status) {
    if (status === 'done') {
        return 'сработало';
    }

    if (status === 'cancelled') {
        return 'отменено';
    }

    return 'запланировано';
}

function getWatchedOrderReminderBadgeClass(status) {
    if (status === 'pending') {
        return 'badge-warning';
    }

    return 'badge-muted';
}

function getWatchedOrderReminderInputId(kind, orderId) {
    const safeId = normalizeOrdersWatchedOrderId(orderId).replace(/[^A-Z0-9]+/g, '_');

    return `ordersReminder${kind}_${safeId}`;
}

function parseOrdersReminderDateTime(value) {
    const text = String(value || '').trim();

    if (!text) {
        return null;
    }

    const timestamp = new Date(text).getTime();

    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function renderBadge(value, className = '') {
    return `<span class="badge ${escapeHtml(className)}">${escapeHtml(value)}</span>`;
}

function formatEventCount(value) {
    const count = Number(value);

    if (!Number.isFinite(count) || count < 0) {
        return '0 событий';
    }

    const normalized = Math.trunc(count);

    if (normalized % 10 === 1 && normalized % 100 !== 11) {
        return `${normalized} событие`;
    }

    if ([2, 3, 4].includes(normalized % 10) && ![12, 13, 14].includes(normalized % 100)) {
        return `${normalized} события`;
    }

    return `${normalized} событий`;
}

function buildOrderMetaParts(context = {}) {
    return [
        context.status ? `статус: ${formatValue(context.status)}` : '',
        context.delivery ? `доставка: ${formatValue(context.delivery)}` : '',
        context.payment ? `оплата: ${formatValue(context.payment)}` : '',
        context.city ? `город: ${formatValue(context.city)}` : ''
    ].filter(Boolean);
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
    const metaParts = buildOrderMetaParts(context);
    const eventCount = formatEventCount(candidate.eventCount);
    const watched = candidate.isWatched ? renderBadge('отслеживается', 'badge-positive') : renderBadge('не отслеживается', 'badge-muted');

    return `
        <div class="candidate-item" data-order-id="${escapeHtml(candidate.orderId || '')}">
            <div>
                <div class="candidate-title">${escapeHtml(candidate.orderId || '')}</div>
                <div class="candidate-meta">
                    ${escapeHtml(metaParts.length ? metaParts.join(' · ') : 'состояние неизвестно')}
                    · последнее событие: ${escapeHtml(formatTimestamp(candidate.lastSeenAt))}
                    · ${escapeHtml(eventCount)}
                </div>
                <div>${watched}</div>
            </div>
            <button type="button" data-order-id="${escapeHtml(candidate.orderId || '')}">Выбрать</button>
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
    const watchedBadge = watched
        ? renderBadge('прямая проверка включена', 'badge-positive')
        : renderBadge('прямая проверка выключена', 'badge-muted');
    const watchButton = watched
        ? `<button type="button" data-watch-action="remove" data-order-id="${escapeHtml(orderId)}">Отключить прямую проверку</button>`
        : `<button type="button" data-watch-action="add" data-order-id="${escapeHtml(orderId)}">Включить прямую проверку</button>`;

    setInnerHtml('orderSummary', `
        <section class="order-summary">
            <div class="order-summary-title">Заказ ${escapeHtml(orderId)}</div>
            <div>${watchedBadge}</div>
            <div class="order-summary-meta">
                Последнее известное событие: ${escapeHtml(formatTimestamp(order.lastSeenAt))}
                · ${escapeHtml(formatEventCount(order.eventCount))}
                ${orderUrl ? ` · ${orderUrl}` : ''}
            </div>
            <div class="actions-row">${watchButton}</div>
            <div class="current-state">
                <div class="order-summary-title">Последнее известное состояние</div>
                ${renderCurrentState(order.context || {})}
            </div>
            <p class="hint support-note">
                Показаны только изменения, которые обнаружил плагин. Это не полная серверная история заказа.
            </p>
        </section>
    `);
}

function renderHistory(response) {
    if (!response?.ok) {
        setInnerText('historyStatus', 'Не удалось загрузить данные по заказу');
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
        setInnerText('historyStatus', 'Введите 4 цифры или полный номер заказа в формате 1234-110626');
        setInnerHtml('historyCandidates', '');
        setInnerHtml('orderSummary', '');
        setInnerHtml('historyList', '');
        return;
    }

    if (status === 'not-found') {
        setInnerText('historyStatus', `Заказ ${response.query || ''} не найден в локальной базе плагина`);
        setInnerHtml('historyCandidates', '');
        setInnerHtml('orderSummary', '');
        setInnerHtml('historyList', '<div class="history-empty">Плагин показывает только заказы, которые уже видел. Проверьте номер или дождитесь следующей синхронизации.</div>');
        return;
    }

    renderCandidates(response);
    renderOrderSummary(response);

    if (status === 'multiple-candidates') {
        setInnerText('historyStatus', `Найдено несколько заказов: ${(response.candidates || []).length}. Выберите полный номер.`);
        setInnerHtml('orderSummary', '');
        setInnerHtml('historyList', '');
        return;
    }

    setInnerText('historyStatus', `Заказ ${response.selectedOrderId || ''} найден · ${formatEventCount(entries.length)}`);

    if (!entries.length) {
        setInnerHtml('historyList', '<div class="history-empty">Изменений по этому заказу пока не записано. Последнее состояние показано выше.</div>');
        return;
    }

    setInnerHtml('historyList', `
        <section class="candidate-list">
            <div class="order-summary-title">Обнаруженные изменения</div>
            <p class="hint">Это локальная история плагина, а не полный журнал админки.</p>
            ${entries.map(renderEntry).join('')}
        </section>
    `);
}


function renderWatchedOrderReminderForm(item) {
    const reminderAtInputId = getWatchedOrderReminderInputId('At', item.id);
    const reminderNoteInputId = getWatchedOrderReminderInputId('Note', item.id);

    return `
        <div class="reminder-form" aria-label="Новое напоминание для заказа ${escapeHtml(item.id)}">
            <input
                id="${escapeHtml(reminderAtInputId)}"
                type="datetime-local"
                aria-label="Дата и время напоминания"
                required
            >
            <input
                id="${escapeHtml(reminderNoteInputId)}"
                type="text"
                maxlength="${ORDERS_WATCHED_ORDER_REMINDER_NOTE_LIMIT}"
                placeholder="Комментарий (опционально)"
                aria-label="Комментарий к напоминанию"
            >
            <button type="button" data-watch-action="set-reminder" data-order-id="${escapeHtml(item.id)}">Напомнить</button>
        </div>
    `;
}

function renderWatchedOrderReminder(item) {
    const reminder = item.reminder || null;

    if (reminder?.status === 'pending') {
        return `
            <div class="reminder-panel reminder-panel-active">
                <div>
                    ${renderBadge(getWatchedOrderReminderStatusLabel(reminder.status), getWatchedOrderReminderBadgeClass(reminder.status))}
                    <span class="reminder-title">Напоминание: ${escapeHtml(formatTimestamp(reminder.remindAt))}</span>
                </div>
                ${reminder.note ? `<div class="reminder-note">${escapeHtml(reminder.note)}</div>` : ''}
                <div class="reminder-actions">
                    <button type="button" data-watch-action="clear-reminder" data-order-id="${escapeHtml(item.id)}">Удалить напоминание</button>
                </div>
            </div>
        `;
    }

    const previousReminder = reminder
        ? `
            <div class="reminder-previous">
                ${renderBadge(getWatchedOrderReminderStatusLabel(reminder.status), getWatchedOrderReminderBadgeClass(reminder.status))}
                <span>${escapeHtml(formatTimestamp(reminder.remindAt))}</span>
            </div>
        `
        : '';

    return `
        <div class="reminder-panel">
            ${previousReminder}
            ${renderWatchedOrderReminderForm(item)}
        </div>
    `;
}

function renderWatchedOrders(config = currentOrdersConfig) {
    const watchedOrders = getOrdersWatchedOrdersConfig(config);

    setInnerText(
        'ordersWatchedStatus',
        watchedOrders.items.length
            ? `В прямой проверке: ${watchedOrders.items.length}`
            : 'Список отслеживаемых заказов пуст.'
    );

    if (!watchedOrders.items.length) {
        setInnerHtml('ordersWatchedList', '<div class="history-empty">Добавьте полный номер заказа, чтобы включить прямую проверку конкретной карточки заказа.</div>');
        return;
    }

    setInnerHtml('ordersWatchedList', watchedOrders.items.map((item) => `
        <article class="watched-order-row" data-order-id="${escapeHtml(item.id)}">
            <div class="watched-order-main">
                <div class="watched-orders-title">${escapeHtml(item.id)}</div>
                ${renderBadge(getWatchedOrderStatusLabel(item.status), getWatchedOrderStatusBadgeClass(item.status))}
                <div class="watched-order-meta">
                    Добавлен: ${escapeHtml(formatTimestamp(item.addedAt))}<br>
                    Baseline: ${escapeHtml(formatTimestamp(item.lastBaselineAt))}<br>
                    Последняя проверка: ${escapeHtml(formatTimestamp(item.lastCheckedAt))}<br>
                    Последнее изменение: ${escapeHtml(formatTimestamp(item.lastEventAt))}
                    ${item.lastError ? `<br>Ошибка: ${escapeHtml(item.lastError)}` : ''}
                </div>
                ${renderWatchedOrderReminder(item)}
            </div>
            <div class="watched-order-actions">
                <button type="button" data-watch-action="open" data-order-id="${escapeHtml(item.id)}">Показать</button>
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
        ? `Для заказа №${id} включена прямая проверка.`
        : `Заказ №${id} добавлен. Первая прямая проверка станет baseline без уведомления.`);
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

    saveOrdersConfig(nextConfig, `Для заказа №${id} прямая проверка отключена.`);
}

function setWatchedOrderReminderFromForm(orderId) {
    const id = normalizeOrdersWatchedOrderId(orderId);
    const watchedOrders = getOrdersWatchedOrdersConfig(currentOrdersConfig);
    const item = watchedOrders.items.find(candidate => candidate.id === id);

    if (!item) {
        setInnerText('ordersWatchedStatus', `Заказ №${id} не найден в списке отслеживания.`);
        return;
    }

    if (item.reminder?.status === 'pending') {
        setInnerText('ordersWatchedStatus', `У заказа №${id} уже есть активное напоминание.`);
        return;
    }

    const remindAt = parseOrdersReminderDateTime(getElementValue(getWatchedOrderReminderInputId('At', id)));
    const note = getElementValue(getWatchedOrderReminderInputId('Note', id));

    if (!remindAt || remindAt <= Date.now()) {
        setInnerText('ordersWatchedStatus', 'Выберите дату и время напоминания в будущем.');
        return;
    }

    sendMessage({
        type: 'SET_WATCHED_ORDER_REMINDER',
        orderId: id,
        reminder: {
            remindAt,
            note
        }
    }, (response) => {
        if (!response?.ok) {
            setInnerText('ordersWatchedStatus', 'Не удалось сохранить напоминание.');
            renderWatchedOrders(currentOrdersConfig);
            return;
        }

        currentOrdersConfig = response.userConfig || currentOrdersConfig;
        renderWatchedOrders(currentOrdersConfig);
        setInnerText('ordersWatchedStatus', `Напоминание для заказа №${id} сохранено.`);
    });
}

function clearWatchedOrderReminderFromButton(orderId) {
    const id = normalizeOrdersWatchedOrderId(orderId);

    sendMessage({
        type: 'CLEAR_WATCHED_ORDER_REMINDER',
        orderId: id
    }, (response) => {
        if (!response?.ok) {
            setInnerText('ordersWatchedStatus', 'Не удалось удалить напоминание.');
            renderWatchedOrders(currentOrdersConfig);
            return;
        }

        currentOrdersConfig = response.userConfig || currentOrdersConfig;
        renderWatchedOrders(currentOrdersConfig);
        setInnerText('ordersWatchedStatus', `Напоминание для заказа №${id} удалено.`);
    });
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
        statusEl.innerText = 'Ищу заказ...';
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
            } else if (action === 'set-reminder') {
                setWatchedOrderReminderFromForm(orderId);
            } else if (action === 'clear-reminder') {
                clearWatchedOrderReminderFromButton(orderId);
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
