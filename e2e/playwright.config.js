// @ts-check
const { defineConfig, devices } = require('@playwright/test')
const { BASE_URL } = require('./support/env')

module.exports = defineConfig({
  testDir: './tests',
  globalSetup: require.resolve('./global-setup'),

  // Journeys change the seeded data as they go (Alice closes a submission, Dave
  // submits an evaluation...). One worker keeps every run deterministic; each
  // journey sticks to its own seeded users so files don't depend on each other.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,          // the stack uses a self-signed certificate
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'api',      testDir: './tests/api' },
    { name: 'journeys', testDir: './tests/journeys', use: { ...devices['Desktop Chrome'] } },
  ],
})
