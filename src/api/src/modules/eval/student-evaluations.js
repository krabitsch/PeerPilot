// Staff view of one student in one assignment: every evaluation pairing that
// involves them, with the feedback behind it — what their group received and
// what they gave. Feeds the expandable rows on the student analytics page.
//
// Scoped with the same rule as the per-student exports (export/service.js
// getStudentScope), so the page, the CSV and the ZIP always agree. Read-only.
const { prisma } = require('@transcendence/database')
const { NotFoundError, ValidationError } = require('@transcendence/errors')
const { evaluationOutcome, responseSelect } = require('./outcome')
const { getStudentScope, directionFor } = require('../export/service')

const getStudentEvaluations = async (assId, studentId) => {
    const assignmentId = parseInt(assId)
    if (!assignmentId) throw new ValidationError('Invalid assignment id')
    const assignment = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, max_score: true, pass_threshold: true },
    })
    if (!assignment) throw new NotFoundError('Assignment not found')
    const scope = await getStudentScope(assignmentId, studentId ?? '')

    const pairings = await prisma.evalAssignment.findMany({
        where: { assignmentId, OR: [
            ...(scope.group ? [{ evalueeGroupId: scope.group.id }] : []),
            { evaluatorUserId: scope.user.id },
        ] },
        select: {
            id: true, assignmentId: true, round: true, status: true, createdAt: true,
            evalueeGroupId: true, evaluatorUserId: true, submissionId: true, evalResponseId: true,
            evalResponse: { select: {
                ...responseSelect, comment: true,
                scores: {
                    orderBy: [{ section: { sortOrder: 'asc' } }, { sectionId: 'asc' }],
                    select: { sectionId: true, score: true, section: { select: { name: true, marks: true, isBonus: true } } },
                },
            } },
        },
        orderBy: [{ round: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })

    return pairings.map(p => {
        const r = p.evalResponse
        return {
            pairingId: p.id,
            direction: directionFor(scope, p.evalueeGroupId, p.evaluatorUserId),
            round: p.round,
            status: p.status,
            outcome: evaluationOutcome(p, assignment),
            response: r ? {
                id: r.id,
                givenMarks: r.givenMarks,
                coreScore: r.coreScore,
                bonusScore: r.bonusScore,
                comment: r.comment,
                reply: r.reply ?? null,
                hasRecording: r.recordingFileId != null,
                scores: (r.scores ?? []).map(s => ({
                    sectionId: s.sectionId, name: s.section?.name ?? `Section ${s.sectionId}`,
                    score: s.score, marks: s.section?.marks ?? null, isBonus: !!s.section?.isBonus,
                })),
            } : null,
        }
    })
}

module.exports = { getStudentEvaluations }
