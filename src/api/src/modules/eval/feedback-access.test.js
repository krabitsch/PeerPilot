// §8.1: feedback on a submission is readable only by staff, the evaluated
// group, and (for their own responses) its evaluators.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const plain = v => JSON.parse(JSON.stringify(v))   // modules run in a vm context

// Submission 3 belongs to group 2 (members 5, 6). Users 4 and 7 evaluated it.
const responses = [
  { id: 10, subId: 3, userId: 4, comment: 'from 4' },
  { id: 11, subId: 3, userId: 7, comment: 'from 7' },
]
const path = require('node:path')
const load = (file, db, extra = {}) => {
  const module = { exports: {} }
  const dir = path.dirname(path.resolve(__dirname, file))
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, file), 'utf8'), { module, Date, require: name => {
    if (name === '@transcendence/database') return { prisma: db }
    if (name === '@transcendence/errors') return require('../../../../packages/errors')
    if (name === '@transcendence/filemanager') return { createStorage: () => ({ makePublic: async () => {} }), recordingUploader: {} }
    if (name === '@transcendence/logger') return { info() {}, error() {}, warn() {} }
    if (name in extra) return extra[name]
    return require(name.startsWith('.') ? path.resolve(dir, name) : name)
  } })
  return module.exports
}

function feedbackHarness() {
  const queries = []
  const db = {
    submission: { findUnique: async ({ where, select }) => {
      if (where.id !== 3) return null
      const uid = select.group.select.members.where.userId
      return { group: { members: [5, 6].includes(uid) ? [{ userId: uid }] : [] } }
    } },
    evalResponse: {
      count: async ({ where }) => responses.filter(r => r.subId === where.subId && r.userId === where.userId).length,
      findMany: async ({ where }) => { queries.push(where)
        return responses.filter(r => r.subId === where.subId && (where.userId === undefined || r.userId === where.userId)) },
    },
  }
  return { service: load('service.js', db), queries }
}

test('§8.1: staff and the evaluated group read all feedback on a submission', async () => {
  const { service } = feedbackHarness()
  for (const requester of [{ userId: 1, isStaff: true }, { userId: 5 }, { userId: '6' }]) {
    const rows = await service.getEvalResponsesForSubmission(3, requester)
    assert.deepEqual(plain(rows.map(r => r.id)), [10, 11], JSON.stringify(requester))
  }
})

test('§8.1: an evaluator reads only the feedback they wrote', async () => {
  const { service, queries } = feedbackHarness()
  const rows = await service.getEvalResponsesForSubmission(3, { userId: 4 })
  assert.deepEqual(plain(rows.map(r => r.comment)), ['from 4'])
  assert.deepEqual(plain(queries.at(-1)), { subId: 3, userId: 4 })
})

test('§8.1: anyone else is refused, and ids cannot be iterated', async () => {
  const { service, queries } = feedbackHarness()
  await assert.rejects(service.getEvalResponsesForSubmission(3, { userId: 99 }), err => err.statusCode === 403 || err.status === 403 || /cannot access/.test(err.message))
  await assert.rejects(service.getEvalResponsesForSubmission(3, undefined), /cannot access/)
  await assert.rejects(service.getEvalResponsesForSubmission(42, { userId: 5 }), /Submission not found/)
  assert.equal(queries.length, 0, 'no feedback was read for a refused requester')
})

test('§8.1: the route passes the token identity, not the query or body', async () => {
  const src = fs.readFileSync(`${__dirname}/routes.js`, 'utf8')
  const route = src.slice(src.indexOf("route.get('/submission/:subId/responses'"))
  assert.match(route.slice(0, 400), /getEvalResponsesForSubmission\(req\.params\.subId, \{ userId: req\.user\.userId, isStaff: isStaff\(req\) \}\)/)
})
