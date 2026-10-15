const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm')
const errors=require('../../../../packages/errors')
const harness=()=>{
  const course={id:1,externalCourseCodes:['1268','1269','1421'],term:'Fall 2026'}
  const assignment={id:2,classid:1,name:'A',fileId:null,evaluationDurationMinutes:30}
  let enrolled=0,allowed=0
  const db={
    class:{create:async({data})=>({...course,...data}),findUnique:async()=>course,update:async({data})=>Object.assign(course,data)},
    enrollment:{count:async()=>enrolled},allowedEnrollment:{count:async()=>allowed},
    assignment:{create:async({data})=>({...assignment,...data}),update:async({data})=>Object.assign(assignment,data)},
  };db.$transaction=fn=>fn(db)
  const utils={getOrgById:async()=>({id:1}),getUserById:async()=>({id:1}),getClassById:async()=>course,getAssignmentById:async()=>assignment,getAssignmentByName:async()=>null}
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/service.js','utf8'),{module,require:name=>{
    if(name==='@transcendence/database')return {prisma:db}
    if(name==='@transcendence/errors')return errors
    if(name==='@transcendence/utils')return utils
    if(name==='@transcendence/filemanager')return {createStorage:()=>({ensureBucket:async()=>{},makePublic:async()=>{}})}
    if(name==='@transcendence/logger')return {error(){}}
    throw Error(name)
  }})
  return {service:module.exports,course,assignment,set enrolled(v){enrolled=v},set allowed(v){allowed=v}}
}
const fields={org_id:1,created_by:1,name:'Course',description:'Description',pass_threshold:80}
const assFields={classId:1,name:'Assignment',description:'Description',groupSize:2,reqEval:3,maxScore:100,passThreshold:50,createdBy:1}
test('course creation/edit accepts term and distinct trimmed codes',async()=>{
  const h=harness()
  const created=await h.service.createClass({...fields,term:' Spring 2027 ',externalCourseCodes:['1268',' 1268 ','9999']})
  assert.equal(created.term,'Spring 2027');assert.equal(created.externalCourseCodes.join(','),'1268,9999')
  await h.service.updateClass(1,{...fields,term:'Fall 2027',externalCourseCodes:['1268','1421','7777']})
  assert.equal(h.course.term,'Fall 2027');assert.equal(h.course.externalCourseCodes.join(','),'1268,1421,7777')
})
for(const table of ['enrolled','allowed'])test(`in-use code removal is rejected for ${table} records without changes`,async()=>{
  const h=harness();h[table]=1
  await assert.rejects(h.service.updateClass(1,{...fields,term:'Changed',externalCourseCodes:['1268']}),/existing enrollments or whitelist records/)
  assert.equal(h.course.term,'Fall 2026');assert.equal(h.course.externalCourseCodes.length,3)
})
test('omitting optional metadata preserves it and malformed codes are rejected',async()=>{
  const h=harness();await h.service.updateClass(1,fields)
  assert.equal(h.course.term,'Fall 2026');assert.equal(h.course.externalCourseCodes.length,3)
  await assert.rejects(h.service.updateClass(1,{...fields,externalCourseCodes:'1268'}),/list of non-empty codes/)
})
test('new assignments default to 30 minutes and can be edited to 45',async()=>{
  const h=harness();const created=await h.service.createAssignment(1,assFields)
  assert.equal(created.evaluationDurationMinutes,30)
  await h.service.updateAssignment(2,{...assFields,evaluationDurationMinutes:'45'})
  assert.equal(h.assignment.evaluationDurationMinutes,45)
  await h.service.updateAssignment(2,assFields)
  assert.equal(h.assignment.evaluationDurationMinutes,45)
})
for(const duration of [0,4,181,30.5,'invalid'])test(`invalid duration ${duration} is rejected before writing`,async()=>{
  const h=harness()
  await assert.rejects(h.service.createAssignment(1,{...assFields,evaluationDurationMinutes:duration}),/5 to 180 minutes/)
  await assert.rejects(h.service.updateAssignment(2,{...assFields,evaluationDurationMinutes:duration}),/5 to 180 minutes/)
  assert.equal(h.assignment.evaluationDurationMinutes,30)
})
