// In-memory service checks: never connects to a database or file storage.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const errors = require('../../../../packages/errors')
const outcome = require('./outcome')
const assignment = { id: 1, req_eval: 3, max_score: 100, pass_threshold: 50,
  evalSheet: { sections: [{ id: 1, marks: 100, name: 'Score', sectionType: 'Slider' }] } }

const harness = (marks = 20) => {
  const record = { id: 1, round: 1, assignmentId: 1, evalueeGroupId: 2, evaluatorUserId: 4,
    submissionId: 3, evalResponseId: marks == null ? null : 10, createdAt: new Date(),
    status: marks == null ? 'Pending' : 'Submitted', assignment, passKey: '482913',
    retryRequested: false, retryRequestedAt: null,
    evalResponse: marks == null ? null : { id: 10, subId: 3, userId: 4, givenMarks: marks, comment: 'Old feedback', reply: 'Response submitted' } }
  const responses = record.evalResponse ? [record.evalResponse] : []
  const saved = { id: 3, groupId: 2, status: 'Close', passed: null, finalScore: marks, group: { id: 2, name: 'evaluee-group', assId: 1 }, file: null }
  const db = {
    evalAssignment: {
      findUnique: async () => record,
      updateMany: async ({ where, data }) => {
        if ((where.retryRequested !== undefined && record.retryRequested !== where.retryRequested) ||
            (where.status !== undefined && record.status !== where.status) ||
            (where.evalResponseId !== undefined && record.evalResponseId !== where.evalResponseId)) return { count: 0 }
        Object.assign(record, data); return { count: 1 }
      },
      update: async ({ data }) => {
        Object.assign(record, data)
        record.evalResponse = responses.find(r => r.id === record.evalResponseId)
        return record
      },
    },
    groupMember: { findUnique: async ({ where }) => where.userId_groupId.userId === 5 ? { userId: 5 } : null },
    group: { findUnique: async () => ({ assignment, evalAssignmentsAsEvaluee: [record] }) },
    submission: { findFirst: async () => saved, findUnique: async () => saved, update: async ({ data }) => Object.assign(saved, data) },
    evalResponse: {
      create: async ({ data }) => { const response = { id: 11, ...data }; responses.push(response); return response },
      findUnique: async () => ({ ...responses[0], submission: { group: { leaderId: 5 } } }),
      update: async ({ data }) => Object.assign(responses[0], data),
      updateMany: async ({ data }) => {
        if (responses[0].reply != null) return { count: 0 }
        Object.assign(responses[0], data); return { count: 1 }
      },
      findMany: async () => responses,
    },
    $queryRaw: async () => [],
  }
  db.$transaction = async action => action(db)
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(__dirname + '/service.js', 'utf8'), {
    module, Date, require: name => {
      if (name === '@transcendence/database') return { prisma: db }
      if (name === '@transcendence/errors') return errors
      if (name === '@transcendence/utils') return { getEvalAssignmentById: async () => record, getAssignmentById: async () => assignment }
      if (name === '@transcendence/filemanager') return { createStorage: () => ({}) }
      if (name === './outcome') return outcome
      if (name === 'crypto') return require('node:crypto')
      throw new Error('Unexpected import: ' + name)
    },
  })
  return { service: module.exports, record, responses, saved }
}

test('E/F: member requests retry; repeated requests preserve timestamp and failed response', async () => {
  const h = harness()
  const failedFeedback = structuredClone(h.record.evalResponse)
  await h.service.requestEvaluationRetry(1, 5)
  const requestedAt = h.record.retryRequestedAt
  await h.service.requestEvaluationRetry(1, 5)
  assert.equal(h.record.retryRequested, true)
  assert.equal(h.record.retryRequestedAt, requestedAt)
  assert.deepEqual(h.record.evalResponse, failedFeedback)
  assert.equal(h.responses.length, 1)
})

test('G: passing evaluation cannot request retry', async () => {
  const h = harness(50)
  await assert.rejects(h.service.requestEvaluationRetry(1, 5), /Only a submitted, failed/)
  assert.equal(h.record.retryRequested, false)
})

test('H: pending evaluation cannot request retry', async () => {
  const h = harness(null)
  await assert.rejects(h.service.requestEvaluationRetry(1, 5), /Only a submitted, failed/)
})

test('non-member cannot request retry for another group', async () => {
  const h = harness()
  await assert.rejects(h.service.requestEvaluationRetry(1, 99), /Only a member/)
  assert.equal(h.record.retryRequested, false)
})

test('submission stores one pairing response and updates failure immediately without reply', async () => {
  const h = harness(null)
  await h.service.submitEvaluation({ evalAssignmentId: 1, evaluatorUserId: 4, comment: 'New feedback', scores: [{ sectionId: 1, score: 20 }] })
  assert.equal(h.record.status, 'Submitted')
  assert.equal(h.record.evalResponseId, 11)
  assert.equal(h.saved.passed, false)
  assert.equal(h.responses[0].reply, undefined)
  await assert.rejects(h.service.submitEvaluation({ evalAssignmentId: 1, evaluatorUserId: 4, comment: 'Repeat', scores: [{ sectionId: 1, score: 80 }] }), /already been submitted/)
  assert.equal(h.responses.length, 1)
})

test('feedback reply does not change the numerical outcome or finalScore', async () => {
  const h = harness(20)
  h.saved.passed = false
  h.responses[0].reply = null
  await h.service.replyToEvalResponse(10, { userId: 5, reply: 'Thanks' })
  assert.equal(h.saved.passed, false)
  assert.equal(h.saved.finalScore, 20)
  assert.equal(h.responses[0].reply, 'Thanks')
})

test('retry route uses authenticated user, ignoring a forged body userId', async () => {
  const routes = []
  const router = {}
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    router[method] = (path, ...handlers) => routes.push({ method, path, handlers })
  }
  let actualUser
  vm.runInNewContext(fs.readFileSync(__dirname + '/routes.js', 'utf8'), {
    module: { exports: {} }, require: name => {
      if (name === 'express') return { Router: () => router }
      if (name === './service') return { requestEvaluationRetry: async (id, userId) => { actualUser = userId; return { id } } }
      if (name === '../../middleware/authenticate') return { requireStaff: () => {} }
      throw new Error(name)
    },
  })
  const route = routes.find(r => r.method === 'post' && r.path === '/eval-assignments/:id/retry')
  await route.handlers[0]({ params: { id: 1 }, user: { userId: 5 }, body: { userId: 99, failed: true } }, { json() {} }, err => { throw err })
  assert.equal(actualUser, 5)
})

test('a new pairing does not overwrite earlier feedback by the same evaluator', async () => {
  const h = harness(null)
  const earlier = { id: 10, subId: 3, userId: 4, givenMarks: 20, comment: 'Earlier failed attempt', reply: 'Earlier reply' }
  h.responses.push(earlier)
  await h.service.submitEvaluation({ evalAssignmentId: 1, evaluatorUserId: 4, comment: 'Later attempt', scores: [{ sectionId: 1, score: 80 }] })
  assert.equal(h.responses.length, 2)
  assert.equal(h.responses[0], earlier)
  assert.equal(h.responses[0].comment, 'Earlier failed attempt')
  assert.equal(h.responses[0].givenMarks, 20)
  assert.equal(h.record.evalResponseId, 11)
  assert.equal(h.saved.passed, null) // two other required rounds still missing
})

test('F: selected task rejects the wrong evaluation passkey', async () => {
  const h = harness(null)
  await assert.rejects(h.service.startEvaluation({ evalAssignmentId: 1, evaluatorUserId: 4, passkey: '000000' }), /Invalid evaluation passkey/)
})

test('G: even a correct key cannot start another evaluator\'s pairing', async () => {
  const h = harness(null)
  await assert.rejects(h.service.startEvaluation({ evalAssignmentId: 1, evaluatorUserId: 99, passkey: '482913' }), /not been assigned to you/)
})

test('H/I: selected task starts its intended submission without leader email', async () => {
  const h = harness(null)
  h.record.submissionId = null
  const session = await h.service.startEvaluation({ evalAssignmentId: 1, evaluatorUserId: 4, passkey: '482913' })
  assert.equal(session.evalAssignmentId, 1)
  assert.equal(session.submission.id, 3)
  assert.equal(session.assignment.id, 1)
  assert.equal(h.record.submissionId, 3)
  assert.equal(h.record.passKey, '482913')
})

test('completed and cancelled pairings cannot restart', async () => {
  const h = harness(80)
  await assert.rejects(h.service.startEvaluation({ evalAssignmentId: 1, evaluatorUserId: 4, passkey: '482913' }), /no longer pending/)
  h.record.status = 'Cancelled'
  await assert.rejects(h.service.startEvaluation({ evalAssignmentId: 1, evaluatorUserId: 4, passkey: '482913' }), /no longer pending/)
})

test('A/E: evaluator task query scopes identity and enrollments without passkeys/emails', async () => {
  let taskQuery, courseQuery
  const database = {
    class: { findMany: async query => { courseQuery = query; return [{ id: 1, name: 'Course' }] } },
    evalAssignment: { findMany: async query => { taskQuery = query; return [{ id: 1, evalueeGroup: { members: [{ user: { id: 5, username: 'student42' } }] } }] } },
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(__dirname + '/service.js', 'utf8'), {
    module, require: name => {
      if (name === '@transcendence/database') return { prisma: database }
      if (name === '@transcendence/errors') return errors
      if (name === '@transcendence/utils') return {}
      if (name === '@transcendence/filemanager') return { createStorage: () => ({}) }
      if (name === './outcome') return outcome
      return require(name)
    },
  })
  const result = await module.exports.getMyEvaluatorTasks(4)
  assert.equal(taskQuery.where.evaluatorUserId, 4)
  assert.equal(taskQuery.where.assignment.class.enrollments.some.userId, 4)
  assert.equal(courseQuery.where.enrollments.some.status, 'Active')
  assert.equal(taskQuery.select.evalueeGroup.select.members.select.user.select.username, true)
  assert.equal(JSON.stringify(taskQuery.select).includes('email'), false)
  assert.equal(JSON.stringify(taskQuery.select).includes('passKey'), false)
  assert.equal(result.tasks[0].evalueeGroup.members[0].user.username, 'student42')
})

test('start route ignores forged evaluator identity and obsolete leader email', async () => {
  const routes = [], router = {}
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) router[method] = (path, ...handlers) => routes.push({ method, path, handlers })
  let received
  vm.runInNewContext(fs.readFileSync(__dirname + '/routes.js', 'utf8'), {
    module: { exports: {} }, require: name => {
      if (name === 'express') return { Router: () => router }
      if (name === './service') return { startEvaluation: async data => { received = data; return {} } }
      if (name === '../../middleware/authenticate') return { requireStaff: () => {} }
      throw Error(name)
    },
  })
  await routes.find(r => r.path === '/evaluate/start').handlers[0]({ user: { userId: 4 }, body: { evalAssignmentId: 1, passkey: '482913', evaluatorUserId: 99, leaderEmail: 'obsolete@example.com' } }, { json() {} }, err => { throw err })
  assert.equal(received.evaluatorUserId, 4)
  assert.equal(received.evalAssignmentId, 1)
  assert.equal('leaderEmail' in received, false)
})

test('failed feedback must be answered before retry, with duplicate replies rejected', async () => {
  const h = harness(20)
  h.responses[0].reply = null
  await assert.rejects(h.service.requestEvaluationRetry(1, 5), /answered feedback/)
  await h.service.replyToEvalResponse(10, { userId: 5, reply: 'Understood' })
  assert.equal(h.saved.finalScore, 20)
  await assert.rejects(h.service.replyToEvalResponse(10, { userId: 5, reply: 'Again' }), /already been replied/)
  await h.service.requestEvaluationRetry(1, 5)
  assert.equal(h.record.retryRequested, true)
})
