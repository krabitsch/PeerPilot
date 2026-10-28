const { prisma } = require('@transcendence/database')
const { summarizeEvaluationRounds, responseSelect } = require('../eval/outcome')

const buildStaffDashboard = courses => {
  const actions = []
  for (const course of courses) {
    const active = course.enrollments.map(e => e.user)
    const staff = (course.org?.users ?? []).filter(u => !u.enrollments?.some(e=>e.classId===course.id&&e.status==='Dropped'))
    for (const assignment of course.assignments) {
      const roster = new Map([...active,...staff].map(u=>[u.id,u]))
      const overrides = new Map((assignment.participations ?? []).map(p=>[p.userId,p]))
      const students = new Set([...roster.values()].filter(u=>overrides.get(u.id)?.evalueeEligible ??
        (u.role === 'Student' || (!u.role && active.some(p=>p.id===u.id)))).map(u=>u.id))
      const base = { courseId: course.id, courseName: course.name, assignmentId: assignment.id,
        assignmentName: assignment.name, occurredAt: assignment.created_at }
      const add = (kind, label, route, queryParams, extra = {}) => actions.push({
        ...base, id: `${kind}:${assignment.id}`, kind, label, route, queryParams, ...extra,
      })
      if (!assignment.description?.trim() && !assignment.fileId)
        add('instructions', `Provide assignment instructions for ${assignment.name} (description or file).`, '/bocal/assignment-create', { assId: assignment.id })
      const sections = assignment.evalSheet?.sections ?? []
      if (!assignment.evalSheet)
        add('sheet', `Create the evaluation sheet for ${assignment.name}.`, '/bocal/assignment-create', { assId: assignment.id })
      else if (!sections.length)
        add('sheet', `Finish the evaluation sheet for ${assignment.name}: add evaluation sections.`, '/bocal/assignment-create', { assId: assignment.id })
      else if (sections.filter(s=>!s.isBonus).reduce((n, s) => n + s.marks, 0) !== assignment.max_score)
        add('sheet', `Finish the evaluation sheet for ${assignment.name}: section marks do not total ${assignment.max_score}.`, '/bocal/assignment-create', { assId: assignment.id })
      const grouped = new Set(assignment.groups.flatMap(g => g.members.map(m => m.user.id)))
      const missingStudents = [...students].filter(id => !grouped.has(id)).length
      if (missingStudents)
        add('groups', `${assignment.name} needs groups for ${missingStudents} unassigned ${missingStudents === 1 ? 'student' : 'students'}.`,
          '/bocal/classes', { classId: course.id, groupAssignmentId: assignment.id })
      // Dropped students stay in groups that have history; only the current roster counts.
      const eligible = assignment.groups.filter(g => {
        const current = g.members.filter(m => roster.has(m.user.id))
        return current.length && current.every(m => students.has(m.user.id))
      })
      let missingRounds = 0
      for (const group of eligible) {
        const pairings = assignment.evalAssignments.filter(p => p.evalueeGroupId === group.id)
        const summary = summarizeEvaluationRounds(assignment, pairings)
        missingRounds += summary.evaluationRounds.filter(r => !r.attemptIds.length).length
        for (const round of summary.evaluationRounds.filter(r => r.waitingForRematch)) {
          const pairing = pairings.find(p => p.id === round.evalAssignmentId)
          const names = group.members.map(m => m.user.username).join(', ') || group.name
          add('rematch', `${names} requested a new evaluator for Evaluation ${round.round} of ${assignment.name} after a failed evaluation.`,
            '/eval-assignments', { assignmentId: assignment.id }, {
              id: `rematch:${pairing.id}`, occurredAt: pairing.retryRequestedAt ?? pairing.createdAt,
            })
        }
      }
      if (missingRounds)
        add('pairings', `Create missing evaluation pairings for ${assignment.name} (${missingRounds} required ${missingRounds === 1 ? 'round' : 'rounds'} unassigned).`,
          '/eval-assignments', { assignmentId: assignment.id })
    }
  }
  const preparationOrder = { instructions: 0, sheet: 1, groups: 2, 'groups-capacity': 2, pairings: 3, rematch: 4 }
  actions.sort((a, b) => a.courseId - b.courseId || a.assignmentId - b.assignmentId ||
    preparationOrder[a.kind] - preparationOrder[b.kind] || a.id.localeCompare(b.id))
  return {
    courses: courses.map(c => ({ id: c.id, name: c.name, description: c.description, term: c.term })), actions,
  }
}
const getStaffDashboard = async orgId => {
  // Match the existing Bocal course scope, without exposing another organisation.
  if (!orgId) return { courses: [], actions: [] }
  const courses = await prisma.class.findMany({
    where: { org_id: orgId }, orderBy: { id: 'asc' }, select: {
      id: true, name: true, description: true, term: true,
      enrollments: { where: { status: 'Active' }, select: { user: { select: { id: true, role:true } } } },
      org: { select: { users: { where: { role: { in:['Bocal','Admin'] } }, select: { id:true,role:true,
        enrollments:{select:{classId:true,status:true}} } } } },
      assignments: { select: {
        id: true, name: true, created_at: true, description: true, fileId: true, req_eval: true, max_score: true, pass_threshold: true,
        participations: { select: { userId:true,evalueeEligible:true,evaluatorEligible:true } },
        evalSheet: { select: { sections: { select: { marks: true, isBonus: true } } } },
        groups: { select: { id: true, members: { orderBy: { userId: 'asc' }, select: { user: { select: { id: true, username: true } } } } } },
        evalAssignments: { select: {
          id: true, assignmentId: true, evalueeGroupId: true, evaluatorUserId: true, round: true,
          submissionId: true, evalResponseId: true, status: true, createdAt: true,
          retryRequested: true, retryRequestedAt: true, evalResponse: { select: responseSelect },
        } },
      } },
    },
  })
  return buildStaffDashboard(courses)
}
module.exports = { getStaffDashboard, buildStaffDashboard }
