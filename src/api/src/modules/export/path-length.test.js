// Windows Explorer can't extract paths over 260 characters. A prod ZIP built
// from names shaped like the (made-up) ones below had entries of up to 264 characters on their own, so
// "Extract all" into Downloads failed for 309 of its 311 files.
const {test}=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm'),fs=require('node:fs')
const {sanitize,shorten,fitEntry,ARCHIVE_ROOT_MAX,ARCHIVE_ENTRY_MAX}=require('./csv')

const longAssignment='Assignment 1: dynamic optimization and the stochastic growth model'
const longRecording='Macro_Evaluation_09_11_26_Evaluator_Jane_Example_Evaluee_John_Sample_and_some_more_words_to_be_sure.m4a'
const longSubmission='surname_firstname_00000000_assignment_1_final_version_after_feedback_from_the_tutor_really_final.pdf'
const longGroup='The group whose members picked a very long name indeed'

function plan({studentId=null}={}){
  const group={id:237,name:longGroup}
  const response={id:151,subId:3,userId:5,isStaffReview:false,givenMarks:80,comment:'',reply:'',scores:[],user:{username:'Jane_Example'},
    submission:{group},recordingFile:{name:longRecording,url:'rec',size:10},evalAssignment:{id:419,round:2}}
  const db={
    assignment:{findUnique:async()=>({id:1,name:longAssignment,class:{name:'Foundations of Macroeconomics'},max_score:100,pass_threshold:50,evalSheet:{sections:[]}})},
    user:{findUnique:async()=>({id:5,username:'h00000001'})},
    group:{findFirst:async()=>group,findMany:async()=>[group]},
    evalAssignment:{findMany:async()=>[]},
    evalResponse:{findMany:async()=>[response],count:async()=>1},
  }
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/service.js','utf8'),{module,Date,require:name=>{
    if(name==='@transcendence/database')return {prisma:db}
    if(name==='@transcendence/errors')return require('../../../../packages/errors')
    if(name==='@transcendence/filemanager')return {createStorage:()=>({})}
    if(name==='@transcendence/utils')return {getSubmissionsBy:async()=>[{id:75,groupId:237,group,createdAt:new Date(),
      file:{id:1,name:longSubmission,url:'orig',size:10},fileVersions:[{id:12,createdAt:new Date(),file:{name:longSubmission,url:'retry',size:10}}]}]}
    return require(name)
  }})
  return module.exports.planArchive(1,{studentId})
}

test('shorten keeps the extension and fitEntry keeps the whole entry within budget',()=>{
  assert.equal(shorten('report.pdf',40),'report.pdf')
  const cut=shorten(longRecording,30)
  assert.equal(cut.length,30);assert(cut.endsWith('.m4a'));assert(cut.startsWith('Macro_Evaluation_'))
  const entry=fitEntry('recordings/group23-group-237/round1-pairing-313-response-83-Jane E-',longRecording)
  assert(entry.length<=ARCHIVE_ENTRY_MAX,entry);assert(entry.endsWith('.m4a'))
  // Windows strips trailing dots/spaces, and `..` must not survive as a name.
  assert.equal(sanitize('..'),'unnamed');assert.equal(sanitize('notes. '),'notes')
})

test('every path in a ZIP of long prod names fits Windows\' 260-character limit',async()=>{
  for(const studentId of [null,5]){
    const p=await plan({studentId})
    assert(p.archiveRoot.length<=ARCHIVE_ROOT_MAX,p.archiveRoot)
    assert(p.archiveRoot.startsWith('peerofessor-Assignment-1_-dynamic-'),p.archiveRoot)
    if(studentId) assert(p.archiveRoot.endsWith('-h00000001'),'the student stays identifiable')
    const entries=[...p.submissionEntries,...p.recordingEntries].map(e=>e.path)
    assert.equal(entries.length,3)
    // C:\Users\<name>\Downloads\ (~40) + <zip name>\ + <root>\ + entry
    for(const e of entries){
      assert(e.length<=ARCHIVE_ENTRY_MAX,e)
      assert(40+2*(p.archiveRoot.length+1)+e.length<260,e)
    }
    // Ids stay, so names remain unique and traceable to the CSV.
    assert(entries.some(e=>e.includes('submission-75/original/')&&e.endsWith('.pdf')))
    assert(entries.some(e=>e.includes('submission-75/retry-1-version-12/')))
    assert(entries.some(e=>e.includes('round2-pairing-419-response-151-')&&e.endsWith('.m4a')))
  }
})
