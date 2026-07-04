function createOzonWarehouseMessage(type, payload = {}) {
    return {
        type: String(type || ''),
        ...(payload && typeof payload === 'object' ? payload : {})
    };
}

async function sendOzonWarehouseMessage({
    session = null,
    type = '',
    payload = {},
    logCategory = 'OZON',
    logMessage = 'failed to send message to warehouse tab'
} = {}) {
    const warehouseTabId = session?.warehouseTabId;

    if (!warehouseTabId || typeof chrome?.tabs?.sendMessage !== 'function') {
        return false;
    }

    try {
        await chrome.tabs.sendMessage(warehouseTabId, createOzonWarehouseMessage(type, payload));
        return true;
    } catch (error) {
        if (typeof log === 'function') {
            log('WARN', logCategory, logMessage, error?.message || error);
        }
        return false;
    }
}
