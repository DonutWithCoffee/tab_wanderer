'use strict';
const model = globalThis.TWSoldBarcodeScan;
const selectionModel=TWSoldBarcodeSelection;
const reviewModel = globalThis.TWSoldBarcodeReview;
const cleanupPreviewModel=globalThis.TWSoldOzonCleanupPreview;
const cleanupExecutionModel=globalThis.TWSoldOzonCleanupExecution;
let cleanupDeleteActive=false,cleanupDeleteOperation='',cleanupSelected=new Set(),cleanupExpected=null;
const exclusionModel = globalThis.TWSoldOzonExclusion;
const orderRecoveryModel = globalThis.TWSoldOrderRecovery;
const REVIEW_DB = 'tw-sold-barcode-review-v1';
let reviewDbPromise, completedSnapshot = null, excludedKeys = new Set();
let ozonCheck = null, ozonCheckOperation = '', ozonCheckActive = false;
let showRemoved=false, clearListActive=false;
const $ = id => document.getElementById(id);
const DB_NAME = 'tw-sold-barcode-scan-v3';
const MAX_LIST_PAGES = 5000, MAX_ORDERS = 30000, MAX_PRODUCTS = 10000;
const NETWORK_DELAY_MS = 220, MAX_RETRIES = 3, REQUEST_TIMEOUT_MS = 20000;
let active = false, stopRequested = false, runId = 0, controllers = new Set(), dbPromise;
let logItems = [], output = [], uncertain = [], excludedMulti = [], failures = [];
let stats = { pages: 0, candidates: 0, details: 0, emptyDetails: 0, products: 0, histories: 0, confirmed: 0, unknownType: 0, excludedMulti: 0, failed: 0 };
function state(message) { $('state').textContent = message; }
function log(level, event, data = {}) {
    const entry = { at: new Date().toISOString(), level, event, ...data };
    logItems.push(entry); if (logItems.length > 3000) logItems.shift();
    try { localStorage.setItem('tw-sold-last-diagnostics', JSON.stringify(logItems.slice(-350))); } catch { /* logging must not block scanning */ }
    const node = $('log'); node.textContent += `${entry.at} [${level}] ${event} ${JSON.stringify(data)}\n`;
    if (node.textContent.length > 120000) node.textContent = node.textContent.slice(-90000);
    node.scrollTop = node.scrollHeight;
}
function renderIssues() {
    const target=$('scan-issues');
    target.replaceChildren();
    const issues=[...failures.map(row=>({stage:row.stage || 'scan',id:row.item,message:row.message})),
        ...uncertain.map(row=>({stage:'barcode-type',id:String(row.productId || row.number || '?'),message:'Не подтверждён тип или штрихкод'})),
        ...(ozonCheck?.skipped || []).filter(row=>!row.confirmedAbsent && !row.manuallyExcluded)
            .map(row=>({stage:'ozon',id:String(row.productId),message:row.reason}))];
    const groups=new Map();
    for(const issue of issues) {
        const list=groups.get(issue.stage) || [];
        list.push(issue); groups.set(issue.stage,list);
    }
    $('issue-count').textContent=issues.length
        ? `Найдено проблем: ${issues.length}.`
        : 'Проблем нет.';
    for(const [stage,rows] of groups) {
        const detail=document.createElement('details');detail.className='product-group';
        const heading=document.createElement('summary');heading.textContent=`${stage}: ${rows.length}`;
        detail.append(heading);
        const table=document.createElement('table');
        for(const row of rows) {
            const tr=document.createElement('tr');
            for(const value of [row.id,row.message]) {const td=document.createElement('td');td.textContent=value;tr.append(td);}
            table.append(tr);
        }
        detail.append(table);target.append(detail);
    }
}
function updateStats() {
    $('stats').textContent = `Заказов: ${stats.details} · Товаров: ${stats.products} · Проданных ШК: ${stats.confirmed}`;
    renderIssues();
}
function ensureRunning(token) { if (!active || stopRequested || runId !== token) throw new Error('Остановлено пользователем'); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function openDB() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => { const db = req.result; for (const name of ['orders', 'histories', 'productItems']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name); };
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    return dbPromise;
}
async function cachedGet(store, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly'); const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
}
async function cachedPut(store, key, data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(data, key);
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
}
let lastFetchStart = 0;
let detailRecovery = null;
async function apiGet(url, token) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        ensureRunning(token);
        const gap = Math.max(0, NETWORK_DELAY_MS - (Date.now() - lastFetchStart));
        if (gap) await wait(gap);
        ensureRunning(token); lastFetchStart = Date.now();
        const controller = new AbortController(); controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(url, { credentials:'include', signal:controller.signal, cache:'no-store' });
            if (!response.ok) {
                const err = new Error(`HTTP ${response.status}`); err.status = response.status; throw err;
            }
            const data = await response.json();
            if (typeof data !== 'object' || !data) throw new Error('Ответ не JSON-объект');
            return data;
        } catch (error) {
            if (stopRequested) throw error;
            if (detailRecovery && url.includes('/admin/api/shop-orders/')) {
                const previous = detailRecovery.concurrency;
                if (detailRecovery.onFailure(error.status)) log('warn', 'details-concurrency-reduced', {
                    status:error.status, from:previous, to:detailRecovery.concurrency
                });
            }
            log('warn', 'request-failed', { path: new URL(url).pathname, status:error.status || null, attempt, message:String(error.message || error).slice(0,160) });
            if ([401,403,404].includes(error.status) || attempt === MAX_RETRIES) throw error;
            await wait((error.status === 429 || error.status === 503 ? 2500 : 700) * attempt);
        } finally { clearTimeout(timeout); controllers.delete(controller); }
    }
    throw new Error('Retry limit reached');
}
async function parallel(items, concurrency, work, token, options = {}) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async (_, workerIndex) => {
        while (cursor < items.length) {
            ensureRunning(token);
            if (options.getConcurrency && workerIndex >= options.getConcurrency()) {
                await wait(200);
                continue;
            }
            const index = cursor++;
            try { await work(items[index], index); }
            catch (error) {
                if (stopRequested) throw error;
                const issue = { stage:options.stage || 'scan', item:String(items[index]), message:String(error.message || error).slice(0,200) };
                if (options.deferred) {
                    options.deferred.push({item:items[index], error});
                    log('warn', 'item-deferred', issue);
                } else {
                    failures.push(issue); stats.failed++;
                    log('error', 'item-failed', issue); updateStats();
                }
            }
        }
    });
    await Promise.all(runners);
}
function openReviewDB() {
    if (!reviewDbPromise) reviewDbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(REVIEW_DB, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains('data')) req.result.createObjectStore('data');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return reviewDbPromise;
}
async function reviewRead(key) {
    const db = await openReviewDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction('data','readonly').objectStore('data').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function reviewWrite(key, value) {
    const db = await openReviewDB();
    return new Promise((resolve,reject) => {
        const tx = db.transaction('data','readwrite');
        tx.objectStore('data').put(value,key);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
}
function partitionReview() {
    return selectionModel.partitionInspection(reviewModel.selectionGroups(output,excludedKeys),
        ozonCheck,completedSnapshot?.savedAt);
}
function visibleGroups() {return partitionReview().working;}
function renderRemoved() {
    const part=partitionReview();
    const btn=$('show-removed');
    btn.hidden=!part.ready;
    btn.textContent=`${showRemoved?'Свернуть':'Показать'} исключённые позиции (${part.removed.reduce((n,r)=>n+r.group.barcodes.length,0)} ШК)`;
    const target=$('removed-results');target.replaceChildren();
    target.hidden=!part.ready||!showRemoved;
    if(target.hidden)return;
    if(!part.removed.length){target.textContent='Исключённых ШК нет.';return;}
    for(const item of part.removed){
        const d=document.createElement('details');d.className='product-group';
        const summary=document.createElement('summary');
        summary.textContent=`Товар ${item.group.productId} · ${item.group.barcodes.length} ШК · ${item.reason}`;
        d.append(summary);
        const table=document.createElement('table');
        const header=document.createElement('tr');
        for(const label of ['ШК','Заказы','Продаж']) {const th=document.createElement('th');th.textContent=label;header.append(th);}
        table.append(header);
        for(const unit of item.group.barcodes){
            const tr=document.createElement('tr');
            for(const value of [unit.barcode,unit.orders.join(', ')||'—',unit.sales]){
                const td=document.createElement('td');td.textContent=String(value);tr.append(td);
            }
            table.append(tr);
        }
        d.append(table);target.append(d);
    }
}
$('show-removed').addEventListener('click',()=>{showRemoved=!showRemoved;renderRemoved();});
function verifiedOzonBarcodeStatus(productId,barcode) {
    if(!partitionReview().ready)return 'Не проверен';
    return (ozonCheck.results?.[productId]||[]).includes(barcode)?'Найден':'Не найден';
}
function updateReviewPeriod() {
    const el=$('review-period');
    const from=completedSnapshot?.from, to=completedSnapshot?.to;
    if(!from||!to||!output.length){el.textContent='';el.hidden=true;return;}
    const dateLabel=value=>value.split('-').reverse().join('.');
    el.textContent=`Период заказов: ${dateLabel(from)} — ${dateLabel(to)}`;
    el.hidden=false;
}
function updateReviewStatus() {
    updateReviewPeriod();
    const part=partitionReview(),grouped=part.working;
    const selected=part.ready ? [...cleanupSelected].filter(key=>grouped.some(g=>g.barcodes.some(u=>u.key===key))).length
        : grouped.reduce((n,p)=>n+p.selected,0);
    $('review-count').textContent=part.ready
        ? `Подтверждено: ${grouped.length} артикулов, ${grouped.reduce((n,g)=>n+g.count,0)} ШК · выбрано: ${selected}`
        : `Выбрано: ${grouped.filter(p=>p.selected>0).length} из ${grouped.length} артикулов · ${selected} из ${grouped.reduce((n,p)=>n+p.count,0)} ШК`;
    const all=$('review-select-all');
    const state=part.ready
        ? selectionModel.selectionState(grouped.map(g=>({...g,barcodes:g.barcodes.map(u=>({...u,selected:cleanupSelected.has(u.key)}))})))
        : selectionModel.selectionState(grouped);
    all.checked=state.checked;all.indeterminate=state.indeterminate;
    all.disabled=ozonCheckActive||cleanupDeleteActive||!state.total;
    $('review-select-all-label').textContent=part.ready?'Выбрать все для удаления':'Выбрать все для сверки';
    $('review-stage').textContent=!completedSnapshot?'Сначала найдите проданные ШК.'
        : part.ready?'Сверка готова. Выберите ШК для удаления.'
        : ozonCheckActive?'Идёт сверка с Ozon…'
        :'Выберите ШК и нажмите «Сверить с Ozon».';
}
let persistSelection = Promise.resolve();
function saveSelection() {
    const snapshot = [...excludedKeys];
    persistSelection=persistSelection.catch(()=>{}).then(()=>reviewWrite('excluded',snapshot));
    persistSelection.catch(error => { $('errors').textContent=`Не удалось сохранить выбор ШК: ${error.message}`; });
}
// Checkbox clicks must not rebuild hundreds of product tables. Update only the
// existing controls; rebuilding also discards the user's open rows and focus.
function refreshCheckboxes(groupIds=null) {
    const inspected=partitionReview().ready;
    const ids=groupIds ? new Set(groupIds.map(String)) : null;
    for(const details of $('results').querySelectorAll('details.product-group')) {
        if(ids && !ids.has(details.dataset.productId)) continue;
        const units=[...details.querySelectorAll('input[data-barcode-key]')];
        const selected=units.reduce((sum,input)=>sum+(input.checked?1:0),0);
        const checked=units.length>0 && selected===units.length;
        const partial=selected>0 && selected<units.length;
        for(const input of details.querySelectorAll('input[data-group-select]')) {
            input.checked=checked;
            input.indeterminate=partial;
        }
        const heading=details.querySelector('[data-group-heading]');
        if(heading)heading.textContent=`Артикул ${details.dataset.productId} · ${units.length} ШК · выбрано: ${selected}`;
    }
    const allUnits=[...$('results').querySelectorAll('input[data-barcode-key]')];
    const selected=allUnits.reduce((sum,input)=>sum+(input.checked?1:0),0);
    const all=$('review-select-all');
    all.checked=allUnits.length>0 && selected===allUnits.length;
    all.indeterminate=selected>0 && selected<allUnits.length;
    all.disabled=ozonCheckActive||cleanupDeleteActive||!allUnits.length;
    if(inspected){
        $('review-count').textContent=`Подтверждено: ${$('results').querySelectorAll('details.product-group').length} артикулов, ${allUnits.length} ШК · выбрано: ${selected}`;
        renderCleanupPreview();
    }else{
        const articleCount=[...$('results').querySelectorAll('details.product-group')].filter(d=>
            [...d.querySelectorAll('input[data-barcode-key]')].some(input=>input.checked)).length;
        $('review-count').textContent=`Выбрано: ${articleCount} из ${$('results').querySelectorAll('details.product-group').length} артикулов · ${selected} из ${allUnits.length} ШК`;
    }
}
function changeSelection(groups,checked) {
    if(partitionReview().ready) {
        for(const group of groups)for(const unit of group.barcodes){
            if(checked)cleanupSelected.add(unit.key);else cleanupSelected.delete(unit.key);
        }
    }else{
        if (!selectionModel.applySelection(excludedKeys,groups,checked)) return;
        saveSelection();invalidateInspection();
    }
    const keys=new Set(groups.flatMap(group=>group.barcodes.map(unit=>unit.key)));
    for(const input of $('results').querySelectorAll('input[data-barcode-key]')) {
        if(keys.has(input.dataset.barcodeKey))input.checked=checked;
    }
    refreshCheckboxes(groups.map(group=>group.productId));
}
$('review-select-all').addEventListener('change',event=>{
    changeSelection(visibleGroups(),event.target.checked);
});
function render() {
    const container=$('results');
    const previouslyOpen=new Set([...container.querySelectorAll('details.product-group[open]')].map(node=>node.dataset.productId));
    container.replaceChildren();
    const groups=visibleGroups();
    const inspected=partitionReview().ready;
    updateReviewStatus();
    renderRemoved();
    renderIssues();
    if (!groups.length) { container.textContent=inspected?'Совпадающих ШК нет.':'ШК пока не найдены.'; renderCleanupPreview(); return; }
    for (const group of groups) {
        const details=document.createElement('details'); details.className='product-group';
        details.dataset.productId=group.productId;
        details.open=previouslyOpen.has(group.productId);
        const summary=document.createElement('summary');
        const checkbox=document.createElement('input');checkbox.type='checkbox';
        checkbox.checked=inspected?group.barcodes.every(u=>cleanupSelected.has(u.key)):group.selected===group.count;
        checkbox.indeterminate=inspected?(group.barcodes.some(u=>cleanupSelected.has(u.key))&&!group.barcodes.every(u=>cleanupSelected.has(u.key))):(group.selected>0 && group.selected<group.count);
        checkbox.title='Выбрать / исключить все ШК товара';
        checkbox.dataset.groupSelect='1';
        checkbox.setAttribute('aria-label',`Выбрать артикул ${group.productId}`);
        checkbox.disabled=ozonCheckActive||cleanupDeleteActive;
        checkbox.addEventListener('click',event=>event.stopPropagation());
        checkbox.addEventListener('change',()=>changeSelection([group],checkbox.checked));
        const heading=document.createElement('span');
        heading.dataset.groupHeading='1';
        heading.textContent=`Артикул ${group.productId} · ${group.count} ШК · выбрано: ${inspected?group.barcodes.filter(u=>cleanupSelected.has(u.key)).length:group.selected}`;
        summary.append(checkbox,heading);details.append(summary);

        const table=document.createElement('table');
        const head=document.createElement('tr');
        for(const title of ['','Штрихкод','Ozon','Заказы','Продаж']) {
            const th=document.createElement('th');th.textContent=title;head.append(th);
        }
        table.append(head);
        for(const unit of group.barcodes) {
            const row=document.createElement('tr');
            const cell=document.createElement('td');
            const input=document.createElement('input');input.type='checkbox';input.dataset.barcodeKey=unit.key;input.checked=inspected?cleanupSelected.has(unit.key):unit.selected;
            input.setAttribute('aria-label',`Выбрать ШК ${unit.barcode}`);
            input.disabled=ozonCheckActive||cleanupDeleteActive;
            input.addEventListener('change',()=>{
                if(inspected){if(input.checked)cleanupSelected.add(unit.key);else cleanupSelected.delete(unit.key);}
                else{if(input.checked)excludedKeys.delete(unit.key);else excludedKeys.add(unit.key);
                    saveSelection();invalidateInspection();}
                refreshCheckboxes([group.productId]);
            });
            cell.append(input);row.append(cell);
            for(const value of [unit.barcode,verifiedOzonBarcodeStatus(group.productId,unit.barcode),unit.orders.join(', ')||'—',unit.sales]) {
                const td=document.createElement('td');td.textContent=String(value);row.append(td);
            }
            table.append(row);
        }
        details.append(table);container.append(details);
    }
    renderCleanupPreview();
}
function currentInspectionRows() {
    return reviewModel.groupSales(output,excludedKeys).map(p=>({
        productId:p.productId, barcodes:p.barcodes.filter(b=>b.selected).map(b=>b.barcode)
    })).filter(p=>p.barcodes.length);
}
function renderOzonExclusions() {
    const el=$('ozon-check-exclusions'); el.replaceChildren();
    if (!ozonCheck?.skipped?.length || ozonCheck.complete) return;
    const title=document.createElement('p');
    title.textContent=`Исключено по подтверждённо пустому поиску: ${ozonCheck.skipped.filter(row=>row.confirmedAbsent).length}; не проверено: ${ozonCheck.skipped.filter(row=>!row.confirmedAbsent).length}.`;
    el.append(title);
    for (const row of ozonCheck.skipped) {
        const line=document.createElement('div');line.className='product-group';
        const description=document.createElement('span');
        description.textContent=`Товар ${row.productId}: ${row.reason}. `;line.append(description);
        if (row.confirmedAbsent) {
            const note=document.createElement('strong');note.textContent='Исключён автоматически: поиск в Ozon вернул 0 товаров без ошибок.';line.append(note);
        } else if (row.manuallyExcluded) {
            const note=document.createElement('strong');note.textContent='Исключён вручную из текущей сверки (не подтверждено удаление карточки).';line.append(note);
        } else if (exclusionModel.canManuallyExclude(row) && !ozonCheckActive && !ozonCheck.complete) {
            const button=document.createElement('button');button.type='button';button.textContent='Исключить вручную';
            button.addEventListener('click',()=>void manuallyExcludeOzonProduct(row.productId));line.append(button);
        } else {
            const note=document.createElement('span');note.textContent='Требуется повторная проверка; автоматическое исключение запрещено.';line.append(note);
        }
        el.append(line);
    }
}
async function manuallyExcludeOzonProduct(productId) {
    if (ozonCheckActive || !ozonCheck || ozonCheck.complete) return;
    const row=ozonCheck.skipped?.find(item=>item.productId===productId);
    if (!exclusionModel.canManuallyExclude(row) || row.manuallyExcluded) return;
    const accepted=window.confirm(`Товар ${productId} не найден при загрузке страницы Ozon. Это НЕ доказательство удаления карточки. Исключить все его ШК только из текущей сверки? Другие товары останутся без изменений.`);
    if (!accepted) return;
    row.manuallyExcluded=true; row.exclusionReason='user-confirmed-unresolved-product';
    const ready=exclusionModel.isFullyResolved(ozonCheck);
    if (ready) {ozonCheck.complete=true;ozonCheck.savedAt=new Date().toISOString();}
    await reviewWrite('ozonCheck',ozonCheck);

    log('warn','ozon-inspection-manual-exclusion',{productId,reason:row.reason,ready});
    if (ready) state('Сверка завершена с ручными исключениями. Исключённые ШК не входят в результаты.');
    render();showInspection();checkStatus();
}
function showInspection() {renderOzonExclusions();}
function currentCleanupPreview() {
    return cleanupPreviewModel.createPreview({sales:output,excludedKeys,inspection:ozonCheck,
        snapshotId:completedSnapshot?.savedAt,currentProducts:currentInspectionRows()});
}
function renderCleanupPreview() {
    const result=(!active&&!ozonCheckActive&&!cleanupDeleteActive)?currentCleanupPreview():{ok:false};
    if(!result.ok)cleanupSelected.clear();
    else {
        const allowed=new Set(result.preview.rows.map(row=>`${row.productId}:${row.barcode}`));
        for(const key of cleanupSelected)if(!allowed.has(key))cleanupSelected.delete(key);
    }
    $('cleanup-delete').disabled=!result.ok||cleanupSelected.size===0;
    if(!cleanupDeleteActive&&!cleanupSelected.size && !/Подтверждено удаление|Очистка остановлена/.test($('cleanup-delete-status').textContent))
        $('cleanup-delete-status').textContent='Выберите ШК для удаления.';
    else if(!cleanupDeleteActive) $('cleanup-delete-status').textContent=`Выбрано для удаления: ${cleanupSelected.size} ШК.`;
}
$('cleanup-delete').addEventListener('click',async()=>{
    if(cleanupDeleteActive||active||ozonCheckActive)return;
    const result=currentCleanupPreview();
    if(!result.ok)return;
    const batch=cleanupExecutionModel.createBatch(result.preview,[...cleanupSelected],currentCleanupPreview().preview);
    if(!batch.ok){$('cleanup-delete-status').textContent='Результаты изменились — нужна новая сверка.';return;}
    const again=currentCleanupPreview();
    if(!again.ok||!cleanupExecutionModel.createBatch(result.preview,[...cleanupSelected],again.preview).ok)return;
    await persistSelection;
    const verifiedAfterSave=currentCleanupPreview();
    if(!verifiedAfterSave.ok||!cleanupExecutionModel.createBatch(result.preview,[...cleanupSelected],verifiedAfterSave.preview).ok)return;
    cleanupDeleteActive=true;cleanupExpected={products:batch.products,done:0,barcodes:batch.barcodes,removed:0};
    cleanupSelected.clear();checkStatus();render();
    $('cleanup-delete-status').textContent=`Удаление запущено: ${batch.barcodes} ШК; не закрывайте вкладку.`;
    log('warn','ozon-cleanup-delete-start',{products:batch.products.length,barcodes:batch.barcodes});
    try {
        const response=await chrome.runtime.sendMessage({type:'SOLD_OZON_DELETE_START',products:batch.products,
            snapshotId:result.preview.snapshotId,inspectionSavedAt:result.preview.inspectionSavedAt});
        if(response?.ok!==true||!response.started)throw new Error(response?.error||'Не удалось начать удаление');
        cleanupDeleteOperation=response.operationId;
    }catch(error){cleanupDeleteActive=false;cleanupExpected=null;cleanupDeleteOperation='';
        $('cleanup-delete-status').textContent=`Операция не запущена: ${error.message}`;
        log('error','ozon-cleanup-delete-start-failed',{message:String(error.message||error)});checkStatus();render();}
});
async function soldDeleteProgress(msg){
    if(!cleanupDeleteActive||!cleanupExpected)return;
    // The first progress may arrive before the start reply; accept the operation id once.
    if(cleanupDeleteOperation&&cleanupDeleteOperation!==msg.operationId)return;
    if(!cleanupDeleteOperation)cleanupDeleteOperation=msg.operationId;
    if(msg.event==='product'){
        const expected=cleanupExpected.products[cleanupExpected.done];
        if(!expected||expected.productId!==msg.productId||msg.removedCount!==expected.barcodes.length)return;
        cleanupExpected.done++;cleanupExpected.removed+=msg.removedCount;
        log('info','ozon-cleanup-delete-product',{productId:msg.productId,removedCount:msg.removedCount});
        $('cleanup-delete-status').textContent=`Подтверждено удаление ${cleanupExpected.removed}/${cleanupExpected.barcodes} ШК.`;
    }else if(msg.event==='product-failed'){
        log('error','ozon-cleanup-delete-product-failed',{productId:msg.productId,error:msg.error,removedCount:msg.removedCount||0});
    }else if(msg.event==='failed'||msg.event==='complete'){
        const complete=msg.event==='complete'&&cleanupExpected.done===cleanupExpected.products.length;
        log(complete?'info':'error',complete?'ozon-cleanup-delete-complete':'ozon-cleanup-delete-incomplete',
            {removed:cleanupExpected.removed,expected:cleanupExpected.barcodes,error:msg.error||null});
        $('cleanup-delete-status').textContent=complete
            ? `Подтверждено удаление ${cleanupExpected.removed} ШК. Для повторного удаления требуется новая сверка.`
            : `Очистка остановлена. Подтверждено: ${cleanupExpected.removed} ШК; остальные требуют ручной проверки. ${msg.error||''}`;
        cleanupDeleteActive=false;cleanupDeleteOperation='';cleanupExpected=null;
        invalidateInspection();render();checkStatus();
    }
}
function checkStatus() {
    $('ozon-check').disabled=active || ozonCheckActive || cleanupDeleteActive || !completedSnapshot;
    $('ozon-check-stop').disabled=!ozonCheckActive;
    $('clear').disabled=active || cleanupDeleteActive || clearListActive;
    $('clear-list').disabled=active || ozonCheckActive || cleanupDeleteActive || clearListActive || !completedSnapshot;
    $('reset-log').disabled=active || cleanupDeleteActive;
    renderCleanupPreview();
    $('start').disabled=active || ozonCheckActive || cleanupDeleteActive || clearListActive;
    if (ozonCheck?.complete) $('ozon-check-status').textContent=`Сверено: ${ozonCheck.products.length} товаров · найдено ${partitionReview().working.reduce((n,p)=>n+p.barcodes.length,0)} ШК.`;
}
function invalidateInspection() {
    cleanupSelected.clear();
    ozonCheck=null;showRemoved=false;
    $('ozon-check-status').textContent='Список изменён. Сверьте с Ozon ещё раз.';
    showInspection();
    void reviewWrite('ozonCheck',null).catch(error=> { $('errors').textContent=String(error.message || error); });
    checkStatus();
}
async function startInspection() {
    if (active || ozonCheckActive || cleanupDeleteActive || !completedSnapshot) return;
    const products=currentInspectionRows();
    if (!products.length) {
        ozonCheck={complete:true,products:[],results:{},skipped:[],savedAt:new Date().toISOString(),snapshotId:completedSnapshot.savedAt};
        await reviewWrite('ozonCheck',ozonCheck);
        $('ozon-check-status').textContent='Нет выбранных ШК для сверки.';
        render();showInspection();checkStatus();return;
    }
    ozonCheckActive=true; ozonCheck={complete:false,products,results:{},skipped:[],savedAt:null,snapshotId:completedSnapshot.savedAt};
    checkStatus();render();showInspection();$('ozon-check-status').textContent=`Запуск сверки: ${products.length} товаров`;
    try {
        const response=await chrome.runtime.sendMessage({type:'SOLD_OZON_INSPECT_START',products});
        if (response?.ok!==true || !response.started) throw new Error(response?.error||'Сверка не запущена');
        ozonCheckOperation=response.operationId;
        log('info','ozon-inspection-start',{products:products.length});
    } catch(error) {
        ozonCheckActive=false;ozonCheckOperation='';checkStatus();render();
        $('ozon-check-status').textContent=`Не удалось начать сверку: ${error.message}`;
        state('Поиск завершён, но сверка с Ozon не выполнена. Используйте повторную сверку.');
        log('error','ozon-inspection-start-failed',{message:String(error.message || error)});
    }
}
async function inspectProgress(msg) {
    if (!ozonCheckActive || !ozonCheckOperation || msg.operationId!==ozonCheckOperation) return;
    if (msg.event==='product') {
        const expected=ozonCheck.products[msg.done];
        if (!expected || expected.productId!==msg.productId || !Array.isArray(msg.present)
            || msg.present.some(code=>!expected.barcodes.includes(code))) return;
        ozonCheck.results[msg.productId]=[...new Set(msg.present)];
        await reviewWrite('ozonCheck',ozonCheck);
        $('ozon-check-status').textContent=`Сверено ${msg.done+1} из ${msg.total} товаров`;
    } else if (msg.event==='absent') {
        if (!ozonCheck.skipped) ozonCheck.skipped=[];
        ozonCheck.skipped.push({productId:msg.productId,reason:'catalogue-search-confirmed-empty',confirmedAbsent:true});
        await reviewWrite('ozonCheck',ozonCheck);
        log('warn','ozon-inspection-catalogue-absent',{productId:msg.productId});
        $('ozon-check-status').textContent=`Сверено ${msg.done+1}/${msg.total}; отсутствует в каталоге: ${ozonCheck.skipped.filter(row=>row.confirmedAbsent).length}`;
    } else if (msg.event==='retry' || msg.event==='retry-failed') {
        log(msg.event==='retry-failed' ? 'warn' : 'info',
            msg.event==='retry-failed' ? 'ozon-inspection-catalogue-retry-failed' : 'ozon-inspection-catalogue-retry',
            {productId:msg.productId,attempt:msg.attempt,strategy:msg.strategy,reason:msg.reason});
        $('ozon-check-status').textContent=msg.event==='retry'
            ? `Повторный поиск Ozon: товар ${msg.productId}, попытка ${msg.attempt}/2`
            : `Не удалось повторить поиск Ozon: ${msg.productId}`;
    } else if (msg.event==='skipped') {
        if (!ozonCheck.skipped) ozonCheck.skipped=[];
        if (!ozonCheck.skipped.some(row=>row.productId===msg.productId)) ozonCheck.skipped.push({productId:msg.productId,reason:msg.reason || 'identity unverified'});
        await reviewWrite('ozonCheck',ozonCheck);
        $('ozon-check-status').textContent=`Сверено ${msg.done+1}/${msg.total}; не удалось проверить: ${ozonCheck.skipped.length}`;
        log('warn','ozon-inspection-product-skipped',{productId:msg.productId,reason:msg.reason || 'identity unverified',diagnostic:msg.diagnostic || null,catalogueRetryCount:msg.catalogueRetryCount || 0});
    } else if (msg.event==='complete') {
        if (!exclusionModel.hasSafePartialResults(ozonCheck)) {
            $('ozon-check-status').textContent='Неполная сверка. Требуется повторить.';
        } else {
            ozonCheck.complete=true;ozonCheck.savedAt=new Date().toISOString();
            await reviewWrite('ozonCheck',ozonCheck);showInspection();
            state('Сверка завершена. Остались совпадающие ШК.');
            log('info','ozon-inspection-complete',{products:ozonCheck.products.length,
                present:Object.values(ozonCheck.results).reduce((n,a)=>n+a.length,0)});
        }
        ozonCheckActive=false;ozonCheckOperation='';checkStatus();render();
    } else if (msg.event==='failed') {
        ozonCheckActive=false;ozonCheckOperation='';
        const skipped=Array.isArray(msg.skipped)?msg.skipped:ozonCheck?.skipped || [];
        if (ozonCheck) {
            ozonCheck.skipped=skipped;
            // A terminal worker error is NOT proof that remaining products were inspected.
            // Only explicitly checked or explicitly skipped products may enter a finished review.
            const accounted=exclusionModel.hasSafePartialResults(ozonCheck);
            ozonCheck.complete=accounted;
            if (accounted) ozonCheck.savedAt=new Date().toISOString();
            await reviewWrite('ozonCheck',ozonCheck);
        }
        $('ozon-check-status').textContent=ozonCheck?.complete
            ? `Сверка завершена с исключениями: ${skipped.length}. Проверенные ШК доступны отдельно.`
            : `Сверка прервана: ${msg.error || 'ошибка'}. Не все товары получили результат.`;
        state(ozonCheck?.complete?'Проверенные результаты сохранены. Ошибки вынесены отдельно.':'Сверка прервана. Непроверенные товары исключены из результатов.');
        log('warn','ozon-inspection-incomplete',{error:msg.error || 'unknown'});checkStatus();render();showInspection();
    }
}
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type==='SOLD_OZON_INSPECT_PROGRESS') void inspectProgress(msg);
    if (msg?.type==='SOLD_OZON_DELETE_PROGRESS') void soldDeleteProgress(msg);
});
$('ozon-check').addEventListener('click',()=>void startInspection());
$('ozon-check-stop').addEventListener('click',()=>{
    if (ozonCheckOperation) void chrome.runtime.sendMessage({type:'SOLD_OZON_INSPECT_STOP',operationId:ozonCheckOperation});
});

async function restoreReview() {
    try {
        const [stored, excluded, previousCheck] = await Promise.all([reviewRead('completed'),reviewRead('excluded'),reviewRead('ozonCheck')]);
        if (Array.isArray(excluded)) excludedKeys=new Set(excluded.filter(value=>typeof value==='string'));
        if (stored && stored.complete===true && Array.isArray(stored.confirmed)) {
            completedSnapshot=stored;
            if (!active) {
                output=stored.confirmed;
                $('from').value=stored.from.slice(0,7);
                $('to').value=stored.to.slice(0,7);
                failures=Array.isArray(stored.failures)?stored.failures:[];
                uncertain=Array.isArray(stored.unknownType)?stored.unknownType:[];
                stats.failed=failures.length;
                state(`Восстановлены подтверждённые результаты сканирования: ${output.length} записей; проблем: ${failures.length}.`);
            }
        }
        if (previousCheck && stored?.savedAt && previousCheck.snapshotId===stored.savedAt
            && JSON.stringify(previousCheck.products)===JSON.stringify(currentInspectionRows())) {
            ozonCheck=previousCheck;
            
        }
        render();showInspection();checkStatus();
    } catch(error) { $('errors').textContent=`Не удалось восстановить сохранённые результаты: ${error.message}`; }
}
function download(filename, object) {
    const blob = new Blob([JSON.stringify(object, null, 2)], {type:'application/json'});
    const href = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = href; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
}
async function run() {
    const fromMonth = $('from').value, toMonth = $('to').value;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(toMonth) || fromMonth > toMonth) {
        $('errors').textContent = 'Неверный интервал дат'; return;
    }
    const from = `${fromMonth}-01`;
    const [endYear, endMonth] = toMonth.split('-').map(Number);
    const to = new Date(Date.UTC(endYear, endMonth, 0)).toISOString().slice(0, 10);
    if (ozonCheckActive || cleanupDeleteActive) return;
    active = true; stopRequested = false; const token = ++runId;
    invalidateInspection();
    completedSnapshot = null;
    showRemoved=false;cleanupSelected.clear();
    $('start').disabled = true; $('stop').disabled = false; $('clear').disabled = true; $('reset-log').disabled = true;
    $('errors').textContent = ''; logItems=[]; $('log').textContent=''; output=[]; uncertain=[]; excludedMulti=[]; failures=[];
    stats={pages:0,candidates:0,details:0,emptyDetails:0,products:0,histories:0,confirmed:0,unknownType:0,excludedMulti:0,failed:0};
    render(); updateStats(); log('info','scan-start',{from,to,dateField:'created_at'});
    let complete = false;
    try {
        const listing = await model.collectOrdersByCreationDate(
            page => apiGet(model.listUrl(page), token), from, to,
            (event, data) => {
                ensureRunning(token);
                if (event === 'page') {
                    stats.pages = data.requests; updateStats();
                    state(`Список Ozon: запрошено страниц ${data.requests}, всего ${data.pages}`);
                } else if (event === 'progress') {
                    stats.candidates = data.candidates; updateStats();
                    state(`Список Ozon (${data.mode}): ${data.page}/${data.pages}, отобрано ${data.candidates}`);
                } else if (event === 'fallback') log('warn','list-full-fallback',data);
                else if (event === 'range') log('info','list-page-range',data);
                else if (event === 'unordered-full-page') log('warn','list-order-anomaly',data);
            }
        );
        const orders = new Map(listing.orders.map(order => [order.number, order]));
        stats.pages = listing.requests; stats.candidates = orders.size; updateStats();
        log('info','list-summary',{ mode:listing.mode, totalPages:listing.pages, pagesRequested:listing.requests,
            fromPage:listing.fromPage ?? null, toPage:listing.toPage ?? null, candidates:orders.size });
        if (orders.size > MAX_ORDERS) throw new Error(`Слишком много заказов: ${orders.size}`);
        const details = {};
        const numbers=[...orders.keys()];
        const loadDetails = async number => {
            ensureRunning(token);
            let record=await cachedGet('orders',number);
            if (!record || record.statusChangedAt!==orders.get(number).status_changed_at) {
                const data=await apiGet(model.detailsUrl(number),token);
                record={ ...model.parseDetails(data,number), statusChangedAt:orders.get(number).status_changed_at };
                await cachedPut('orders',number,record);
                log('debug','details-cached',{number,products:record.products.length});
            }
            details[number]=record; stats.details++; if (!record.products.length) { stats.emptyDetails++; if (stats.emptyDetails <= 10) log('warn','details-no-products',{number,lines:record.lines?.length ?? 0}); } updateStats();
            if (stats.details%30===0 || stats.details===numbers.length) {
                state(`Карточки JSON: ${stats.details}/${numbers.length}`);
                log('info','details-progress',{done:stats.details,total:numbers.length});
            }
        };
        // First pass is adaptive: 500/429/503 responses reduce active workers.
        detailRecovery = orderRecoveryModel.create(3);
        const pending = [];
        try {
            await parallel(numbers, 3, loadDetails, token, {
                deferred: pending, stage:'order-details', getConcurrency: () => detailRecovery.concurrency
            });
            // Terminal errors are deferred until the entire list has been processed.
            // Recheck only failed orders; successful records are already in IndexedDB.
            let unresolved = pending;
            for (let round = 0; round < 2 && unresolved.length; round++) {
                ensureRunning(token);
                const delay = detailRecovery.retryDelay(round);
                log('info','details-recovery-start', {round:round+1, pending:unresolved.length, delayMs:delay, concurrency:1});
                state(`Повторная проверка проблемных заказов: ${unresolved.length} (этап ${round+1}/2)`);
                await wait(delay);
                const next = [];
                for (const entry of unresolved) {
                    ensureRunning(token);
                    if (!detailRecovery.recoverable(entry.error)) { next.push(entry); continue; }
                    try {
                        await loadDetails(entry.item);
                        log('info','details-recovered', {number:entry.item, round:round+1});
                    } catch (error) {
                        if (stopRequested) throw error;
                        next.push({item:entry.item,error});
                        log('warn','details-recovery-failed', {number:entry.item, round:round+1,
                            message:String(error.message||error).slice(0,160)});
                    }
                }
                unresolved = next;
            }
            for (const entry of unresolved) {
                const issue={stage:'order-details',item:String(entry.item),message:String(entry.error?.message||entry.error).slice(0,200)};
                failures.push(issue); stats.failed++;
                log('error','item-failed',issue);
            }
            log('info','details-recovery-summary', {initialFailures:pending.length,
                recovered:pending.length-unresolved.length, unresolved:unresolved.length,
                serverErrors:detailRecovery.serverErrors});
            updateStats();
        } finally { detailRecovery = null; }
        if (failures.length) log('warn','details-partial',{failed:failures.length,processed:stats.details});
        const byProduct=new Map();
        const earliestByProduct=new Map();
        for (const record of Object.values(details)) {
            const createdAt=orders.get(record.number)?.created_at;
            if (!createdAt || !Number.isFinite(Date.parse(createdAt))) {
                const issue={stage:'order-date',item:record.number,message:'Неизвестна дата создания'};
                failures.push(issue);stats.failed++;log('error','item-failed',issue);
                continue; // No contribution from a record whose date is unverified.
            }
            for (const productId of record.products) {
                if (!byProduct.has(productId)) byProduct.set(productId,{});
                byProduct.get(productId)[record.number]=record;
                const earlier=earliestByProduct.get(productId);
                if (!earlier || Date.parse(createdAt)<Date.parse(earlier)) earliestByProduct.set(productId,createdAt);
            }
        }
        const productIds=[...byProduct.keys()]; stats.products=productIds.length; updateStats();
        log('info','details-summary',{total:stats.details,empty:stats.emptyDetails,withProducts:stats.details-stats.emptyDetails});
        if (stats.details && !productIds.length && !failures.length) throw new Error('Все карточки без товаров: проверь формат ответа API подробностей');
        if (productIds.length > MAX_PRODUCTS) throw new Error(`Лимит уникальных товаров: ${productIds.length}`);
        log('info','product-stage',{uniqueProducts:productIds.length});
        await parallel(productIds, 3, async productId => {
            ensureRunning(token);
            let record=await cachedGet('histories',productId);
            // One full-day safety margin for timezone differences and clock skew.
            const cutoff=new Date(Date.parse(earliestByProduct.get(productId))-24*60*60*1000).toISOString();
            // A completed cache is a snapshot, not proof that no new sales appeared.
            // Always probe the live first page, then merge the new prefix with the covered suffix.
            {
                const compact = event => ({
                    id:event.id, created_at:event.created_at, action:{type:event.action?.type},
                    attributes:{shop_order:event.attributes?.shop_order, affected_quantity:event.attributes?.affected_quantity},
                    product:{id:event.product?.id},
                    productItem:{id:event.productItem?.id,barcode:event.productItem?.barcode,type:event.productItem?.type}
                });
                const result = await model.collectProductHistorySince(
                    page => apiGet(model.historyUrl(productId,page), token), cutoff, record,
                    async progress => {
                        ensureRunning(token);
                        record = {savedAt:Date.now(), ...progress, history:progress.history.map(compact)};
                        await cachedPut('histories',productId,record);
                        if (!progress.complete) log('debug','history-checkpoint',{productId,page:progress.nextPage-1,pages:progress.pages,cutoff});
                    }
                );
                log('info','history-range',{productId,cutoff,events:result.history.length,
                    requests:result.requests,pages:result.pages,resumed:result.resumed,usedCache:result.usedCache,
                    stoppedByDate:result.stoppedByDate});
            }
            const itemIds = model.missingSaleItemIds(record.history, byProduct.get(productId), productId);
            const resolvedItems = {};
            for (const itemId of itemIds) {
                ensureRunning(token);
                let item = await cachedGet('productItems', itemId);
                if (item) {
                    item = model.normalizeProductItem(item, itemId, productId);
                    if (item) { resolvedItems[itemId] = item; continue; }
                }
                try {
                    const payload = await apiGet(model.productItemUrl(itemId), token);
                    item = model.normalizeProductItem(payload, itemId, productId);
                    if (!item) {
                        log('warn', 'product-item-invalid', { productId, itemId });
                        continue;
                    }
                    resolvedItems[itemId] = item;
                    await cachedPut('productItems', itemId, item);
                } catch (error) {
                    if (stopRequested) throw error;
                    log('warn', 'product-item-unavailable', { productId, itemId,
                        message: String(error.message || error).slice(0, 120) });
                }
            }
            if (itemIds.length) log('info', 'product-items-resolved', {productId, requested:itemIds.length,
                resolved:Object.keys(resolvedItems).length});
            const matched=model.matchSales(record.history,byProduct.get(productId),productId,resolvedItems);
            output.push(...matched.accepted); uncertain.push(...matched.unknownType); excludedMulti.push(...matched.excludedMulti);
            stats.histories++; stats.confirmed=output.length; stats.unknownType=uncertain.length; stats.excludedMulti=excludedMulti.length;
            updateStats();
            if (stats.histories%10===0 || stats.histories===productIds.length) {
                state(`История: ${stats.histories}/${productIds.length}; подтверждено ${output.length}; неизвестный тип ${uncertain.length}`);
                log('info','history-progress',{done:stats.histories,total:productIds.length,confirmed:output.length,unknownType:uncertain.length,multi:excludedMulti.length});
                render();
            }
        },token,{stage:'history'});
        if (failures.length) log('warn','scan-partial',{failed:failures.length,confirmed:output.length});
        updateStats();
        const savedAt=new Date().toISOString();
        await reviewWrite('completed',{complete:true,partial:failures.length>0,from,to,confirmed:output,failures:[...failures],unknownType:[...uncertain],savedAt});
        completedSnapshot={complete:true,partial:failures.length>0,from,to,savedAt};
        complete=true;
        log('info','scan-complete',{...stats});
        state(`Обход завершён${failures.length?' с ошибками':''}. Подтверждено единичных ШК: ${output.length}; исключено мульти: ${excludedMulti.length}; проблем: ${failures.length+uncertain.length}.`);
        if (failures.length || uncertain.length) $('errors').textContent = `Частичный результат: ${failures.length} ошибок обработки, ${uncertain.length} неподтверждённых ШК. Они исключены из списка; детали ниже.`;
    } catch (error) {
        const interrupted=stopRequested;
        log(interrupted?'info':'error',interrupted?'scan-stopped':'scan-interrupted',{message:String(error.message || error)});
        state(interrupted?'Остановлено. При новом запуске успешно загруженные карточки и истории берутся из кэша.':'Сканирование не завершено; частичные результаты сохранены в кэше.');
        $('errors').textContent=`НЕПОЛНЫЙ РЕЗУЛЬТАТ: ${String(error.message || error)}. Экспортируй диагностический журнал.`;
    } finally {
        if (!complete) log('warn','scan-incomplete',{...stats});
        active=false; controllers.clear(); checkStatus(); $('start').disabled=false; $('stop').disabled=true; $('clear').disabled=false; $('reset-log').disabled=false; render(); updateStats();
        // Completed (possibly partial) scans may inspect only confirmed barcodes.
        // Fatal or stopped scans must not inspect a partial dataset.
        if (complete) {
            state('Поиск завершён. Запускается автоматическая сверка с Ozon…');
            await startInspection();
        }
    }
}
try { const previous = JSON.parse(localStorage.getItem('tw-sold-last-diagnostics') || '[]');
    if (Array.isArray(previous) && previous.length) { logItems=previous; $('log').textContent=previous.map(e=>`${e.at} [${e.level}] ${e.event} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k])=>!['at','level','event'].includes(k))))}`).join('\n')+'\n'; }
} catch { /* optional previous diagnostics */ }
$('start').addEventListener('click',()=>{if(!active) void run();});
$('stop').addEventListener('click',()=>{stopRequested=true;controllers.forEach(controller=>controller.abort());log('info','stop-requested');});
$('clear-list').addEventListener('click',async()=>{
    if(active||ozonCheckActive||cleanupDeleteActive||clearListActive||!completedSnapshot)return;
    clearListActive=true;checkStatus();
    try {
        // Complete any queued selection writes before clearing, so they cannot restore old choices.
        await persistSelection;
        const db=await openReviewDB();
        await new Promise((resolve,reject)=>{
            const tx=db.transaction('data','readwrite');
            for(const key of ['completed','excluded','ozonCheck'])tx.objectStore('data').delete(key);
            tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
            tx.onabort=()=>reject(tx.error||new Error('Не удалось очистить результаты'));
        });
        completedSnapshot=null;ozonCheck=null;excludedKeys=new Set();cleanupSelected.clear();
        showRemoved=false;output=[];uncertain=[];excludedMulti=[];failures=[];
        stats={pages:0,candidates:0,details:0,emptyDetails:0,products:0,histories:0,confirmed:0,unknownType:0,excludedMulti:0,failed:0};
        $('errors').textContent='';
        $('ozon-check-status').textContent='Сверка ещё не проводилась';
        $('cleanup-delete-status').textContent='Выберите ШК для удаления.';
        state('Список очищен. Можно начать новый поиск.');
        log('info','review-list-cleared');
        render();updateStats();showInspection();
    }catch(error){$('errors').textContent=`Не удалось очистить список: ${error.message}`;}
    finally {clearListActive=false;checkStatus();}
});
$('clear').addEventListener('click',async()=>{
    if(active||cleanupDeleteActive)return;
    if(!confirm('Удалить локальный кэш сканера? Это не затрагивает Amperkot или Ozon.'))return;
    const db=await openDB(); db.close(); dbPromise=null;
    await new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase(DB_NAME);req.onsuccess=resolve;req.onerror=()=>reject(req.error);});
    log('info','cache-cleared');
});
$('reset-log').addEventListener('click',()=>{
    if (active || cleanupDeleteActive) return;
    if (!confirm('Очистить диагностический журнал? Кэш заказов и результаты сканирования сохранятся.')) return;
    logItems = [];
    $('log').textContent = '';
    try { localStorage.removeItem('tw-sold-last-diagnostics'); } catch { /* optional diagnostics persistence */ }
});
$('export-log').addEventListener('click',()=>download(`tw-sold-scan-log-${new Date().toISOString().replace(/[:.]/g,'-')}.json`,{version:2,stats,complete:!active&&logItems.some(e=>e.event==='scan-complete'),partial:stats.failed>0,events:logItems,failures,unknownType:uncertain,excludedMulti:excludedMulti.map(({number,productId,saleEventId})=>({number,productId,saleEventId}))}));
$('export-results').addEventListener('click',()=>download('tw-sold-scan-results.json',{complete:!active&&logItems.some(e=>e.event==='scan-complete'),partial:stats.failed>0,stats,confirmed:output,unknownType:uncertain,excludedMulti}));
const month=new Date().toISOString().slice(0,7);$('to').value=month;$('from').value=`${month.slice(0,4)}-01`;

void restoreReview();
