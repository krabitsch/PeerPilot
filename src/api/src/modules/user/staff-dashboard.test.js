const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm'), fs = require('node:fs')
const moduleStub = { exports: {} }
let query
vm.runInNewContext(fs.readFileSync(__dirname + '/staff-dashboard.js','utf8'), {
  module: moduleStub, require: name => name === '@transcendence/database' ? { prisma: { class: { findMany: async q => { query=q; return [] } } } } : require('../eval/outcome'),
})
const { buildStaffDashboard, getStaffDashboard } = moduleStub.exports
const user = { id: 5, username: 'student42' }
const assignment = { id:1,name:'Assignment 1',created_at:'2026-10-01',description:'',fileId:null,req_eval:1,max_score:100,pass_threshold:50,evalSheet:null,groups:[],evalAssignments:[] }
const course = a => ({ id:1,name:'Course',description:'Description',term:'Fall 2026',enrollments:[{user}],assignments:[a] })
const failed = { id:1,assignmentId:1,evalueeGroupId:2,evaluatorUserId:6,round:1,status:'Submitted',submissionId:3,evalResponseId:4,createdAt:'2026-10-02',retryRequested:true,retryRequestedAt:'2026-10-03',evalResponse:{id:4,userId:6,subId:3,givenMarks:20,recordingFileId:1,reply:'Understood',isStaffReview:false} }
const grouped = { ...assignment, description:'Instructions',evalSheet:{sections:[{marks:100}]},groups:[{id:2,members:[{user}]}],evalAssignments:[failed] }
test('missing instructions, empty evaluation sheets and unassigned students are actionable', () => {
  const result=buildStaffDashboard([course(assignment)])
  assert.deepEqual(Array.from(result.actions,a=>a.kind).sort(),['groups','instructions','sheet'])
  assert(result.actions.find(a=>a.kind==='groups').label.includes('1 unassigned student.'))
  assert.equal(result.actions.find(a=>a.kind==='instructions').queryParams.assId,1)
})
test('instructions and valid sheets clear automatically; wrong mark total is detected', () => {
  let result=buildStaffDashboard([course({...grouped,evalAssignments:[]})])
  assert(!result.actions.some(a=>a.kind==='instructions'||a.kind==='sheet'))
  result=buildStaffDashboard([course({...grouped,evalSheet:{sections:[{marks:50}]}})])
  assert(result.actions.find(a=>a.kind==='sheet').label.includes('do not total 100'))
})
test('retry requests show actual group usernames, round and request time', () => {
  const result=buildStaffDashboard([course(grouped)])
  const action=result.actions.find(a=>a.kind==='rematch')
  assert(action.label.includes('student42'))
  assert(action.label.includes('Evaluation 1 of Assignment 1'))
  assert.equal(action.occurredAt,'2026-10-03')
})
test('unrequested failures, unanswered feedback and replacement pairings do not demand rematching', () => {
  for(const pairings of [
    [{...failed,retryRequested:false}],
    [{...failed,evalResponse:{...failed.evalResponse,reply:null}}],
    [failed,{...failed,id:2,status:'Pending',evalResponse:null,evalResponseId:null,createdAt:'2026-10-04'}],
    [failed,{...failed,id:2,createdAt:'2026-10-04',evalResponse:{...failed.evalResponse,givenMarks:80}}],
  ]) assert(!buildStaffDashboard([course({...grouped,evalAssignments:pairings})]).actions.some(a=>a.kind==='rematch'))
})
test('missing pairings are detected for populated groups with adequate group count', () => {
  const a={...grouped,groups:[...grouped.groups,{id:7,members:[{user:{id:6,username:'student46'}}]}],evalAssignments:[]}
  assert(buildStaffDashboard([{...course(a),enrollments:[{user},{user:{id:6}}]}]).actions.some(a=>a.kind==='pairings'))
})
test('only caller organisation is queried; data does not expose scores, replies or passkeys', async () => {
  await getStaffDashboard(3); assert.equal(query.where.org_id,3)
  assert.equal(query.select.enrollments.where.status,'Active')
  const text=JSON.stringify(buildStaffDashboard([course(grouped)]))
  for(const key of ['passKey','passkey','email','givenMarks','reply']) assert(!text.includes('"'+key+'"'))
  assert.equal((await getStaffDashboard(null)).actions.length,0)
})

test('staff route rejects students and scopes queries to the authenticated organisation', async () => {
  const routes=[],router={};let selectedOrg
  for(const method of ['get','post','put','patch','delete']) router[method]=(path,...handlers)=>routes.push({path,handlers})
  const staff=(req,res,next)=>['Bocal','Admin'].includes(req.user.role)?next():next(new Error('Forbidden'))
  vm.runInNewContext(fs.readFileSync(__dirname+'/routes.js','utf8'),{
    module:{exports:{}},require:name=>{
      if(name==='express')return {Router:()=>router}
      if(name==='./service')return {}
      if(name==='../../middleware/authenticate')return {requireStaff:staff,requireRole:()=>()=>{},requireSelfOrStaff:()=>()=>{}}
      if(name==='@transcendence/filemanager')return {uploader:{single:()=>()=>{}}}
      if(name==='./staff-dashboard')return {getStaffDashboard:async org=>{selectedOrg=org;return {actions:[]}}}
      throw Error(name)
    },
  })
  const route=routes.find(r=>r.path==='/me/staff-dashboard')
  let rejected
  route.handlers[0]({user:{role:'Student'}},{},e=>rejected=e)
  assert.equal(rejected.message,'Forbidden')
  await route.handlers[1]({user:{role:'Bocal',orgId:3},query:{orgId:99}},{json(){}},e=>{throw e})
  assert.equal(selectedOrg,3)
})
