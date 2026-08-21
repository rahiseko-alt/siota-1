// @ts-check
const { defineConfig } = require('playwright/test');

module.exports = defineConfig({
  testDir: './test',
  testMatch: ['**/e2e-ponchi.spec.cjs', '**/archive-back.spec.cjs'],
  timeout: 40000,
  retries: 0,
  workers: 1, // KV への直列アクセス（競合回避）
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:8787/api/ping',
    reuseExistingServer: true,
    timeout: 120000,
  },
  use: {
    baseURL: 'http://localhost:8787',
    headless: true,
    viewport: { width: 390, height: 844 }, // iPhone 14 Pro
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  reporter: [['list'], ['json', { outputFile: 'test/e2e-results.json' }]],
});
