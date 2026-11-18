'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../core/sold-barcode-scan.js');
test('list URL uses confirmed server-side status/source filters and per_page=100',()=>{
    const u=new URL(m.listUrl(4));
    assert.equal(u.searchParams.get('status[]'),'6809');
    assert.equal(u.searchParams.get('source[]'),'197300');
    assert.equal(u.searchParams.get('per_page'),'100');
    assert.equal(u.searchParams.get('page'),'4');
    assert.equal(u.searchParams.has('status_changed_at_from'),false);
});
test('details URL validates order number',()=>{
    assert.equal(m.detailsUrl('8087-260926'),'https://amperkot.ru/admin/api/shop-orders/8087-260926');
    assert.throws(()=>m.detailsUrl('../danger'));
});
test('filters by creation date, source and status rather than status_changed_at',()=>{
    const base={number:'8087-260926',created_at:'2026-05-10T12:00:00Z',status_changed_at:'2026-09-27T21:00:00Z',status:{id:6809},source:{id:197300}};
    const records=[base,
        {...base,number:'8088-260926',status:{id:1}},
        {...base,number:'8089-260926',source:{id:1}},
        {...base,number:'8090-260926',created_at:'2026-06-01T00:00:00Z'},
        {...base,number:'8091-260926',created_at:'2026-04-30T23:59:59Z'},
        {...base,number:'8092-260926',created_at:'2026-05-31T23:59:59Z'},
        {...base,number:'8093-260926',created_at:'2026-05-05T00:00:00Z',status_changed_at:'2026-01-01T00:00:00Z'}];
    assert.deepEqual(m.filterOrders({items:records},'2026-05-01','2026-05-31').map(o=>o.number),
        ['8087-260926','8092-260926','8093-260926']);
});
test('parses all product IDs in completed orders, even when line status differs from sold',()=>{
    const payload={shop_order:{number:'8087-260926',id:971651,status:{id:6809},source:{id:197300},items:[
        {type:'product',item_id:'42742201',status:'sold',quantity:1},{type:'product',item_id:'42742201',status:'sold',quantity:1},
        {type:'service',item_id:'1',status:'sold'},{type:'product',item_id:'2',status:'cancelled'}]}};
    const result=m.parseDetails(payload,'8087-260926');
    assert.deepEqual(result.products,['42742201','2']);
    assert.deepEqual(result.lines.map(line => line.status), ['sold','sold','cancelled']);
    assert.equal(result.id,'971651');
    assert.throws(()=>m.parseDetails(payload,'1111-111111'));
});
test('separates unit barcodes from multi and missing type (fail closed)',()=>{
    const template={id:1,created_at:'2026-09-27T21:00:00Z',attributes:{shop_order:{id:971651,number:'8087-260926'},affected_quantity:1},action:{type:3},product:{id:42742201},productItem:{id:4248083,barcode:'2471918',type:0}};
    const events=[template,{...template,id:2,productItem:{id:4,barcode:'2471919',type:1}},
        {...template,id:3,productItem:{id:5,barcode:'2471920'}},
        {...template,id:4,action:{type:6}}];
    const orders={'8087-260926':{number:'8087-260926',id:'971651',products:['42742201']}};
    const result=m.matchSales(events,orders,'42742201');
    assert.equal(result.accepted.length,1);
    assert.equal(result.excludedMulti.length,1);
    assert.equal(result.unknownType.length,1);
    assert.equal(result.accepted[0].barcode,'2471918');
});
test('history URL asks explicitly for item type, fetch scoped by product',()=>{
    const url=new URL(m.historyUrl('42742201',2));
    assert.equal(url.searchParams.get('product'),'42742201');
    assert.equal(url.searchParams.get('fields[1]'),'productItem.type');
    assert.equal(url.searchParams.get('per_page'),'100');
});

test('closed order with initial line status still supplies product for warehouse verification',()=>{
    const data={shop_order:{number:'6902-201026',id:990920,status:{id:6809},source:{id:197300},items:[{type:'product',item_id:'40552238',status:'initial',quantity:2}]}};
    const parsed=m.parseDetails(data,'6902-201026');
    assert.deepEqual(parsed.products,['40552238']);
    const history=[{id:10,action:{type:3},attributes:{shop_order:{id:990920,number:'6902-201026'},affected_quantity:2},product:{id:40552238},productItem:{id:7,barcode:'12345',type:0}}];
    assert.equal(m.matchSales(history,{'6902-201026':parsed},'40552238').accepted.length,1);
});

test('list URL requests confirmed ascending creation-date ordering', () => {
    const u = new URL(m.listUrl(2));
    assert.equal(u.searchParams.get('sort'), 'created_at');
    assert.equal(u.searchParams.get('order'), 'asc');
});
function fakeListing(months, mutate) {
    const records = months.map((date, i) => ({number:`${String(i+1000).padStart(4,'0')}-010126`,created_at:`${date}T12:00:00Z`, status:{id:6809},source:{id:197300}}));
    const pages = Math.ceil(records.length / 100);
    const called=[];
    return { called, fetch: async page => {
        called.push(page);
        const response = {count:records.length,page,pages,items:records.slice((page-1)*100,page*100)};
        return mutate ? mutate(response) : response;
    }};
}
test('binary scan finds only May, handles boundary pages and avoids full traversal', async () => {
    const dates = [ ...Array(900).fill('2026-04-20'), ...Array(521).fill('2026-05-20'), ...Array(900).fill('2026-06-20') ];
    const f=fakeListing(dates);
    const result=await m.collectOrdersByCreationDate(f.fetch,'2026-05-01','2026-05-31');
    assert.equal(result.mode,'binary');
    assert.equal(result.orders.length,521);
    assert.ok(result.requests<23,`too many requests: ${result.requests}`);
    assert.ok(f.called.includes(10) && f.called.includes(15));
});
test('empty month returns no candidates without full traversal', async () => {
    const f=fakeListing([...Array(200).fill('2026-04-20'), ...Array(200).fill('2026-06-20')]);
    const result=await m.collectOrdersByCreationDate(f.fetch,'2026-05-01','2026-05-31');
    assert.equal(result.mode,'binary');
    assert.equal(result.orders.length,0);
});
test('out-of-order page falls back to full scan without losing matches', async () => {
    const dates=[...Array(100).fill('2026-05-20'), ...Array(100).fill('2026-04-20'), ...Array(100).fill('2026-06-20')];
    const f=fakeListing(dates); let fallbackReason='';
    const result=await m.collectOrdersByCreationDate(f.fetch,'2026-05-01','2026-05-31', (event, data) => {if(event==='fallback') fallbackReason=data.reason;});
    assert.equal(result.mode,'full');
    assert.equal(result.orders.length,100);
    assert.ok(fallbackReason.includes('sorted') || fallbackReason.includes('global-order'));
});
test('list count changes during boundary search and is not silently accepted', async () => {
    const f=fakeListing([...Array(300).fill('2026-05-20')], response => response.page===2 ? {...response,count:301} : response);
    await assert.rejects(m.collectOrdersByCreationDate(f.fetch,'2026-05-01','2026-05-31'), /list-count-changed/);
});

test('history collection reads 257 pages, validates count, and checkpoints', async () => {
    const total = 25622, pages = 257, calls = [], saved = [];
    const fetchPage = async page => { calls.push(page); return {page,pages,count:total,items:Array.from({length:Math.min(100,total-(page-1)*100)},(_,i)=>({id:total-(page-1)*100-i}))}; };
    const result=await m.collectProductHistory(fetchPage,null,async value=>{saved.push({nextPage:value.nextPage, complete:value.complete, count:value.history.length});});
    assert.equal(result.history.length,total);
    assert.equal(result.pages,257);
    assert.equal(calls.length,257);
    assert.ok(saved.length < 35);
    assert.equal(saved.at(-1).complete,true);
});
test('history collection resumes after interruption from persisted checkpoint', async () => {
    const total=2500, pages=25;
    const fetchPage=async page=>({page,pages,count:total,items:Array.from({length:100},(_,i)=>({id:total-(page-1)*100-i}))});
    let last, calls=0;
    await assert.rejects(m.collectProductHistory(async page=>{if(page===13) throw new Error('network outage');return fetchPage(page);},null,async value=>{last={...value, history:[...value.history]};}),/network outage/);
    assert.equal(last.nextPage,11);
    const result=await m.collectProductHistory(async page=>{calls++;return fetchPage(page);},last);
    assert.equal(result.history.length,total);
    assert.equal(result.resumed,true);
    assert.equal(calls,16);
});
test('history resumes from beginning when new events shift pagination', async () => {
    const payload=async page=>({page,pages:2,count:101,items:Array.from({length:page===1?100:1},(_,i)=>({id:1000-(page-1)*100-i}))});
    const stale={complete:false,firstId:'999',pages:2,count:101,nextPage:2,history:Array.from({length:100},(_,i)=>({id:999-i}))};
    const result=await m.collectProductHistory(payload,stale);
    assert.equal(result.resumed,false);
    assert.equal(result.history.length,101);
});
test('history fails closed when pages duplicate an operation or count changes', async () => {
    const duplicate=async page=>({page,pages:2,count:101,items:Array.from({length:page===1?100:1},(_,i)=>({id:page===2?1:i+1}))});
    await assert.rejects(m.collectProductHistory(duplicate),/Повтор/);
    const changed=async page=>({page,pages:page===1?2:3,count:page===1?101:201,items:Array.from({length:page===1?100:100},(_,i)=>({id:page*100+i}))});
    await assert.rejects(m.collectProductHistory(changed),/изменилась/);
});

function fakeHistoryDates(dates, mutate) {
    const called=[];
    return {called, fetch:async page=>{
        called.push(page);
        const response={page,pages:Math.max(1,Math.ceil(dates.length/100)),count:dates.length,
            items:dates.slice((page-1)*100,page*100).map((date,index)=>({id:dates.length-(page-1)*100-index,created_at:`${date}T12:00:00Z`}))};
        return mutate ? mutate(response) : response;
    }};
}
test('dated history stops after the last needed month, not at end of stock history',async()=>{
    const f=fakeHistoryDates([...Array(100).fill('2026-11-01'),...Array(100).fill('2026-06-01'),...Array(100).fill('2026-03-02'),...Array(1000).fill('2026-02-01')]);
    const r=await m.collectProductHistorySince(f.fetch,'2026-03-01T00:00:00Z');
    assert.equal(r.history.length,400); // boundary page also fetched
    assert.equal(r.requests,5);
    assert.equal(r.stoppedByDate,true);
});
test('cached date range covers later month and avoids re-reading old pages on refresh',async()=>{
    const dates=[...Array(150).fill('2026-11-01'),...Array(180).fill('2026-05-01'),...Array(500).fill('2026-02-01')];
    const first=fakeHistoryDates(dates);
    let cached;
    await m.collectProductHistorySince(first.fetch,'2026-03-01T00:00:00Z',null,async p=>{if(p.complete)cached={...p,history:[...p.history]};});
    const second=fakeHistoryDates([...Array(8).fill('2026-11-02'),...dates]);
    const r=await m.collectProductHistorySince(second.fetch,'2026-05-01T00:00:00Z',cached);
    assert.equal(r.usedCache,true);
    assert.ok(r.requests<=2);
    assert.equal(r.history.length,cached.history.length+8);
});
test('older month expands historical coverage instead of relying on insufficient cached suffix',async()=>{
    const dates=[...Array(100).fill('2026-06-01'),...Array(100).fill('2026-04-01'),...Array(100).fill('2026-03-01'),...Array(100).fill('2026-02-01')];
    const f=fakeHistoryDates(dates);let cached;
    await m.collectProductHistorySince(f.fetch,'2026-05-01T00:00:00Z',null,async p=>{if(p.complete)cached={...p,history:[...p.history]};});
    const later=fakeHistoryDates(dates);const r=await m.collectProductHistorySince(later.fetch,'2026-03-01T00:00:00Z',cached);
    assert.equal(r.usedCache,false);
    assert.equal(r.requests,3);
    assert.equal(r.history.length,400);
});
test('May to April reuses a complete one-page history without requesting nonexistent page 2', async () => {
    const dates = Array(60).fill('2026-05-12');
    let cache;
    await m.collectProductHistorySince(fakeHistoryDates(dates).fetch, '2026-05-01T00:00:00Z', null,
        async p => { if (p.complete) cache = structuredClone(p); });
    assert.equal(cache.pages, 1);
    assert.equal(cache.nextPage, 2);
    const april = fakeHistoryDates(dates);
    const result = await m.collectProductHistorySince(april.fetch, '2026-03-31T00:00:00Z', cache);
    assert.deepEqual(april.called, [1]);
    assert.equal(result.history.length, 60);
    assert.equal(result.usedCache, true);
    assert.equal(result.resumed, true);
    assert.equal(result.requests, 1);
});
test('May to April reuses a complete multi-page history without requesting pages beyond last', async () => {
    const dates = [...Array(100).fill('2026-05-12'), ...Array(60).fill('2026-05-11')];
    let cache;
    await m.collectProductHistorySince(fakeHistoryDates(dates).fetch, '2026-05-01T00:00:00Z', null,
        async p => { if (p.complete) cache = structuredClone(p); });
    assert.equal(cache.nextPage, 3);
    const april = fakeHistoryDates(dates);
    const result = await m.collectProductHistorySince(april.fetch, '2026-03-31T00:00:00Z', cache);
    assert.deepEqual(april.called, [1]);
    assert.equal(result.history.length, 160);
    assert.equal(result.usedCache, true);
    assert.equal(result.resumed, true);
});
test('unsorted dated history rejects early exit',async()=>{
    const f=fakeHistoryDates([...Array(100).fill('2026-11-01'),...Array(100).fill('2026-02-01'),...Array(100).fill('2026-05-01')]);
    await assert.rejects(m.collectProductHistorySince(f.fetch,'2026-03-01T00:00:00Z'),/history-date-not-sorted/);
});

test('older period reuses previously verified pages when server history unchanged',async()=>{
    const dates=[...Array(100).fill('2026-06-01'),...Array(100).fill('2026-04-01'),...Array(100).fill('2026-03-01'),...Array(100).fill('2026-02-01')];
    const first=fakeHistoryDates(dates); let cached;
    await m.collectProductHistorySince(first.fetch,'2026-05-01T00:00:00Z',null,async p=>{if(p.complete) cached={...p,history:[...p.history]};});
    const next=fakeHistoryDates(dates); const r=await m.collectProductHistorySince(next.fetch,'2026-03-01T00:00:00Z',cached);
    assert.equal(r.resumed,true);
    assert.equal(r.requests,3); // first-page probe and 2 pages of extension
    assert.equal(r.history.length,400);
});

test('incremental refresh sees a newly sold event while reusing older cached operations', async () => {
    const dates = [...Array(100).fill('2026-11-01'), ...Array(100).fill('2026-05-01'), ...Array(100).fill('2026-02-01')];
    const initial = fakeHistoryDates(dates);
    let cache;
    await m.collectProductHistorySince(initial.fetch, '2026-03-01T00:00:00Z', null, async record => {
        if (record.complete) cache = structuredClone(record);
    });
    const extra = { id: 999999, created_at: '2026-11-17T12:30:00Z', action: { type: 3 },
        attributes: { shop_order: { number: '1234-010526', id: 42 } }, product:{id:123},
        productItem: { id: 10, barcode: '1234567', type: 0 } };
    const all = [extra, ...cache.history];
    const refreshed = { called: [], fetch: async page => {
        refreshed.called.push(page);
        return { page, pages: Math.ceil((dates.length + 1) / 100), count: dates.length + 1,
            items: all.slice((page-1)*100, page*100) };
    } };
    const result = await m.collectProductHistorySince(refreshed.fetch, '2026-05-01T00:00:00Z', cache);
    assert.equal(result.usedCache, true);
    assert.ok(result.requests < 4);
    assert.equal(result.history[0].id, 999999);
    assert.equal(result.history.filter(item => item.id === 999999).length, 1);
    const sales = m.matchSales(result.history, {'1234-010526': {id:'42', products:['123']}}, '123');
    assert.equal(sales.accepted.length, 1);
    assert.equal(sales.accepted[0].barcode, '1234567');
});

test('history cache never reuses an unknown anchor when operations have been replaced', async () => {
    const dates = [...Array(100).fill('2026-11-01'),...Array(100).fill('2026-05-01'),...Array(100).fill('2026-02-01')];
    let cache;
    await m.collectProductHistorySince(fakeHistoryDates(dates).fetch, '2026-03-01T00:00:00Z', null,
        async p => { if(p.complete) cache=structuredClone(p); });
    const mutated = fakeHistoryDates(dates, response => {
        response.items = response.items.map(event => ({...event, id:event.id+900000}));
        return response;
    });
    const refreshed = await m.collectProductHistorySince(mutated.fetch, '2026-03-01T00:00:00Z', cache);
    assert.equal(refreshed.usedCache, false);
    assert.ok(refreshed.requests>=3);
    assert.equal(refreshed.history[0].id, 900300);
});

test('day boundary includes later sales and retains the page crossing the cutoff', async () => {
    const fixture=fakeHistoryDates([...Array(100).fill('2026-11-01'), ...Array(100).fill('2026-03-01'), ...Array(100).fill('2026-02-28')]);
    const result=await m.collectProductHistorySince(fixture.fetch, '2026-03-01T00:00:00Z');
    assert.equal(result.history.length, 300);
    assert.ok(result.history.some(event=>event.created_at.startsWith('2026-03-01')));
    assert.ok(!fixture.called.includes(4));
});


test('addressed product item endpoint and strict response normalization', () => {
    assert.equal(m.productItemUrl(4376675), 'https://amperkot.ru/_api/v1/warehouse/wh1/product-items/4376675');
    assert.throws(() => m.productItemUrl('../4376675'));
    const payload={id:4376675,product_id:23864619,barcode:'2448437',type:0,quantity:0,state:{type:2}};
    assert.deepEqual(m.normalizeProductItem(payload,'4376675','23864619'),
        {id:'4376675',productId:'23864619',barcode:'2448437',type:0});
    assert.deepEqual(m.normalizeProductItem({id:'4376675',productId:'23864619',barcode:'2448437',type:0},'4376675','23864619'),
        {id:'4376675',productId:'23864619',barcode:'2448437',type:0});
    assert.equal(m.normalizeProductItem({...payload,product_id:7},'4376675','23864619'),null);
    assert.equal(m.normalizeProductItem({...payload,id:7},'4376675','23864619'),null);
    assert.equal(m.normalizeProductItem({...payload,type:2},'4376675','23864619'),null);
});
test('missingSaleItemIds selects only operations tied to matching warehouse order', () => {
    const order={'1111-010326':{id:'321',products:['23864619']}};
    const base={id:1,created_at:'2026-03-05',action:{type:3},product:{id:23864619},
        attributes:{shop_order:{number:'1111-010326',id:321}},productItem:{id:4376675}};
    const events=[base,{...base,id:2},{...base,id:3,productItem:{id:6,barcode:'123',type:0}},
        {...base,id:4,productItem:{id:7,barcode:'123'}},
        {...base,id:5,action:{type:6},productItem:{id:8}},
        {...base,id:6,attributes:{shop_order:{number:'1111-010326',id:999}},productItem:{id:9}}];
    assert.deepEqual(m.missingSaleItemIds(events,order,'23864619'),['4376675','7']);
});
test('matchSales resolves missing barcode and type via addressed sold item without treating sold state as proof', () => {
    const order={'1111-010326':{id:'321',products:['23864619']}};
    const event={id:101,created_at:'2026-03-05',action:{type:3},product:{id:23864619},
        attributes:{shop_order:{number:'1111-010326',id:321},affected_quantity:1},productItem:{id:4376675}};
    const resolved={'4376675':{id:'4376675',productId:'23864619',barcode:'2448437',type:0}};
    const missing=m.matchSales([event],order,'23864619');
    assert.equal(missing.accepted.length,0);
    assert.equal(missing.unknownType.length,1);
    const matched=m.matchSales([event],order,'23864619',resolved);
    assert.equal(matched.accepted.length,1);
    assert.equal(matched.accepted[0].barcode,'2448437');
    assert.equal(matched.accepted[0].productItemId,'4376675');
    assert.equal(m.matchSales([event],{},'23864619',resolved).accepted.length,0);
    assert.equal(m.matchSales([{...event,action:{type:4}}],order,'23864619',resolved).accepted.length,0);
    assert.equal(m.matchSales([event],order,'23864619',{'4376675':{...resolved['4376675'],type:1}}).excludedMulti.length,1);
    assert.equal(m.matchSales([event],order,'23864619',{'4376675':{...resolved['4376675'],productId:'77'}}).unknownType.length,1);
    assert.equal(m.matchSales([{...event,productItem:{id:4376675,barcode:'9999999'}}],order,'23864619',resolved).unknownType.length,1);
});
