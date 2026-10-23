const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const errors = require('../../../../packages/errors')

function loadService({ taken = false, race = false } = {}) {
  const writes = []
  const tx = {
    user: {
      findUnique: async ({ where }) => where.username ? (taken ? { id: 2 } : null) : { username: 'original' },
      update: async args => { if (race) throw { code: 'P2002' }; writes.push(args) },
    },
    userProfile: { upsert: async args => { writes.push(args); return { bio: args.update.bio ?? 'Existing bio', avatar: 'avatar.png' } } },
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(__dirname + '/service.js', 'utf8'), {
    module, require: name => {
      if (name === '@transcendence/database') return { prisma: { $transaction: fn => fn(tx) } }
      if (name === '@transcendence/errors') return errors
      if (name === '@transcendence/filemanager') return { createStorage: () => ({ ensureBucket: async () => {}, makePublic: async () => {} }) }
      return {}
    },
  })
  return { update: module.exports.updateProfile, writes }
}

test('rename trims username, updates only username by existing ID, and preserves profile fields', async () => {
  const { update, writes } = loadService()
  const result = await update(7, 'New bio', '  new name  ')
  assert.equal(result.username, 'new name')
  assert.equal(result.bio, 'New bio')
  assert.equal(result.avatar, 'avatar.png')
  assert.equal(writes[0].where.id, 7)
  assert.deepEqual(Object.keys(writes[0].data), ['username'])
  assert.equal(writes[1].where.userId, 7)
})
test('unchanged username avoids account update; omitted bio remains unchanged', async () => {
  const { update, writes } = loadService()
  const result = await update(7, undefined, ' original ')
  assert.equal(result.bio, 'Existing bio')
  assert.equal(writes.length, 1)
  assert(!Object.hasOwn(writes[0].update, 'bio'))
})
test('empty and non-string usernames are rejected before writing', async () => {
  const { update, writes } = loadService()
  for (const username of ['', '  ', null, 123]) {
    await assert.rejects(update(7, undefined, username), { status: 400 })
  }
  assert.equal(writes.length, 0)
})
test('duplicate username returns friendly conflict without writing', async () => {
  const { update, writes } = loadService({ taken: true })
  await assert.rejects(update(7, 'New bio', 'taken'), { status: 409, message: 'This username is already taken.' })
  assert.equal(writes.length, 0)
})
test('concurrent unique conflict is translated to friendly conflict', async () => {
  await assert.rejects(loadService({ race: true }).update(7, undefined, 'taken'), {
    status: 409, message: 'This username is already taken.',
  })
})
test('profile route prevents renaming another user for every role and ignores email/role input', async () => {
  let handler
  const calls = []
  const router = { get() {}, post() {}, delete() {}, patch(path, guard, fn) { handler = fn } }
  vm.runInNewContext(fs.readFileSync(__dirname + '/routes.js', 'utf8'), {
    module: { exports: {} }, require: name => {
      if (name === 'express') return { Router: () => router }
      if (name === './service') return { updateProfile: async (...args) => { calls.push(args); return {} } }
      if (name === '@transcendence/errors') return errors
      if (name === '@transcendence/filemanager') return { uploader: { single: () => () => {} } }
      return { requireStaff() {}, requireRole: () => () => {}, requireSelfOrStaff: () => () => {} }
    },
  })
  for (const role of ['Student', 'Bocal', 'Admin']) {
    let error
    await handler({ params: { id: '8' }, user: { userId: 7, role }, body: { username: 'other' } }, {}, err => { error = err })
    assert.equal(error.status, 403)
    await handler({ params: { id: '7' }, user: { userId: 7, role }, body: { username: 'self', bio: 'bio', email: 'changed', role: 'Admin', userId: 8 } }, { json() {} }, err => { throw err })
    assert.deepEqual(calls.at(-1), ['7', 'bio', 'self'])
  }
})
