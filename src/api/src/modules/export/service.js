const { prisma } = require('@transcendence/database')
const { NotFoundError, ValidationError } = require('@transcendence/errors')
const utils = require('@transcendence/utils')
const { createStorage } = require('@transcendence/filemanager')
const { csvRow, sanitize } = require('./csv')
const { fileVersionInclude } = require('../submission/files')
const { evaluationOutcome } = require('../eval/outcome')

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
            evalSheet: { include: { sections: { orderBy: [{sortOrder:'asc'},{id:'asc'}] } } },
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
            id: true, isStaffReview: true, givenMarks: true, coreScore: true, bonusScore: true, comment: true, reply: true,
            user: { select: { username: true, email: true } },
            submission: { select: { group: { select: { id: true, name: true } } } },
            scores: { select: { sectionId: true, score: true } },
            recordingFile: { select: { url: true, name: true } },
            evalAssignment: { select: { id: true, round: true } },
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

    header.push('evalAssignmentId', 'attempt', 'status', 'outcome', 'createdAt', 'retryRequestedAt', 'evalResponseId')
    const pairings = await prisma.evalAssignment.findMany({
        where: { assignmentId: assignment.id },
        include: { evaluatorUser: true, evalueeGroup: true, evalResponse: true },
        orderBy: [{round:'asc'}, {createdAt:'asc'}, {id:'asc'}],
    })
    const responseById = new Map(responses.map(r => [r.id,r]))
    const linked = new Set(pairings.map(p => p.evalResponseId).filter(Boolean))
    const attempts = new Map()
    const records = pairings.map(p => {
        const key = `${p.evalueeGroupId}:${p.round}`
        const attempt = (attempts.get(key) ?? 0) + 1
        attempts.set(key,attempt)
        return {p, attempt, r:responseById.get(p.evalResponseId)}
    })
    // Retain legacy/unpaired responses and staff reviews too.
    records.push(...responses.filter(r=>!linked.has(r.id)).map(r=>({r})))
    const lines = [csvRow(header)]
    for (const {r,p,attempt} of records) {
        const sectionScores = new Array(sections.length).fill('')
        for (const sc of r?.scores ?? []) {
            const idx = sectionIndex.get(sc.sectionId)
            if (idx !== undefined) sectionScores[idx] = sc.score
        }
        lines.push(csvRow([
            p?.evalueeGroup?.name ?? r?.submission?.group?.name ?? '',
            p?.round ?? r?.evalAssignment?.round ?? '',
            p?.evaluatorUser?.username ?? r?.user?.username ?? '',
            p?.evaluatorUser?.email ?? r?.user?.email ?? '',
            r?.isStaffReview ?? false, ...sectionScores,
            r?.givenMarks ?? '', assignment.max_score, r?.comment ?? '', r?.reply ?? '',
            r?.reply ? 'yes' : 'no', r?.recordingFile?.name ?? '',
            p?.id ?? '', attempt ?? '', p?.status ?? 'Submitted',
            p ? evaluationOutcome(p,assignment) : ((r?.coreScore ?? r?.givenMarks) / assignment.max_score * 100 >= assignment.pass_threshold ? 'Passed' : 'Failed'),
            p?.createdAt?.toISOString?.() ?? p?.createdAt ?? '',
            p?.retryRequestedAt?.toISOString?.() ?? p?.retryRequestedAt ?? '', r?.id ?? '',
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

    // Bulk exports contain every immutable submitted version, in chronological order.
    const submissions = await utils.getSubmissionsBy(
        { group: { assId: assignment.id } },
        { file: true, fileVersions:fileVersionInclude, group: { select: { id: true, name: true } } },
    )
    submissions.sort((a,b)=>a.groupId-b.groupId || new Date(a.createdAt)-new Date(b.createdAt) || a.id-b.id)
    const latestByGroup = new Map()
    const submissionEntries = []
    for (const s of submissions) {
        const versions = [...(s.fileVersions ?? [])].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)||a.id-b.id)
        const entries = [
            ...(s.file ? [{file:s.file,folder:'original'}] : []),
            ...versions.map((v,i)=>({file:v.file,folder:`retry-${i+1}-version-${v.id}`})),
        ]
        for (const {file,folder} of entries) {
            if (!file) continue
            latestByGroup.set(s.groupId,s)
            submissionEntries.push({
                path:`submissions/${sanitize(s.group.name)}-group-${s.groupId}/submission-${s.id}/${folder}/${sanitize(file.name)}`,
                bucket:'submissions',key:file.url,
            })
        }
    }

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
            path: `recordings/${sanitize(r.submission?.group?.name ?? 'unknown')}-group-${r.submission?.group?.id ?? 'unknown'}/` +
                  `round${r.evalAssignment?.round ?? 'NA'}-pairing-${r.evalAssignment?.id ?? 'NA'}-response-${r.id}-${sanitize(r.user?.username ?? 'unknown')}-${sanitize(r.recordingFile.name)}`,
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
