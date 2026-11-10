/* Pure helpers for preparing a procurement → existing-order copy. */
(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.TabWandererProcurementReserveModel = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function readJsonArrayAssignment(source) {
        if (typeof source !== 'string') {
            throw new Error('Не получен исходный код списка поставки.');
        }
        const controllerAt = source.indexOf(".controller('ProcurementItemsCtrl'");
        if (controllerAt < 0) {
            throw new Error('В HTML отсутствует контроллер списка поставки.');
        }
        const assignment = /\bvm\.items\s*=\s*\[/g;
        assignment.lastIndex = controllerAt;
        const found = assignment.exec(source);
        if (!found) {
            throw new Error('Не удалось найти исходные позиции поставки.');
        }
        const start = found.index + found[0].lastIndexOf('[');
        let depth = 0;
        let quoted = false;
        let escaped = false;
        for (let index = start; index < source.length; index += 1) {
            const character = source[index];
            if (quoted) {
                if (escaped) {
                    escaped = false;
                } else if (character === '\\') {
                    escaped = true;
                } else if (character === '"') {
                    quoted = false;
                }
            } else if (character === '"') {
                quoted = true;
            } else if (character === '[') {
                depth += 1;
            } else if (character === ']') {
                depth -= 1;
                if (depth === 0) {
                    const value = JSON.parse(source.slice(start, index + 1));
                    if (!Array.isArray(value)) {
                        throw new Error('Список поставки имеет неверный формат.');
                    }
                    return value;
                }
            }
        }
        throw new Error('Не удалось прочитать полный массив позиций поставки.');
    }

    function summarizeItems(rawItems) {
        if (!Array.isArray(rawItems)) {
            throw new Error('Неверные данные позиций поставки.');
        }
        const map = new Map();
        const problems = [];
        let skipped = 0;
        let sourceUnits = 0;
        for (let i = 0; i < rawItems.length; i += 1) {
            const item = rawItems[i];
            const count = Number(item && item.quantity);
            if (!Number.isSafeInteger(count) || count < 0) {
                problems.push(`Строка ${i + 1}: некорректное количество`);
                continue;
            }
            sourceUnits += count;
            if (count === 0 || item.status === 'rejected') {
                skipped += 1;
                continue;
            }
            const id = Number(item.product && item.product.id);
            if (!Number.isSafeInteger(id) || id <= 0) {
                problems.push(`Строка ${i + 1}: отсутствует ID товара`);
                continue;
            }
            const prev = map.get(id);
            if (prev) {
                prev.quantity += count;
                if (!Number.isSafeInteger(prev.quantity)) {
                    problems.push(`ID ${id}: слишком большое количество`);
                }
                prev.sourceRows += 1;
            } else {
                map.set(id, {
                    id,
                    title: String(item.product.title || `Товар ${id}`),
                    article: String(item.product.article || ''),
                    quantity: count,
                    sourceRows: 1
                });
            }
        }
        const rows = Array.from(map.values());
        return {
            rows,
            sourceRows: rawItems.length,
            sourceUnits,
            skipped,
            units: rows.reduce((total, item) => total + item.quantity, 0),
            problems
        };
    }

    function parseOrderUrl(input) {
        let url;
        try {
            url = new URL(String(input || '').trim());
        } catch (_error) {
            throw new Error('Вставьте полную ссылку на заказ из админки.');
        }
        if (url.protocol !== 'https:' || url.hostname !== 'amperkot.ru' || url.port || url.username || url.password) {
            throw new Error('Ссылка должна вести на https://amperkot.ru.');
        }
        const match = url.pathname.match(/^\/admin\/orders\/([0-9]+-[0-9]+)\/?$/);
        if (!match || url.search || url.hash) {
            throw new Error('Нужна ссылка на старую страницу заказа вида /admin/orders/1234-101126/.');
        }
        return {
            number: match[1],
            url: `https://amperkot.ru/admin/orders/${match[1]}/`,
            formUrl: `https://amperkot.ru/admin/orders/${match[1]}/items/new/?type=product`
        };
    }

    function reconcileItems(desired, existingMap) {
        const wanted = new Map(desired.map((item) => [item.id, item]));
        const toAdd = [];
        const already = [];
        const conflicts = [];
        for (const [id, quantity] of existingMap) {
            const item = wanted.get(id);
            if (!item) {
                conflicts.push(`В заказе уже есть посторонний товар ID ${id}.`);
            } else if (quantity !== item.quantity) {
                conflicts.push(`ID ${id}: в заказе ${quantity} шт., в поставке ${item.quantity} шт.`);
            }
        }
        for (const item of desired) {
            if (existingMap.get(item.id) === item.quantity) {
                already.push(item);
            } else if (!existingMap.has(item.id)) {
                toAdd.push(item);
            }
        }
        return { toAdd, already, conflicts };
    }

    // One initial read, one POST (whose redirect returns the updated order HTML)
    // per product, and one independent final read. No blind retries.
    async function transferToOrder(desired, operations) {
        const current = await operations.readOrder();
        const initial = reconcileItems(desired, current);
        if (initial.conflicts.length) {
            throw new Error(`В заказе найдены несовпадения:\n${initial.conflicts.slice(0, 6).join('\n')}`);
        }

        const already = initial.already.length;
        const total = desired.length;
        let added = 0;
        const notify = (phase, item) => {
            if (typeof operations.onUpdate === 'function') {
                operations.onUpdate({ phase, item, added, already, total, pending: initial.toAdd.length });
            }
        };
        const checkCancel = () => {
            if (operations.isCancelled && operations.isCancelled()) {
                throw new Error('Остановлено пользователем.');
            }
        };

        notify('planned');
        checkCancel();
        const token = initial.toAdd.length ? await operations.getFormToken() : null;
        for (const item of initial.toAdd) {
            checkCancel();
            if (operations.heartbeat) operations.heartbeat();
            notify('adding', item);
            // The POST follows the form's redirect to the order detail page.
            // Its response body is the new order snapshot: do not GET it again.
            const after = reconcileItems(desired, await operations.addAndRead(item, token));
            if (after.conflicts.length) {
                throw new Error(`Проверка после добавления: ${after.conflicts[0]}`);
            }
            if (!after.already.some((entry) => entry.id === item.id)) {
                throw new Error(`Товар ID ${item.id} не обнаружен в заказе после POST. Повторно не отправляем.`);
            }
            added += 1;
            notify('confirmed', item);
        }

        if (operations.heartbeat) operations.heartbeat();
        const final = reconcileItems(desired, await operations.readOrder());
        if (final.conflicts.length || final.toAdd.length) {
            throw new Error('Итоговая сверка не совпала с составом поставки.');
        }
        notify('completed');
        return { added, already, total };
    }

    return { readJsonArrayAssignment, summarizeItems, parseOrderUrl, reconcileItems, transferToOrder };
});
