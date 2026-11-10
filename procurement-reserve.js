/* Procurement items → manually created empty legacy-admin order. */
(function () {
    'use strict';

    const model = globalThis.TabWandererProcurementReserveModel;
    const match = location.pathname.match(/^\/admin\/products\/procurements\/(\d+)\/items-view\/?$/);
    if (!model || !match || document.getElementById('tw-procurement-reserve-button')) {
        return;
    }

    const procurementId = match[1];
    const orderLinkBase = '/admin/orders/';
    const lockTimeout = 600000;
    let summary;
    let isRunning = false;
    let cancelRequested = false;
    let lock = null;
    let orderInfo = null;
    let modal = null;
    let statusLine = null;
    let progressLine = null;
    let startButton = null;
    let cancelButton = null;
    let closeButton = null;
    let orderLink = null;

    function getSourceItems() {
        const scripts = Array.from(document.scripts).filter((script) => !script.src);
        for (const script of scripts) {
            if ((script.textContent || '').includes(".controller('ProcurementItemsCtrl'")) {
                return model.readJsonArrayAssignment(script.textContent);
            }
        }
        throw new Error('Список товаров не найден. Обновите страницу поставки.');
    }

    function setStatus(message, bad) {
        if (!statusLine) return;
        statusLine.textContent = message;
        statusLine.style.color = bad ? '#ad2525' : '#1d4b35';
    }

    function make(tag, attrs, text) {
        const el = document.createElement(tag);
        for (const [name, value] of Object.entries(attrs || {})) {
            if (name === 'className') el.className = value;
            else if (name === 'style') el.style.cssText = value;
            else el.setAttribute(name, value);
        }
        if (text != null) el.textContent = String(text);
        return el;
    }

    function addText(parent, tag, text, attrs) {
        const element = make(tag, attrs || {}, text);
        parent.appendChild(element);
        return element;
    }

    function createModal() {
        const overlay = make('div', { id: 'tw-procurement-reserve-modal', style: 'position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:14px;' });
        const panel = make('div', { style: 'max-width:850px;width:100%;max-height:94vh;overflow:auto;background:#fff;color:#20262b;padding:22px;border-radius:9px;box-shadow:0 12px 35px #0006;font:14px/1.45 Arial,sans-serif;' });
        overlay.appendChild(panel);
        addText(panel, 'h2', 'Собрать резерв под процен', { style: 'font-size:21px;margin:0 0 10px' });
        addText(panel, 'p', `Поставка №${procurementId}. К добавлению: ${summary.rows.length} позиций, ${summary.units} шт. Пропущено: ${summary.skipped} строк (отклонённые/нулевое количество).`, { style: 'margin:0 0 12px' });
        addText(panel, 'p', 'Создайте пустой заказ в старом интерфейсе, затем вставьте ссылку на него. Расширение не создаёт заказ и не устанавливает авторезерв.', { style: 'margin:0 0 13px' });
        const label = addText(panel, 'label', 'Ссылка на пустой заказ', { for: 'tw-procurement-reserve-order', style: 'display:block;font-weight:bold;margin-bottom:5px;' });
        const input = make('input', { id: 'tw-procurement-reserve-order', type: 'url', placeholder: 'https://amperkot.ru/admin/orders/3486-101126/', style: 'width:100%;box-sizing:border-box;border:1px solid #a0a6ad;padding:9px;border-radius:4px;' });
        label.after(input);
        const warning = addText(panel, 'p', 'Пока идёт перенос, не изменяйте этот заказ в других вкладках или с других компьютеров. Будут проверены уже имеющиеся позиции; при посторонних товарах, несовпадении количества или ошибке автоматизация остановится.', { style: 'margin:12px 0;color:#775406;' });
        const sample = make('details', { style: 'margin:10px 0;' });
        sample.appendChild(make('summary', {}, `Показать состав поставки (${summary.rows.length} позиций)`));
        const preview = make('div', { style: 'max-height:240px;overflow:auto;border:1px solid #ddd;margin-top:8px;padding:7px;' });
        const list = make('table', { style: 'width:100%;font-size:12px;border-collapse:collapse;' });
        summary.rows.forEach((item) => {
            const tr = make('tr');
            const title = make('td', { style: 'padding:3px;border-bottom:1px solid #ddd;' }, `${item.title} (ID ${item.id})`);
            tr.appendChild(title);
            tr.appendChild(make('td', { style: 'padding:3px;text-align:right;white-space:nowrap;border-bottom:1px solid #ddd;' }, `${item.quantity} шт.`));
            list.appendChild(tr);
        });
        preview.appendChild(list);
        sample.appendChild(preview);
        panel.appendChild(sample);
        progressLine = addText(panel, 'p', 'Ожидание запуска.', { style: 'font-weight:bold;margin:10px 0 5px;' });
        statusLine = addText(panel, 'p', '', { style: 'white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 10px;' });
        const actions = make('div', { style: 'display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px;margin-top:12px;' });
        orderLink = make('a', { target: '_blank', rel: 'noopener noreferrer', style: 'display:none;margin-right:auto;color:#006cbb;' }, 'Открыть заказ');
        actions.appendChild(orderLink);
        closeButton = make('button', { type: 'button', style: 'padding:8px 15px;border:1px solid #bbb;border-radius:4px;background:#fff;' }, 'Закрыть');
        startButton = make('button', { type: 'button', style: 'padding:8px 15px;border:0;border-radius:4px;background:#146bc4;color:white;font-weight:bold;' }, 'Начать добавление');
        cancelButton = make('button', { type: 'button', style: 'padding:8px 15px;border:1px solid #b26c3d;border-radius:4px;background:#fff4e9;display:none;' }, 'Остановить');
        actions.append(closeButton, cancelButton, startButton);
        panel.appendChild(actions);
        document.body.appendChild(overlay);
        modal = overlay;
        closeButton.addEventListener('click', () => {
            if (isRunning) return;
            modal.remove();
            modal = null;
        });
        cancelButton.addEventListener('click', () => {
            cancelRequested = true;
            cancelButton.disabled = true;
            setStatus('Остановка после текущей операции.');
        });
        startButton.addEventListener('click', () => void start(input.value));
        input.focus();
    }

    function parseHtml(html) {
        return new DOMParser().parseFromString(html, 'text/html');
    }

    async function loadHtml(path) {
        const result = await fetch(path, {
            method: 'GET',
            credentials: 'same-origin',
            redirect: 'follow',
            cache: 'no-store',
            headers: { Accept: 'text/html' }
        });
        if (!result.ok || new URL(result.url).origin !== location.origin) {
            throw new Error(`Не удалось загрузить страницу админки: HTTP ${result.status}.`);
        }
        return { html: await result.text(), finalUrl: new URL(result.url) };
    }

    function parseOrder(html, number) {
        const doc = parseHtml(html);
        const correctLink = `/admin/orders/${number}/items/new/`;
        const addLink = Array.from(doc.querySelectorAll('a[href]'))
            .some((el) => new URL(el.getAttribute('href'), location.origin).pathname === correctLink);
        if (!addLink) {
            throw new Error('Страница заказа не распознана или нет доступа к добавлению позиций. Проверьте ссылку и авторизацию.');
        }
        const reserveControl = doc.querySelector('#shop-order-reserve');
        if (reserveControl && reserveControl.getAttribute('data-value') === '1') {
            throw new Error('В заказе уже включён авторезерв. Сначала отключите его вручную.');
        }
        const existing = new Map();
        const productRows = new Set();
        const allRows = Array.from(doc.querySelectorAll('input[name="batch-action[items][]"]'));
        for (const checkbox of allRows) {
            const row = checkbox.closest('tr');
            if (!row) throw new Error('Не распознана строка товара в заказе.');
            const link = row.querySelector('a[href*="/products/"][href$=".html"]');
            if (!link) throw new Error('В заказе обнаружена позиция без ID товара.');
            const match = new URL(link.getAttribute('href'), location.origin).pathname.match(/^\/products\/[^/]+\/(\d+)\.html$/);
            if (!match) throw new Error('Не распознан ID товара в заказе.');
            const cells = Array.from(row.children).filter((el) => el.tagName === 'TD');
            const productColumn = cells.findIndex((cell) => cell.contains(link));
            if (productColumn < 0 || !cells[productColumn + 1]) throw new Error('Не найдена колонка количества в заказе.');
            const qtyText = (cells[productColumn + 1].querySelector('b') || {}).textContent || '';
            const qty = Number(qtyText.replace(/\s/g, ''));
            if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error(`Не распознано количество товара ID ${match[1]} в заказе.`);
            const id = Number(match[1]);
            existing.set(id, (existing.get(id) || 0) + qty);
            productRows.add(row);
        }
        if (productRows.size !== allRows.length) {
            throw new Error('В заказе обнаружены непроверенные строки.');
        }
        return existing;
    }

    async function loadOrder() {
        const page = await loadHtml(orderInfo.url);
        if (page.finalUrl.pathname !== `${orderLinkBase}${orderInfo.number}/`) {
            throw new Error('Сайт перенаправил запрос не на страницу заказа.');
        }
        return parseOrder(page.html, orderInfo.number);
    }

    async function getFormToken() {
        const response = await loadHtml(orderInfo.formUrl);
        if (response.finalUrl.pathname !== `${orderLinkBase}${orderInfo.number}/items/new/`) {
            throw new Error('Форма добавления недоступна или выполнено перенаправление.');
        }
        const doc = parseHtml(response.html);
        const form = doc.querySelector('form[name="form"][method="post"]');
        const token = form && form.querySelector('input[name="form[_token]"]');
        if (!form || !token || !token.value || !form.querySelector('select[name="form[loader_data][product]"]') || !form.querySelector('input[name="form[quantity]"]')) {
            throw new Error('Форма добавления товара изменилась. Безопасно продолжить нельзя.');
        }
        return token.value;
    }

    async function postItem(item, token) {
        const body = new URLSearchParams();
        body.set('form[loader_data][product]', String(item.id));
        body.set('form[quantity]', String(item.quantity));
        body.set('form[_token]', token);
        body.set('form[save]', '');
        const response = await fetch(orderInfo.formUrl, {
            method: 'POST',
            credentials: 'same-origin',
            redirect: 'follow',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'text/html' },
            body: body.toString()
        });
        if (!response.ok || new URL(response.url).origin !== location.origin) {
            throw new Error(`Сервер вернул ошибку при добавлении ID ${item.id}: HTTP ${response.status}.`);
        }
        // The followed redirect contains the updated order. Verify this exact
        // response instead of requesting the same page two more times.
        if (new URL(response.url).pathname !== `${orderLinkBase}${orderInfo.number}/`) {
            throw new Error(`Не подтверждено добавление ID ${item.id}: форма не вернула страницу заказа.`);
        }
        return parseOrder(await response.text(), orderInfo.number);
    }

    function acquireLock(number) {
        const key = `tab-wanderer:procurement-reserve:lock:${number}`;
        const old = localStorage.getItem(key);
        if (old) {
            try {
                const previous = JSON.parse(old);
                if (Date.now() - previous.time < lockTimeout) {
                    throw new Error('В другой вкладке уже выполняется добавление в этот заказ.');
                }
            } catch (error) {
                if (error.message.includes('В другой вкладке')) throw error;
            }
        }
        const token = `${Date.now()}-${Math.random()}`;
        localStorage.setItem(key, JSON.stringify({ token, time: Date.now() }));
        if (JSON.parse(localStorage.getItem(key)).token !== token) {
            throw new Error('Другой запуск занял этот заказ.');
        }
        return { key, token };
    }

    function updateLock() {
        if (!lock) return;
        const value = JSON.parse(localStorage.getItem(lock.key) || 'null');
        if (!value || value.token !== lock.token) {
            throw new Error('Блокировка заказа потеряна — работа остановлена.');
        }
        localStorage.setItem(lock.key, JSON.stringify({ token: lock.token, time: Date.now() }));
    }

    function releaseLock() {
        if (!lock) return;
        try {
            if (JSON.parse(localStorage.getItem(lock.key) || 'null')?.token === lock.token) {
                localStorage.removeItem(lock.key);
            }
        } catch (_error) { /* stale lock expires automatically */ }
        lock = null;
    }

    async function start(rawUrl) {
        if (isRunning) return;
        try {
            orderInfo = model.parseOrderUrl(rawUrl);
            if (summary.problems.length) throw new Error(summary.problems.join('\n'));
            if (!summary.rows.length) throw new Error('Нет позиций для добавления.');
            lock = acquireLock(orderInfo.number);
        } catch (error) {
            setStatus(error.message, true);
            return;
        }
        isRunning = true;
        cancelRequested = false;
        startButton.disabled = true;
        closeButton.disabled = true;
        cancelButton.style.display = 'inline-block';
        cancelButton.disabled = false;
        orderLink.href = orderInfo.url;
        orderLink.style.display = 'inline';
        let verified = 0;
        let skipped = 0;
        try {
            updateLock();
            const result = await model.transferToOrder(summary.rows, {
                readOrder: loadOrder,
                getFormToken,
                addAndRead: postItem,
                heartbeat: updateLock,
                isCancelled: () => cancelRequested,
                onUpdate: ({ phase, item, added, already, total, pending }) => {
                    verified = added;
                    skipped = already;
                    if (phase === 'planned') {
                        progressLine.textContent = `Уже присутствуют: ${already}. К добавлению: ${pending}.`;
                    } else if (phase === 'adding') {
                        progressLine.textContent = `Проверено: ${added + already}/${total}. Добавляем ID ${item.id} — ${item.quantity} шт.`;
                    } else if (phase === 'confirmed') {
                        progressLine.textContent = `Подтверждено: ${added + already}/${total}.`;
                    }
                }
            });
            progressLine.textContent = `Готово: ${summary.rows.length} позиций, ${summary.units} шт.`;
            setStatus(`Добавлено за запуск: ${result.added}. Уже находились в заказе: ${result.already}. Проверьте заказ и вручную включите авторезерв.`);
        } catch (error) {
            progressLine.textContent = `Остановлено. Добавлено и проверено: ${verified}. Ранее присутствовали: ${skipped}.`;
            setStatus(`${error.message}\nПроверьте состав заказа перед повторным запуском.`, true);
        } finally {
            releaseLock();
            isRunning = false;
            startButton.disabled = false;
            closeButton.disabled = false;
            cancelButton.style.display = 'none';
        }
    }

    function initialize() {
        const header = document.querySelector('#content > .flex.flex-wrap.justify-between') || document.querySelector('#content h1');
        if (!header) return;

        // The admin page does not define a reliable btn-warning style. Use the extension's primary palette.
        const styles = make('style', { id: 'tw-procurement-reserve-button-style' });
        styles.textContent = `
            #tw-procurement-reserve-button {
                display: inline-flex !important;
                align-items: center;
                justify-content: center;
                gap: 9px;
                min-height: 40px;
                margin: 4px 8px;
                padding: 10px 16px;
                border: 1px solid #1d47ae !important;
                border-radius: 9px !important;
                background: #2458d3 !important;
                color: #fff !important;
                font: 700 13px/1.3 Arial, sans-serif !important;
                text-decoration: none !important;
                white-space: nowrap;
                box-shadow: 0 2px 6px rgba(36, 88, 211, .22);
                cursor: pointer !important;
                transition: background-color .12s ease, box-shadow .12s ease, transform .12s ease;
            }
            #tw-procurement-reserve-button:hover {
                border-color: #173b92 !important;
                background: #1d47ae !important;
                box-shadow: 0 4px 10px rgba(36, 88, 211, .28);
            }
            #tw-procurement-reserve-button:active {
                background: #173b92 !important;
                transform: translateY(1px);
            }
            #tw-procurement-reserve-button:focus-visible {
                outline: 3px solid rgba(36, 88, 211, .35);
                outline-offset: 3px;
            }
            #tw-procurement-reserve-button > svg {
                width: 18px;
                height: 18px;
                flex: none;
                fill: none;
                stroke: currentColor;
                stroke-width: 1.8;
                stroke-linecap: round;
                stroke-linejoin: round;
                pointer-events: none;
            }
        `;
        document.head.appendChild(styles);

        const button = make('button', { id: 'tw-procurement-reserve-button', type: 'button', className: 'btn' });
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        for (const d of [
            'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
            'm3.3 7 8.7 5 8.7-5M12 22V12'
        ]) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            icon.appendChild(path);
        }
        button.append(icon, make('span', {}, 'Собрать резерв под процен'));
        if (header.matches('h1')) header.after(button);
        else header.appendChild(button);
        button.addEventListener('click', () => {
            if (modal) return;
            try {
                summary = model.summarizeItems(getSourceItems());
                if (summary.problems.length) throw new Error(summary.problems.join('\n'));
                createModal();
            } catch (error) {
                alert(`Не удалось подготовить поставку: ${error.message}`);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();
