// No real database or object storage: exercise authorization, writes and history.
const {test} = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const errors = require('../../../../packages/errors')
const outcome = require('../eval/outcome')
const harness = () => {
  const group = {id:2,leaderId:5,assignment:{id:1,class:{id:1},req_eval:1,max_score:100,pass_threshold:50},evalAssignmentsAsEvaluee:[]}
  let submission = null, locks = 0, starts = 0
  const files = [], uploaded = [], deleted = []
  let fileSequence = 0
  const include = () => submission && {...submission,file:files.find(f=>f.id===submission.fileId)??null,fileVersions:submission.fileVersions.map(v=>({...v,file:files.find(f=>f.id===v.fileId)}))}
  const db = {
    group:{findUnique:async()=>group},
    submission:{
      upsert:async({create})=>{ starts++; if(!submission) submission={id:3,passkey:'123456',fileVersions:[],...create}; return include() },
      findUnique:async()=>include(),
      update:async({data})=>{Object.assign(submission,data);return include()},
    },
    file:{create:async({data})=>{const file={id:++fileSequence,...data};files.push(file);return file},delete:async({where})=>{const i=files.findIndex(f=>f.id===where.id);return files.splice(i,1)[0]}},
    submissionFileVersion:{create:async({data})=>{const v={id:submission.fileVersions.length+1,createdAt:new Date(),...data};submission.fileVersions.push(v);return v}},
    evalResponse:{findMany:async()=>[]},
    $queryRaw:async()=>{locks++;return []},
  }
  db.$transaction = action=>action(db)
  const utils = {
    getGroupById:async()=>group,getUserById:async id=>({id}),isEnrolledAndActive:async()=>true,
    existingMembership:async userId=>[5,6,7].includes(Number(userId))?{groupId:2}:null,
    getLastSubmission:async()=>include(),
    getAssignmentById:async()=>group.assignment,
    getSubmissionsBy:async()=>submission?[include()]:[],
  }
  const storage={ensureBucket:async()=>{},makePublic:async()=>{},upload:async key=>uploaded.push(key),delete:async key=>deleted.push(key),getUrl:async key=>key}
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/service.js','utf8'),{module,Date,require:name=>{
    if (name === '../assignment/deadlines') return require('../assignment/deadlines')
    if(name==='@transcendence/database')return {prisma:db}
    if(name==='@transcendence/errors')return errors
    if(name==='@transcendence/utils')return utils
    if(name==='@transcendence/filemanager')return {createStorage:()=>storage}
    if(name==='@transcendence/logger')return {error(){}}
    if(name==='../eval/outcome')return outcome
    if(name==='./files')return require('./files')
    return require(name)
  }})
  const service=module.exports
  const start=userId=>service.createSubmission({groupId:2,userId,type:'FILE'})
  const file={originalname:'answers.pdf',mimetype:'application/pdf',size:10,buffer:Buffer.from('answers')}
  const retry=()=>group.evalAssignmentsAsEvaluee.push({id:8,round:1,assignmentId:1,evalueeGroupId:2,evaluatorUserId:9,submissionId:3,evalResponseId:10,status:'Submitted',retryRequested:true,retryRequestedAt:new Date(Date.now()-1000),passKey:'987654',createdAt:new Date(),evalResponse:{id:10,userId:9,subId:3,givenMarks:10,reply:'Thanks',recordingFileId:2}})
  return {service,db,group,start,file,retry,files,uploaded,deleted,get submission(){return submission},get locks(){return locks}}
}
test('all three members start/access one shared submission, including after close',async()=>{
  const h=harness()
  const results=await Promise.all([5,6,7].map(h.start))
  assert.deepEqual(results.map(s=>s.id),[3,3,3])
  await h.service.closeSubmission(2,{userId:6})
  assert.equal((await h.start(7)).status,'Close')
  assert.equal(h.submission.id,3)
})
test('concurrent start unique conflict recovers the existing shared row',async()=>{
  const h=harness();await h.start(5)
  h.db.submission.upsert=async()=>{throw Object.assign(new Error('concurrent start'),{code:'P2002'})}
  assert.equal((await h.start(6)).id,3)
})
test('nonleader uploads and closes, ordinary mutation is refused after close',async()=>{
  const h=harness();await h.start(5)
  await h.service.uploadFile(2,6,h.file)
  assert.equal(h.files[0].uploadedBy,6)
  await h.service.closeSubmission(2,{userId:7})
  const original=h.submission.fileId
  await assert.rejects(h.service.uploadFile(2,6,h.file),/already closed/)
  await assert.rejects(h.service.removeFile(2,6),/already closed/)
  assert.equal(h.submission.fileId,original)
  assert(h.locks>=4)
})
test('outsider cannot start, close, upload, retry-upload, remove or download',async()=>{
  const h=harness();await h.start(5)
  for(const action of [()=>h.start(99),()=>h.service.closeSubmission(2,{userId:99}),()=>h.service.uploadFile(2,99,h.file),()=>h.service.uploadRetryFile(2,99,h.file),()=>h.service.removeFile(2,99),()=>h.service.getDownloadUrl(2,{userId:99})])
    await assert.rejects(action(),/Membership not found/)
  assert.equal(h.uploaded.length,0)
})
test('retry files append history, preserve original/passkeys/status, and are downloadable',async()=>{
  const h=harness();await h.start(5)
  await h.service.uploadFile(2,6,h.file)
  await h.service.closeSubmission(2,{userId:6});h.retry()
  const original=h.submission.fileId, keys=[h.submission.passkey,h.group.evalAssignmentsAsEvaluee[0].passKey]
  const revised=await h.service.uploadRetryFile(2,7,{...h.file,originalname:'revised.pdf'})
  assert.equal(revised.files.length,2)
  assert.equal(revised.files[0].id,original)
  assert.equal(revised.files[1].name,'revised.pdf')
  assert.equal(revised.status,'Close');assert.equal(revised.passed,false)
  assert.equal(revised.evaluationRounds[0].waitingForRematch,true)
  assert.equal(h.submission.fileId,original)
  assert.deepEqual([h.submission.passkey,h.group.evalAssignmentsAsEvaluee[0].passKey],keys)
  assert.equal(h.deleted.length,0)
  assert.equal((await h.service.getDownloadUrl(2,{userId:6,fileId:original})).url,revised.files[0].url)
  assert.equal((await h.service.getDownloadUrl(2,{userId:6})).url,revised.files[1].url)
  await assert.rejects(h.service.getDownloadUrl(2,{userId:6,fileId:999}),/File not found/)
  assert.equal(revised.canUploadRetryFile,false)
  await assert.rejects(h.service.uploadRetryFile(2,6,{...h.file,originalname:'revised-again.pdf'}),/one updated file per unresolved retry/)
  assert.equal(h.submission.fileVersions.length,1)
})
test('retry upload is refused for open, pending, passed, and failure without retry request',async()=>{
  const h=harness();await h.start(5)
  await assert.rejects(h.service.uploadRetryFile(2,6,h.file),/unresolved retry/)
  await h.service.closeSubmission(2,{userId:5})
  await assert.rejects(h.service.uploadRetryFile(2,6,h.file),/unresolved retry/)
  h.retry();h.group.evalAssignmentsAsEvaluee[0].retryRequested=false
  await assert.rejects(h.service.uploadRetryFile(2,6,h.file),/unresolved retry/)
  h.group.evalAssignmentsAsEvaluee[0].retryRequested=true;h.group.evalAssignmentsAsEvaluee[0].evalResponse.givenMarks=80
  await assert.rejects(h.service.uploadRetryFile(2,6,h.file),/unresolved retry/)
  assert.equal(h.submission.fileVersions.length,0)
})
test('replacement can receive updates until evaluator starts, not after',async()=>{
  const h=harness();await h.start(5);await h.service.closeSubmission(2,{userId:5});h.retry()
  const pending={id:9,round:1,assignmentId:1,status:'Pending',submissionId:null,createdAt:new Date()}
  h.group.evalAssignmentsAsEvaluee.push(pending)
  const updated=await h.service.uploadRetryFile(2,6,h.file);assert.equal(updated.files.length,1)
  pending.submissionId=3
  await assert.rejects(h.service.uploadRetryFile(2,6,h.file),/unresolved retry/)
})

test('only open draft files are replaced/removed; closed originals stay immutable',async()=>{
  const h=harness();await h.start(5)
  await h.service.uploadFile(2,6,h.file)
  const first=h.submission.fileId
  await h.service.uploadFile(2,7,{...h.file,originalname:'draft2.pdf'})
  assert.notEqual(h.submission.fileId,first)
  assert.equal(h.files.length,1);assert.equal(h.deleted.length,1)
  await h.service.removeFile(2,6)
  assert.equal(h.submission.fileId,null);assert.equal(h.files.length,0);assert.equal(h.deleted.length,2)
})

test('a subsequent failed replacement and new retry allow exactly one more version',async()=>{
  const h=harness();await h.start(5);await h.service.uploadFile(2,5,h.file)
  await h.service.closeSubmission(2,{userId:5});h.retry()
  await h.service.uploadRetryFile(2,5,h.file)
  h.submission.fileVersions[0].createdAt=new Date(Date.now()-5000)
  const old=h.group.evalAssignmentsAsEvaluee[0]
  h.group.evalAssignmentsAsEvaluee.push({...old,id:9,evaluatorUserId:10,evalResponseId:11,
    retryRequestedAt:new Date(Date.now()-1000),createdAt:new Date(),
    evalResponse:{...old.evalResponse,id:11,userId:10}})
  const revised=await h.service.uploadRetryFile(2,6,h.file)
  assert.equal(revised.files.length,3)
  assert.equal(revised.canUploadRetryFile,false)
  await assert.rejects(h.service.uploadRetryFile(2,5,h.file),/one updated file per unresolved retry/)
  assert.equal(h.submission.fileVersions.length,2)
})

test('deadline guards cover start/upload/close/remove while preserving downloads and originals',async()=>{
  const h=harness(); h.group.assignment.submissionDeadline=new Date(Date.now()+60000)
  await h.start(5);await h.service.uploadFile(2,5,h.file)
  await h.service.uploadFile(2,6,h.file)
  const original=h.submission.fileId, uploaded=h.uploaded.length
  h.group.assignment.submissionDeadline=new Date(Date.now()-1000)
  for (const action of [()=>h.start(5),()=>h.service.uploadFile(2,5,h.file),
    ()=>h.service.closeSubmission(2,{userId:5}),()=>h.service.removeFile(2,5)])
    await assert.rejects(action(),/The submission deadline has passed/)
  assert.equal(h.submission.fileId,original);assert.equal(h.uploaded.length,uploaded)
  assert((await h.service.getDownloadUrl(2,{userId:5})).url)
  h.group.assignment.submissionDeadline=null
  await h.service.closeSubmission(2,{userId:5})
  h.group.assignment.submissionDeadline=new Date(Date.now()-1000)
  const [saved]=await h.service.getSubmissionsForAssignment(1)
  assert.equal(saved.deadlineFailure,false);assert.equal(saved.fileId,original)
})
test('late creation is refused without creating a submission row',async()=>{
  const h=harness();h.group.assignment.submissionDeadline=new Date(Date.now()-1000)
  await assert.rejects(h.start(5),/submission deadline has passed/)
  assert.equal(h.submission,null)
})

for (const evaluationDeadline of [null, new Date(Date.now()+60000)]) test(`retry upload ignores original submission deadline with evaluation deadline ${evaluationDeadline}`,async()=>{
  const h=harness();await h.start(5);await h.service.uploadFile(2,5,h.file);await h.service.closeSubmission(2,{userId:5});h.retry()
  h.group.evalAssignmentsAsEvaluee.push({id:9,round:1,assignmentId:1,status:'Pending',submissionId:null,createdAt:new Date()})
  const original=h.submission.fileId
  h.group.assignment.submissionDeadline=new Date(Date.now()-1000)
  h.group.assignment.evaluationDeadline=evaluationDeadline
  const saved=await h.service.uploadRetryFile(2,5,h.file)
  assert.equal(saved.files.length,2);assert.equal(h.submission.fileId,original);assert.equal(h.deleted.length,0)
  await assert.rejects(h.service.uploadRetryFile(2,5,h.file),/one updated file per unresolved retry/)
  await assert.rejects(h.service.uploadFile(2,5,h.file),/submission deadline has passed/)
})
test('retry upload is rejected after evaluation deadline without changing original or uploading storage data',async()=>{
  const h=harness();await h.start(5);await h.service.uploadFile(2,5,h.file);await h.service.closeSubmission(2,{userId:5});h.retry()
  const original=h.submission.fileId,uploads=h.uploaded.length
  h.group.assignment.submissionDeadline=new Date(Date.now()-2000)
  h.group.assignment.evaluationDeadline=new Date(Date.now()-1000)
  await assert.rejects(h.service.uploadRetryFile(2,5,h.file),/peer-evaluation deadline has passed/)
  assert.equal(h.submission.fileId,original);assert.equal(h.submission.fileVersions.length,0);assert.equal(h.uploaded.length,uploads)
})
