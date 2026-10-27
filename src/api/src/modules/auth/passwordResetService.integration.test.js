// Opt-in PostgreSQL verification. Every write is intentionally rolled back;
// mail delivery is stubbed so this test never sends real email.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs'), vm = require('node:vm')
const { createRequire } = require('node:module')

test('PostgreSQL reset retains identity and atomically replaces credentials and revokes refresh tokens', {
  skip: process.env.PASSWORD_RESET_DB_TEST !== '1',
}, async () => {
  const { prisma } = require('@transcendence/database')
  const bcrypt = require('bcrypt')
  const rollback = new Error('intentional rollback')
  try {
    await assert.rejects(prisma.$transaction(async tx => {
      const suffix = crypto.randomUUID().replaceAll('-', '')
      const user = await tx.user.create({ data: {
        email: `reset-${suffix}@example.invalid`, username: `reset${suffix}`,
        userAuth: { create: { provider: 'local', pass_hash: await bcrypt.hash('old password', 4), email_verified: true } },
      } })
      await tx.refreshToken.create({ data: { userId: user.id, tokenHash: suffix, expiresAt: new Date(Date.now() + 60000) } })
      const deliveries = []
      const db = new Proxy(tx, { get: (target, key) => key === '$transaction' ? fn => fn(tx) : target[key] })
      const module = { exports: {} }, localRequire = createRequire(__dirname + '/passwordResetService.js')
      vm.runInNewContext(fs.readFileSync(__dirname + '/passwordResetService.js', 'utf8'), {
        module, URL, Date, process: { env: { PUBLIC_APP_URL: 'http://localhost:4200', BCRYPT_ROUNDS: '4' } },
        require: name => name === '@transcendence/database' ? { prisma: db }
          : name === '../../services/mailService' ? { sendPasswordResetEmail: async mail => deliveries.push(mail) } : localRequire(name),
      })
      const service = module.exports
      await service.requestReset(user.email)
      const first = new URL(deliveries[0].url).searchParams.get('token')
      await service.requestReset(user.email)
      const token = new URL(deliveries[1].url).searchParams.get('token')
      await assert.rejects(service.validateReset(first))
      const before = await tx.userAuth.findUnique({ where: { userId: user.id } })
      assert.equal(before.reset_token_hash, crypto.createHash('sha256').update(token).digest('hex'))
      assert.ok(await bcrypt.compare('old password', before.pass_hash))
      const password = 'Quartz!Canoe7#Lantern$Orbit'
      await service.resetPassword(token, password)
      const after = await tx.userAuth.findUnique({ where: { userId: user.id } })
      assert.equal(after.id, before.id); assert.equal(after.userId, before.userId)
      assert.ok(await bcrypt.compare(password, after.pass_hash))
      assert.equal(await bcrypt.compare('old password', after.pass_hash), false)
      assert.equal(after.reset_token_hash, null); assert.equal(after.reset_token_expiry, null)
      assert.equal(await tx.refreshToken.count({ where: { userId: user.id } }), 0)
      assert.deepEqual(await tx.user.findUnique({ where: { id: user.id } }), user)
      await assert.rejects(service.validateReset(token))
      throw rollback
    }, { timeout: 20000 }), err => err === rollback)
  } finally { await prisma.$disconnect() }
})
