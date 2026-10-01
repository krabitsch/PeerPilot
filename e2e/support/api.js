// Helpers for talking to the API directly, as a given role.
const { test: base, expect, request } = require('@playwright/test')
const { BASE_URL } = require('./env')
const { tokenFor } = require('./sessions')

// `api('alice')` is a request context authenticated as Alice; `api('anon')`
// sends no token. Contexts are created on first use and disposed after the test.
const test = base.extend({
  api: async ({}, use) => {
    const contexts = {}
    await use(async (role) => (contexts[role] ??= await request.newContext({
      baseURL: `${BASE_URL}/api/`,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: role === 'anon' ? {} : { Authorization: `Bearer ${tokenFor(role)}` },
    })))
    for (const ctx of Object.values(contexts)) await ctx.dispose()
  },
})

// The API reports failures as `{ ok: false, error, code }`. Today it sends them
// with HTTP 200; the last Phase 2 item switches to real status codes. Accepting
// either keeps the suite green across that change — tighten it afterwards.
const expectError = async (res, code) => {
  const body = await res.json()
  expect(body, `expected an error with code ${code}`).toMatchObject({ ok: false, code })
  expect([200, code], `HTTP status for a ${code} error`).toContain(res.status())
  return body
}

const expectOk = async (res) => {
  const body = await res.json()
  expect(body?.ok, `expected success, got ${JSON.stringify(body).slice(0, 200)}`).not.toBe(false)
  expect(res.status()).toBeLessThan(300)
  return body
}

module.exports = { test, expect, expectError, expectOk }
