const {test}=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm'),fs=require('node:fs')
const assignment={id:1,name:'Assignment',class:{name:'Course'},max_score:100,pass_threshold:100,evalSheet:{sections:[]}}
const group={id:4,name:'same/name'}
const pairing=(id,status,response)=>({id,round:1,evalueeGroupId:4,evaluatorUserId:id,submissionId:3,evalResponseId:response?.id??null,
  createdAt:new Date(2026,0,id),status,evalueeGroup:group,evaluatorUser:{username:`student${id}`,email:`s${id}@example.com`},evalResponse:response})
const response=id=>({id,subId:3,userId:id,isStaffReview:false,givenMarks:81,comment:`feedback ${id}`,reply:`reply ${id}`,scores:[],
  user:{username:`student${id}`},submission:{group},recordingFile:{name:'audio.webm',url:`audio-${id}`},evalAssignment:{id,round:1}})
function harness(){
  const responses=[response(1),response(2)]
  const pairings=[pairing(1,'Submitted',responses[0]),pairing(2,'Submitted',responses[1]),pairing(3,'Pending')]
  const db={assignment:{findUnique:async()=>assignment},evalAssignment:{findMany:async()=>pairings},
    evalResponse:{findMany:async()=>responses,count:async()=>responses.length},group:{findMany:async()=>[group]}}
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/service.js','utf8'),{module,Date,require:name=>{
    if(name==='@transcendence/database')return {prisma:db}
    if(name==='@transcendence/errors')return require('../../../../packages/errors')
    if(name==='@transcendence/filemanager')return {createStorage:()=>({getStream:async key=>require('node:stream').Readable.from([Buffer.from('content:'+key)])})}
    if(name==='@transcendence/utils')return {getSubmissionsBy:async()=>[{id:3,groupId:4,group,createdAt:new Date(),file:{id:1,name:'answer.pdf',url:'original'},
      fileVersions:[{id:3,createdAt:new Date(2026,0,3),file:{name:'answer.pdf',url:'retry2'}},{id:2,createdAt:new Date(2026,0,2),file:{name:'answer.pdf',url:'retry1'}}]}]}
    return require(name)
  }})
  return module.exports
}
test('CSV preserves every attempt including pending replacement and feedback',async()=>{
  const {csv}=await harness().buildEvaluationsCsv(1)
  assert.equal(csv.trim().split('\r\n').length,4)
  for(const text of ['attempt','evalAssignmentId','feedback 1','reply 1','feedback 2','Pending','Failed','student3']) assert(csv.includes(text),text)
})
test('bulk plan contains chronological original and revisions and unique historical recordings',async()=>{
  const plan=await harness().planArchive(1)
  assert.deepEqual(Array.from(plan.submissionEntries,e=>e.key),['original','retry1','retry2'])
  assert.equal(new Set(plan.submissionEntries.map(e=>e.path)).size,3)
  assert.equal(plan.recordingEntries.length,2)
  assert.equal(new Set(plan.recordingEntries.map(e=>e.path)).size,2)
  assert(plan.recordingEntries[0].path.includes('pairing-1-response-1'))
  assert(plan.recordingEntries[1].path.includes('pairing-2-response-2'))
  const without=await harness().planArchive(1,{includeRecordings:false})
  assert.equal(without.recordingEntries.length,0)
  assert(without.manifest.includes('recordings excluded by request'))
})

module.exports={harness}
