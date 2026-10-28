const { assignmentDeadlines } = require('../assignment/deadlines')
const { assignmentOutcome, responseSelect } = require('../eval/outcome')
const { prisma } = require('@transcendence/database')
const logger = require('@transcendence/logger')
const {NotFoundError, ValidationError, ConflictError} = require('@transcendence/errors')
const utils = require('@transcendence/utils')
const { createStorage } = require('@transcendence/filemanager')

let storage
(async () => {
  storage = createStorage('assignment-subjects')
  await storage.ensureBucket()
  await storage.makePublic()
})().catch(err => logger.error('class-service', 'Failed to initialize storage', err))

const getClasses = async () => {
  const select = {id: true, name: true, description: true, created_at: true, org_id: true,
    term: true, externalCourseCodes: true, pass_threshold:true, assignments: true}
  return await utils.getClasses(select)
}

const getClassById = async (classId) => {
  const select = {id: true, name: true, description: true, created_at: true, org_id: true,
    term: true, externalCourseCodes: true, pass_threshold:true, assignments: true}
  const result = await utils.getClassById(parseInt(classId), select)
  if (!result)
    throw new NotFoundError('Class not found')
  return result
}

const getClassByOrgId = async (orgId) => {
  const select = {id: true, name: true, description: true, created_at: true, org_id: true,
    term: true, externalCourseCodes: true, pass_threshold:true, assignments: true}
  const result = await utils.getClassByOrgId(parseInt(orgId), select)
  if (!result)
    throw new NotFoundError('Org not found')
  return result
}

const courseMetadata = ({term, externalCourseCodes}) => {
  if (term !== undefined && term !== null && (typeof term !== 'string' || term.trim().length > 100))
    throw new ValidationError('Term must be text of at most 100 characters')
  if (externalCourseCodes !== undefined && (!Array.isArray(externalCourseCodes) ||
      externalCourseCodes.some(c => typeof c !== 'string' || !c.trim() || c.trim().length > 40)))
    throw new ValidationError('Official course numbers must be a list of non-empty codes (maximum 40 characters each)')
  // Enrollment assigns every student one of these numbers, so a course needs at least one.
  if (externalCourseCodes !== undefined && externalCourseCodes.length === 0)
    throw new ValidationError('At least one official course number is required')
  return { ...(term !== undefined && {term: term?.trim() || null}),
    ...(externalCourseCodes !== undefined && {externalCourseCodes: [...new Set(externalCourseCodes.map(c => c.trim()))]}) }
}
const evaluationDuration = value => {
  const minutes = Number(value)
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180)
    throw new ValidationError('Recommended evaluation duration must be a whole number from 5 to 180 minutes')
  return minutes
}

const createClass = async ({org_id, created_by, name, description, pass_threshold, term, externalCourseCodes})=>{
    if(!org_id || !created_by || !name || !description || !pass_threshold)
        throw new ValidationError("invalid request")
    if(externalCourseCodes === undefined)
        throw new ValidationError('At least one official course number is required')

    const org = await utils.getOrgById(org_id)
    if(!org)
        throw new NotFoundError('Org not found')

    const user = await utils.getUserById(created_by)
    if(!user)
        throw new NotFoundError('User not found')

    return await prisma.class.create({
        data: {...courseMetadata({term, externalCourseCodes}), name, description, org_id:parseInt(org_id), created_by:parseInt(created_by), pass_threshold:parseFloat(pass_threshold)},
        select:{id:true, name: true, description: true, org_id: true, created_by: true, pass_threshold: true, term:true, externalCourseCodes:true}
    })
}

const updateClass = async (classId, {org_id, created_by, name, description, pass_threshold, term, externalCourseCodes})=>{
    if(!org_id || !created_by || !name || !description || !pass_threshold)
        throw new ValidationError("invalid request")

    const targetClass = await getClassById(classId)
    if (!targetClass)
        throw new NotFoundError('Class not found')

    const org = await utils.getOrgById(org_id)
    if(!org)
        throw new NotFoundError('Org not found')

    const user = await utils.getUserById(created_by)
    if(!user)
        throw new NotFoundError('User not found')

    const metadata = courseMetadata({term, externalCourseCodes})
    return prisma.$transaction(async tx => {
      const current = await tx.class.findUnique({where:{id:Number(classId)}})
      const removed = (current.externalCourseCodes ?? []).filter(code => metadata.externalCourseCodes && !metadata.externalCourseCodes.includes(code))
      if (removed.length) {
        const where = {classId:Number(classId), externalCourseCode:{in:removed}}
        const [enrolled, allowed] = await Promise.all([
          tx.enrollment.count({where}), tx.allowedEnrollment.count({where}),
        ])
        if (enrolled || allowed) throw new ConflictError(`Cannot remove official course numbers ${removed.join(', ')}: existing enrollments or whitelist records still use them.`)
      }
      return await tx.class.update({
          where: { id: parseInt(classId) },
          data: {...courseMetadata({term, externalCourseCodes}), name, description, org_id:parseInt(org_id), created_by:parseInt(created_by), pass_threshold:parseFloat(pass_threshold)},
          select:{id:true, name: true, description: true, org_id: true, created_by: true, pass_threshold: true, term:true, externalCourseCodes:true}
      })
    }, {isolationLevel:'Serializable'})
}

const getClassStudents = async (classId)=>{
    const targetClass = await utils.getClassById(classId)
    if(!targetClass)
        throw new NotFoundError("Class not found")

    const enrollments = await prisma.enrollment.findMany({
        where: { classId: parseInt(classId), status: 'Active' },
        select: {
            externalCourseCode: true,
            user: { select: { id: true, username: true, email: true, role: true, created_at: true,
                userAuth: { select: { provider: true, pass_hash: true } } } }
        }
    })
    // `pending`: enrolled by staff, not signed up yet. The hash never leaves here.
    return enrollments.map(({ externalCourseCode, user: { userAuth, ...user } }) =>
        ({ ...user, externalCourseCode, pending: utils.isPendingAuth(userAuth) }))
}

const deleteClass = async (classId)=>{
    const targetClass = getClassById(classId)
    if (!targetClass)
        throw new NotFoundError('Class not found')

    await prisma.class.delete({where: {id: parseInt(classId)}})

    return {
        message: 'Course deleted successfully',
        id: classId }
}

const createAssignment = async (classId, {name, description, maxScore, reqEval, passThreshold, createdBy, evaluationDurationMinutes}, reqFile)=>{
    if(!classId || !name|| !description || !maxScore || !reqEval)
        throw new ValidationError("Invalid request")

    const duration = evaluationDuration(evaluationDurationMinutes ?? 30)
    const targetClass = await utils.getClassById(classId)
    if(!targetClass)
        throw new NotFoundError("Class not found")
    const existingAss = await utils.getAssignmentByName(classId, name, null)
    if(existingAss)
        throw new ConflictError('Assignment already exists')

    let subjectFile = null
    if (reqFile) {
        if (!createdBy)
            throw new ValidationError("createdBy is required to upload a subject file")

        const fileName = `assignment-${classId}-${Date.now()}-${reqFile.originalname}`
        await storage.upload(fileName, reqFile.buffer, reqFile.mimetype, reqFile.size)
        subjectFile = await prisma.file.create({
            data: {
                name: reqFile.originalname,
                mimiType: reqFile.mimetype,
                size: reqFile.size,
                url: storage.getPublicUrl(fileName),
                uploadedBy: parseInt(createdBy),
            },
            select: {id: true, name: true, url: true, mimiType: true, size: true}
        })
    }

    const result = await prisma.assignment.create({
        data:{classid: parseInt(classId), name, description, max_score:parseInt(maxScore),
            req_eval:parseInt(reqEval), evaluationDurationMinutes: duration,
            // Optional so older clients keep working; they get the schema default.
            ...(passThreshold && { pass_threshold: parseFloat(passThreshold) }),
            ...(subjectFile && { fileId: subjectFile.id })
        },
         select: {submissionDeadline:true, evaluationDeadline:true, evaluationDurationMinutes:true, id: true, name: true, description: true, max_score:true, req_eval:true,
            pass_threshold: true, created_at: true, classid:true, fileId:true}
    })
    return {...result, file: subjectFile}
}

const attachSubjectFile = async (assignments)=>{
    const list = Array.isArray(assignments) ? assignments : [assignments]
    const fileIds = [...new Set(list.filter(a => a.fileId).map(a => a.fileId))]
    if(fileIds.length === 0)
        return list.map(a => ({...a, file: null}))

    const files = await prisma.file.findMany({
        where: {id: {in: fileIds}},
        select: {id: true, name: true, url: true, mimiType: true, size: true}
    })
    const fileMap = new Map(files.map(f => [f.id, f]))
    return list.map(a => ({...a, file: a.fileId ? (fileMap.get(a.fileId) ?? null) : null}))
}

const getAssignments = async (classId)=>{
    const targetClass = await utils.getClassById(classId);
    if(!targetClass)
        throw new NotFoundError("Class not found")

    const select = {submissionDeadline:true, evaluationDeadline:true, evaluationDurationMinutes:true, id: true, name: true, description: true, max_score:true, req_eval:true,
            created_at: true, classid:true, fileId:true, groupSize:true, pass_threshold:true}
    const assignments = await utils.getAssignments(parseInt(classId), select)
    return await attachSubjectFile(assignments)
}

const getAssignmentById = async (assignId)=>{
    const select = {submissionDeadline:true, evaluationDeadline:true, evaluationDurationMinutes:true, id: true, classid: true, name: true, description: true, created_at: true,
            groupSize: true, req_eval: true, max_score: true, pass_threshold: true, subtype: true, fileId: true }
    const result = await utils.getAssignmentById(assignId, select, {
        groups: {
            include: {
                members: true, submissions: true, evalAssignmentsAsEvaluee: {include:{evalResponse:{select:responseSelect}}}
            }
        }
    })
    if(!result)
        throw new NotFoundError("Assignment not found")
    const decorated = (await attachSubjectFile(result))[0]
    decorated.groups = (result.groups ?? []).map(({submissions, evalAssignmentsAsEvaluee, ...group}) => {
      const submission = submissions?.[0]
      const overall = assignmentOutcome(result, (evalAssignmentsAsEvaluee ?? []).filter(p => !p.submissionId || p.submissionId === submission?.id), submission)
      return {...group, deadlineFailure:overall.deadlineFailure, workflowStatus:overall.workflowStatus, passed:overall.passed}
    })
    return decorated
}

const updateAssignment = async (assignId, {classId, name, description, groupSize, reqEval, maxScore, passThreshold, createdBy, evaluationDurationMinutes, submissionDeadline, evaluationDeadline}, reqFile)=>{
    if(!assignId ||!classId || !name|| !description || !groupSize || !reqEval|| !maxScore || !passThreshold )
        throw new ValidationError("Invalid request")

    const targetAssign = await utils.getAssignmentById(assignId)
    if(!targetAssign)
        throw new NotFoundError("Assignment not found")

    const targetClass = await utils.getClassById(classId)
    if(!targetClass)
        throw new NotFoundError("Class not found")

    const deadlines = assignmentDeadlines({submissionDeadline, evaluationDeadline}, targetAssign)
    const duration = evaluationDuration(evaluationDurationMinutes ?? targetAssign.evaluationDurationMinutes ?? 30)
    let fileId = targetAssign.fileId
    if (reqFile) {
        if (!createdBy)
            throw new ValidationError("createdBy is required to upload a subject file")

        const fileName = `assignment-${classId}-${Date.now()}-${reqFile.originalname}`
        await storage.upload(fileName, reqFile.buffer, reqFile.mimetype, reqFile.size)
        const fileData = {
            name: reqFile.originalname,
            mimiType: reqFile.mimetype,
            size: reqFile.size,
            url: storage.getPublicUrl(fileName),
            uploadedBy: parseInt(createdBy),
        }
        if (targetAssign.fileId) {
            const updatedFile = await prisma.file.update({ where: { id: targetAssign.fileId }, data: fileData })
            fileId = updatedFile.id
        } else {
            const newFile = await prisma.file.create({ data: fileData })
            fileId = newFile.id
        }
    }

    const result = await prisma.assignment.update({
        where: { id: parseInt(assignId) },
        data: { ...deadlines, evaluationDurationMinutes: duration, classid: parseInt(classId), name, description, groupSize: parseInt(groupSize), req_eval:parseInt(reqEval), max_score: parseInt(maxScore),
                    pass_threshold: parseInt(passThreshold), ...(reqFile && { fileId }) },
        select: {submissionDeadline:true, evaluationDeadline:true, evaluationDurationMinutes:true, id: true, classid: true, name: true, description: true, groupSize: true, req_eval: true, max_score: true,
            created_at: true, fileId: true}
    })
    return (await attachSubjectFile(result))[0]
}

const deleteAssignment = async (assignId)=>{
    const targetAssign = await getAssignmentById(assignId)
    if (!targetAssign)
        throw new NotFoundError('Assignment not found')

    await prisma.assignment.delete({where: {id: parseInt(assignId)}})

    return {
        message: 'Assignment deleted successfully',
        id: assignId }
}

module.exports = {getClasses, createClass, getClassById, getClassByOrgId, updateClass, deleteClass, getClassStudents,
    createAssignment, getAssignments, getAssignmentById, updateAssignment, deleteAssignment}
