const { test } = require('node:test')
const assert = require('node:assert/strict')
const { evaluationOutcome, summarizeEvaluationRounds, submissionOutcome } = require('./outcome')
const assignment = { id: 1, req_eval: 3, max_score: 100, pass_threshold: 50 }
const attempt = (round, marks, id = round) => ({
  id, assignmentId: 1, round, createdAt: new Date(id * 1000),
  evaluatorUserId: 10 + id, submissionId: 1, evalResponseId: marks == null ? null : id,
  status: marks == null ? 'Pending' : 'Submitted', retryRequested: false,
  evalResponse: marks == null ? null : { id, givenMarks: marks, subId: 1, userId: 10 + id, isStaffReview: false, recordingFileId: 1, reply: 'Response' },
})
for (const [label, scores, passed] of [
  ['A: pass + pending + pending', [80, null, null], null],
  ['B: pass + pass + pending', [80, 60, null], null],
  ['C: pass + fail + pending', [80, 30, null], false],
  ['D: all three pass', [80, 60, 50], true],
]) test(label, () => assert.equal(summarizeEvaluationRounds(assignment, scores.map((s,i) => attempt(i+1,s))).passed, passed))

test('F: retry waits for rematch without clearing failure or feedback', () => {
  const failed = { ...attempt(2, 30), retryRequested: true }
  const before = structuredClone(failed)
  const result = summarizeEvaluationRounds(assignment, [attempt(1, 80), failed, attempt(3, null)])
  assert.equal(result.passed, false)
  assert.equal(result.evaluationRounds[1].waitingForRematch, true)
  assert.equal(result.evaluationRounds[1].outcome, 'Failed')
  assert.deepEqual(failed, before)
})

test('replacement pending displays pending while unresolved failure keeps assignment failed', () => {
  const result = summarizeEvaluationRounds(assignment, [attempt(1, 80), { ...attempt(2, 30), retryRequested: true }, attempt(2, null, 4), attempt(3, 80)])
  assert.equal(result.passed, false)
  assert.equal(result.evaluationRounds[1].outcome, 'Pending')
  assert.equal(result.evaluationRounds[1].evalAssignmentId, 4)
  assert.equal(result.evaluationRounds[1].waitingForRematch, false)
})

test('successful retry resolves the round; later failures cannot undo that pass', () => {
  const result = summarizeEvaluationRounds(assignment, [attempt(1, 80), attempt(2, 30), attempt(2, 80, 4), attempt(2, 20, 5), attempt(3, 80)])
  assert.equal(result.passed, true)
  assert.equal(result.evaluationRounds[1].evalAssignmentId, 4)
  assert.equal(result.evaluationRounds[1].hasUnresolvedFailure, false)
  assert.equal(result.evaluationRounds[1].attemptIds.length, 3)
})

test('outcomes ignore replies; threshold boundary passes and submitted below threshold fails', () => {
  assert.equal(evaluationOutcome(attempt(1, 50), assignment), 'Passed')
  assert.equal(evaluationOutcome({ ...attempt(1, 49), reply: 'Acknowledged' }, assignment), 'Failed')
})

test('cancelled, staff, mismatched, and unlinked responses do not satisfy rounds', () => {
  const p = attempt(1, 100)
  for (const bad of [
    { ...p, status: 'Cancelled' },
    { ...p, evalResponseId: 99 },
    { ...p, evalResponse: { ...p.evalResponse, userId: 99 } },
    { ...p, evalResponse: { ...p.evalResponse, subId: 99 } },
    { ...p, evalResponse: { ...p.evalResponse, isStaffReview: true } },
  ]) assert.equal(summarizeEvaluationRounds(assignment, [bad, attempt(2, 80), attempt(3, 80)]).passed, null)
})

test('read-time outcomes override premature cached pass without changing finalScore', async () => {
  const db = { evalResponse: { findMany: async () => [{ givenMarks: 80 }] }, group: { findUnique: async () => ({ assignment, evalAssignmentsAsEvaluee: [attempt(1, 80), attempt(2, null), attempt(3, null)] }) } }
  const result = await submissionOutcome(db, { id: 1, groupId: 1, status: 'Close', passed: true, finalScore: 80 })
  assert.equal(result.passed, null)
  assert.equal(result.finalScore, 80)
})

test('no required rounds does not create a vacuous pass', () => {
  assert.equal(summarizeEvaluationRounds({ ...assignment, req_eval: 0 }, []).passed, null)
})

test('several passing attempts in one round cannot substitute for missing required rounds', () => {
  const result = summarizeEvaluationRounds(assignment, [attempt(1, 80), attempt(1, 90, 4), attempt(1, 100, 5)])
  assert.equal(result.passed, null)
  assert.deepEqual(result.evaluationRounds.map(r => r.outcome), ['Passed', 'Pending', 'Pending'])
})

test('unanswered submitted feedback gates display without altering numerical outcomes', () => {
  for (const marks of [80, 20]) {
    const p = attempt(1, marks)
    p.evalResponse.reply = null
    const result = summarizeEvaluationRounds({ ...assignment, req_eval: 1 }, [p])
    assert.equal(result.passed, marks >= 50 ? null : false)
    assert.equal(result.workflowStatus, 'FeedbackRequired')
    assert.equal(result.evaluationRounds[0].displayOutcome, 'FeedbackRequired')
    p.evalResponse.reply = 'Acknowledged'
    const answered = summarizeEvaluationRounds({ ...assignment, req_eval: 1 }, [p])
    assert.equal(answered.passed, marks >= 50)
    assert.equal(answered.workflowStatus, marks >= 50 ? 'Passed' : 'Failed')
  }
})

test('unanswered feedback takes precedence over answered failures, including historical attempts', () => {
  const awaiting = attempt(2, 80)
  awaiting.evalResponse.reply = null
  const result = summarizeEvaluationRounds(assignment, [attempt(1, 20), awaiting, attempt(3, null)])
  assert.equal(result.passed, false)
  assert.equal(result.workflowStatus, 'FeedbackRequired')
})

test('finalScore remains available while passing waits for completed feedback', async () => {
  const p = attempt(1, 80)
  p.evalResponse.reply = null
  const a = { ...assignment, req_eval: 1 }
  const db = {
    group: { findUnique: async () => ({ assignment: a, evalAssignmentsAsEvaluee: [p] }) },
    evalResponse: { findMany: async () => [p.evalResponse] },
  }
  const sub = { id: 1, groupId: 1, status: 'Close', finalScore: null }
  const before = await submissionOutcome(db, sub)
  p.evalResponse.reply = 'Understood'
  const after = await submissionOutcome(db, sub)
  assert.equal(before.finalScore, 80)
  assert.equal(after.finalScore, 80)
  assert.equal(before.passed, null)
  assert.equal(after.passed, true)
  assert.equal(before.workflowStatus, 'FeedbackRequired')
  assert.equal(after.workflowStatus, 'Passed')
})


test('a reply without a recording blocks passing and retry until both are present', () => {
  for (const marks of [80, 20]) {
    const p = attempt(1, marks)
    p.evalResponse.recordingFileId = null
    const a = { ...assignment, req_eval: 1 }
    const waiting = summarizeEvaluationRounds(a, [p])
    assert.equal(waiting.workflowStatus, 'FeedbackRequired')
    assert.equal(waiting.passed, marks >= 50 ? null : false)
    p.evalResponse.recordingFileId = 42
    assert.equal(summarizeEvaluationRounds(a, [p]).workflowStatus, marks >= 50 ? 'Passed' : 'Failed')
  }
})
