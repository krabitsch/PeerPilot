// Stack-level behaviour that isn't about any one role.
const { test, expect, expectError } = require('../../support/api')
const D = require('../../support/data')

test('the API reports healthy through nginx', async ({ api }) => {
  const res = await (await api('anon')).get('health')
  expect(await res.json()).toEqual({ status: 'ok', service: 'api' })
})

test('login is rate-limited', async ({ api }) => {
  const res = await (await api('anon')).post('auth/login', { data: { email: 'nobody@e2e.test', password: 'x' } })
  // express-rate-limit announces the window on every response it governs.
  expect(Number(res.headers()['ratelimit-limit'])).toBeGreaterThan(0)
  await expectError(res, 401)
})

test('a wrong password is refused', async ({ api }) => {
  const res = await (await api('anon')).post('auth/login', { data: { email: D.users.alice.email, password: 'wrong' } })
  await expectError(res, 401)
})

test('the removed duplicate /user/login and /user/register are gone', async ({ api }) => {
  const admin = await api('admin')
  expect((await admin.post('user/login', { data: {} })).status()).toBe(404)
  expect((await admin.post('user/register', { data: {} })).status()).toBe(404)
})
