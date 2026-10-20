const { prisma } = require('@transcendence/database')
const crypto = require('crypto')
const { fileVersionInclude, submissionFiles } = require('../submission/files')
const { evaluationDisplayOutcome, evaluationOutcome, responseSelect, recomputeSubmissionPassed } = require('./outcome')
const {NotFoundError, ValidationError, ConflictError, UnauthorizedError, ForbiddenError} = require('@transcendence/errors')
const utils = require('@transcendence/utils')
const { createStorage } = require('@transcendence/filemanager')
const logger = require('@transcendence/logger')
const storage = createStorage('submissions')

// Private bucket for evaluation recordings — NOT made public; downloads go
// through presigned URLs gated by getRecordingUrl().
const recordingStorage = createStorage('eval-recordings')
const recordingReady = (async () => {
    await recordingStorage.ensureBucket()
})().catch(err => logger.error('eval-service', 'Failed to init eval-recordings bucket', { message: err.message }))

// TODO Move to Class Service cuz its not place here XD
const getAssignment = async(assId)=>{
    if(!assId)
        throw new ValidationError('Invalid request')
    const ass =  await utils.getAssignmentById(assId)
    if(!ass)
        throw new NotFoundError('Assignment not found')
    return ass;
}

const createEvalSheet = async ({assId})=>{
    if(!assId)
        throw new ValidationError('Invalid request')
    const ass = await utils.getAssignmentById(assId, null, {evalSheet:true})
    if(!ass)
        throw new NotFoundError('Assignment not found')
    if(ass.evalSheet)
        throw new ConflictError('Assignment has already an evalsheet')
    return await prisma.evalSheet.create({
        data:{assId: parseInt(assId)}
    })
}

const validateString = (str)=>{
    return (str && str.length > 0)
}

const validateSectionType = (type)=>{
    return(type.length > 0 &&(type === 'Toggle' || type === 'Slider'))
}

const createEvalSection = async(sheetId, 
    {name, description, marks, sectionType})=>{
    if(!sheetId || !validateString(name) || !validateString(description) || 
        !marks || parseInt(marks) <= 0 || !validateSectionType(sectionType))
        throw new ValidationError('invalide request')
    const sheet = await utils.getEvalSheetById(sheetId)
    if(!sheet)
        throw new NotFoundError('EvalSheet not found')
    return await prisma.evalSection.create({
        data:{name, description, sectionType, 
            marks: parseInt(marks), evalSheetId: parseInt(sheetId)}
    })
}

const getEvalSheetById = async (id)=>{
    if(!id)
        throw new ValidationError('invalid request')
    const sheet =  await utils.getEvalSheetById(id, null, {sections:true})
    if(!sheet)
        throw new NotFoundError('EvalSheet not found')
    return sheet
}

const getEvalSheetByAssId = async (assId)=>{
    if(!assId)
        throw new ValidationError('invalid request')
    const ass = await utils.getAssignmentById(assId, null, {evalSheet: {include:{sections:true}}})
    if(!ass)
        throw new NotFoundError('Assignment not found')
    if(!ass.evalSheet)
        throw new NotFoundError('EvalSheet not found')
    return ass.evalSheet
}

const updateEvalSheetSection = async (sheetId, {secId, name, description, marks, sectionType})=>{
    if(!sheetId || !secId)
        throw new ValidationError('invalid request')
    const sheet =  await utils.getEvalSheetById(sheetId, null, {sections:true})
    if(!sheet)
        throw new NotFoundError('Evalsheet not found')
    const existSection = sheet.sections.some(sec => sec.id === parseInt(secId))
    if(!existSection)
        throw new NotFoundError('Section not found')

    const newName = (name.length > 0) ? name: existSection.name
    const newDesc = (description.length > 0) ? description: existSection.description
    const newMarks = (parseInt(marks) > 0) ? parseInt(marks) : parseInt(existSection.marks)
    const newtype = (validateSectionType(sectionType))? sectionType: existSection.sectionType
     
    return await prisma.evalSection.update({
        where:{id: parseInt(secId)},
        data:{name: newName, description: newDesc, marks: newMarks, sectionType: newtype}
    })
}

const removeSection = async (sheetId, {secId})=>{
    if(!sheetId || !secId)
        throw new ValidationError('invalid request')
    //console.log('HI')
    const sheet =  await utils.getEvalSheetById(sheetId, null, {sections:true})
    if(!sheet)
        throw new NotFoundError('Evalsheet not found')
    const existSection = sheet.sections.some(sec => sec.id === parseInt(secId))
    if(!existSection)
        throw new NotFoundError('Section not found')
    await prisma.evalSection.delete({where: {id: parseInt(secId)}})
    return{
        message: 'Section deleted successfully',
        id: parseInt(secId)
    }
}

// methods pertaining to EvalAssignment model/table:

// Contact emails are scoped to the evaluated group's members. Passkeys also
// require its submission to be closed. Staff retain their management view.
const protectPairingDetails = async (pairings, viewer) => {
  if (!viewer || viewer.isStaff) return pairings
  const groups = await prisma.group.findMany({
    where: { id: { in: [...new Set(pairings.map(p => p.evalueeGroupId))] },
      members: { some: { userId: Number(viewer.userId) } } },
    select: { id: true, submissions: { select: {status:true} } },
  })
  const involved = new Set(groups.map(g => g.id))
  const closed = new Set(groups.filter(g => g.submissions.some(s => s.status === 'Close')).map(g => g.id))
  return pairings.map(pairing => ({ ...pairing,
    evaluatorUser: pairing.evaluatorUser ? {
      id:pairing.evaluatorUser.id, username:pairing.evaluatorUser.username,
      ...(involved.has(pairing.evalueeGroupId) && {email:pairing.evaluatorUser.email}),
    } : undefined,
    passKey: closed.has(pairing.evalueeGroupId) ? pairing.passKey : null }))
}

// get all EvalAssignments for one particular assignment.id
const getEvalAssignments = async (assignmentId, viewer)=>{
  const assignmentIdInt = parseInt(assignmentId)

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentIdInt }
  })

  if (!assignment)
    throw new NotFoundError('Assignment not found')

  const select = {
    id: true,
    assignmentId: true,
    evalueeGroupId: true,
    evaluatorGroupId: true,
    evaluatorUserId: true,
    round: true,
    status: true,
    submissionId: true,
    evalResponseId: true,
    createdAt: true,
    passKey: true,
    retryRequested: true,
    retryRequestedAt: true,
    evalResponse: { select: responseSelect },

    evaluatorUser: {
      select: {
        id: true,
        username: true, email:true
      }
    }
  }

  const pairings = await utils.getEvalAssignments(assignmentIdInt, select)
  return protectPairingDetails(pairings.map(pairing => ({ ...pairing, outcome: evaluationOutcome(pairing, assignment), studentOutcome: evaluationDisplayOutcome(pairing, assignment) })), viewer)
}

// Historical attempts are retained, including cancelled pending work.
const deleteEvalAssignments = async () => { throw new ConflictError('Bulk deletion is disabled to preserve evaluation history') }

const getEvalAssignmentById = async (evalAssignmentId, viewer) => {
  const evalAssignmentIdInt =
    parseInt(evalAssignmentId)

  const select = {
    id: true,
    assignmentId: true,
    evalueeGroupId: true,
    evaluatorGroupId: true,
    evaluatorUserId: true,
    round: true,
    status: true,
    submissionId: true,
    evalResponseId: true,
    createdAt: true,
    passKey: true,
    retryRequested: true,
    retryRequestedAt: true,
    evalResponse: { select: responseSelect },

    evaluatorUser: {
      select: {
        id: true,
        username: true, email:true
      }
    }
  }

  const result =
    await utils.getEvalAssignmentById(
      evalAssignmentIdInt,
      select
    )

  if (!result)
    throw new NotFoundError(
      'Eval assignment not found'
    )

  const assignment = await utils.getAssignmentById(result.assignmentId)
  const [visible] = await protectPairingDetails([{ ...result, outcome: evaluationOutcome(result, assignment), studentOutcome: evaluationDisplayOutcome(result, assignment) }], viewer)
  return visible
}


const createEvalAssignment = (payload, actor) => require('./pairing-management').createPairing(payload, actor)

const updateEvalAssignment = async () => { throw new ConflictError('Existing attempts cannot be overwritten; cancel pending work and create a new pairing') }
const deleteEvalAssignment = (id, actor) => require('./pairing-management').cancelPairing(id, actor)

// Compatibility entry point: generation now fills missing slots without reshuffling.
const generateSimpleEvalAssignmentPairings = (assignmentId, options, actor) =>
  require('./pairing-management').generateMissing(assignmentId, options, actor)

const getAssignmentWithSheet = async (assignmentId)=>{
    return await utils.getAssignmentById(assignmentId, null, {evalSheet: {include: {sections: true}}})
}

// One request supplies the course filters and evaluator-owned task display data.
// Only evaluator-owned tasks include the involved evaluees' contact emails; no passkeys.
const getMyEvaluatorTasks = async (userId, role = 'Student') => {
  const evaluatorUserId = Number(userId)
  const activeEnrollment = { enrollments: { some: { userId: evaluatorUserId, status: 'Active' } } }
  // Staff may perform their assigned evaluator work without enrolling as a student.
  // Students retain the existing active-enrollment boundary.
  const enrollmentScope = ['Bocal','Admin'].includes(role) ? { OR: [activeEnrollment,
    { assignments: { some: { evalAssignments: { some: { evaluatorUserId } } } } }
  ] } : activeEnrollment
  const [courses, tasks] = await Promise.all([
    prisma.class.findMany({
      where: enrollmentScope,
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: {
        id: true, name: true, description: true, term: true, created_at: true,
        assignments: {
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true, created_at: true }
        }
      }
    }),
    prisma.evalAssignment.findMany({
      where: { evaluatorUserId, assignment: { class: enrollmentScope } },
      orderBy: [{ assignment: { classid: 'asc' } }, { assignment: { created_at: 'asc' } },
        { assignmentId: 'asc' }, { round: 'asc' }, { id: 'asc' }],
      select: {
        id: true, assignmentId: true, evalueeGroupId: true, round: true, status: true,
        assignment: { select: { id: true, name: true, created_at: true, classid: true, max_score:true, pass_threshold:true, evaluationDurationMinutes:true } },
        evalueeGroup: {
          select: { id: true, name: true, members: {
            orderBy: { userId: 'asc' }, select: { user: { select: { id: true, username: true, email:true } } }
          } }
        },
        evalResponse: { select: {
          id: true, givenMarks: true, comment: true, reply: true,
          scores: { orderBy: { sectionId: 'asc' }, select: {
            sectionId: true, score: true, section: { select: { name: true, marks: true } }
          } }
        } }
      }
    })
  ])
  return { courses, tasks }
}

const startEvaluation = async ({ evalAssignmentId, evaluatorUserId, passkey }) => {
  const id = Number(evalAssignmentId)
  const evaluatorId = Number(evaluatorUserId)
  const cleanPassKey = String(passkey ?? '').trim()
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(evaluatorId) || evaluatorId <= 0)
    throw new ValidationError('evalAssignmentId and authenticated evaluator are required')
  if (!/^\d{6}$/.test(cleanPassKey)) throw new ValidationError('Invalid evaluation passkey')

  const pairing = await prisma.evalAssignment.findUnique({ where: { id } })
  if (!pairing) throw new NotFoundError('Evaluation assignment not found')
  if (pairing.evaluatorUserId !== evaluatorId)
    throw new ForbiddenError('This evaluation has not been assigned to you')
  if (pairing.status !== 'Pending') throw new ConflictError('This evaluation is no longer pending')
  if (!pairing.passKey || pairing.passKey !== cleanPassKey)
    throw new ValidationError('Invalid evaluation passkey')

  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM submission WHERE "groupId" = ${pairing.evalueeGroupId} FOR UPDATE`
    const submission = await tx.submission.findFirst({
      where: { groupId: pairing.evalueeGroupId }, include: { group: true, file: true, fileVersions: fileVersionInclude }
    })
    if (!submission) throw new NotFoundError('Submission not found')
    if (submission.status !== 'Close') throw new ValidationError('Submission is not closed yet')
    if (submission.group.assId !== pairing.assignmentId ||
        (pairing.submissionId && pairing.submissionId !== submission.id))
      throw new ValidationError('Mismatched submission for this evaluation pairing')

    const assignment = await getAssignmentWithSheet(pairing.assignmentId)
    if (!assignment?.evalSheet) throw new NotFoundError('This assignment has no eval sheet yet')
    if (!pairing.submissionId) {
      const linked = await tx.evalAssignment.updateMany({
        where: { id, evaluatorUserId: evaluatorId, status: 'Pending', passKey: cleanPassKey, submissionId: null },
        data: { submissionId: submission.id }
      })
      if (linked.count !== 1) throw new ConflictError('Evaluation changed; please open the task again')
    }
    const files = submissionFiles(submission).map(file => ({...file, url: storage.getPublicUrl(file.url)}))
    return {
      evalAssignmentId: pairing.id,
      assignment: { id: assignment.id, name: assignment.name, description: assignment.description, max_score: assignment.max_score, pass_threshold:assignment.pass_threshold, evaluationDurationMinutes:assignment.evaluationDurationMinutes },
      group: { id: submission.group.id, name: submission.group.name },
      submission: { id: submission.id, file: files.at(-1) ?? null, files },
      evalSheet: assignment.evalSheet
    }
  })
}

const submitEvaluation = async ({evalAssignmentId, evaluatorUserId, comment, scores})=>{
    const evalAssignmentIdInt = parseInt(evalAssignmentId)
    const evaluatorUserIdInt = parseInt(evaluatorUserId)
    if(!evalAssignmentIdInt || !evaluatorUserIdInt || !validateString(comment) || !Array.isArray(scores) || scores.length === 0)
        throw new ValidationError('evalAssignmentId, evaluatorUserId, comment and scores are required')

    if (typeof comment !== 'string' || comment.trim().length < 100)
        throw new ValidationError('Please provide at least 100 characters of constructive feedback.')
    comment = comment.trim()
    const evalAssignment = await utils.getEvalAssignmentById(evalAssignmentIdInt)
    if(!evalAssignment)
        throw new NotFoundError('Eval assignment not found')
    if(evalAssignment.evaluatorUserId !== evaluatorUserIdInt)
        throw new UnauthorizedError('This is not your evaluation')
    if(evalAssignment.status !== 'Pending')
        throw new ConflictError('This evaluation has already been submitted')
    if(!evalAssignment.submissionId)
        throw new ValidationError('No submission attached to this evaluation — start the evaluation again')

    const assignment = await getAssignmentWithSheet(evalAssignment.assignmentId)
    const sections = assignment?.evalSheet?.sections ?? []
    if(sections.length === 0)
        throw new NotFoundError('This assignment has no eval sheet')

    const sectionsById = new Map(sections.map(s => [s.id, s]))
    if(scores.length !== sections.length)
        throw new ValidationError('Every section must be scored exactly once')

    const seen = new Set()
    for(const {sectionId, score} of scores){
        const sectionIdInt = parseInt(sectionId)
        const scoreInt = parseInt(score)
        const section = sectionsById.get(sectionIdInt)
        if(!section)
            throw new ValidationError(`Section ${sectionId} does not belong to this eval sheet`)
        if(seen.has(sectionIdInt))
            throw new ValidationError(`Section ${sectionId} was scored more than once`)
        seen.add(sectionIdInt)
        if(isNaN(scoreInt) || scoreInt < 0 || scoreInt > section.marks)
            throw new ValidationError(`Score for "${section.name}" must be between 0 and ${section.marks}`)
        if(section.sectionType === 'Toggle' && scoreInt !== 0 && scoreInt !== section.marks)
            throw new ValidationError(`"${section.name}" is a yes/no section — score must be 0 or ${section.marks}`)
    }

    const givenMarks = scores.reduce((sum, s) => sum + parseInt(s.score), 0)

    const response = await prisma.$transaction(async (tx) => {
        // Serialize outcome recomputation for concurrent evaluations of one submission.
        await tx.$queryRaw`SELECT id FROM "submission" WHERE id = ${evalAssignment.submissionId} FOR UPDATE`
        const claimed = await tx.evalAssignment.updateMany({
            where: { id: evalAssignment.id, status: 'Pending', evalResponseId: null },
            data: { status: 'Submitted' }
        })
        if (claimed.count !== 1) throw new ConflictError('This evaluation has already been submitted')

        const evalResponse = await tx.evalResponse.create({
            data: {
                subId: evalAssignment.submissionId,
                userId: evaluatorUserIdInt,
                givenMarks,
                comment,
                scores: { create: scores.map(s => ({ sectionId: parseInt(s.sectionId), score: parseInt(s.score) })) }
            },
            include: { scores: true }
        })

        await tx.evalAssignment.update({
            where: { id: evalAssignment.id },
            data: { status: 'Submitted', evalResponseId: evalResponse.id }
        })

        await recomputeSubmissionPassed(tx, evalAssignment.submissionId)
        return evalResponse
    })

    return response
}

// get all eval feedback (EvalResponse rows) left on one submission
const getEvalResponsesForSubmission = async (subId) => {
    const subIdInt = parseInt(subId)
    if(!subIdInt)
        throw new ValidationError('Invalid submission id')

    return await prisma.evalResponse.findMany({
        where: { subId: subIdInt },
        select: {
            id: true, isStaffReview: true, givenMarks: true, comment: true, reply: true, rating: true, userId: true,
            user: { select: { id: true, username: true } },
            recordingFile: { select: { id: true, name: true } },
            scores: { select: { id: true, sectionId: true, score: true,
                       section: { select: { id: true, name: true, description: true, marks: true, sectionType: true } } } }
        },
        orderBy: { id: 'asc' }
    })
}

// Presigned download URL for an evaluation recording, gated to the people
// allowed to hear it: staff, the evaluator who made it, or any member of the
// evaluated group. `requester` is { userId, isStaff }.
const getRecordingUrl = async (responseId, requester) => {
    const responseIdInt = parseInt(responseId)
    if(!responseIdInt)
        throw new ValidationError('Invalid response id')

    const response = await prisma.evalResponse.findUnique({
        where: { id: responseIdInt },
        select: {
            userId: true,
            recordingFile: { select: { url: true, name: true } },
            submission: { select: { group: { select: { leaderId: true, members: { select: { userId: true } } } } } },
        }
    })
    if(!response || !response.recordingFile)
        throw new NotFoundError('No recording for this evaluation')

    const uid = parseInt(requester?.userId)
    const groupUserIds = response.submission?.group?.members?.map(m => m.userId) ?? []
    const allowed = requester?.isStaff
        || response.userId === uid
        || groupUserIds.includes(uid)
    if(!allowed)
        throw new UnauthorizedError('You cannot access this recording')

    const url = await recordingStorage.getUrl(response.recordingFile.url, response.recordingFile.name)
    return { url }
}

// recomputes a submission's finalScore/passed from the avg of givenMarks across replied-to EvalResponses
const recomputeFinalScore = async (subId) => {
    const replied = await prisma.evalResponse.findMany({
        where: { subId, reply: { not: null } },
        select: { givenMarks: true }
    })

    if(replied.length === 0){
        await prisma.submission.update({ where: { id: subId }, data: { finalScore: null, passed: null } })
        return
    }

    const avg = replied.reduce((sum, r) => sum + r.givenMarks, 0) / replied.length

    const submission = await prisma.submission.findUnique({
        where: { id: subId },
        include: { group: { include: { assignment: true } } }
    })
    const assignment = submission.group.assignment
    const passed = assignment.max_score > 0 && (avg / assignment.max_score) * 100 >= assignment.pass_threshold

    await prisma.submission.update({ where: { id: subId }, data: { finalScore: avg, passed } })
}

const requestEvaluationRetry = async (evalAssignmentId, userId) => {
    const id = Number(evalAssignmentId)
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Invalid evaluation assignment id')
    return prisma.$transaction(async tx => {
        const pairing = await tx.evalAssignment.findUnique({
            where: { id }, include: { assignment: true, evalResponse: true }
        })
        if (!pairing) throw new NotFoundError('Evaluation assignment not found')
        const member = await tx.groupMember.findUnique({
            where: { userId_groupId: { userId: Number(userId), groupId: pairing.evalueeGroupId } }
        })
        if (!member) throw new ForbiddenError('Only a member of the evaluee group can request a retry')
        if (evaluationDisplayOutcome(pairing, pairing.assignment) !== 'Failed')
            throw new ValidationError('Only a submitted, failed evaluation with answered feedback can request a retry')
        await tx.evalAssignment.updateMany({
            where: { id, retryRequested: false, status: 'Submitted' },
            data: { retryRequested: true, retryRequestedAt: new Date() }
        })
        // A repeated request preserves the original timestamp and feedback.
        return tx.evalAssignment.findUnique({ where: { id } })
    })
}

// The evaluee group leader completes feedback with a reply and recording.
const replyToEvalResponse = async (responseId, { userId, reply, recording }) => {
    const responseIdInt = parseInt(responseId)
    const userIdInt = parseInt(userId)
    if (!responseIdInt || !userIdInt || !validateString(reply?.trim()))
        throw new ValidationError('userId and reply are required')

    const response = await prisma.evalResponse.findUnique({
        where: { id: responseIdInt },
        include: { submission: { include: { group: true } } }
    })
    if (!response) throw new NotFoundError('Eval response not found')
    if (response.submission.group.leaderId !== userIdInt)
        throw new UnauthorizedError('Only the group leader can reply to this feedback')
    if (response.reply && (response.isStaffReview || response.recordingFileId))
        throw new ConflictError('This feedback has already been replied to')
    if (!response.isStaffReview && !response.recordingFileId && !recording?.buffer)
        throw new ValidationError('Upload the evaluation recording with your feedback response')

    let objectKey
    if (!response.isStaffReview && !response.recordingFileId) {
        await recordingReady
        objectKey = `${response.subId}-${response.id}-${userIdInt}-${crypto.randomUUID()}`
        await recordingStorage.upload(objectKey, recording.buffer, recording.mimetype, recording.size)
    }
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "submission" WHERE id = ${response.subId} FOR UPDATE`
        const claimed = await tx.evalResponse.updateMany({
            where: { id: responseIdInt, reply: response.reply, recordingFileId: response.recordingFileId },
            data: { reply: reply.trim() }
        })
        if (claimed.count !== 1) throw new ConflictError('This feedback has already been replied to')
        if (objectKey) {
            const file = await tx.file.create({ data: {
                name: recording.originalname, mimiType: recording.mimetype, size: recording.size,
                url: objectKey, uploadedBy: userIdInt,
            } })
            await tx.evalResponse.update({ where: { id: responseIdInt }, data: { recordingFileId: file.id } })
        }
        await recomputeSubmissionPassed(tx, response.subId)
        return tx.evalResponse.findUnique({ where: { id: responseIdInt }, include: { recordingFile: { select: { id: true, name: true } } } })
    })
}

module.exports = {getEvalSheetById, getEvalSheetByAssId, getAssignment, createEvalSheet, createEvalSection,
    updateEvalSheetSection, removeSection,
    getEvalAssignments, deleteEvalAssignments, getEvalAssignmentById, createEvalAssignment,
    updateEvalAssignment, deleteEvalAssignment, generateSimpleEvalAssignmentPairings,
    getMyEvaluatorTasks, startEvaluation, submitEvaluation, getEvalResponsesForSubmission, replyToEvalResponse,
    requestEvaluationRetry, getRecordingUrl
}
