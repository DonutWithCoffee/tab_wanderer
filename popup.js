function send(msg) {
    chrome.runtime.sendMessage(msg, (res) => {
        console.log('[POPUP]', msg.type, res);
    });
}

// baseline
document.getElementById('baseline').onclick = () => {
    send({ type: 'MANUAL_BASELINE', data: [] });
};

// reset
document.getElementById('reset').onclick = () => {
    send({ type: 'RESET_BASELINE' });
};

// test
document.getElementById('test').onclick = () => {

    const testOrders = [
        {
            id: 'TEST-1',
            status: 'Новый',
            delivery: 'Курьер',
            payment: 'Наличные'
        },
        {
            id: 'TEST-2',
            status: 'В обработке',
            delivery: 'Самовывоз',
            payment: 'Онлайн'
        },
        {
            id: 'TEST-3',
            status: 'Новый',
            delivery: 'Курьер',
            payment: '–'
        }
    ];

    send({
        type: 'ORDERS',
        data: testOrders,
        isTest: true
    });
};