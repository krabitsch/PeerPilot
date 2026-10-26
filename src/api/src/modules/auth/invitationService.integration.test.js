// Opt-in: runs against the configured development DB; all writes roll back.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const vm = require('node:vm')
const { createRequire } = require('node:module')

test('real PostgreSQL redemption creates credentials and preserves existing pending relationships', {
  skip: process.env.INVITATION_DB_TEST !== '1',
}, async () => {
  require('dotenv').config({ path: __dirname + '/../../../../.env', quiet: true })
  const { prisma } = require('@transcendence/database')
  const rollback = new Error('intentional test rollback')
  const loadService = db => {
    const module = { exports: {} }
    const localRequire = createRequire(__dirname + '/invitationService.js')
    vm.runInNewContext(fs.readFileSync(__dirname + '/invitationService.js', 'utf8'), {
      module, process, URL, Date, require: name => name === '@transcendence/database'
        ? { prisma: db } : localRequire(name),
    })
    return module.exports
  }
  const relationships = async (db, userId) => ({
    user: await db.user.findUnique({ where: { id: userId }, select: { id: true, username: true, email: true, orgId: true } }),
    enrollments: await db.enrollment.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    groups: await db.groupMember.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    pairings: await db.evalAssignment.findMany({ where: { evaluatorUserId: userId }, orderBy: { id: 'asc' } }),
  })
  try {
    const pending = await prisma.user.findFirst({ where: { userAuth: { provider: 'local', pass_hash: null } } })
    assert.ok(pending, 'A pending roster account is needed for this opt-in verification')
    const before = await relationships(prisma, pending.id)
    for (const existing of [null, pending]) {
      await assert.rejects(prisma.$transaction(async tx => {
        const raw = crypto.randomBytes(32).toString('base64url')
        const email = existing?.email || `invitation-check-${crypto.randomUUID()}@example.invalid`
        const entry = await tx.authAllowedEmail.upsert({ where: { email },
          create: { email, orgId: existing?.orgId ?? null }, update: {},
        })
        await tx.authAllowedEmail.update({ where: { id: entry.id }, data: {
          used: false, invite_token_hash: crypto.createHash('sha256').update(raw).digest('hex'),
          invite_token_expiry: new Date(Date.now() + 60000),
        } })
        const service = loadService(new Proxy(tx, { get: (target, key) => key === '$transaction' ? fn => fn(tx) : target[key] }))
        const result = await service.redeemInvitation(raw, 'Quartz!Canoe7#Lantern$Orbit')
        const auth = await tx.userAuth.findUnique({ where: { userId: result.id } })
        assert.ok(await require('bcrypt').compare('Quartz!Canoe7#Lantern$Orbit', auth.pass_hash))
        const consumed = await tx.authAllowedEmail.findUnique({ where: { id: entry.id } })
        assert.equal(consumed.used, true)
        assert.equal(consumed.invite_token_hash, null)
        assert.equal(consumed.invite_token_expiry, null)
        await assert.rejects(service.validateInvitation(raw))
        if (existing) {
          assert.equal(result.id, pending.id)
          assert.deepEqual(await relationships(tx, pending.id), before)
        }
        throw rollback
      }, { timeout: 20000 }), err => err === rollback)
    }
    assert.deepEqual(await relationships(prisma, pending.id), before)
    assert.equal((await prisma.userAuth.findUnique({ where: { userId: pending.id } })).pass_hash, null)
  } finally { await prisma.$disconnect() }
})
