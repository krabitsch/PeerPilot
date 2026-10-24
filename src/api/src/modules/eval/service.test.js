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
  const sheetQueries = []
  const record = { id: 1, round: 1, assignmentId: 1, evalueeGroupId: 2, evaluatorUserId: 4, evaluatorUser:{id:4,username:'student4',email:'student4@example.com'},
    submissionId: 3, evalResponseId: marks == null ? null : 10, createdAt: new Date(),
    status: marks == null ? 'Pending' : 'Submitted', assignment, passKey: '482913',
    retryRequested: false, retryRequestedAt: null,
    evalResponse: marks == null ? null : { id: 10, subId: 3, userId: 4, givenMarks: marks, comment: 'Old feedback', recordingFileId: 1, reply: 'Response submitted' } }
  const responses = record.evalResponse ? [record.evalResponse] : []
  const saved = { id: 3, groupId: 2, status: 'Close', passed: null, finalScore: marks, group: { id: 2, name: 'evaluee-group', assId: 1 }, file: null }
  const files = []
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
    assignment: { findUnique: async () => assignment },
    group: { findMany: async ({where}) => where.members.some.userId === 5 ? [{id:2,submissions:saved.status ? [{status:saved.status}] : []}] : [], findUnique: async () => ({ assignment, evalAssignmentsAsEvaluee: [record] }) },
    submission: { findFirst: async () => saved, findUnique: async () => saved, update: async ({ data }) => Object.assign(saved, data) },
    evalResponse: {
      create: async ({ data }) => { const response = { id: 11, ...data }; responses.push(response); return response },
      findUnique: async () => ({ ...responses[0], submission: { group: { leaderId: 5 } } }),
      update: async ({ data }) => Object.assign(responses[0], data),
      updateMany: async ({ where, data }) => {
        if (responses[0].reply !== where.reply || responses[0].recordingFileId !== where.recordingFileId) return { count: 0 }
        Object.assign(responses[0], data); return { count: 1 }
      },
      findMany: async () => responses,
    },
    file: { create: async ({ data }) => { const file = { id: 42, ...data }; files.push(file); return file } },
    $queryRaw: async () => [],
  }
  db.$transaction = async action => action(db)
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(__dirname + '/service.js', 'utf8'), {
    module, Date, require: name => {
      if (name === '@transcendence/database') return { prisma: db }
      if (name === '@transcendence/errors') return errors
      if (name === '@transcendence/utils') return { getEvalAssignments: async () => [record], getEvalAssignmentById: async () => record, getAssignmentById: async (id, select, include) => { sheetQueries.push(include); return assignment }, getEvalSheetById: async (id, select, include) => { sheetQueries.push(include); return assignment.evalSheet } }
      if (name === '@transcendence/filemanager') return { recordingUploader: { single: () => () => {} }, createStorage: () => ({ ensureBucket: async () => {}, upload: async () => {}, getPublicUrl: key => key }) }
      if (name === '@transcendence/logger') return { error() {} }
      if (name === '../submission/files') return require('../submission/files')
      if (name === './outcome') return outcome
      if (name === 'crypto') return require('node:crypto')
      throw new Error('Unexpected import: ' + name)
    },
  })
  return { service: module.exports, record, responses, saved, files, sheetQueries }
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
  await h.service.submitEvaluation({ evalAssignmentId: 1, evaluatorUserId: 4, comment: 'New feedback'.repeat(20), scores: [{ sectionId: 1, score: 20 }] })
  assert.equal(h.record.status, 'Submitted')
  assert.equal(h.record.evalResponseId, 11)
  assert.equal(h.saved.passed, false)
  assert.equal(h.responses[0].reply, undefined)
  await assert.rejects(h.service.submitEvaluation({ evalAssignmentId: 1, evaluatorUserId: 4, comment: 'Repeat'.repeat(20), scores: [{ sectionId: 1, score: 80 }] }), /already been submitted/)
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
      if (name === '@transcendence/filemanager') return { recordingUploader: { single: () => () => {} } }
      if (name === 'express') return { Router: () => router }
      if (name === './pairing-management' || name === '../participation/service') return {}
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
  await h.service.submitEvaluation({ evalAssignmentId: 1, evaluatorUserId: 4, comment: 'Later attempt'.repeat(20), scores: [{ sectionId: 1, score: 80 }] })
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

test('A/E: evaluator task query scopes identity and enrollments with scoped contact emails and no passkeys', async () => {
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
      if (name === '@transcendence/filemanager') return { recordingUploader: { single: () => () => {} }, createStorage: () => ({ ensureBucket: async () => {}, upload: async () => {}, getPublicUrl: key => key }) }
      if (name === '@transcendence/logger') return { error() {} }
      if (name === '../submission/files') return require('../submission/files')
      if (name === './outcome') return outcome
      return require(name)
    },
  })
  const result = await module.exports.getMyEvaluatorTasks(4)
  assert.equal(taskQuery.where.evaluatorUserId, 4)
  assert.equal(taskQuery.where.assignment.class.enrollments.some.userId, 4)
  assert.equal(courseQuery.where.enrollments.some.status, 'Active')
  assert.equal(taskQuery.select.evalueeGroup.select.members.select.user.select.username, true)
  assert.equal(taskQuery.select.evalueeGroup.select.members.select.user.select.email, true)
  assert.equal(JSON.stringify(taskQuery.select).includes('passKey'), false)
  assert.equal(result.tasks[0].evalueeGroup.members[0].user.username, 'student42')
  await module.exports.getMyEvaluatorTasks(4,'Bocal')
  assert.equal(courseQuery.where.OR[1].assignments.some.evalAssignments.some.evaluatorUserId,4)
  assert.equal(taskQuery.where.evaluatorUserId,4)
})

test('start route ignores forged evaluator identity and obsolete leader email', async () => {
  const routes = [], router = {}
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) router[method] = (path, ...handlers) => routes.push({ method, path, handlers })
  let received
  vm.runInNewContext(fs.readFileSync(__dirname + '/routes.js', 'utf8'), {
    module: { exports: {} }, require: name => {
      if (name === '@transcendence/filemanager') return { recordingUploader: { single: () => () => {} } }
      if (name === 'express') return { Router: () => router }
      if (name === './pairing-management' || name === '../participation/service') return {}
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


const recording = { buffer: Buffer.from('audio'), originalname: 'evaluation.webm', mimetype: 'audio/webm', size: 5 }
test('evaluee must attach recording to feedback and uploader identity is the evaluee', async () => {
  const h = harness(20)
  h.responses[0].reply = null
  h.responses[0].recordingFileId = null
  await assert.rejects(h.service.replyToEvalResponse(10, { userId: 5, reply: 'Understood' }), /Upload the evaluation recording/)
  await assert.rejects(h.service.replyToEvalResponse(10, { userId: 4, reply: 'Understood', recording }), /Only the group leader/)
  // File creation uses the authenticated evaluee, never the original evaluator.
  const updated = await h.service.replyToEvalResponse(10, { userId: 5, reply: 'Understood', recording })
  assert.equal(updated.recordingFileId, 42)
  assert.equal(h.files[0].uploadedBy, 5)
  assert.equal(updated.reply, 'Understood')
  await h.service.requestEvaluationRetry(1, 5)
  assert.equal(h.record.retryRequested, true)
})

test('historical reply missing recording can be completed without discarding feedback', async () => {
  const h = harness(20)
  h.responses[0].recordingFileId = null
  await assert.rejects(h.service.requestEvaluationRetry(1, 5), /answered feedback/)
  await h.service.replyToEvalResponse(10, { userId: 5, reply: 'Response submitted', recording })
  assert.equal(h.responses[0].recordingFileId, 42)
  assert.equal(h.responses[0].comment, 'Old feedback')
})

for (const read of ['list', 'single']) {
  test(`${read} pairing reads protect passkeys until close and preserve staff access`, async () => {
    const h = harness(null)
    const get = async viewer => read === 'list'
      ? (await h.service.getEvalAssignments(1, viewer))[0]
      : h.service.getEvalAssignmentById(1, viewer)
    const student = {userId:5, isStaff:false}
    h.saved.status = null // No closed submission exists.
    assert.equal((await get(student)).passKey, null)
    h.saved.status = 'Open'
    assert.equal((await get(student)).passKey, null)
    assert.equal((await get({userId:4, isStaff:false})).passKey, null)
    assert.equal((await get({userId:7, isStaff:true})).passKey, '482913')
    h.saved.status = 'Close'
    assert.equal((await get(student)).passKey, '482913')
    assert.equal((await get({userId:4, isStaff:false})).passKey, null)
    assert.equal(h.record.passKey, '482913')
  })
}

for (const text of [' '.repeat(200), 'a'.repeat(99), ' '+ 'a'.repeat(99)+' ']) {
  test('rejects feedback under 100 trimmed characters', async () => {
    const h = harness(null)
    await assert.rejects(h.service.submitEvaluation({evalAssignmentId:1,evaluatorUserId:4,comment:text,scores:[{sectionId:1,score:60}]}), /at least 100 characters/)
    assert.equal(h.responses.length, 0)
  })
}
test('accepts 100 trimmed characters of evaluator feedback', async () => {
  const h = harness(null)
  await h.service.submitEvaluation({evalAssignmentId:1,evaluatorUserId:4,comment:'  '+ 'a'.repeat(100)+'  ',scores:[{sectionId:1,score:60}]})
  assert.equal(h.responses[0].comment.length,100)
})
test('contact emails are visible only to the paired evaluee group and staff', async () => {
  const h = harness(null)
  h.saved.status = 'Open'
  assert.equal((await h.service.getEvalAssignments(1,{userId:5}))[0].evaluatorUser.email, 'student4@example.com')
  assert.equal((await h.service.getEvalAssignments(1,{userId:99}))[0].evaluatorUser.email, undefined)
  assert.equal((await h.service.getEvalAssignmentById(1,{userId:99})).evaluatorUser.email, undefined)
  assert.equal((await h.service.getEvalAssignments(1,{userId:7,isStaff:true}))[0].evaluatorUser.email, 'student4@example.com')
})
test('replacement evaluator receives the newest revised file and original history', async () => {
  const h = harness(null)
  h.record.submissionId = null
  h.saved.file = {id:1,name:'original.pdf',url:'original.pdf'}
  h.saved.fileVersions = [{id:1,file:{id:2,name:'revised.pdf',url:'revised.pdf'}}]
  const result = await h.service.startEvaluation({evalAssignmentId:1,evaluatorUserId:4,passkey:'482913'})
  assert.equal(result.submission.file.id,2)
  assert.equal(result.submission.files[0].id,1)
  assert.equal(h.record.passKey,'482913')
})

test('submission stores core and bonus separately and permits displayed totals above maximum',async()=>{
 const h=harness(null)
 const original=assignment.evalSheet.sections
 assignment.evalSheet.sections=[{id:1,marks:100,name:'Core',sectionType:'Slider',isBonus:false},
   {id:2,marks:15,name:'Bonus',sectionType:'Slider',isBonus:true}]
 try {
  const result=await h.service.submitEvaluation({evalAssignmentId:1,evaluatorUserId:4,comment:'Constructive feedback. '.repeat(6),scores:[{sectionId:1,score:93},{sectionId:2,score:15}]})
  assert.equal(result.coreScore,93);assert.equal(result.bonusScore,15);assert.equal(result.givenMarks,108)
  assert.equal(h.saved.finalScore,108)
 } finally {assignment.evalSheet.sections=original}
})

test('both eval-sheet read APIs request authoritative ordering rather than creation order',async()=>{
 const h=harness()
 await h.service.getEvalSheetById(1)
 await h.service.getEvalSheetByAssId(1)
 const expected=[{sortOrder:'asc'},{id:'asc'}]
 assert.deepEqual(JSON.parse(JSON.stringify(h.sheetQueries[0].sections.orderBy)),expected)
 assert.deepEqual(JSON.parse(JSON.stringify(h.sheetQueries[1].evalSheet.include.sections.orderBy)),expected)
})
