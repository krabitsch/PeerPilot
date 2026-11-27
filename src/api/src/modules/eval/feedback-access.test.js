// §8.1: feedback on a submission is readable only by staff, the evaluated
// group, and (for their own responses) its evaluators. Plus the staff-only
// per-student evaluations view behind the student analytics page (issue 7).
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

// --- per-student evaluations (staff) ---

const assignment = { id: 1, max_score: 100, pass_threshold: 50 }
const section = (name, marks, isBonus = false) => ({ name, marks, isBonus })
const pairing = (id, evalueeGroupId, evaluatorUserId, response, extra = {}) => ({ id, assignmentId: 1, round: 1, status: response ? 'Submitted' : 'Pending',
  createdAt: new Date(2026, 10, id), evalueeGroupId, evaluatorUserId, submissionId: evalueeGroupId * 10, evalResponseId: response?.id ?? null, evalResponse: response, ...extra })
const resp = (id, userId, subId, givenMarks, extra = {}) => ({ id, userId, subId, givenMarks, coreScore: givenMarks, bonusScore: 0, isStaffReview: false,
  comment: `comment ${id}`, reply: `reply ${id}`, recordingFileId: 100 + id,
  scores: [{ sectionId: 1, score: givenMarks - 10, section: section('Content', 60) }, { sectionId: 2, score: 10, section: section('Method', 40) }], ...extra })

function studentHarness({ group = { id: 4, name: 'eve-group' } } = {}) {
  const q = {}
  const all = [
    pairing(1, 4, 7, resp(31, 7, 40, 68)),                       // received by eve's group
    pairing(2, 9, 5, resp(32, 5, 90, 40, { reply: null, recordingFileId: null })),  // given by eve, failed, no reply yet
    pairing(3, 9, 5, null, { round: 2 }),                         // given by eve, pending
    pairing(4, 9, 8, resp(33, 8, 90, 90)),                        // unrelated
  ]
  const db = {
    assignment: { findUnique: async ({ where }) => where.id === 1 ? assignment : null },
    user: { findUnique: async ({ where }) => where.id === 5 ? { id: 5, username: 'eve' } : null },
    group: { findFirst: async () => group },
    evalAssignment: { findMany: async a => { q.pairings = a
      const or = a.where.OR
      return all.filter(p => or.some(c => (c.evalueeGroupId !== undefined && p.evalueeGroupId === c.evalueeGroupId) || (c.evaluatorUserId !== undefined && p.evaluatorUserId === c.evaluatorUserId))) } },
  }
  const exportService = load('../export/service.js', db, { '@transcendence/utils': {} })
  const mod = load('student-evaluations.js', db, { '../export/service': exportService })
  return { mod, q }
}

test('student evaluations: received and given, with grade, sections, comment and reply', async () => {
  const { mod, q } = studentHarness()
  const rows = plain(await mod.getStudentEvaluations('1', '5'))
  assert.deepEqual(plain(q.pairings.where.OR), [{ evalueeGroupId: 4 }, { evaluatorUserId: 5 }])
  assert.deepEqual(rows.map(r => [r.pairingId, r.direction, r.outcome]), [[1, 'received', 'Passed'], [2, 'given', 'Failed'], [3, 'given', 'Pending']])
  assert.deepEqual(rows[0].response, { id: 31, givenMarks: 68, coreScore: 68, bonusScore: 0, comment: 'comment 31', reply: 'reply 31', hasRecording: true,
    scores: [{ sectionId: 1, name: 'Content', score: 58, marks: 60, isBonus: false }, { sectionId: 2, name: 'Method', score: 10, marks: 40, isBonus: false }] })
  assert.equal(rows[1].response.reply, null)
  assert.equal(rows[1].response.hasRecording, false)
  assert.equal(rows[2].response, null)
  assert(!rows.some(r => r.pairingId === 4), 'other students\' evaluations are not included')
})

test('student evaluations: an unallocated student gets only what they gave', async () => {
  const { mod, q } = studentHarness({ group: null })
  const rows = plain(await mod.getStudentEvaluations(1, 5))
  assert.deepEqual(plain(q.pairings.where.OR), [{ evaluatorUserId: 5 }])
  assert(rows.every(r => r.direction === 'given'))
})

test('student evaluations: bad ids are refused, and the route is staff-only', async () => {
  const { mod } = studentHarness()
  await assert.rejects(mod.getStudentEvaluations('x', 5), /Invalid assignment id/)
  await assert.rejects(mod.getStudentEvaluations(2, 5), /Assignment not found/)
  await assert.rejects(mod.getStudentEvaluations(1, 'abc'), /Invalid student id/)
  await assert.rejects(mod.getStudentEvaluations(1, undefined), /Invalid student id/)
  await assert.rejects(mod.getStudentEvaluations(1, 99), /Student not found/)
  const src = fs.readFileSync(`${__dirname}/routes.js`, 'utf8')
  assert.match(src, /route\.get\('\/assignment\/:id\/student\/:userId\/evaluations', requireStaff,/)
})
