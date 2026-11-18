(function(root) {
    'use strict';
    function selectionState(groups) {
        const total=groups.reduce((sum,group)=>sum+group.barcodes.length,0);
        const selected=groups.reduce((sum,group)=>sum+group.barcodes.filter(unit=>unit.selected).length,0);
        return {total,selected,checked:total>0 && selected===total,indeterminate:selected>0 && selected<total};
    }
    function applySelection(excludedKeys,groups,checked) {
        let changed=false;
        for(const group of groups) for(const unit of group.barcodes) {
            if (checked ? excludedKeys.delete(unit.key) : !excludedKeys.has(unit.key)) {
                if (!checked) excludedKeys.add(unit.key);
                changed=true;
            }
        }
        return changed;
    }
    // Presentation-only: keep scan evidence and inspection input unchanged.
    // A missing product must be confirmed by a completed inspection of this exact scan.
    function visibleAfterOzonAbsence(groups, hidden, snapshotId, currentSnapshotId, showHidden=false) {
        if (showHidden || !snapshotId || snapshotId !== currentSnapshotId || !Array.isArray(groups)) return groups;
        const ids = new Set(Array.isArray(hidden) ? hidden.filter(id=>/^\d+$/.test(id)) : []);
        return groups.filter(group=>!ids.has(String(group.productId)));
    }
    // Hide only products that received a definitive outcome in this inspection:
    // a confirmed absent catalogue card, or a successfully checked card with no
    // matching sold barcodes. Unresolved/skipped products stay visible.
    function hiddenAfterInspection(inspection, previousIds=[]) {
        if (!inspection?.complete || !Array.isArray(inspection.products)) return [...previousIds];
        const checked=new Set(inspection.products.map(row=>String(row.productId)));
        const next=new Set(previousIds.filter(id=>!checked.has(String(id))).map(String));
        const skipped=new Map((inspection.skipped || []).map(row=>[String(row.productId),row]));
        for (const row of inspection.products) {
            const id=String(row.productId);
            const skip=skipped.get(id);
            if (skip) {
                if (skip.confirmedAbsent===true) next.add(id);
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(inspection.results || {},id) &&
                Array.isArray(inspection.results[id]) && inspection.results[id].length===0) next.add(id);
        }
        return [...next].sort();
    }
    // Keep the source evidence intact; render only confirmed barcode intersections
    // after inspection. The removed list distinguishes absent/unmatched/unresolved.
    function partitionInspection(groups, inspection, snapshotId) {
        if (!inspection?.complete || inspection.snapshotId!==snapshotId || !Array.isArray(inspection.products))
            return {ready:false,working:groups,removed:[]};
        const inspected=new Set(inspection.products.map(row=>String(row.productId)));
        const skipped=new Map((inspection.skipped||[]).map(row=>[String(row.productId),row]));
        const working=[],removed=[];
        for (const group of groups) {
            const id=String(group.productId);
            if (!inspected.has(id)) {removed.push({group,reason:'Не вошёл в сверку'});continue;}
            const skip=skipped.get(id);
            if(skip) {removed.push({group,reason:skip.confirmedAbsent?'Карточка отсутствует в Ozon':
                skip.manuallyExcluded?'Исключён вручную (наличие не подтверждено)':'Проверка не завершена: '+(skip.reason||'ошибка')});continue;}
            if (!Object.prototype.hasOwnProperty.call(inspection.results||{},id) ||
                !Array.isArray(inspection.results[id])) {
                removed.push({group,reason:'Нет достоверного результата проверки'});continue;
            }
            const match=new Set(inspection.results[id]);
            const yes=group.barcodes.filter(unit=>unit.selected && match.has(unit.barcode));
            const no=group.barcodes.filter(unit=>unit.selected && !match.has(unit.barcode));
            if(yes.length)working.push({...group,barcodes:yes,count:yes.length,selected:yes.length});
            if(no.length)removed.push({group:{...group,barcodes:no,count:no.length,selected:no.length},reason:'Проданные ШК отсутствуют в Ozon'});
        }
        return {ready:true,working,removed};
    }
    const api={selectionState,applySelection,visibleAfterOzonAbsence,hiddenAfterInspection,partitionInspection};
    root.TWSoldBarcodeSelection=api;
    if(typeof module!=='undefined' && module.exports) module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
