const { prisma } = require('@transcendence/database')
const { NotFoundError, ValidationError, ForbiddenError, ConflictError } = require('@transcendence/errors')

const positiveId = value => {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new ValidationError('A valid positive ID is required')
  return id
}
const defaults = user => ({ evalueeEligible: user.role === 'Student', evaluatorEligible: user.role === 'Student' })
const assignmentForStaff = async (db, id, actor) => {
  const assignment = await db.assignment.findUnique({where:{id:positiveId(id)},include:{class:true}})
  if (!assignment) throw new NotFoundError('Assignment not found')
  if (!actor || !['Admin','Bocal'].includes(actor.role) ||
      (actor.role !== 'Admin' && actor.orgId !== assignment.class.org_id))
    throw new ForbiddenError('You cannot manage this course')
  return assignment
}
// Serializes participation/group/pairing writes across a course, including workload balancing.
const withAssignment = (id, actor, action) => prisma.$transaction(async db => {
  const assignment = await assignmentForStaff(db,id,actor)
  await db.$queryRaw`SELECT id FROM "class" WHERE id = ${assignment.classid} FOR UPDATE`
  return action(db,assignment)
}, {timeout:30000})

const participantsFor = async (db, assignment) => {
  const [users, overrides] = await Promise.all([
    db.user.findMany({where:{OR:[
      {enrollments:{some:{classId:assignment.classid,status:'Active'}}},
      {role:{in:['Bocal','Admin']},orgId:assignment.class.org_id,
        enrollments:{none:{classId:assignment.classid,status:'Dropped'}}}
    ]},select:{id:true,username:true,email:true,role:true},orderBy:{id:'asc'}}),
    db.assignmentParticipation.findMany({where:{assignmentId:assignment.id}})
  ])
  const byUser = new Map(overrides.map(p=>[p.userId,p]))
  return users.map(user=>({ ...user, ...defaults(user),
    ...(byUser.has(user.id) ? {evalueeEligible:byUser.get(user.id).evalueeEligible,
      evaluatorEligible:byUser.get(user.id).evaluatorEligible} : {}) }))
}
const saveOverrides = async (db, assignment, changes) => {
  if (!Array.isArray(changes)) throw new ValidationError('participants must be an array')
  const participants = await participantsFor(db,assignment)
  const groups = await db.group.findMany({where:{assId:assignment.id},include:{members:true}})
  const grouped = new Set(groups.flatMap(g=>g.members.map(m=>m.userId)))
  const seen = new Set()
  for (const change of changes) {
    if (!change || typeof change !== 'object' ||
      ('evalueeEligible' in change && typeof change.evalueeEligible !== 'boolean') ||
      ('evaluatorEligible' in change && typeof change.evaluatorEligible !== 'boolean'))
      throw new ValidationError('Participation eligibility must be boolean')
    const userId=positiveId(change.userId), person=participants.find(p=>p.id===userId)
    if (!person || seen.has(userId)) throw new ValidationError('Invalid or duplicate course participant')
    seen.add(userId)
    const evalueeEligible=change.evalueeEligible ?? person.evalueeEligible
    const evaluatorEligible=change.evaluatorEligible ?? person.evaluatorEligible
    if (typeof evalueeEligible !== 'boolean' || typeof evaluatorEligible !== 'boolean')
      throw new ValidationError('Participation eligibility must be boolean')
    if (evalueeEligible === person.evalueeEligible && evaluatorEligible === person.evaluatorEligible) continue
    if (change.evalueeEligible === false && grouped.has(userId)) throw new ConflictError(
      'This participant is already assigned to a group. Update the group allocation before excluding them as an evaluee.')
    await db.assignmentParticipation.upsert({where:{assignmentId_userId:{assignmentId:assignment.id,userId}},
      create:{assignmentId:assignment.id,userId,evalueeEligible,evaluatorEligible},update:{evalueeEligible,evaluatorEligible}})
  }
}
const getParticipation = async (id,actor) => {
  const assignment=await assignmentForStaff(prisma,id,actor)
  return {assignmentId:assignment.id,participants:await participantsFor(prisma,assignment)}
}
const updateParticipation = (id,changes,actor) => withAssignment(id,actor,async(db,a)=>{
  await saveOverrides(db,a,changes)
  return {assignmentId:a.id,participants:await participantsFor(db,a)}
})
const assertEvaluee = async (db,assignment,userId) => {
  const person=(await participantsFor(db,assignment)).find(p=>p.id===Number(userId))
  if (!person?.evalueeEligible) throw new ValidationError('Participant is not eligible as an evaluee for this assignment')
}
module.exports={positiveId,defaults,assignmentForStaff,withAssignment,participantsFor,saveOverrides,getParticipation,updateParticipation,assertEvaluee}
