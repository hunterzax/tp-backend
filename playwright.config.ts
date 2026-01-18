import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load .env.test by default (won't override process.env if already set)
dotenv.config({ path: process.env.ENV_FILE || '.env.test' });

// Read test base URL from environment; fallback to localhost
const baseURL = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    headless: true,
    actionTimeout: 10_000,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
