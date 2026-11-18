/* Standalone read-only Ozon closed-order barcode scanner model. */
(function (root) {
    'use strict';
    const API = 'https://amperkot.ru';
    const MAX_HISTORY_PAGES = 5000;
    const HISTORY_CHECKPOINT_PAGES = 10;
    const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
    function listUrl(page, perPage = 100) {
        const url = new URL('/admin/api/v3/shop-orders', API);
        url.searchParams.append('status[]', '6809');
        url.searchParams.append('source[]', '197300');
        url.searchParams.set('page', String(page));
        url.searchParams.set('per_page', String(perPage));
        url.searchParams.set('sort', 'created_at');
        url.searchParams.set('order', 'asc');
        return url.href;
    }
    // Optimized read-only listing. Explicit ascending ordering was verified against
    // the live v3 endpoint. Any observable violation triggers a complete scan.
    async function collectOrdersByCreationDate(fetchPage, from, to, report = () => {}) {
        const pageCache = new Map();
        let totalPages = null, totalCount = null, perPage = null;
        const invariant = (condition, reason) => { if (!condition) throw new Error(reason); };
        const readPage = async (page, allowUnsorted = false) => {
            if (pageCache.has(page)) return pageCache.get(page);
            const response = await fetchPage(page);
            const pages = Number(response?.pages), count = Number(response?.count);
            invariant(Number.isSafeInteger(pages) && pages >= 1 && pages <= 5000, 'invalid-total-pages');
            invariant(Number.isSafeInteger(count) && count >= 0, 'invalid-total-count');
            invariant(Number(response.page) === page, 'page-number-mismatch');
            invariant(Array.isArray(response.items), 'invalid-items');
            invariant(response.items.length <= 100, 'invalid-page-size');
            if (totalPages === null) {
                totalPages = pages; totalCount = count;
                perPage = 100;
            }
            invariant(totalPages === pages && totalCount === count, 'list-count-changed');
            invariant(page >= 1 && page <= totalPages, 'page-out-of-range');
            // Server may return an empty final page only for empty search results.
            invariant(response.items.length || count === 0, 'unexpected-empty-page');
            const dates = response.items.map(item => dateOnly(item?.created_at));
            if (!allowUnsorted) {
                invariant(dates.every(Boolean), 'missing-creation-date');
                invariant(dates.every((date, i) => i === 0 || dates[i - 1] <= date), 'page-not-sorted');
            }
            const value = { response, dates, first: dates[0] || null, last: dates.at(-1) || null };
            pageCache.set(page, value);
            report('page', { page, pages: totalPages, requests: pageCache.size });
            return value;
        };
        async function fullScan(reason) {
            report('fallback', { reason });
            // Re-fetch the entire listing rather than using potentially stale samples.
            // Sorting may be ignored; therefore never stop early in fallback mode.
            pageCache.clear(); totalPages = null; totalCount = null;
            const orders = new Map();
            let previousLast = null;
            for (let page = 1; ; page++) {
                const current = await readPage(page, true);
                // Date sort is not required for a full scan.
                if (previousLast && current.first < previousLast) report('unordered-full-page', { page });
                previousLast = current.last;
                for (const order of filterOrders(current.response, from, to)) orders.set(order.number, order);
                report('progress', { page, pages: totalPages, candidates: orders.size, mode: 'full' });
                if (page === totalPages) break;
            }
            return { orders: [...orders.values()], mode: 'full', pages: totalPages, requests: pageCache.size, reason };
        }
        try {
            const first = await readPage(1);
            const last = await readPage(totalPages);
            invariant(first.last === null || last.first === null || first.last <= last.first, 'global-order-invalid');
            // First page whose final date is >= from.
            let low = 1, high = totalPages + 1;
            while (low < high) {
                const mid = Math.floor((low + high) / 2);
                const sample = await readPage(mid);
                if (sample.last < from) low = mid + 1;
                else high = mid;
            }
            const start = low;
            // First page whose first date is > to (after the selected month).
            low = 1; high = totalPages + 1;
            while (low < high) {
                const mid = Math.floor((low + high) / 2);
                const sample = await readPage(mid);
                if (sample.first <= to) low = mid + 1;
                else high = mid;
            }
            const end = low - 1;
            invariant(start <= end + 1, 'invalid-range');
            const orders = new Map();
            let previousLast = null;
            for (let page = start; page <= end; page++) {
                const current = await readPage(page);
                invariant(previousLast === null || previousLast <= current.first, 'cross-page-not-sorted');
                previousLast = current.last;
                for (const order of filterOrders(current.response, from, to)) orders.set(order.number, order);
                report('progress', { page, pages: totalPages, candidates: orders.size, mode: 'binary', fromPage: start, toPage: end });
            }
            // Verify both excluded neighbours. This is essential for timestamp ties
            // that spill across page boundaries.
            if (start > 1) {
                const before = await readPage(start - 1);
                invariant(before.last < from, 'left-boundary-includes-target');
                if (start <= totalPages) invariant(before.last <= (await readPage(start)).first, 'left-boundary-unsorted');
            }
            if (end < totalPages) {
                const after = await readPage(end + 1);
                invariant(after.first > to, 'right-boundary-includes-target');
                if (end >= 1) invariant((await readPage(end)).last <= after.first, 'right-boundary-unsorted');
            }
            // Check monotonicity among *all sampled pages*, including binary probes.
            const sampled = [...pageCache.entries()].sort((a, b) => a[0] - b[0]);
            for (let i = 1; i < sampled.length; i++) {
                invariant(sampled[i - 1][1].last <= sampled[i][1].first, 'sampled-pages-unsorted');
            }
            report('range', { fromPage: start, toPage: end, pages: totalPages, requests: pageCache.size, candidates: orders.size });
            return { orders: [...orders.values()], mode: 'binary', pages: totalPages, requests: pageCache.size, fromPage: start, toPage: end };
        } catch (error) {
            // Errors thrown by fetchPage (HTTP, cancellation) must propagate; only
            // known structural/sort violations should activate the fallback.
            const reason = String(error?.message || error);
            if (!/^(invalid-total-pages|invalid-total-count|page-number-mismatch|invalid-items|invalid-page-size|list-count-changed|page-out-of-range|unexpected-empty-page|missing-creation-date|page-not-sorted|global-order-invalid|invalid-range|cross-page-not-sorted|left-boundary-includes-target|left-boundary-unsorted|right-boundary-includes-target|right-boundary-unsorted|sampled-pages-unsorted)$/.test(reason)) throw error;
            return fullScan(reason);
        }
    }
    function detailsUrl(number) {
        if (!/^\d{4}-\d{6}$/.test(String(number))) throw new Error('Invalid order number');
        return `${API}/admin/api/shop-orders/${encodeURIComponent(number)}`;
    }
    function historyUrl(productId, page) {
        if (!/^\d+$/.test(String(productId))) throw new Error('Invalid product ID');
        const url = new URL('/_api/private/warehouse/wh1/changes', API);
        // Request item type explicitly. If omitted by API, fail closed instead of treating a multi barcode as a unit.
        ['productItem.barcode', 'productItem.type', 'action.type'].forEach((field, i) => url.searchParams.set(`fields[${i}]`, field));
        url.searchParams.set('page', String(page));
        url.searchParams.set('per_page', '100');
        url.searchParams.set('product', String(productId));
        return url.href;
    }
    // Fetch every history page without silently truncating large stock-card histories.
    // A partial checkpoint is replayable after a stop or request failure.
    async function collectProductHistory(fetchPage, resume = null, checkpoint = async () => {}) {
        let history = [], nextPage = 1, totalPages = null, totalCount = null, firstId = null;
        const prior = resume && resume.complete === false && Array.isArray(resume.history) ? resume : null;
        // Always recheck page 1: new events can shift page offsets even within a day.
        const first = await fetchPage(1);
        const validate = (response, page) => {
            const pages = Number(response?.pages), count = Number(response?.count);
            if (!Array.isArray(response?.items) || !Number.isSafeInteger(pages) || pages < 1 || pages > MAX_HISTORY_PAGES ||
                !Number.isSafeInteger(count) || count < 0 || Number(response?.page) !== page || response.items.length > 100 ||
                (count > 0 && !response.items.length)) throw new Error(`Некорректная пагинация истории: страница ${page}`);
            if (pages !== Math.max(1, Math.ceil(count / 100))) throw new Error(`Несогласованное число страниц истории: ${page}`);
            return { pages, count };
        };
        const meta = validate(first, 1);
        totalPages = meta.pages; totalCount = meta.count;
        firstId = String(first.items[0]?.id ?? '');
        if (totalCount && !firstId) throw new Error('История без идентификаторов операций');
        const append = (items, seen) => {
            for (const event of items) {
                const id = String(event?.id ?? '');
                if (!id || seen.has(id)) throw new Error(`Повтор или отсутствие ID операции в истории, страница ${nextPage}`);
                seen.add(id); history.push(event);
            }
        };
        const canResume = prior && prior.firstId === firstId && prior.pages === totalPages && prior.count === totalCount &&
            Number.isInteger(prior.nextPage) && prior.nextPage >= 2 && prior.nextPage <= totalPages + 1 &&
            prior.history.length === Math.min(totalCount, (prior.nextPage - 1) * 100) &&
            prior.history[0]?.id === first.items[0]?.id;
        const seen = new Set();
        if (canResume) {
            append(prior.history, seen);
            nextPage = prior.nextPage;
        } else {
            append(first.items, seen);
            nextPage = 2;
        }
        const save = async (complete) => checkpoint({ history, nextPage, pages:totalPages, count:totalCount, firstId, complete });
        if (!canResume) await save(false);
        for (let page = nextPage; page <= totalPages; page++) {
            nextPage = page;
            const response = await fetchPage(page);
            const current = validate(response, page);
            if (current.pages !== totalPages || current.count !== totalCount) throw new Error(`История изменилась во время обхода: страница ${page}`);
            append(response.items, seen);
            nextPage = page + 1;
            if (page % HISTORY_CHECKPOINT_PAGES === 0) await save(false);
        }
        if (history.length !== totalCount) throw new Error(`История неполная: ${history.length}/${totalCount}`);
        await save(true);
        return { history, pages:totalPages, count:totalCount, resumed: Boolean(canResume) };
    }
    // Read only the recent prefix required by the selected orders. A cached
    // historical suffix is re-used only when its covered time interval includes
    // the requested boundary and its first event is found in a fresh page.
    async function collectProductHistorySince(fetchPage, cutoff, prior = null, checkpoint = async () => {}) {
        const threshold = Date.parse(cutoff);
        if (!Number.isFinite(threshold)) throw new Error('Некорректная нижняя граница истории');
        const history = [], seen = new Set();
        let pages = null, count = null, firstId = '', previousLast = Infinity, requests = 0;
        let usedCache = false, stoppedByDate = false;
        const validPrior = prior && Array.isArray(prior.history) && prior.history.length &&
            prior.complete === true && Number.isFinite(Date.parse(prior.coverageFrom)) &&
            Date.parse(prior.coverageFrom) <= threshold &&
            prior.history.every((event, i) => String(event?.id ?? '') && Number.isFinite(Date.parse(event.created_at)) &&
                (!i || Date.parse(event.created_at) <= Date.parse(prior.history[i-1].created_at))) &&
            new Set(prior.history.map(event => String(event.id))).size === prior.history.length;
        const append = event => {
            const id = String(event?.id ?? '');
            if (!id || seen.has(id)) throw new Error(`Повтор или отсутствие ID складской операции: ${id}`);
            seen.add(id); history.push(event);
        };
        // Old partial checkpoints are useful only if page offsets are unchanged.
        // Checkpoint every ten pages; on restart page 1 and metadata are verified.
        let nextPage = 1;
        let canResume = false;
        for (let page = 1; ; page++) {
            const response = await fetchPage(page); requests++;
            const p = Number(response?.pages), n = Number(response?.count);
            if (!Array.isArray(response?.items) || !Number.isSafeInteger(p) || p < 1 || p > MAX_HISTORY_PAGES ||
                !Number.isSafeInteger(n) || n < 0 || Number(response?.page) !== page || response.items.length > 100 ||
                p !== Math.max(1, Math.ceil(n / 100)) || (n && !response.items.length))
                throw new Error(`Некорректная пагинация истории: страница ${page}`);
            if (pages === null) { pages = p; count = n; firstId = String(response.items[0]?.id ?? ''); }
            if (p !== pages || n !== count) throw new Error(`История изменилась во время обхода: страница ${page}`);
            const pageDates = response.items.map(item => Date.parse(item?.created_at));
            if (pageDates.some(t => !Number.isFinite(t)) || pageDates.some((t,i) => i && t > pageDates[i-1]) ||
                (pageDates.length && pageDates[0] > previousLast))
                throw new Error('history-date-not-sorted');
            if (pageDates.length) previousLast = pageDates.at(-1);
            if (page === 1 && prior &&
                ((prior.complete === false && prior.cutoff === cutoff) ||
                 (prior.complete === true && Number.isFinite(Date.parse(prior.coverageFrom)) &&
                  Date.parse(prior.coverageFrom) > threshold)) &&
                prior.firstId === firstId && prior.pages === pages && prior.count === count &&
                Number.isInteger(prior.nextPage) && prior.nextPage >= 2 && prior.nextPage <= pages + 1 &&
                prior.history?.length === Math.min(count, (prior.nextPage-1)*100) &&
                String(prior.history[0]?.id) === firstId) {
                // Replay the saved prefix instead of requesting the same pages.
                const savedDates = prior.history.map(item => Date.parse(item?.created_at));
                if (savedDates.every(Number.isFinite) && savedDates.every((t,i) => !i || t <= savedDates[i-1])) {
                    for (const item of prior.history) append(item);
                    previousLast = savedDates.at(-1);
                    nextPage = prior.nextPage;
                    canResume = true;
                    // The cached prefix can already be the entire server history.
                    // In that case nextPage = pages + 1 is a sentinel, not a
                    // valid page to fetch (for a one-page history it is page 2).
                    if (nextPage === pages + 1) {
                        if (history.length !== count) throw new Error(`История неполная: ${history.length}/${count}`);
                        usedCache = true;
                        stoppedByDate = true;
                        break;
                    }
                    page = nextPage - 1;
                    continue;
                }
            }
            nextPage = page + 1;
            // Refresh the live prefix even when the cached interval covers this
            // date. Only join at two consecutive matching IDs: a single ID at
            // a page edge is not enough evidence that the suffix is contiguous.
            for (const item of response.items) append(item);
            if (validPrior) {
                const anchor = String(prior.history[0].id);
                const start = history.findIndex(item => String(item.id) === anchor);
                if (start >= 0) {
                    const overlapLength = Math.min(2, prior.history.length);
                    const overlapVerified = history.length >= start + overlapLength &&
                        prior.history.slice(0, overlapLength).every((item, i) =>
                            String(history[start + i].id) === String(item.id));
                    if (overlapVerified) {
                        // Entries obtained from the server override cached entries.
                        // Validate the merged chronology before trusting the suffix.
                        const lastFreshId = String(history.at(-1).id);
                        const lastCachedIndex = prior.history.findIndex(item => String(item.id) === lastFreshId);
                        if (lastCachedIndex >= overlapLength - 1) {
                            const suffix = prior.history.slice(lastCachedIndex + 1);
                            if (suffix.every(item => !seen.has(String(item.id))) &&
                                (!suffix.length || Date.parse(suffix[0].created_at) <= Date.parse(history.at(-1).created_at))) {
                                for (const item of suffix) append(item);
                                usedCache = true;
                                stoppedByDate = true;
                                break;
                            }
                        }
                    }
                }
            }
            if (pageDates.length && pageDates.at(-1) < threshold) {
                // Check the next page as an inexpensive boundary guard. We do
                // not persist it: it is older than the requested date window.
                if (page < pages) {
                    const after = await fetchPage(page+1); requests++;
                    if (Number(after?.page) !== page+1 || Number(after?.pages) !== pages || Number(after?.count) !== count ||
                        !Array.isArray(after.items) || !after.items.length ||
                        after.items.some((item,i) => !Number.isFinite(Date.parse(item?.created_at)) ||
                            (i && Date.parse(item.created_at) > Date.parse(after.items[i-1].created_at))) ||
                        Date.parse(after.items[0].created_at) > pageDates.at(-1))
                        throw new Error('history-date-not-sorted');
                }
                stoppedByDate = true; break;
            }
            if (page === pages) break;
            if (page % HISTORY_CHECKPOINT_PAGES === 0) {
                await checkpoint({ complete:false,cutoff,history,nextPage,pages,count,firstId });
            }
        }
        // A fresh page must cover the cutoff or the server history must end.
        if (!usedCache && !stoppedByDate && history.length !== count)
            throw new Error(`История неполная: ${history.length}/${count}`);
        // The cache is certified to cover the requested lower bound, not the
        // actual oldest event (which may be older by one page).
        await checkpoint({ complete:true, cutoff, coverageFrom:cutoff, history,nextPage,pages,count,firstId });
        return { history, pages, count, requests, resumed:canResume, usedCache, stoppedByDate };
    }
    function filterOrders(response, from, to) {
        if (!Array.isArray(response?.items)) throw new Error('Invalid orders list response');
        return response.items.filter(item => Number(item?.status?.id) === 6809
            && Number(item?.source?.id) === 197300
            && dateOnly(item?.created_at) >= from && dateOnly(item?.created_at) <= to
            && /^\d{4}-\d{6}$/.test(item?.number || ''));
    }
    function parseDetails(payload, expectedNumber) {
        const order = payload?.shop_order;
        if (!order || order.number !== expectedNumber || Number(order.status?.id) !== 6809
            || Number(order.source?.id) !== 197300 || !Array.isArray(order.items)) throw new Error('Order details mismatch');
        // Sale is verified against warehouse action.type=3 later. Line-item status is
        // not a reliable selector: closed Ozon orders may have non-"sold" line states.
        const lines = order.items.filter(item => item?.type === 'product'
            && /^\d+$/.test(String(item?.item_id ?? ''))).map(item => ({
                productId: String(item.item_id), quantity: Number(item.quantity) || 0,
                status: String(item.status ?? '')
            }));
        return {
            number: expectedNumber,
            id: String(order.id || ''),
            products: [...new Set(lines.map(item => item.productId))],
            lines
        };
    }
    function productItemUrl(itemId) {
        if (!/^\d+$/.test(String(itemId))) throw new Error('Invalid product item ID');
        return `${API}/_api/v1/warehouse/wh1/product-items/${encodeURIComponent(String(itemId))}`;
    }
    // A resolved item must be tied to the exact warehouse item and product.
    // Neither a matching barcode alone nor the sold state is proof of an order sale.
    function normalizeProductItem(payload, itemId, productId) {
        if (!payload || String(payload.id ?? '') !== String(itemId) ||
            String(payload.product_id ?? payload.productId ?? payload.product?.id ?? '') !== String(productId)) return null;
        const barcode = String(payload.barcode ?? '').trim();
        if (!/^\d+$/.test(barcode) || (payload.type !== 0 && payload.type !== 1)) return null;
        return { id: String(itemId), productId: String(productId), barcode, type: payload.type };
    }
    function saleBelongsToOrder(event, ordersByNumber, productId) {
        if (Number(event?.action?.type) !== 3 || String(event?.product?.id) !== String(productId)) return false;
        const number = String(event?.attributes?.shop_order?.number || '');
        const order = ordersByNumber[number];
        if (!order || !order.products.includes(String(productId))) return false;
        if (order.id && event?.attributes?.shop_order?.id != null &&
            String(event.attributes.shop_order.id) !== order.id) return false;
        return true;
    }
    function missingSaleItemIds(history, ordersByNumber, productId) {
        const ids = new Set();
        for (const event of history) {
            if (!saleBelongsToOrder(event, ordersByNumber, productId)) continue;
            const item = event?.productItem;
            if (!/^\d+$/.test(String(item?.id ?? ''))) continue;
            if (!/^\d+$/.test(String(item?.barcode ?? '').trim()) ||
                (item?.type !== 0 && item?.type !== 1 && item?.type !== '0' && item?.type !== '1'))
                ids.add(String(item.id));
        }
        return [...ids];
    }
    function matchSales(history, ordersByNumber, productId, resolvedItems = {}) {
        const accepted = [], unknownType = [], excludedMulti = [];
        const seen = new Set();
        for (const event of history) {
            if (!saleBelongsToOrder(event, ordersByNumber, productId)) continue;
            const number = String(event?.attributes?.shop_order?.number || '');
            const itemId = String(event?.productItem?.id ?? '');
            if (!/^\d+$/.test(itemId)) continue;
            const originalBarcode = String(event?.productItem?.barcode ?? '').trim();
            const extra = resolvedItems[itemId];
            // A contradictory API response cannot confirm the original sale.
            const mismatch = !!extra && (String(extra.id) !== itemId ||
                String(extra.productId) !== String(productId) ||
                (/^\d+$/.test(originalBarcode) && originalBarcode !== extra.barcode));
            const barcode = mismatch ? '' : (extra?.barcode ?? originalBarcode);
            const rawType = mismatch ? null : (extra?.type ?? event?.productItem?.type);
            const key = String(event.id || `${number}:${productId}:${barcode}:${event.created_at}`);
            if (seen.has(key)) continue;
            seen.add(key);
            const result = { number, productId: String(productId), barcode, productItemId: itemId,
                quantity: Number(event?.attributes?.affected_quantity) || null,
                saleEventId: key, soldAt: event.created_at || '' };
            if (!/^\d+$/.test(barcode)) { unknownType.push(result); continue; }
            if (rawType === undefined || rawType === null || rawType === '') unknownType.push(result);
            else if (rawType === 0 || rawType === '0') accepted.push(result);
            else if (rawType === 1 || rawType === '1') excludedMulti.push(result);
            else unknownType.push(result);
        }
        return { accepted, unknownType, excludedMulti };
    }
    const api = { listUrl, collectOrdersByCreationDate, detailsUrl, historyUrl, productItemUrl, normalizeProductItem, missingSaleItemIds, dateOnly, filterOrders, parseDetails, matchSales, collectProductHistory, collectProductHistorySince, MAX_HISTORY_PAGES, HISTORY_CHECKPOINT_PAGES };
    root.TWSoldBarcodeScan = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
