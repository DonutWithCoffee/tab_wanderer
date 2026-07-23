const { spawnSync } = require('child_process');

const testFiles = [
    'tests/order-kind.test.js',
    'tests/notification-rules.test.js',
    'tests/background-core.test.js',
    'tests/lifecycle-hardening.test.js',
    'tests/background-process.test.js',
    'tests/background-config.test.js',
    'tests/content-parser.test.js',
    'tests/popup-ui.test.js',
    'tests/options-ui.test.js',
    'tests/watched-orders-ui.test.js',
    'tests/warehouse-barcode-extractor.test.js',
    'tests/warehouse-barcode-bridge.test.js',
    'tests/ozon-product-search.test.js',
    'tests/ozon-barcode-binding.test.js',
    'tests/ozon-product-bridge.test.js'
];

function collectSummary(output) {
    const text = String(output || '');
    const lines = text.split(/\r?\n/);

    let pass = 0;
    let fail = 0;

    for (const line of lines) {
        const passMatch = line.match(/\bpass\s+(\d+)\b/);
        const failMatch = line.match(/\bfail\s+(\d+)\b/);

        if (passMatch) {
            pass += Number(passMatch[1]);
        }

        if (failMatch) {
            fail += Number(failMatch[1]);
        }
    }

    return { pass, fail };
}

let totalPass = 0;
let totalFail = 0;
let exitCode = 0;

for (const file of testFiles) {
    const result = spawnSync(process.execPath, ['--test', file], {
        encoding: 'utf8'
    });

    if (result.stdout) {
        process.stdout.write(result.stdout);
    }

    if (result.stderr) {
        process.stderr.write(result.stderr);
    }

    const summary = collectSummary(`${result.stdout || ''}\n${result.stderr || ''}`);

    totalPass += summary.pass;
    totalFail += summary.fail;

    if (result.status !== 0) {
        exitCode = result.status || 1;
    }
}

console.log(`${totalPass} pass ${totalFail} fail`);

process.exit(exitCode);