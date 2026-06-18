// Playwright configuration for Intants web E2E smoke tests.
// Targets the locally running Vite dev server (http://localhost:5173).
// Run: npm run e2e
// Prerequisites: data_gateway on :8002, interview_core on :8001, Vite on :5173, Postgres.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
