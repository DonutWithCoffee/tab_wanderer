const test = require('node:test');
const assert = require('node:assert/strict');
const {
    loadBackgroundContext,
    settleBackgroundContext,
    runExpression,
    getBackgroundState,
    sendRuntimeMessage
} = require('./helpers/load-extension-context');

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

test('background initialization restricts storage and creates lifecycle alarms', async () => {
    const context = loadBackgroundContext();
    await context.ensureInitialized();

    assert.deepEqual(JSON.parse(JSON.stringify(context.__test.storageAccessLevelCalls)), [
        { accessLevel: 'TRUSTED_CONTEXTS' }
    ]);
    assert.equal(Boolean(context.__test.alarms.tab_wanderer_monitor_health), true);
    assert.equal(Boolean(context.__test.alarms.tab_wanderer_direct_follow_up), true);
    assert.equal(Boolean(context.__test.alarms.tab_wanderer_storage_maintenance), true);
});

test('runtime messages wait for persisted state initialization', async () => {
    const deferredLoad = createDeferred();
    let loadStarted = false;
    const context = loadBackgroundContext({
        configureTestState(testState) {
            testState.storageGetHook = async () => {
                loadStarted = true;
                return deferredLoad.promise;
            };
        }
    });

    let responseSettled = false;
    const responsePromise = sendRuntimeMessage(context, { type: 'GET_CONFIG' })
        .then((response) => {
            responseSettled = true;
            return response;
        });

    for (let index = 0; index < 16 && !loadStarted; index += 1) {
        await Promise.resolve();
    }

    assert.equal(loadStarted, true);
    assert.equal(responseSettled, false);

    deferredLoad.resolve({
        userConfig: {
            monitorMode: 'active',
            deepSyncMaxPages: 3
        }
    });

    const response = await responsePromise;
    assert.equal(response.ok, true);
    assert.equal(response.userConfig.monitorMode, 'active');
    assert.equal(response.userConfig.deepSyncMaxPages, 3);
});

test('state saves are serialized and coalesce to the newest snapshot', async () => {
    const context = loadBackgroundContext();
    await context.ensureInitialized();

    context.__test.storageSetCalls.length = 0;
    context.__test.storageSetConcurrent = 0;
    context.__test.storageSetMaxConcurrent = 0;

    const firstWrite = createDeferred();
    let blocked = false;
    context.__test.storageSetHook = async () => {
        if (!blocked) {
            blocked = true;
            await firstWrite.promise;
        }
    };

    runExpression(context, `
        knownOrdersDB = {
            '1000-300326': { id: '1000-300326', status: 'Новый' }
        };
        knownOrdersHashDB = {
            '1000-300326': getHash(knownOrdersDB['1000-300326'])
        };
    `);
    const firstSave = context.save();

    await Promise.resolve();
    await Promise.resolve();

    runExpression(context, `
        knownOrdersDB['1000-300326'] = {
            ...knownOrdersDB['1000-300326'],
            status: 'Оплачен'
        };
        knownOrdersHashDB['1000-300326'] = getHash(knownOrdersDB['1000-300326']);
    `);
    const secondSave = context.save();

    firstWrite.resolve();
    await Promise.all([firstSave, secondSave]);

    assert.equal(context.__test.storageSetMaxConcurrent, 1);
    assert.equal(context.__test.storageSetCalls.length >= 2, true);
    const finalSnapshot = context.__test.storageSetCalls.at(-1);
    assert.equal(finalSnapshot.knownOrdersDB['1000-300326'].status, 'Оплачен');
});



test('storage write failures are surfaced and a later successful save clears the error', async () => {
    const context = loadBackgroundContext();
    await context.ensureInitialized();

    context.__test.storageSetHook = async () => {
        throw new Error('simulated quota failure');
    };

    const failed = await context.save();
    assert.equal(failed, false);
    assert.match(getBackgroundState(context).storageDiagnostics.lastError, /simulated quota failure/);
    assert.equal(getBackgroundState(context).storageDiagnostics.lastErrorOperation, 'state');

    context.__test.storageSetHook = null;
    context.flushDiagnosticLog();
    await runExpression(context, 'storageWriteQueue');
    assert.match(getBackgroundState(context).storageDiagnostics.lastError, /simulated quota failure/);
    assert.equal(getBackgroundState(context).storageDiagnostics.lastErrorOperation, 'state');

    const recovered = await context.save();
    assert.equal(recovered, true);
    assert.equal(getBackgroundState(context).storageDiagnostics.lastError, null);

    const persistedSnapshot = context.__test.storageSetCalls.at(-1);
    assert.equal(persistedSnapshot.storageDiagnostics.lastError, null);
    assert.equal(persistedSnapshot.storageDiagnostics.lastErrorOperation, null);
    assert.equal(Number(persistedSnapshot.storageDiagnostics.lastSuccessfulWriteAt) > 0, true);
});

test('incoming order normalization bounds payloads and rejects invalid identities', () => {
    const context = loadBackgroundContext();
    const oversizedText = 'x'.repeat(800);
    const orders = context.normalizeIncomingOrders([
        {
            id: '1000-300326',
            internalId: oversizedText,
            status: oversizedText,
            phoneNormalized: '+7 (999) 123-45-67 ext 9999999999999999999999999999999999',
            tags: Array.from({ length: 40 }, (_, index) => `tag-${index}-${oversizedText}`),
            totalAmount: -1,
            productsDone: '4.9',
            productsTotal: Number.POSITIVE_INFINITY,
            orderUrl: 'https://evil.example/'
        },
        { id: 'javascript:alert(1)', status: 'bad' },
        { id: '1000-300326', status: 'duplicate' }
    ]);

    assert.equal(orders.length, 1);
    assert.equal(orders[0].orderUrl, 'https://amperkot.ru/admin/orders/1000-300326/');
    assert.equal(orders[0].status.length, 250);
    assert.equal(orders[0].internalId.length, 100);
    assert.equal(orders[0].phoneNormalized.length <= 32, true);
    assert.equal(orders[0].tags.length, 20);
    assert.equal(orders[0].tags.every(tag => tag.length <= 80), true);
    assert.equal(orders[0].totalAmount, null);
    assert.equal(orders[0].productsDone, 4);
    assert.equal(orders[0].productsTotal, null);
});

test('persisted order maps drop invalid ids and canonicalize stored links on load', async () => {
    const context = loadBackgroundContext({
        configureTestState(testState) {
            testState.storageGetResult = {
                knownOrdersDB: {
                    '1000-300326': {
                        id: ' 1000-300326 ',
                        status: 'Новый',
                        orderUrl: 'https://evil.example/admin/orders/1000-300326/'
                    },
                    malicious: {
                        id: 'javascript:alert(1)',
                        status: 'Новый',
                        orderUrl: 'javascript:alert(1)'
                    }
                },
                knownOrdersHashDB: {
                    '1000-300326': 'stored-hash',
                    malicious: 'malicious-hash'
                },
                windowOrdersDB: {
                    '2000-300326': {
                        id: '2000-300326',
                        orderUrl: 'https://evil.example/'
                    }
                },
                directFollowUpOrdersDB: {
                    invalid: { id: '../invalid' }
                }
            };
        }
    });

    await context.ensureInitialized();

    const state = getBackgroundState(context);
    assert.deepEqual(Object.keys(state.knownOrdersDB), ['1000-300326']);
    assert.equal(
        state.knownOrdersDB['1000-300326'].orderUrl,
        'https://amperkot.ru/admin/orders/1000-300326/'
    );
    assert.equal(
        state.knownOrdersHashDB['1000-300326'],
        context.getHash(state.knownOrdersDB['1000-300326'])
    );
    assert.equal(
        state.windowOrdersDB['2000-300326'].orderUrl,
        'https://amperkot.ru/admin/orders/2000-300326/'
    );
    assert.deepEqual(state.directFollowUpOrdersDB, {});
});

test('known order retention keeps watched orders and caps unprotected history', async () => {
    const context = loadBackgroundContext();
    await context.ensureInitialized();

    const orders = {};
    const hashes = {};
    for (let index = 1; index <= 5002; index += 1) {
        const id = `${index}-010101`;
        orders[id] = { id, status: `status-${index}` };
        hashes[id] = `hash-${index}`;
    }

    context.__orders = orders;
    context.__hashes = hashes;
    runExpression(context, `
        knownOrdersDB = __orders;
        knownOrdersHashDB = __hashes;
        windowOrdersDB = {};
        directFollowUpOrdersDB = {};
        userConfig = getEffectiveUserConfig({
            watchedOrders: { items: [{ id: '1-010101' }] }
        });
        applyKnownOrdersRetention();
    `);
    delete context.__orders;
    delete context.__hashes;

    const state = getBackgroundState(context);
    assert.equal(Object.keys(state.knownOrdersDB).length, 5000);
    assert.equal(state.knownOrdersDB['1-010101'].id, '1-010101');
    assert.equal(Object.prototype.hasOwnProperty.call(state.knownOrdersDB, '2-010101'), false);
    assert.equal(state.knownOrdersDB['5002-010101'].id, '5002-010101');
});

test('byte-aware state retention preserves watched orders before storage quota is reached', async () => {
    const context = loadBackgroundContext();
    await context.ensureInitialized();

    const orders = {};
    const hashes = {};
    for (let index = 1; index <= 20; index += 1) {
        const id = `${index}-020202`;
        orders[id] = { id, status: `status-${index}-${'x'.repeat(1000)}` };
        hashes[id] = `hash-${index}`;
    }

    context.__orders = orders;
    context.__hashes = hashes;
    runExpression(context, `
        knownOrdersDB = __orders;
        knownOrdersHashDB = __hashes;
        windowOrdersDB = {};
        directFollowUpOrdersDB = {};
        userConfig = getEffectiveUserConfig({
            watchedOrders: { items: [{ id: '1-020202' }] }
        });
        applyStateByteRetention(6000);
    `);
    delete context.__orders;
    delete context.__hashes;

    const state = getBackgroundState(context);
    assert.equal(state.knownOrdersDB['1-020202'].id, '1-020202');
    assert.equal(Object.keys(state.knownOrdersDB).length < 20, true);
    assert.equal(state.storageDiagnostics.lastEstimatedStateBytes <= 6000, true);
});

test('notification target retention removes expired and excess targets', async () => {
    const context = loadBackgroundContext();
    await context.ensureInitialized();

    const targets = {
        expired: {
            orderId: '1-010101',
            orderUrl: 'https://evil.example/admin/orders/1-010101/',
            createdAt: 1
        }
    };
    const now = 20 * 24 * 60 * 60 * 1000;
    for (let index = 0; index < 505; index += 1) {
        targets[`target-${index}`] = {
            orderId: `${index + 100}-010101`,
            createdAt: now - (505 - index)
        };
    }

    context.__targets = targets;
    context.__now = now;
    runExpression(context, `
        notificationTargets = __targets;
        applyNotificationTargetRetention(__now);
    `);
    delete context.__targets;
    delete context.__now;

    const state = getBackgroundState(context);
    assert.equal(Object.keys(state.notificationTargets).length, 500);
    assert.equal(Object.prototype.hasOwnProperty.call(state.notificationTargets, 'expired'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(state.notificationTargets, 'target-0'), false);
    assert.equal(state.notificationTargets['target-504'].orderUrl, 'https://amperkot.ru/admin/orders/604-010101/');
});

test('startup reconciliation adopts one main worker and removes orphan workers', async () => {
    const context = loadBackgroundContext({
        configureTestState(testState) {
            testState.storageGetResult = {
                isRunning: true,
                userConfig: { monitorMode: 'active' }
            };
            testState.tabsQueryResult = [
                { id: 11, url: 'https://amperkot.ru/admin/orders/#tab_wanderer_worker=1' },
                { id: 12, url: 'https://amperkot.ru/admin/orders/?page=2#tab_wanderer_worker=1' },
                { id: 13, url: 'https://amperkot.ru/admin/orders/1000-300326/#tab_wanderer_direct_worker=1' },
                { id: 14, url: 'https://seller.ozon.ru/app/products?search=1#tab_wanderer_ozon_worker=1' },
                { id: 15, url: 'https://evil.example/#tab_wanderer_worker=1' }
            ];
        }
    });

    await context.ensureInitialized();

    const state = getBackgroundState(context);
    assert.equal(state.workerTabId, 11);
    assert.deepEqual([...context.__test.removedTabs].sort((a, b) => a - b), [12, 13, 14]);
    assert.equal(context.__test.removedTabs.includes(15), false);
    assert.equal(context.__test.tabUpdates.some(call => call.tabId === 11), true);
});

test('worker URL checks reject marker spoofing on foreign origins', () => {
    const context = loadBackgroundContext();

    assert.equal(
        context.isMarkedAmperkotWorkerUrl(
            'https://amperkot.ru/admin/orders/#tab_wanderer_worker=1',
            '#tab_wanderer_worker=1'
        ),
        true
    );
    assert.equal(
        context.isMarkedAmperkotWorkerUrl(
            'https://evil.example/admin/orders/#tab_wanderer_worker=1',
            '#tab_wanderer_worker=1'
        ),
        false
    );
    assert.equal(
        context.isMarkedOzonWorkerUrl(
            'https://seller.ozon.ru/app/products?search=1#tab_wanderer_ozon_worker=1'
        ),
        true
    );
    assert.equal(
        context.isMarkedOzonWorkerUrl(
            'https://evil.example/app/products#tab_wanderer_ozon_worker=1'
        ),
        false
    );
});

test('warehouse Ozon session accepts only the exact trusted warehouse origin', () => {
    const context = loadBackgroundContext();

    assert.equal(context.isWarehouseOzonResolveSender({
        url: 'https://amperkot.ru/web-apps/wh3/order/1000-300326'
    }), true);
    assert.equal(context.isWarehouseOzonResolveSender({
        url: 'https://amperkot.ru.evil.example/web-apps/wh3/order/1000-300326'
    }), false);
    assert.equal(context.isWarehouseOzonResolveSender({
        url: 'http://amperkot.ru/web-apps/wh3/order/1000-300326'
    }), false);
});

test('manifest keeps least-privilege runtime permissions after hardening', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

    assert.equal(manifest.version, '1.0.4');
    assert.deepEqual(manifest.permissions, ['storage', 'notifications', 'alarms']);
    assert.equal(manifest.permissions.includes('tabs'), false);
    assert.deepEqual(manifest.host_permissions, [
        'https://amperkot.ru/*',
        'https://seller.ozon.ru/*'
    ]);
    assert.equal(manifest.web_accessible_resources.every(item => item.use_dynamic_url === true), true);

    const webAccessibleResources = manifest.web_accessible_resources.flatMap(item => item.resources || []);
    assert.equal(webAccessibleResources.includes('ozon-product-page-bridge.js'), true);
    assert.equal(webAccessibleResources.includes('ozon-product-bridge.js'), false);

    const sellerContentScript = manifest.content_scripts.find(item => (item.matches || []).some(match => match.startsWith('https://seller.ozon.ru/')));
    assert.equal(sellerContentScript.js.includes('ozon-product-bridge.js'), true);
});
