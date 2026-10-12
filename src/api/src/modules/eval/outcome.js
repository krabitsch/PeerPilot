// Peer evaluation outcomes are independent of feedback replies and finalScore.
const evaluationOutcome = (pairing, assignment) => {
  if (pairing.status === 'Cancelled') return 'Cancelled'
  const response = pairing.evalResponse
  if (pairing.status !== 'Submitted' || !response || response.id !== pairing.evalResponseId ||
      response.isStaffReview || response.userId !== pairing.evaluatorUserId ||
      response.subId !== pairing.submissionId) return 'Pending'
  if (!Number.isFinite(response.givenMarks) || !(assignment.max_score > 0)) return 'Pending'
  return response.givenMarks / assignment.max_score * 100 >= assignment.pass_threshold ? 'Passed' : 'Failed'
}

const summarizeEvaluationRounds = (assignment, pairings) => {
  const rounds = Array.from({ length: Math.max(0, assignment.req_eval) }, (_, i) => {
    const round = i + 1
    const attempts = pairings.filter(p => p.round === round && p.assignmentId === assignment.id && p.status !== 'Cancelled')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.id - a.id)
    const passed = attempts.find(p => evaluationOutcome(p, assignment) === 'Passed')
    const pending = attempts.find(p => evaluationOutcome(p, assignment) === 'Pending')
    const failed = attempts.find(p => evaluationOutcome(p, assignment) === 'Failed')
    const current = passed ?? pending ?? failed ?? null
    return {
      round,
      outcome: passed ? 'Passed' : pending ? 'Pending' : failed ? 'Failed' : 'Pending',
      evalAssignmentId: current?.id ?? null,
      attemptIds: attempts.map(p => p.id),
      hasUnresolvedFailure: !passed && !!failed,
      waitingForRematch: !passed && !pending && !!failed?.retryRequested,
    }
  })
  const passed = rounds.some(r => r.hasUnresolvedFailure) ? false :
    rounds.length > 0 && rounds.every(r => r.outcome === 'Passed') ? true : null
  return { passed, evaluationRounds: rounds }
}

const responseSelect = { id: true, givenMarks: true, subId: true, userId: true, isStaffReview: true }

// Read-time derivation prevents old cached Submission.passed values from leaking
// into either student page after pairing/threshold changes.
const submissionOutcome = async (db, submission) => {
  const group = await db.group.findUnique({
    where: { id: submission.groupId },
    include: { assignment: true, evalAssignmentsAsEvaluee: { include: { evalResponse: { select: responseSelect } } } },
  })
  const summary = summarizeEvaluationRounds(group.assignment,
    group.evalAssignmentsAsEvaluee.filter(p => !p.submissionId || p.submissionId === submission.id))
  return { ...submission, ...summary, passed: submission.status === 'Close' ? summary.passed : null }
}

const recomputeSubmissionPassed = async (db, subId) => {
  const submission = await db.submission.findUnique({ where: { id: subId } })
  const result = await submissionOutcome(db, submission)
  await db.submission.update({ where: { id: subId }, data: { passed: result.passed } })
  return result
}

module.exports = { evaluationOutcome, summarizeEvaluationRounds, responseSelect, submissionOutcome, recomputeSubmissionPassed }
