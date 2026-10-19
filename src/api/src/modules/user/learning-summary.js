const { prisma } = require('@transcendence/database')
const { summarizeEvaluationRounds, evaluationOutcome, responseSelect } = require('../eval/outcome')

const buildLearningSummary = (enrollments, pairings, evaluatorTasks, userId) => ({
  courses: enrollments.map(enrollment => {
    const course = enrollment.class
    const assignments = [...course.assignments].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id)
      .map(assignment => {
        const group = assignment.groups[0]
        const submission = group?.submissions[0]
        const attempts = pairings.filter(p => p.assignmentId === assignment.id && p.evalueeGroupId === group?.id &&
          (!p.submissionId || p.submissionId === submission?.id))
        const summary = summarizeEvaluationRounds(assignment, attempts)
        const rounds = summary.evaluationRounds.map(round => {
          const current = attempts.find(p => p.id === round.evalAssignmentId)
          const passedAfterRetry = round.displayOutcome === 'Passed' && attempts.some(p => p.round === round.round &&
            evaluationOutcome(p, assignment) === 'Failed' &&
            (new Date(p.createdAt) < new Date(current.createdAt) ||
              (+new Date(p.createdAt) === +new Date(current.createdAt) && p.id < current.id)))
          return { round: round.round, displayOutcome: round.displayOutcome,
            waitingForRematch: round.waitingForRematch, pairingPending: round.attemptIds.length === 0, passedAfterRetry,
            // Same contact policy as Assignment Detail: only the caller's evaluee group.
            meetingEvaluator: current?.status === 'Pending' && round.displayOutcome === 'Pending' && !round.waitingForRematch
              ? current.evaluatorUser ?? null : null }
        })
        const tasks = evaluatorTasks.filter(t => t.assignmentId === assignment.id && t.status !== 'Cancelled')
        const status = !submission ? 'NotStarted' : submission.status !== 'Close' ? 'InProgress' : summary.workflowStatus
        return {
          id: assignment.id, name: assignment.name, created_at: assignment.created_at,
          status, groupAssigned: !!group, canReply: group?.leaderId === userId,
          submissionState: !submission ? 'NotSubmitted' : submission.status === 'Close' ? 'Submitted' : 'Open',
          completed: submission?.status === 'Close' && rounds.length > 0 && rounds.every(r =>
            ['Passed', 'Failed'].includes(r.displayOutcome) && !r.waitingForRematch),
          retryAvailable: summary.evaluationRounds.some(r => r.displayOutcome === 'Failed' &&
            !attempts.find(p => p.id === r.evalAssignmentId)?.retryRequested),
          evaluationRounds: rounds,
          evaluatorAssigned: tasks.length,
          evaluatorCompleted: tasks.filter(t => t.status === 'Submitted').length,
          evaluatorPending: tasks.filter(t => t.status === 'Pending').length,
        }
      })
    return { id: course.id, name: course.name, description: course.description, term: course.term,
      externalCourseCode: enrollment.externalCourseCode, assignments }
  }).sort((a, b) => a.id - b.id),
})

const getLearningSummary = async userId => {
  const scope = { class: { enrollments: { some: { userId, status: 'Active' } } } }
  const [enrollments, pairings, evaluatorTasks] = await Promise.all([
    prisma.enrollment.findMany({
      where: { userId, status: 'Active' },
      select: { externalCourseCode: true, class: { select: {
        id: true, name: true, description: true, term: true,
        assignments: { orderBy: [{ created_at: 'asc' }, { id: 'asc' }], select: {
          id: true, name: true, created_at: true, req_eval: true, max_score: true, pass_threshold: true,
          groups: { where: { members: { some: { userId } } }, select: {
            id: true, leaderId: true, submissions: { select: { id: true, status: true }, orderBy: { createdAt: 'desc' } }
          } }
        } }
      } } }
    }),
    prisma.evalAssignment.findMany({
      where: { evalueeGroup: { members: { some: { userId } } }, assignment: scope },
      select: { id: true, assignmentId: true, evalueeGroupId: true, evaluatorUserId: true,
        submissionId: true, evalResponseId: true, round: true, status: true, createdAt: true, retryRequested: true,
        evaluatorUser: { select: { id: true, username: true, email: true } },
        evalResponse: { select: responseSelect } }
    }),
    prisma.evalAssignment.findMany({
      where: { evaluatorUserId: userId, assignment: scope }, select: { assignmentId: true, status: true }
    }),
  ])
  return buildLearningSummary(enrollments, pairings, evaluatorTasks, userId)
}
module.exports = { getLearningSummary, buildLearningSummary }
