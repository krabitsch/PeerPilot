const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs'), vm = require('node:vm')
const bcrypt = require('bcrypt')
const errors = require('../../../../packages/errors')
const helpers = require('../../services/invitationState')
const strong = 'Quartz!Canoe7#Lantern$Orbit'
const hash = token => crypto.createHash('sha256').update(token).digest('hex')
function harness(env = {}) {
  let state = { users: [{ id: 7, email: 'student@example.com', userAuth: {
    userId: 7, provider: 'local', pass_hash: bcrypt.hashSync('old password', 4), reset_token_hash: null, reset_token_expiry: null,
  } }], refresh: [{ userId: 7 }, { userId: 8 }] }
  const deliveries = [], logs = []
  let failMail = false, failRefresh = false
  const matches = (row, where) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object') {
      if ('gt' in v) return row[k] > v.gt
      if ('not' in v) return row[k] !== v.not
      if ('equals' in v) return row[k].toLowerCase() === v.equals
    }
    return row[k] === v
  })
  const db = {
    user: { findMany: async ({ where }) => structuredClone(state.users.filter(u => matches(u, where))) },
    userAuth: {
      findFirst: async ({ where }) => structuredClone(state.users.map(u => u.userAuth).find(a => matches(a, where)) || null),
      updateMany: async ({ where, data }) => {
        const auth = state.users.map(u => u.userAuth).filter(a => matches(a, where))
        auth.forEach(a => Object.assign(a, data)); return { count: auth.length }
      },
    },
    refreshToken: { deleteMany: async ({ where }) => {
      if (failRefresh) throw Error('DB error')
      state.refresh = state.refresh.filter(r => r.userId !== where.userId)
    } },
  }
  let queue = Promise.resolve()
  db.$transaction = fn => {
    const result = queue.then(async () => {
      const before = structuredClone(state)
      try { return await fn(db) } catch (e) { state = before; throw e }
    })
    queue = result.catch(() => {}); return result
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(__dirname + '/passwordResetService.js', 'utf8'), {
    module, process: { env: { PUBLIC_APP_URL: 'http://localhost:4200', BCRYPT_ROUNDS: '4', ...env } }, Date, URL,
    require: name => {
      if (name === '@transcendence/database') return { prisma: db }
      if (name === 'crypto') return crypto
      if (name === 'bcrypt') return bcrypt
      if (name === '@transcendence/errors') return errors
      if (name === '@transcendence/logger') return { error: (...args) => logs.push(args) }
      if (name === '../../services/invitationState') return helpers
      if (name === './utils') return { validatePasswordStrength: password => ({ isValid: require('zxcvbn')(password).score >= 3, suggestions: [] }) }
      if (name === '../../services/mailService') return { sendPasswordResetEmail: async mail => {
        if (failMail) throw Error('secret SMTP content'); deliveries.push(mail)
      } }
      throw Error(name)
    },
  })
  return { service: module.exports, deliveries, logs, get state() { return state },
    get auth() { return state.users[0].userAuth }, set failMail(v) { failMail = v }, set failRefresh(v) { failRefresh = v },
    token: () => new URL(deliveries.at(-1).url).searchParams.get('token') }
}
test('registered request stores only SHA-256, defaults to 20 minutes and preserves password', async () => {
  const h = harness(), original = h.auth.pass_hash, now = Date.now()
  const result = await h.service.requestReset(' STUDENT@EXAMPLE.COM ')
  assert.equal(result.message, h.service.MESSAGE)
  assert.equal(Buffer.from(h.token(), 'base64url').length, 32)
  assert.equal(h.auth.reset_token_hash, hash(h.token()))
  assert.notEqual(h.auth.reset_token_hash, h.token())
  assert.ok(h.auth.reset_token_expiry >= new Date(now + 20 * 60000))
  assert.equal(h.auth.pass_hash, original)
  assert.ok(await bcrypt.compare('old password', h.auth.pass_hash))
  assert.equal(h.deliveries[0].minutes, 20)
  assert.equal(h.deliveries[0].email, 'student@example.com')
})
test('unknown, pending and OAuth accounts get the same public response without token or email', async () => {
  const h = harness(); const known = await h.service.requestReset('student@example.com')
  for (const mode of ['unknown', 'pending', 'oauth']) {
    const x = harness()
    if (mode === 'pending') x.auth.pass_hash = null
    if (mode === 'oauth') x.auth.provider = 'google'
    assert.equal((await x.service.requestReset(mode === 'unknown' ? 'other@example.com' : 'student@example.com')).message, known.message)
    assert.equal(x.auth.reset_token_hash, null); assert.equal(x.deliveries.length, 0)
  }
})
test('configuration controls expiry; expiry leaves old password unchanged; resend invalidates old link', async () => {
  const h = harness({ PASSWORD_RESET_EXPIRY_MINUTES: '10' })
  await h.service.requestReset('student@example.com'); const first = h.token()
  assert.equal(h.deliveries[0].minutes, 10)
  assert.ok(h.auth.reset_token_expiry <= new Date(Date.now() + 10 * 60000))
  await h.service.requestReset('student@example.com'); const second = h.token()
  assert.notEqual(first, second); await assert.rejects(h.service.validateReset(first))
  assert.equal((await h.service.validateReset(second)).valid, true)
  h.auth.reset_token_expiry = new Date(0)
  await assert.rejects(h.service.validateReset(second)); await assert.rejects(h.service.resetPassword(second, strong))
  assert.ok(await bcrypt.compare('old password', h.auth.pass_hash))
})
test('missing, malformed, unknown tokens and weak passwords cannot reset credentials', async () => {
  const h = harness()
  for (const token of [undefined, '', {}, 'bad', crypto.randomBytes(32).toString('base64url')]) {
    await assert.rejects(h.service.validateReset(token)); await assert.rejects(h.service.resetPassword(token, strong))
  }
  await h.service.requestReset('student@example.com')
  await assert.rejects(h.service.resetPassword(h.token(), 'password'), err => Array.isArray(err.suggestions))
  assert.ok(await bcrypt.compare('old password', h.auth.pass_hash))
  assert.equal((await h.service.validateReset(h.token())).valid, true)
  h.auth.provider = 'google'; await assert.rejects(h.service.validateReset(h.token()))
  h.auth.provider = 'local'; h.auth.pass_hash = null; await assert.rejects(h.service.validateReset(h.token()))
})
test('successful reset preserves identity, replaces password, clears token and revokes only own refresh tokens', async () => {
  const h = harness(); await h.service.requestReset('student@example.com'); const token = h.token()
  await h.service.resetPassword(token, strong)
  assert.equal(h.state.users[0].id, 7); assert.equal(h.auth.userId, 7)
  assert.ok(await bcrypt.compare(strong, h.auth.pass_hash)); assert.equal(await bcrypt.compare('old password', h.auth.pass_hash), false)
  assert.equal(h.auth.reset_token_hash, null); assert.equal(h.auth.reset_token_expiry, null)
  assert.deepEqual(h.state.refresh, [{ userId: 8 }])
  await assert.rejects(h.service.validateReset(token)); await assert.rejects(h.service.resetPassword(token, strong))
})
test('refresh deletion failure rolls back password and token changes', async () => {
  const h = harness(); await h.service.requestReset('student@example.com'); const token = h.token(), before = h.auth.pass_hash
  h.failRefresh = true; await assert.rejects(h.service.resetPassword(token, strong))
  assert.equal(h.auth.pass_hash, before); assert.equal(h.auth.reset_token_hash, hash(token)); assert.equal(h.state.refresh.length, 2)
})
test('concurrent redemptions have only one success', async () => {
  const h = harness(); await h.service.requestReset('student@example.com'); const token = h.token()
  const results = await Promise.allSettled([h.service.resetPassword(token, strong), h.service.resetPassword(token, strong)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
})
test('delivery/configuration failures stay generic and do not change current password', async () => {
  const h = harness(); h.failMail = true
  assert.equal((await h.service.requestReset('student@example.com')).message, h.service.MESSAGE)
  assert.equal(h.auth.reset_token_hash, null); assert.ok(await bcrypt.compare('old password', h.auth.pass_hash))
  assert.equal(JSON.stringify(h.logs).includes('secret'), false)
  const bad = harness({ PUBLIC_APP_URL: '', PASSWORD_RESET_EXPIRY_MINUTES: 'bad' })
  assert.equal((await bad.service.requestReset('student@example.com')).message, bad.service.MESSAGE)
  assert.equal(bad.auth.reset_token_hash, null)
})
