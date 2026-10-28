const { assertDeadline } = require('../assignment/deadlines')
const {prisma} = require('@transcendence/database')
const {NotFoundError, ValidationError} = require('@transcendence/errors')
const utils = require('@transcendence/utils')
const { createStorage } = require('@transcendence/filemanager')
const logger = require('@transcendence/logger')
const { submissionOutcome, summarizeEvaluationRounds, evaluationOutcome, responseSelect } = require('../eval/outcome')
const { fileVersionInclude, submissionFiles, latestSubmissionFile } = require('./files')
const { randomUUID } = require('crypto')
const storage = createStorage('submissions')

const storageReady = (async () => {
    await storage.ensureBucket()
    await storage.makePublic()
})().catch(err => {
    logger.error('submission-service', 'Failed to initialize storage bucket', err)
    throw err
})


const validateGroupMember = async (groupId, userId)=>{
     const group = await utils.getGroupById(groupId, null, {
        assignment: {
            include:{
                class:{
                    select:{
                        id: true,
                        name: true
                    }
                }
            }
        }
    })
     if(!group)
        throw new NotFoundError('Group not found')
    const assId = group.assignment.id;
    const classId = group.assignment.class.id;

    const user = await utils.getUserById(userId)
    if(!user)
        throw new NotFoundError('User not found')
    const userEnrAct = await utils.isEnrolledAndActive(userId, classId)
    if(!userEnrAct)
        throw new ValidationError('User is not Enrolled into this class')
    const memberShip = await utils.existingMembership(userId, assId)
    if(!memberShip)
        throw new NotFoundError('Membership not found')
    if(memberShip.groupId != groupId)
        throw new ValidationError('Membership validation error')
    return {group, user, assId, classId}
}

const getGroupSubmissions = async (groupId, {userId, isStaff} = {}) => {
    if (!isStaff) await validateGroupMember(groupId, userId)
    if(!groupId)
        throw new ValidationError('Invalid request')

    // Include submissions in the query
    const group = await utils.getGroupById(groupId, null, { submissions: {include:{file:true,fileVersions:fileVersionInclude}} })
    
    if(!group)
        throw new NotFoundError("Group Not Found")
    
    return Promise.all(group.submissions.map(s => decorateSubmission(prisma, s)))
}

// The unique groupId and upsert make simultaneous starts share one row.
const createSubmission = async ({groupId, userId, type}) => {
    if (!groupId || !userId || !['FILE','IMAGE','PDF'].includes(type))
        throw new ValidationError('Invalid request')
    const {group: deadlineGroup} = await validateGroupMember(groupId, userId)
    assertDeadline(deadlineGroup.assignment, 'submission')
    let saved
    try { saved = await prisma.submission.upsert({
        where:{groupId:Number(groupId)}, update:{},
        create:{groupId:Number(groupId), status:'Open', type},
        include:{file:true, fileVersions:fileVersionInclude},
    }) } catch (error) {
        if (error.code !== 'P2002') throw error
        saved = await prisma.submission.findUnique({where:{groupId:Number(groupId)},include:{file:true,fileVersions:fileVersionInclude}})
        if (!saved) throw error
    }
    return decorateSubmission(prisma, saved)
}

const retryFileAllowed = async (db, submission) => {
    if (submission.status !== 'Close') return false
    const group = await db.group.findUnique({where:{id:submission.groupId}, include:{
        assignment:true, evalAssignmentsAsEvaluee:{include:{evalResponse:{select:responseSelect}}},
    }})
    const pairings = group.evalAssignmentsAsEvaluee.filter(p => !p.submissionId || p.submissionId === submission.id)
    const summary = summarizeEvaluationRounds(group.assignment, pairings)
    const availableRequests = summary.evaluationRounds.flatMap(round => {
        const current = pairings.find(p => p.id === round.evalAssignmentId)
        const awaiting = round.waitingForRematch || (round.displayOutcome === 'Pending' &&
            current?.status === 'Pending' && !current.submissionId)
        if (!awaiting) return []
        // Each failed attempt opens a new window. A version consumes the window
        // even while its replacement is still waiting to start.
        return pairings.filter(p => p.round === round.round && p.retryRequested &&
            p.retryRequestedAt && evaluationOutcome(p, group.assignment) === 'Failed')
    }).sort((a,b) => new Date(b.retryRequestedAt)-new Date(a.retryRequestedAt) || b.id-a.id)
    const request = availableRequests[0]
    return !!request && !(submission.fileVersions ?? []).some(v =>
        new Date(v.createdAt).getTime() >= new Date(request.retryRequestedAt).getTime())
}
const decorateSubmission = async (db, submission) => ({
    ...await submissionOutcome(db, submission),
    files:submissionFiles(submission),
    canUploadRetryFile:await retryFileAllowed(db, submission),
})
const lockSubmission = async (db, groupId) => {
    await db.$queryRaw`SELECT id FROM submission WHERE "groupId" = ${Number(groupId)} FOR UPDATE`
    const submission = await db.submission.findUnique({where:{groupId:Number(groupId)},
        include:{file:true, fileVersions:fileVersionInclude}})
    if (!submission) throw new NotFoundError('Submission not found')
    return submission
}

const closeSubmission = async (groupId, {userId}) => {
    const {group: deadlineGroup} = await validateGroupMember(groupId, userId)
    assertDeadline(deadlineGroup.assignment, 'submission')
    return prisma.$transaction(async tx => {
        const existing = await lockSubmission(tx, groupId)
        assertDeadline(deadlineGroup.assignment, 'submission')
        const saved = existing.status === 'Close' ? existing : await tx.submission.update({
            where:{id:existing.id}, data:{status:'Close',closedAt:new Date()},
            include:{file:true,fileVersions:fileVersionInclude},
        })
        return decorateSubmission(tx, saved)
    })
}

// Upload to a new object, then serialize writes and closing on the shared row.
// A closed original is immutable; retry uploads only append a version relation.
const saveFile = async (groupId, userId, reqFile, revised = false) => {
    if (!groupId || !userId || !reqFile) throw new ValidationError('Invalid request')
    const {group: deadlineGroup} = await validateGroupMember(groupId, userId)
    assertDeadline(deadlineGroup.assignment, revised ? 'evaluation' : 'submission')
    const fileName = `${groupId}-${randomUUID()}-${reqFile.originalname}`
    await storage.upload(fileName, reqFile.buffer, reqFile.mimetype, reqFile.size)
    let supersededDraft = null
    let result
    try {
        result = await prisma.$transaction(async tx => {
            const existing = await lockSubmission(tx, groupId)
            assertDeadline((await tx.group.findUnique({where:{id:Number(groupId)},include:{assignment:true}})).assignment, revised ? 'evaluation' : 'submission')
            if (revised ? !await retryFileAllowed(tx, existing) : existing.status !== 'Open')
                throw new ValidationError(revised ? 'Only one updated file per unresolved retry is allowed, before its evaluation starts.' : 'Submission is already closed')
            const file = await tx.file.create({data:{name:reqFile.originalname, size:reqFile.size,
                mimiType:reqFile.mimetype, url:fileName, uploadedBy:Number(userId)}})
            if (revised) await tx.submissionFileVersion.create({data:{submissionId:existing.id,fileId:file.id,createdAt:new Date()}})
            else {
                await tx.submission.update({where:{id:existing.id},data:{fileId:file.id}})
                if (existing.file) {
                    supersededDraft = existing.file
                    await tx.file.delete({where:{id:existing.file.id}})
                }
            }
            const saved = await tx.submission.findUnique({where:{id:existing.id},include:{file:true,fileVersions:fileVersionInclude}})
            return decorateSubmission(tx, saved)
        })
    } catch (error) {
        await storage.delete(fileName).catch(err => logger.error('submission-service','Failed to clean up rejected upload',err))
        throw error
    }
    if (supersededDraft) await storage.delete(supersededDraft.url).catch(err =>
        logger.error('submission-service','Failed to clean up superseded draft',err))
    return result
}
const uploadFile = (groupId, userId, file) => saveFile(groupId, userId, file)
const uploadRetryFile = (groupId, userId, file) => saveFile(groupId, userId, file, true)

// Staff (teachers) may download any group's submission for grading/export, so
// they skip the group-membership check students are held to.
const getDownloadUrl = async(groupId, { userId, isStaff, fileId } = {})=>{
    if(!groupId || !userId)
        throw new ValidationError('Invalid Request')
    if(!isStaff)
        await validateGroupMember(groupId, userId)
    const existingSub = await utils.getLastSubmission(groupId, {file: true, fileVersions:fileVersionInclude})
    if(!existingSub) throw new NotFoundError('Submission not found')
    const files = submissionFiles(existingSub)
    const file = fileId ? files.find(f => f.id === Number(fileId)) : latestSubmissionFile(existingSub)
    if (!file) throw new NotFoundError('File not found')
    const url = await storage.getUrl(file.url, file.name)
    return {url, expiresIn: '10 minutes' }
}

const removeFile = async (groupId, userId) => {
    if (!groupId || !userId) throw new ValidationError('Invalid request')
    const {group: deadlineGroup} = await validateGroupMember(groupId, userId)
    assertDeadline(deadlineGroup.assignment, 'submission')
    const removed = await prisma.$transaction(async tx => {
        const existing = await lockSubmission(tx, groupId)
        assertDeadline(deadlineGroup.assignment, 'submission')
        if (existing.status !== 'Open') throw new ValidationError('Submission is already closed')
        if (!existing.file) throw new NotFoundError('File not found')
        await tx.submission.update({where:{id:existing.id},data:{fileId:null}})
        await tx.file.delete({where:{id:existing.file.id}})
        return existing.file
    })
    await storage.delete(removed.url).catch(err => logger.error('submission-service','Failed to clean up removed draft',err))
    return {message:'File deleted successfully'}
}

// `memberId` narrows the list to submissions of groups that user belongs to.
// Students get only their own group's; staff pass nothing and see every group.
const getSubmissionsForAssignment = async (assId, { memberId } = {})=>{
    const ass = await utils.getAssignmentById(assId)
    if(!ass)
        throw new NotFoundError('Assignment not found')
    const where = {group:{assId: parseInt(assId)}}
    if (memberId)
        where.group.members = { some: { userId: parseInt(memberId) } }
    const submissions = await utils.getSubmissionsBy(
        where,
        {file: true, fileVersions:fileVersionInclude, group: {include: {members: {include: {user: { select: { id: true, username: true } } }}}}}
    )
    return Promise.all(submissions.map(s => decorateSubmission(prisma, s)))
}

module.exports = {
  getGroupSubmissions, createSubmission, closeSubmission,
    uploadFile, uploadRetryFile, getDownloadUrl, removeFile, getSubmissionsForAssignment,
    storageReady
}