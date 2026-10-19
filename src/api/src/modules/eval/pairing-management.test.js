const {test}=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path')
const errors=require('../../../../packages/errors')
const outcome=require('./outcome')
const user=(id,role='Student')=>({id,role,username:`user${id}`,email:`user${id}@example.com`})
const group=(id,ids)=>({id,assId:1,name:`group${id}`,size:ids.length,leaderId:ids[0],members:ids.map(id=>({userId:id,user:user(id)}))})
const assignment={id:1,classid:1,name:'Assignment',class:{id:1,name:'Course',org_id:7},req_eval:2,max_score:100,pass_threshold:50,groupSize:2}
const staff={userId:20,role:'Bocal',orgId:7}
const load=(filename,db,extra={})=>{
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,Date,require:name=>{
    if(name==='@transcendence/database')return {prisma:db}
    if(name==='@transcendence/errors')return errors
    if(name in extra)return extra[name]
    return require(name)
  }})
  return module.exports
}
function harness(){
  const state={users:[user(1),user(2),user(3),user(4),user(20,'Bocal'),user(21,'Admin')],overrides:[],groups:[group(1,[1]),group(2,[2])],pairings:[],queries:[]}
  const db={
    assignment:{findUnique:async()=>assignment},
    user:{findMany:async q=>{state.queries.push(q);return state.users}},
    assignmentParticipation:{findMany:async()=>state.overrides,upsert:async({create,update})=>{
      const old=state.overrides.find(p=>p.userId===create.userId)
      if(old)Object.assign(old,update);else state.overrides.push({...create})
    }},
    group:{findMany:async()=>state.groups,findUnique:async({where})=>state.groups.find(g=>g.id===where.id),
      findFirst:async({where})=>state.groups.find(g=>g.name===where.name),
      create:async({data})=>{const g=group(state.groups.length+1,data.members.create.map(m=>m.userId));Object.assign(g,{name:data.name,size:data.size});state.groups.push(g);return g}},
    groupMember:{findFirst:async({where})=>state.groups.flatMap(g=>g.members).find(m=>m.userId===where.userId)},
    evalAssignment:{findMany:async({where})=>state.pairings.filter(p=>where.assignmentId?p.assignmentId===where.assignmentId:p.status!=='Cancelled'),
      findUnique:async({where})=>state.pairings.find(p=>where.passKey?p.passKey===where.passKey:p.id===where.id),
      create:async({data})=>{
        assert(!state.pairings.some(p=>p.assignmentId===data.assignmentId&&p.evalueeGroupId===data.evalueeGroupId&&p.evaluatorUserId===data.evaluatorUserId&&p.round===data.round))
        const row={...data,id:state.pairings.length+1,status:'Pending',createdAt:new Date(),evalResponseId:null,submissionId:null,evalResponse:null}
        state.pairings.push(row);return row
      },updateMany:async({where,data})=>{const row=state.pairings.find(p=>p.id===where.id&&p.status===where.status&&p.evalResponseId===where.evalResponseId)
        if(!row)return {count:0};Object.assign(row,data);return {count:1}}
    },$queryRaw:async()=>[],
  }
  db.$transaction=async fn=>{const saved=structuredClone(state);try{return await fn(db)}catch(e){Object.assign(state,saved);throw e}}
  const participation=load(path.join(__dirname,'../participation/service.js'),db)
  const management=load(path.join(__dirname,'pairing-management.js'),db,{'../participation/service':participation,'./outcome':outcome})
  const groups=load(path.join(__dirname,'../group/service.js'),db,{'../participation/service':participation,'@transcendence/utils':{}})
  return {state,db,participation,management,groups}
}
const failure=(id,evaluatorUserId,round=1)=>({id,assignmentId:1,evalueeGroupId:1,evaluatorUserId,round,status:'Submitted',createdAt:new Date(id*1000),
  submissionId:1,evalResponseId:id,passKey:'123456',retryRequested:true,evaluatorUser:user(evaluatorUserId),
  evalResponse:{id,userId:evaluatorUserId,subId:1,givenMarks:20,isStaffReview:false,reply:'Answered',recordingFileId:1}})

test('A/B: sparse defaults and course roster scope; staff remain excluded without explicit overrides',async()=>{
  const h=harness(),r=await h.participation.getParticipation(1,staff)
  assert(r.participants.filter(p=>p.role==='Student').every(p=>p.evalueeEligible&&p.evaluatorEligible))
  assert(r.participants.filter(p=>p.role!=='Student').every(p=>!p.evalueeEligible&&!p.evaluatorEligible))
  assert.equal(h.state.overrides.length,0)
  assert.equal(h.state.queries[0].where.OR[0].enrollments.some.status,'Active')
  assert.equal(h.state.queries[0].where.OR[1].orgId,7)
})
test('C/D/E/F: independent eligibility drives groups and supports evaluator-only staff',async()=>{
  const h=harness();h.state.groups=[]
  await h.participation.updateParticipation(1,[{userId:1,evalueeEligible:false},{userId:2,evaluatorEligible:false},{userId:20,evaluatorEligible:true}],staff)
  await h.groups.generateGroups(1,staff)
  const grouped=h.state.groups.flatMap(g=>g.members.map(m=>m.userId))
  assert(!grouped.includes(1));assert(!grouped.includes(20));assert(!grouped.includes(21));assert(grouped.includes(2))
  const r=await h.management.getSummary(1,staff)
  assert(r.slots.some(s=>s.candidateIds.includes(1)))
  assert(r.slots.some(s=>s.candidateIds.includes(20)))
  assert(r.slots.every(s=>!s.candidateIds.includes(2)))
  const slot=r.slots.find(s=>s.candidateIds.includes(20))
  const row=await h.management.createPairing({assignmentId:1,evalueeGroupId:slot.groupId,round:slot.round,evaluatorUserId:20},staff)
  assert.equal(row.evaluatorGroupId,null)
})
test('G: disabling grouped evaluee is rejected atomically and groups remain unchanged',async()=>{
  const h=harness(),before=JSON.stringify(h.state.groups)
  await assert.rejects(h.participation.updateParticipation(1,[{userId:3,evaluatorEligible:false},{userId:1,evalueeEligible:false}],staff),/already assigned to a group/)
  assert.equal(JSON.stringify(h.state.groups),before);assert.equal(h.state.overrides.length,0)
  await assert.rejects(h.groups.createGroup({assId:1,userId:20,name:'staff',size:1},staff),/not eligible/)
})
test('H/I/J: workload includes retries, excludes cancellation, and course total takes priority',async()=>{
  const h=harness();h.state.pairings=[{id:10,assignmentId:2,evaluatorUserId:3,status:'Pending'},
    {id:11,assignmentId:2,evaluatorUserId:3,status:'Submitted'},
    {id:12,assignmentId:2,evaluatorUserId:4,status:'Cancelled'},failure(13,4)]
  const r=await h.management.getSummary(1,staff)
  assert.equal(r.participants.find(p=>p.id===3).courseCount,2)
  assert.equal(r.participants.find(p=>p.id===4).courseCount,1)
  assert.equal(r.participants.find(p=>p.id===4).assignmentCount,1)
  const slot=r.slots.find(s=>s.groupId===2&&s.round===1)
  // User 1 has zero course workload and is valid for group 2.
  assert.equal(slot.candidateIds[0],1)
  h.state.groups=[group(1,[1,2])];h.state.pairings=[{id:10,assignmentId:2,evaluatorUserId:3,status:'Pending'},{id:11,assignmentId:2,evaluatorUserId:3,status:'Submitted'}]
  await h.management.generateMissing(1,{},staff)
  assert.equal(h.state.pairings.find(p=>p.assignmentId===1).evaluatorUserId,4)
})
test('K/U: manual creation rejects self-evaluation and ineligible evaluators',async()=>{
  const h=harness()
  await assert.rejects(h.management.createPairing({assignmentId:1,evalueeGroupId:1,round:1,evaluatorUserId:1},staff),/eligible evaluator/)
  await assert.rejects(h.management.createPairing({assignmentId:1,evalueeGroupId:1,round:1,evaluatorUserId:20},staff),/eligible evaluator/)
  await assert.rejects(h.management.createPairing({assignmentId:1,evalueeGroupId:1,round:99,evaluatorUserId:3},staff),/eligible evaluator/)
})
test('L/M/N/O/P/Q/R: requested retries create new same-round attempts/keys, preserve failure, repeated generation is idempotent',async()=>{
  const h=harness();h.state.pairings=[failure(1,2)]
  const original=JSON.stringify(h.state.pairings[0])
  let r=await h.management.getSummary(1,staff),slot=r.slots.find(s=>s.groupId===1&&s.round===1)
  assert.equal(slot.kind,'RetryRequired');assert(!slot.candidateIds.includes(2))
  await h.management.generateMissing(1,{participants:h.state.users.map(p=>({userId:p.id,evaluatorEligible:p.role==='Student'}))},staff)
  assert.equal(h.state.overrides.length,0)
  assert.equal(JSON.stringify(h.state.pairings[0]),original)
  const replacement=h.state.pairings.find(p=>p.evalueeGroupId===1&&p.round===1&&p.status==='Pending')
  assert(replacement);assert.notEqual(replacement.evaluatorUserId,2);assert.notEqual(replacement.passKey,h.state.pairings[0].passKey)
  assert.match(replacement.passKey,/^\d{6}$/)
  const before=JSON.stringify(h.state.pairings)
  assert.equal((await h.management.generateMissing(1,{},staff)).count,0)
  assert.equal(JSON.stringify(h.state.pairings),before)
})
test('S/T: manual creation accepts initial and retry slots only, preserving current pending pairings',async()=>{
  const h=harness()
  await h.management.createPairing({assignmentId:1,evalueeGroupId:1,round:1,evaluatorUserId:3},staff)
  await assert.rejects(h.management.createPairing({assignmentId:1,evalueeGroupId:1,round:1,evaluatorUserId:4},staff),/eligible evaluator/)
  h.state.pairings=[failure(1,2),failure(2,3)]
  const r=await h.management.getSummary(1,staff),slot=r.slots.find(s=>s.groupId===1&&s.round===1)
  assert(!slot.candidateIds.includes(2));assert(!slot.candidateIds.includes(3))
  const row=await h.management.createPairing({assignmentId:1,evalueeGroupId:1,round:1,evaluatorUserId:4},staff)
  assert.equal(row.round,1);assert.equal(h.state.pairings.length,3)
})
test('existing pending tasks survive eligibility changes; cancellations preserve history and workload definitions',async()=>{
  const h=harness()
  const row=await h.management.createPairing({assignmentId:1,evalueeGroupId:1,round:1,evaluatorUserId:3},staff)
  await h.participation.updateParticipation(1,[{userId:3,evaluatorEligible:false}],staff)
  let r=await h.management.getSummary(1,staff)
  assert(!r.slots.some(s=>s.groupId===1&&s.round===1))
  assert.equal(r.participants.find(p=>p.id===3).assignmentCount,1)
  await h.management.cancelPairing(row.id,staff)
  assert.equal(h.state.pairings.length,1);assert.equal(row.status,'Cancelled')
  r=await h.management.getSummary(1,staff);assert.equal(r.participants.find(p=>p.id===3).assignmentCount,0)
  h.state.pairings=[failure(1,2)]
  await assert.rejects(h.management.cancelPairing(1,staff),/Only pending/)
})
test('feedback awaiting response/recording and unrequested failures stay outside rematch queue',async()=>{
  const h=harness(),p=failure(1,2);h.state.pairings=[p]
  for(const change of [{retryRequested:false},{retryRequested:true,evalResponse:{...p.evalResponse,reply:null}},{evalResponse:{...p.evalResponse,recordingFileId:null}}]){
    Object.assign(p,change)
    const r=await h.management.getSummary(1,staff)
    assert(!r.slots.some(s=>s.groupId===1&&s.round===1))
  }
})
test('group exclusions apply only to this generation; empty capacity leaves slots queued',async()=>{
  const h=harness();h.state.users=[user(1),user(2)]
  const r=await h.management.generateMissing(1,{groupIds:[1]},staff)
  assert.equal(r.count,2);assert.equal(r.unfilled.length,0)
  assert(h.state.pairings.every(p=>p.evalueeGroupId===1))
  assert.equal(h.state.groups.length,2)
  h.state.users=[user(1)];h.state.pairings=[]
  const empty=await h.management.generateMissing(1,{groupIds:[1]},staff)
  assert.equal(empty.count,0);assert.equal(empty.unfilled.length,2)
})
test('W: service refuses students and other organisations',async()=>{
  const h=harness()
  await assert.rejects(h.management.getSummary(1,{role:'Student',orgId:7}),/cannot manage/)
  await assert.rejects(h.participation.updateParticipation(1,[],{role:'Bocal',orgId:8}),/cannot manage/)
  await assert.rejects(h.management.generateMissing(1,{}, {role:'Student',orgId:7}),/cannot manage/)
})

test('W: every management route rejects a student before calling a service; authenticated actor controls scope',async()=>{
  const routes=[],router={};let actor
  for(const method of ['get','post','put','patch','delete']) router[method]=(url,...handlers)=>routes.push({method,url,handlers})
  const guard=(req,res,next)=>['Bocal','Admin'].includes(req.user.role)?next():next(new errors.ForbiddenError('Insufficient permissions'))
  const management={getSummary:async(id,who)=>{actor=who;return{}},cancelPairing:async()=>({})}
  const participation={getParticipation:async()=>({}),updateParticipation:async()=>({})}
  load(path.join(__dirname,'routes.js'),{}, {'express':{Router:()=>router},'./service':{},'./pairing-management':management,'../participation/service':participation,
    '../../middleware/authenticate':{requireStaff:guard},'@transcendence/filemanager':{recordingUploader:{single:()=>()=>{}}}})
  const protectedRoutes=routes.filter(r=>r.url.includes('management')||r.url.includes('participation')||
    r.url.includes('generate-simple-pairings')||(r.url.includes('eval-assignments')&&r.method!=='get'&&!r.url.endsWith('/retry')))
  assert(protectedRoutes.length>=8)
  for(const r of protectedRoutes){let denied;r.handlers[0]({user:{role:'Student'}},{},e=>denied=e);assert.match(denied.message,/Insufficient permissions/)}
  await routes.find(r=>r.url.endsWith('/management')).handlers[1]({params:{id:1},user:staff,body:{orgId:999}}, {json(){}},e=>{throw e})
  assert.equal(actor.orgId,7)
})

test('group deletion refuses submission/evaluation history instead of cascading it away',async()=>{
  const h=harness();h.state.groups[0]._count={submissions:1,evalAssignmentsAsEvaluee:0}
  await assert.rejects(h.groups.deleteGroup(1,staff),/history.*cannot be deleted/)
  h.state.groups[0]._count={submissions:0,evalAssignmentsAsEvaluee:1}
  await assert.rejects(h.groups.deleteGroup(1,staff),/history.*cannot be deleted/)
  assert.equal(h.state.groups.length,2)
})
