const crypto = require('crypto')
const { prisma } = require('@transcendence/database')
const { ValidationError, ConflictError, NotFoundError } = require('@transcendence/errors')
const encounters = require('./encounters')
const participation = require('../participation/service')
const { summarizeEvaluationRounds, evaluationOutcome, responseSelect } = require('./outcome')

const buildSummary = (assignment,participants,groups,pairings,workloads) => {
  const counts=new Map(participants.map(p=>[p.id,{assignmentCount:0,courseCount:0}]))
  for (const task of workloads.filter(p=>p.status!=='Cancelled')) {
    const count=counts.get(task.evaluatorUserId)
    if (count) { count.courseCount++; if(task.assignmentId===assignment.id) count.assignmentCount++ }
  }
  const people=participants.map(p=>({...p,...counts.get(p.id)}))
  const eligibleIds=new Set(people.filter(p=>p.evalueeEligible).map(p=>p.id))
  // Dropped students stay in groups that have history; only current participants decide eligibility.
  const participantIds=new Set(people.map(p=>p.id))
  const evalueeGroups=groups.map(g=>{
    const current=g.members.filter(m=>participantIds.has(m.userId))
    return {...g,eligible:current.length>0 && current.every(m=>eligibleIds.has(m.userId))}
  })
  const used=encounters.usedEncounters(pairings,groups)
  const slots=[]
  for (const group of evalueeGroups.filter(g=>g.eligible)) {
    const attempts=pairings.filter(p=>p.evalueeGroupId===group.id)
    const rounds=summarizeEvaluationRounds(assignment,attempts).evaluationRounds
    for (const round of rounds) {
      if (round.attemptIds.length && !round.waitingForRematch) continue
      const failed=attempts.filter(p=>p.round===round.round && evaluationOutcome(p,assignment)==='Failed')
      const excluded=new Set([
        ...group.members.map(m=>m.userId),
        // Unique pairing identity also prevents reusing a cancelled historical tuple.
        ...attempts.filter(p=>p.round===round.round).map(p=>p.evaluatorUserId),
        ...failed.map(p=>p.evaluatorUserId)
      ])
      const previousEvaluatorIds=failed.map(p=>p.evaluatorUserId)
      const candidates=people.filter(p=>p.evaluatorEligible&&!excluded.has(p.id)&&
          encounters.available({groupId:group.id},p.id,groups,used))
        .map(p=>({...p,alreadyEvaluated:attempts.some(a=>a.evaluatorUserId===p.id&&a.status!=='Cancelled')}))
        .sort((a,b)=>a.courseCount-b.courseCount||a.assignmentCount-b.assignmentCount||
          Number(a.alreadyEvaluated)-Number(b.alreadyEvaluated)||a.id-b.id)
      slots.push({groupId:group.id,round:round.round,kind:round.waitingForRematch?'RetryRequired':'InitialMissing',
        previousEvaluatorIds,previousEvaluators:failed.map(p=>p.evaluatorUser?.username??`User ${p.evaluatorUserId}`),
        candidateIds:candidates.map(p=>p.id)})
    }
  }
  slots.sort((a,b)=>a.round-b.round||a.groupId-b.groupId)
  const grouped=new Set(groups.flatMap(g=>g.members.map(m=>m.userId)))
  return {assignment:{id:assignment.id,name:assignment.name,classid:assignment.classid,req_eval:assignment.req_eval,
      courseName:assignment.class.name},participants:people,groups:evalueeGroups,slots,
    ungrouped:people.filter(p=>p.evalueeEligible&&!grouped.has(p.id)),
    pairings:pairings.map(p=>({id:p.id,evalueeGroupId:p.evalueeGroupId,evaluatorUserId:p.evaluatorUserId,
      evaluatorGroupId:p.evaluatorGroupId,round:p.round,status:p.status,evalResponseId:p.evalResponseId,
      evaluatorName:p.evaluatorUser?.username??`User ${p.evaluatorUserId}`,
      outcome:evaluationOutcome(p,assignment),retryRequested:p.retryRequested}))}
}
const loadSummary = async (db,assignment) => {
  const [participants,groups,pairings,workloads]=await Promise.all([
    participation.participantsFor(db,assignment),
    db.group.findMany({where:{assId:assignment.id},orderBy:{id:'asc'},include:{members:{orderBy:{userId:'asc'},
      include:{user:{select:{id:true,username:true,email:true}}}}}}),
    db.evalAssignment.findMany({where:{assignmentId:assignment.id},orderBy:{id:'asc'},include:{
      evaluatorUser:{select:{id:true,username:true}},evalResponse:{select:responseSelect}}}),
    db.evalAssignment.findMany({where:{assignment:{classid:assignment.classid},status:{not:'Cancelled'}},
      select:{assignmentId:true,evaluatorUserId:true,status:true}})
  ])
  return buildSummary(assignment,participants,groups,pairings,workloads)
}
const getSummary = async (id,actor) => loadSummary(prisma,await participation.assignmentForStaff(prisma,id,actor))
const newPairing = async (db,assignment,summary,slot,userId) => {
  if (slot && encounters.usedEncounters(summary.pairings,summary.groups).has(
    encounters.keyFor({evaluatorUserId:userId,evalueeGroupId:slot.groupId},summary.groups)))
    throw new ConflictError(encounters.DUPLICATE)
  if (!slot?.candidateIds.includes(userId)) throw new ValidationError('Select an eligible evaluator for a currently missing or retry slot')
  let passKey
  for (let attempt=0;attempt<20;attempt++) {
    const candidate=String(crypto.randomInt(0,1000000)).padStart(6,'0')
    if (!await db.evalAssignment.findUnique({where:{passKey:candidate}})) {passKey=candidate;break}
  }
  if (!passKey) throw new ConflictError('Could not generate a unique evaluation passkey; please try again')
  const evaluatorGroup=summary.groups.find(g=>g.members.some(m=>m.userId===userId))
  return db.evalAssignment.create({data:{assignmentId:assignment.id,evalueeGroupId:slot.groupId,
    evaluatorUserId:userId,evaluatorGroupId:evaluatorGroup?.id??null,round:slot.round,passKey}})
}
const createPairing = (payload,actor) => participation.withAssignment(payload.assignmentId,actor,async(db,a)=>{
  const summary=await loadSummary(db,a)
  const slot=summary.slots.find(s=>s.groupId===participation.positiveId(payload.evalueeGroupId)&&s.round===Number(payload.round))
  return newPairing(db,a,summary,slot,participation.positiveId(payload.evaluatorUserId))
})
const generateMissing = (id,{groupIds,participants,slots:selectedSlots}={},actor) => participation.withAssignment(id,actor,async(db,a)=>{
  if (participants!==undefined) await participation.saveOverrides(db,a,participants)
  let summary=await loadSummary(db,a)
  if (groupIds!==undefined && (!Array.isArray(groupIds)||groupIds.some(id=>!summary.groups.some(g=>g.id===id&&g.eligible))))
    throw new ValidationError('Select valid evaluee groups')
  const included=new Set(groupIds??summary.groups.filter(g=>g.eligible).map(g=>g.id))
  if (selectedSlots !== undefined && (!Array.isArray(selectedSlots) || selectedSlots.some(s =>
    !summary.slots.some(valid => valid.groupId === s.groupId && valid.round === s.round))))
    throw new ValidationError('Select currently missing or retry pairing slots')
  const slots=summary.slots.filter(s=>included.has(s.groupId) && (selectedSlots === undefined ||
    selectedSlots.some(selected => selected.groupId === s.groupId && selected.round === s.round)))
  const plan=encounters.planPairings(a,summary,slots)
  // Search and full-set validation finish before the first insert. The existing
  // course lock and transaction cover manual generation, retries and overrides.
  const created=[]
  for (const row of plan) {
    const slot=slots.find(s=>s.groupId===row.evalueeGroupId&&s.round===row.round)
    created.push(await newPairing(db,a,summary,slot,row.evaluatorUserId))
  }
  return {count:created.length,unfilled:[],message:`Created ${created.length} missing pairings without repeated encounters.`}
})
// Cancelling pending work retains history and never deletes a submitted response.
const cancelPairing = async (id,actor) => {
  const row=await prisma.evalAssignment.findUnique({where:{id:participation.positiveId(id)}})
  if (!row) throw new NotFoundError('Evaluation assignment not found')
  return participation.withAssignment(row.assignmentId,actor,async(db)=>{
    const changed=await db.evalAssignment.updateMany({where:{id:row.id,status:'Pending',evalResponseId:null},data:{status:'Cancelled'}})
    if(changed.count!==1) throw new ConflictError('Only pending evaluations without submitted feedback can be cancelled')
    return {id:row.id,message:'Pending pairing cancelled; history preserved'}
  })
}
// Reset only unperformed work. Lock rows against concurrent submission, and
// retain every completed attempt/response rather than partially resetting a batch.
const deleteAllPairings = (id,actor) => participation.withAssignment(id,actor,async(db,a)=>{
  await db.$queryRaw`SELECT id FROM "evalAssignment" WHERE "assignmentId" = ${a.id} ORDER BY id FOR UPDATE`
  const rows=await db.evalAssignment.findMany({where:{assignmentId:a.id}})
  if(rows.some(p=>p.status==='Submitted'||p.evalResponseId!=null))
    throw new ConflictError('This assignment has completed evaluations or evaluation responses. Its pairings cannot be reset; existing academic records must be preserved.')
  const result=await db.evalAssignment.deleteMany({where:{assignmentId:a.id,status:{in:['Pending','Cancelled']},evalResponseId:null}})
  if(result.count!==rows.length) throw new ConflictError('Pairings changed while resetting. Please reload and try again.')
  return {assignmentId:a.id,count:result.count,message:`Deleted ${result.count} evaluation pairings.`}
})
module.exports={buildSummary,loadSummary,getSummary,createPairing,generateMissing,cancelPairing,deleteAllPairings}
