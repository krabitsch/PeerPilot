const {test}=require('node:test'), assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm')
const outcome=require('../eval/outcome'),errors=require('../../../../packages/errors')
test('student and staff group fetches derive the same result without writes or private evaluation data',async()=>{
  const assignment={id:1,req_eval:1,max_score:100,pass_threshold:50,submissionDeadline:new Date(Date.now()-1000)}
  const groups=[{id:2,assId:1,members:[],assignment,submissions:[],evalAssignmentsAsEvaluee:[]},
    {id:3,assId:1,members:[],assignment,submissions:[{id:4,status:'Close',fileId:5}],evalAssignmentsAsEvaluee:[]}]
  let query
  const db={group:{findMany:async q=>{query=q;return groups}}}
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/service.js','utf8'),{module,require:name=>{
    if(name==='../eval/outcome')return outcome
    if(name==='@transcendence/errors')return errors
    if(name==='@transcendence/database')return {prisma:db}
    if(name==='@transcendence/utils')return {getAssignmentById:async()=>assignment,existingMembership:async()=>({group:groups[0]})}
    if(name==='../participation/service')return {}
    if(name==='./history')return require('./history')
    throw Error(name)
  }})
  const staff=await module.exports.getGroupsForAssignment(1)
  const student=await module.exports.getMyGroupForAssignment({userId:7,assId:1})
  assert.equal(staff[0].workflowStatus,'Failed');assert.equal(student.workflowStatus,'Failed')
  assert.equal(staff[1].deadlineFailure,false);assert.equal(query.where.assId,1)
  assert.equal(student.evalAssignmentsAsEvaluee,undefined);assert.equal(student.submissions,undefined)
  assert.equal(groups[0].workflowStatus,undefined)
  assignment.submissionDeadline=null
  assert.equal((await module.exports.getMyGroupForAssignment({userId:7,assId:1})).deadlineFailure,false)
})
test('staff group list summarises who submitted, without exposing more than status and counts',async()=>{
  const assignment={id:1,req_eval:1,max_score:100,pass_threshold:50,submissionDeadline:null}
  const closedAt=new Date('2026-11-01T10:00:00Z')
  const groups=[
    {id:1,assId:1,members:[],submissions:[],evalAssignmentsAsEvaluee:[]},
    {id:2,assId:1,members:[],submissions:[{id:20,status:'Open',fileId:null,closedAt:new Date(),fileVersions:[]}],evalAssignmentsAsEvaluee:[]},
    {id:3,assId:1,members:[],submissions:[{id:30,status:'Open',fileId:9,closedAt:new Date(),fileVersions:[]}],evalAssignmentsAsEvaluee:[]},
    {id:4,assId:1,members:[],submissions:[{id:40,status:'Close',fileId:9,closedAt,fileVersions:[{id:1},{id:2}]}],evalAssignmentsAsEvaluee:[]},
  ]
  let query
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/service.js','utf8'),{module,require:name=>{
    if(name==='../eval/outcome')return outcome
    if(name==='@transcendence/errors')return errors
    if(name==='@transcendence/database')return {prisma:{group:{findMany:async q=>{query=q;return groups}}}}
    if(name==='@transcendence/utils')return {getAssignmentById:async()=>assignment}
    if(name==='../participation/service')return {}
    if(name==='./history')return require('./history')
    throw Error(name)
  }})
  const list=await module.exports.getGroupsForAssignment(1)
  // The service runs in a vm context, so compare plain JSON (cross-realm objects).
  assert.deepEqual(JSON.parse(JSON.stringify(list.map(g=>g.submission))),[
    {status:'NotStarted',fileCount:0,submittedAt:null},
    {id:20,status:'Open',fileCount:0,submittedAt:null},
    {id:30,status:'Uploaded',fileCount:1,submittedAt:null},
    {id:40,status:'Submitted',fileCount:3,submittedAt:closedAt.toISOString()},
  ])
  // Only version ids are loaded for the count, not file rows.
  assert.deepEqual(JSON.parse(JSON.stringify(query.include.submissions)),{include:{fileVersions:{select:{id:true}}}})
  assert.equal(list[0].submissions,undefined)
})
