const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const outcome = require('../eval/outcome')
const moduleStub = { exports: {} }
let queries = []
const db = {
  enrollment: { findMany: async query => { queries.push(query); return [] } },
  evalAssignment: { findMany: async query => { queries.push(query); return [] } },
}
vm.runInNewContext(fs.readFileSync(__dirname + '/learning-summary.js', 'utf8'), {
  module: moduleStub, require: name => name === '@transcendence/database' ? { prisma: db } : outcome,
})
const { buildLearningSummary, getLearningSummary } = moduleStub.exports
const assignment = { id: 1, name: 'Assignment 1', created_at: '2026-10-01', req_eval: 3, max_score: 100, pass_threshold: 50,
  groups: [{ id: 2, leaderId: 5, submissions: [{ id: 3, status: 'Close' }] }] }
const enrollment = { externalCourseCode: '1421', class: { id: 1, name: 'Course', description: 'Description', term: 'Fall 2026', assignments: [assignment] } }
const pairing = (round, score, id = round) => ({ id, assignmentId: 1, evalueeGroupId: 2, evaluatorUserId: 10 + id,
  submissionId: 3, evalResponseId: score == null ? null : id, round, createdAt: new Date(id * 1000), retryRequested: false,
  status: score == null ? 'Pending' : 'Submitted', evalResponse: score == null ? null : {
    id, subId: 3, userId: 10 + id, givenMarks: score, recordingFileId: 1, reply: 'Answered', isStaffReview: false }
})
for (const [name, scores, status] of [
  ['D: one pass, two pending', [80, null, null], 'InProgress'],
  ['E: answered failure', [80, 20, null], 'Failed'],
  ['G: all passed', [80, 80, 80], 'Passed'],
]) test(name, () => {
  const result = buildLearningSummary([enrollment], scores.map((s,i) => pairing(i+1,s)), [], 5)
  assert.equal(result.courses[0].assignments[0].status, status)
})
test('C/F: feedback gating, rematch waiting, and passed-after-retry reuse current outcomes', () => {
  const failed = pairing(2, 20)
  failed.evalResponse.reply = null
  let a = buildLearningSummary([enrollment], [pairing(1,80), failed], [], 5).courses[0].assignments[0]
  assert.equal(a.status, 'FeedbackRequired')
  failed.evalResponse.reply = 'Answered'; failed.retryRequested = true
  a = buildLearningSummary([enrollment], [pairing(1,80), failed], [], 5).courses[0].assignments[0]
  assert.equal(a.status, 'Failed')
  assert.equal(a.evaluationRounds[1].waitingForRematch, true)
  assert.equal(a.retryAvailable, false)
  a = buildLearningSummary([enrollment], [pairing(1,80), failed, pairing(2,80,4), pairing(3,80)], [], 5).courses[0].assignments[0]
  assert.equal(a.status, 'Passed')
  assert.equal(a.evaluationRounds[1].passedAfterRetry, true)
})
test('H: assignment timestamp and ID ordering, enrollment metadata, contribution counts', () => {
  const other = { ...assignment, id: 2, created_at: '2026-09-01', groups: [] }
  const e = { ...enrollment, class: { ...enrollment.class, assignments: [assignment, other] } }
  const result = buildLearningSummary([e], [], [{assignmentId:1,status:'Submitted'},{assignmentId:1,status:'Pending'},{assignmentId:1,status:'Cancelled'}], 5)
  assert.deepEqual(Array.from(result.courses[0].assignments, a => a.id), [2,1])
  assert.equal(result.courses[0].externalCourseCode, '1421')
  assert.equal(result.courses[0].assignments[1].evaluatorAssigned, 2)
  assert.equal(result.courses[0].assignments[1].evaluatorCompleted, 1)
})
test('query scope is authenticated user and active course enrollment; summary exposes no private feedback or passkeys', async () => {
  queries = []
  await getLearningSummary(5)
  assert.equal(queries.length, 3)
  assert.equal(queries[0].where.userId, 5)
  assert.equal(queries[1].where.evalueeGroup.members.some.userId, 5)
  assert.equal(queries[2].where.evaluatorUserId, 5)
  assert.equal(queries[1].select.evaluatorUser.select.email, true)
  const result = JSON.stringify(buildLearningSummary([enrollment], [pairing(1,80)], [], 5))
  for (const key of ['passKey', 'passkey', 'comment', 'reply', 'email', 'givenMarks']) assert(!result.includes('"'+key+'"'))
})

test('pairing-pending info is round-aware and removes cancelled/failed retry ambiguity', () => {
  const p=pairing(1,null)
  let a=buildLearningSummary([enrollment],[p],[],5).courses[0].assignments[0]
  assert.equal(a.evaluationRounds[0].pairingPending,false)
  assert.equal(a.evaluationRounds[1].pairingPending,true)
  a=buildLearningSummary([enrollment],[{...p,status:'Cancelled'}],[],5).courses[0].assignments[0]
  assert.equal(a.evaluationRounds[0].pairingPending,true)
  const failed={...pairing(1,20),retryRequested:true}
  a=buildLearningSummary([enrollment],[failed],[],5).courses[0].assignments[0]
  assert.equal(a.evaluationRounds[0].waitingForRematch,true)
  a=buildLearningSummary([enrollment],[failed,{...pairing(1,null,4)}],[],5).courses[0].assignments[0]
  assert.equal(a.evaluationRounds[0].waitingForRematch,false)
  assert.equal(a.evaluationRounds[0].pairingPending,false)
})

test('meeting contact follows selected pending attempt, before close and through feedback/retry/rematch', () => {
  const pending = {...pairing(1,null), evaluatorUser:{id:11,username:'original',email:'original@example.com'}}
  const get = (ps, e=enrollment) => buildLearningSummary([e],ps,[],5).courses[0].assignments[0].evaluationRounds[0]
  const open = {...enrollment,class:{...enrollment.class,assignments:[{...assignment,groups:[{id:2,leaderId:5,submissions:[]}]}]}}
  assert.equal(get([{...pending,submissionId:null}],open).meetingEvaluator.email,'original@example.com')
  const failed = {...pairing(1,20),retryRequested:true,evaluatorUser:pending.evaluatorUser}
  failed.evalResponse.reply=null
  assert.equal(get([failed]).meetingEvaluator,null)
  failed.evalResponse.reply='Answered'
  assert.equal(get([failed]).waitingForRematch,true)
  assert.equal(get([failed]).meetingEvaluator,null)
  const replacement={...pairing(1,null,4),evaluatorUser:{id:14,username:'replacement',email:'replacement@example.com'}}
  assert.equal(get([failed,replacement]).meetingEvaluator.email,'replacement@example.com')
  assert.equal(get([{...replacement,status:'Cancelled'}]).meetingEvaluator,null)
  assert.equal(get([{...pending,evalueeGroupId:999}]).meetingEvaluator,null)
  assert.equal(get([pairing(1,80)]).meetingEvaluator,null)
})
