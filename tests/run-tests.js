const { spawnSync } = require('child_process');

const testFiles = [
    'tests/notification-rules.test.js',
    'tests/background-core.test.js',
    'tests/background-process.test.js',
    'tests/background-config.test.js',
    'tests/content-parser.test.js',
    'tests/popup-ui.test.js'
];

for (const file of testFiles) {
    const result = spawnSync(process.execPath, ['--test', file], {
        stdio: 'inherit'
    });

    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

process.exit(0);