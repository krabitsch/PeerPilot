const { prisma } = require('@transcendence/database')
const { NotFoundError, ValidationError } = require('@transcendence/errors')
const utils = require('@transcendence/utils')
const { createStorage } = require('@transcendence/filemanager')
const { csvRow, sanitize } = require('./csv')

// Same buckets the submission/eval services write to; we only read here.
const storages = {
    submissions: createStorage('submissions'),
    'eval-recordings': createStorage('eval-recordings'),
}

const getAssignmentForExport = async (assId) => {
    const assignmentId = parseInt(assId)
    if (!assignmentId) throw new ValidationError('Invalid assignment id')
    const assignment = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: {
            class: { select: { name: true } },
            evalSheet: { include: { sections: { orderBy: { id: 'asc' } } } },
        },
    })
    if (!assignment) throw new NotFoundError('Assignment not found')
    return assignment
}

// Every evaluation left on any submission in this assignment, with the pieces
// the CSV/recording exports need. `round` comes from the linked EvalAssignment.
const getResponsesForAssignment = async (assignmentId, { onlyWithRecording = false } = {}) => {
    const where = { submission: { group: { assId: assignmentId } } }
    if (onlyWithRecording) where.recordingFileId = { not: null }
    return await prisma.evalResponse.findMany({
        where,
        select: {
            isStaffReview: true, givenMarks: true, comment: true, reply: true,
            user: { select: { username: true, email: true } },
            submission: { select: { group: { select: { id: true, name: true } } } },
            scores: { select: { sectionId: true, score: true } },
            recordingFile: { select: { url: true, name: true } },
            evalAssignment: { select: { round: true } },
        },
        orderBy: { id: 'asc' },
    })
}

const buildEvaluationsCsv = async (assId) => {
    const assignment = await getAssignmentForExport(assId)
    const sections = assignment.evalSheet?.sections ?? []
    const responses = await getResponsesForAssignment(assignment.id)

    const sectionIndex = new Map(sections.map((s, i) => [s.id, i]))

    const header = [
        'evalueeGroup', 'round', 'evaluatorUsername', 'evaluatorEmail', 'isStaffReview',
        ...sections.map(s => s.name),
        'totalGivenMarks', 'maxScore', 'comment', 'reply', 'replied', 'recordingFileName',
    ]

    const lines = [csvRow(header)]
    for (const r of responses) {
        const sectionScores = new Array(sections.length).fill('')
        for (const sc of r.scores) {
            const idx = sectionIndex.get(sc.sectionId)
            if (idx !== undefined) sectionScores[idx] = sc.score
        }
        lines.push(csvRow([
            r.submission?.group?.name ?? '',
            r.evalAssignment?.round ?? '',
            r.user?.username ?? '',
            r.user?.email ?? '',
            r.isStaffReview,
            ...sectionScores,
            r.givenMarks,
            assignment.max_score,
            r.comment ?? '',
            r.reply ?? '',
            r.reply ? 'yes' : 'no',
            r.recordingFile?.name ?? '',
        ]))
    }

    return {
        csv: lines.join('\r\n') + '\r\n',
        filenameBase: `${sanitize(assignment.class?.name ?? 'class')}-${sanitize(assignment.name)}`,
    }
}

// Gathers (and validates) everything the ZIP needs. Runs entirely before any
// byte is streamed, so a failure here still surfaces as a normal JSON error
// through the global handler. Returns a plan the route pipes into archiver.
const planArchive = async (assId, { includeRecordings = true } = {}) => {
    const assignment = await getAssignmentForExport(assId)
    const { csv, filenameBase } = await buildEvaluationsCsv(assignment.id)

    // Latest submission per group that actually has a file.
    const submissions = await utils.getSubmissionsBy(
        { group: { assId: assignment.id } },
        { file: true, group: { select: { id: true, name: true } } },
    )
    const latestByGroup = new Map()
    for (const s of submissions) {
        if (!s.file) continue
        const prev = latestByGroup.get(s.groupId)
        if (!prev || new Date(s.createdAt) > new Date(prev.createdAt)) latestByGroup.set(s.groupId, s)
    }
    const submissionEntries = [...latestByGroup.values()].map(s => ({
        path: `submissions/${sanitize(s.group.name)}/${sanitize(s.file.name)}`,
        bucket: 'submissions',
        key: s.file.url,
    }))

    // Groups in the assignment with no downloadable submission — noted in the manifest.
    const allGroups = await prisma.group.findMany({
        where: { assId: assignment.id },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
    })
    const groupsWithoutSubmission = allGroups.filter(g => !latestByGroup.has(g.id))

    let recordingEntries = []
    let evalsWithoutRecording = 0
    if (includeRecordings) {
        const responses = await getResponsesForAssignment(assignment.id, { onlyWithRecording: true })
        recordingEntries = responses.map(r => ({
            path: `recordings/${sanitize(r.submission?.group?.name ?? 'unknown')}/` +
                  `round${r.evalAssignment?.round ?? 'NA'}-${sanitize(r.user?.username ?? 'unknown')}-${sanitize(r.recordingFile.name)}`,
            bucket: 'eval-recordings',
            key: r.recordingFile.url,
        }))
        const total = await prisma.evalResponse.count({
            where: { submission: { group: { assId: assignment.id } } },
        })
        evalsWithoutRecording = total - responses.length
    }

    const manifest = [
        `Assignment: ${assignment.name}`,
        `Class: ${assignment.class?.name ?? ''}`,
        `Generated: ${new Date().toISOString()}`,
        '',
        `Submissions included: ${submissionEntries.length}`,
        `Recordings included: ${recordingEntries.length}${includeRecordings ? '' : ' (recordings excluded by request)'}`,
        '',
        'Groups with no downloadable submission:',
        ...(groupsWithoutSubmission.length
            ? groupsWithoutSubmission.map(g => `  - ${g.name}`)
            : ['  (none)']),
        '',
        includeRecordings
            ? `Evaluations missing a recording: ${evalsWithoutRecording}`
            : 'Evaluations missing a recording: n/a (recordings excluded)',
        '',
    ].join('\n')

    return { filenameBase, csv, manifest, submissionEntries, recordingEntries }
}

// Opens a readable stream for one planned entry, at pipe time.
const openEntryStream = (entry) => storages[entry.bucket].getStream(entry.key)

module.exports = {
    buildEvaluationsCsv,
    planArchive,
    openEntryStream,
    sanitize,
}
