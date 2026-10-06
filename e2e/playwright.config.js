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

  // `list` prints progress + a summary line as tests run; `html` writes the
  // detailed report (open it with `make e2e-report`); `json` writes a
  // machine-readable result `make e2e-summary` turns into a terminal summary.
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }], ['github']]
    : [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],

  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,          // the stack uses a self-signed certificate
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Set VIDEO=1 (make e2e-video) to record every test to test-results/ and
    // attach them to the HTML report (`make e2e-report`). Off by default — video
    // slows runs and takes disk. Covers the default `page`; the journeys that
    // build their own contexts (freshContext/pageAs) opt in via support/ui.js.
    video: process.env.VIDEO ? 'on' : 'off',
  },

  projects: [
    { name: 'api',      testDir: './tests/api' },
    { name: 'journeys', testDir: './tests/journeys', use: { ...devices['Desktop Chrome'] } },
  ],
})
