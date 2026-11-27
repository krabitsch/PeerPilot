// Per-student exports: only what involves the student, labelled received/given.
const {test}=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm'),fs=require('node:fs')
const plain=v=>JSON.parse(JSON.stringify(v))   // service runs in a vm context

const assignment={id:1,name:'Assignment',class:{name:'Course'},max_score:100,pass_threshold:50,evalSheet:{sections:[{id:1,name:'Content'}]}}
const own={id:4,name:'eve-group'},other={id:9,name:'zoe-group'}
const response=(id,userId,group,extra={})=>({id,subId:group.id*10,userId,isStaffReview:false,givenMarks:70,coreScore:70,
  comment:`comment ${id}`,reply:`reply ${id}`,scores:[{sectionId:1,score:70}],user:{username:userId===5?'eve':'zoe',email:'x@example.com'},
  submission:{group},recordingFile:{name:'audio.webm',url:`rec-${id}`,size:1000},evalAssignment:{id,round:1},...extra})
const pairing=(id,evalueeGroup,evaluatorUserId,r)=>({id,round:1,evalueeGroupId:evalueeGroup.id,evaluatorUserId,submissionId:evalueeGroup.id*10,
  evalResponseId:r.id,createdAt:new Date(2026,0,id),status:'Submitted',evalueeGroup,evaluatorUser:{username:evaluatorUserId===5?'eve':'zoe',email:'x@example.com'},evalResponse:r})

function harness({group=own}={}){
  const received=response(1,7,own),given=response(2,5,other)
  const q={}
  const db={
    assignment:{findUnique:async()=>assignment},
    user:{findUnique:async({where})=>where.id===5?{id:5,username:'eve'}:null},
    group:{findFirst:async a=>{q.group=a;return group},findMany:async()=>{throw Error('scoped export must not list all groups')}},
    evalAssignment:{findMany:async a=>{q.pairings=a;return [pairing(1,own,7,received),pairing(2,other,5,given)].filter(p=>group||p.evaluatorUserId===5)}},
    evalResponse:{findMany:async a=>{q.responses=a;return [received,given].filter(r=>group||r.userId===5)},count:async a=>{q.count=a;return group?2:1}},
  }
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/service.js','utf8'),{module,Date,require:name=>{
    if(name==='@transcendence/database')return {prisma:db}
    if(name==='@transcendence/errors')return require('../../../../packages/errors')
    if(name==='@transcendence/filemanager')return {createStorage:()=>({})}
    if(name==='@transcendence/utils')return {getSubmissionsBy:async where=>{q.submissions=where
      return [{id:40,groupId:4,group:own,createdAt:new Date(),file:{id:1,name:'report.pdf',url:'orig',size:500},fileVersions:[]}]}}
    return require(name)
  }})
  return {service:module.exports,q}
}

test('student CSV keeps their group\'s received evaluations and the ones they gave, labelled',async()=>{
  const {service,q}=harness()
  const {csv,filenameBase}=await service.buildEvaluationsCsv(1,{studentId:'5'})
  const [header,...rows]=csv.trim().split('\r\n')
  assert(header.startsWith('direction,evalueeGroup,'))
  assert.deepEqual(rows.map(r=>r.split(',')[0]),['received','given'])
  for(const text of ['comment 1','reply 1','comment 2','reply 2']) assert(csv.includes(text),text)
  assert.equal(filenameBase,'Course-Assignment-eve')
  assert.deepEqual(plain(q.group.where),{assId:1,members:{some:{userId:5}}})
  assert.deepEqual(plain(q.pairings.where.OR),[{evalueeGroupId:4},{evaluatorUserId:5}])
  assert.deepEqual(plain(q.responses.where.OR),[{submission:{groupId:4}},{userId:5}])
})

test('student ZIP plan: only their group\'s files, recordings split into received/given',async()=>{
  const {service,q}=harness()
  const plan=await service.planArchive(1,{studentId:5})
  assert.deepEqual(plain(q.submissions),{groupId:4})
  assert.deepEqual(plain(plan.submissionEntries.map(e=>e.key)),['orig'])
  assert.deepEqual(plain(plan.recordingEntries.map(e=>e.path.split('/').slice(0,2).join('/'))),['recordings/received','recordings/given'])
  assert.equal(plan.totalBytes,500+1000+1000)
  assert(plan.manifest.includes('Student: eve'))
  assert(plan.manifest.includes('Group: eve-group'))
  assert.deepEqual(plain(q.count.where.OR),[{submission:{groupId:4}},{userId:5}])
})

test('an unallocated student gets the evaluations they gave and no submission',async()=>{
  const {service,q}=harness({group:null})
  const plan=await service.planArchive(1,{studentId:5})
  assert.equal(q.submissions,undefined,'no submission query without a group')
  assert.equal(plan.submissionEntries.length,0)
  assert.deepEqual(plain(q.pairings.where.OR),[{evaluatorUserId:5}])
  assert.deepEqual(plain(q.responses.where.OR),[{userId:5}])
  assert.deepEqual(plain(plan.recordingEntries.map(e=>e.path.split('/')[1])),['given'])
  assert(plan.manifest.includes('(no group in this assignment)'))
})

test('bad or unknown student ids are refused before anything is exported',async()=>{
  const {service}=harness()
  await assert.rejects(service.buildEvaluationsCsv(1,{studentId:'abc'}),/Invalid student id/)
  await assert.rejects(service.planArchive(1,{studentId:99}),/Student not found/)
})
