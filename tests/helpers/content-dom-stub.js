function createHeaderCell(text) {
    return {
        innerText: text
    };
}

function createDataCell(text) {
    return {
        innerText: text
    };
}

function createLink({ text, href }) {
    return {
        innerText: text,
        getAttribute(name) {
            if (name === 'href') {
                return href;
            }

            return null;
        }
    };
}

function createTag(text) {
    return {
        innerText: text
    };
}

function createRow({
    internalId,
    displayId,
    href,
    cells,
    hasFlag = false,
    hasLock = false,
    tags = []
}) {
    return {
        getAttribute(name) {
            if (name === 'data-order-id') {
                return internalId;
            }

            return null;
        },
        querySelectorAll(selector) {
            if (selector === 'td') {
                return cells.map(createDataCell);
            }

            if (selector === '.label, .badge') {
                return tags.map(createTag);
            }

            return [];
        },
        querySelector(selector) {
            if (selector === 'a[href*="/admin/orders/"]' && href) {
                return createLink({
                    text: displayId,
                    href
                });
            }

            if (selector === '.fa-flag' && hasFlag) {
                return {};
            }

            if (selector === '.fa-lock' && hasLock) {
                return {};
            }

            return null;
        }
    };
}

function createDocumentStub({
    headers = [],
    rows = []
}) {
    return {
        querySelectorAll(selector) {
            if (selector === 'thead th') {
                return headers.map(createHeaderCell);
            }

            if (selector === 'tr[data-order-id]') {
                return rows.map(createRow);
            }

            return [];
        }
    };
}

module.exports = {
    createDocumentStub
};