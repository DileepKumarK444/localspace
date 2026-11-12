import { defineConfig } from '@playwright/test';

/** End-to-end tests drive real Chrome against a real server started on a throwaway data directory. */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { channel: 'chrome', actionTimeout: 10_000, navigationTimeout: 20_000, viewport: { width: 1360, height: 860 }, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off' },
  outputDir: './e2e/.results',
});
