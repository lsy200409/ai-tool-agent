const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '..');

module.exports = {
  testDir: __dirname,
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: path.resolve(__dirname, 'report') }]],
  use: {
    headless: false,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15000,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--disable-web-security',
            '--allow-running-insecure-content',
            '--host-resolver-rules=MAP chat.deepseek.com localhost',
            '--ignore-certificate-errors',
          ],
          devtools: false,
        },
      },
    },
  ],
};