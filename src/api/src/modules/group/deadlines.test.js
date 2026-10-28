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
