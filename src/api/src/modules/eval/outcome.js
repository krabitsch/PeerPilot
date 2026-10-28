// Peer evaluation outcomes are independent of feedback replies and finalScore.
const evaluationOutcome = (pairing, assignment) => {
  if (pairing.status === 'Cancelled') return 'Cancelled'
  const response = pairing.evalResponse
  if (pairing.status !== 'Submitted' || !response || response.id !== pairing.evalResponseId ||
      response.isStaffReview || response.userId !== pairing.evaluatorUserId ||
      response.subId !== pairing.submissionId) return 'Pending'
  if (!Number.isFinite(response.givenMarks) || !(assignment.max_score > 0)) return 'Pending'
  return (response.coreScore ?? response.givenMarks) / assignment.max_score * 100 >= assignment.pass_threshold ? 'Passed' : 'Failed'
}

const evaluationDisplayOutcome = (pairing, assignment) => {
  const outcome = evaluationOutcome(pairing, assignment)
  return (outcome === 'Passed' || outcome === 'Failed') && (!pairing.evalResponse.reply?.trim() || !pairing.evalResponse.recordingFileId)
    ? 'FeedbackRequired' : outcome
}

const summarizeEvaluationRounds = (assignment, pairings) => {
  const rounds = Array.from({ length: Math.max(0, assignment.req_eval) }, (_, i) => {
    const round = i + 1
    const attempts = pairings.filter(p => p.round === round && p.assignmentId === assignment.id && p.status !== 'Cancelled')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.id - a.id)
    const passed = attempts.find(p => evaluationOutcome(p, assignment) === 'Passed')
    const pending = attempts.find(p => evaluationOutcome(p, assignment) === 'Pending')
    const failed = attempts.find(p => evaluationOutcome(p, assignment) === 'Failed')
    const awaitingReply = attempts.find(p => evaluationDisplayOutcome(p, assignment) === 'FeedbackRequired')
    const current = awaitingReply ?? passed ?? pending ?? failed ?? null
    return {
      round,
      outcome: passed ? 'Passed' : pending ? 'Pending' : failed ? 'Failed' : 'Pending',
      displayOutcome: awaitingReply ? 'FeedbackRequired' : passed ? 'Passed' : pending ? 'Pending' : failed ? 'Failed' : 'Pending',
      evalAssignmentId: current?.id ?? null,
      attemptIds: attempts.map(p => p.id),
      hasUnresolvedFailure: !passed && !!failed,
      waitingForRematch: !awaitingReply && !passed && !pending && !!failed?.retryRequested,
    }
  })
  const passed = rounds.some(r => r.hasUnresolvedFailure) ? false :
    rounds.length > 0 && rounds.every(r => r.outcome === 'Passed') ? true : null
  const workflowStatus = rounds.some(r => r.displayOutcome === 'FeedbackRequired') ? 'FeedbackRequired' :
    passed === false ? 'Failed' : passed === true ? 'Passed' : 'InProgress'
  return { passed: workflowStatus === 'FeedbackRequired' && passed === true ? null : passed, workflowStatus, evaluationRounds: rounds }
}

const responseSelect = { id: true, givenMarks: true, coreScore: true, bonusScore: true, subId: true, userId: true, isStaffReview: true, reply: true, recordingFileId: true }

// Deadline failure overrides only the overall result, never the individual rounds.
const assignmentOutcome = (assignment, pairings, submission, now = Date.now()) => {
  const summary = summarizeEvaluationRounds(assignment, pairings)
  const overdue = key => !!assignment[key] && now > new Date(assignment[key]).getTime()
  const validSubmission = submission?.status === 'Close' && submission.fileId != null
  const deadlineFailure = (overdue('submissionDeadline') && !validSubmission) ||
    (overdue('evaluationDeadline') && summary.evaluationRounds.some(r => r.outcome === 'Pending'))
  return { ...summary, deadlineFailure,
    workflowStatus: deadlineFailure ? 'Failed' : !submission ? 'NotStarted' : submission.status !== 'Close' ? 'InProgress' : summary.workflowStatus,
    passed: deadlineFailure ? false : submission?.status === 'Close' ? summary.passed : null }
}

// Read-time derivation prevents old cached Submission.passed values from leaking
// into either student page after pairing/threshold changes.
const submissionOutcome = async (db, submission, enforceDeadlines = true) => {
  const group = await db.group.findUnique({
    where: { id: submission.groupId },
    include: { assignment: true, evalAssignmentsAsEvaluee: { include: { evalResponse: { select: responseSelect } } } },
  })
  const attempts = group.evalAssignmentsAsEvaluee.filter(p => !p.submissionId || p.submissionId === submission.id)
  const summary = enforceDeadlines ? assignmentOutcome(group.assignment, attempts, submission) :
    {...summarizeEvaluationRounds(group.assignment, attempts), deadlineFailure:false}
  if (!summary.deadlineFailure) summary.workflowStatus = summarizeEvaluationRounds(group.assignment, attempts).workflowStatus
  const scores = await db.evalResponse.findMany({ where: { subId: submission.id }, select: { givenMarks: true } })
  const finalScore = scores.length ? scores.reduce((sum, r) => sum + r.givenMarks, 0) / scores.length : null
  return { ...submission, ...summary, finalScore, passed: summary.deadlineFailure || submission.status === 'Close' ? summary.passed : null }
}

const recomputeSubmissionPassed = async (db, subId) => {
  const submission = await db.submission.findUnique({ where: { id: subId } })
  const result = await submissionOutcome(db, submission, false)
  await db.submission.update({ where: { id: subId }, data: { passed: result.passed, finalScore: result.finalScore } })
  return result
}

module.exports = { assignmentOutcome, evaluationDisplayOutcome, evaluationOutcome, summarizeEvaluationRounds, responseSelect, submissionOutcome, recomputeSubmissionPassed }
