const {test} = require('node:test')
const assert = require('node:assert/strict')
const {assignmentDeadlines, assertDeadline, deadlinePassed} = require('./deadlines')
const {assignmentOutcome} = require('../eval/outcome')
const before = '2026-01-01T12:00:00Z', after = '2026-01-02T12:00:00Z'
const now = Date.parse('2026-01-02T00:00:00Z')
const assignment = {id:1, req_eval:1, max_score:100, pass_threshold:50}
const submission = {id:3, status:'Close', fileId:4}
const pairing = (marks, status = 'Submitted') => ({id:1,assignmentId:1,round:1,evaluatorUserId:2,submissionId:3,evalResponseId:5,status,
  evalResponse:{id:5,userId:2,subId:3,givenMarks:marks,reply:'Thanks',recordingFileId:6}})

test('nullable/omitted deadline fields preserve current behavior and allow clearing', () => {
  assert.deepEqual(assignmentDeadlines({}), {})
  assert.deepEqual(assignmentDeadlines({submissionDeadline:null,evaluationDeadline:''}), {submissionDeadline:null,evaluationDeadline:null})
  assert.deepEqual(assignmentDeadlines({evaluationDeadline:''}, {submissionDeadline:after,evaluationDeadline:after}), {evaluationDeadline:null})
  assert.doesNotThrow(()=>assertDeadline({},'submission',now))
  assert.doesNotThrow(()=>assertDeadline({},'evaluation',now))
  assert.equal(assignmentOutcome(assignment,[],null,now).workflowStatus,'NotStarted')
  assert.equal(assignmentOutcome(assignment,[],submission,now).workflowStatus,'InProgress')
})
test('later and equal deadlines accepted; earlier or timezone-free timestamps rejected', () => {
  for (const evaluationDeadline of [before,after]) {
    const saved = assignmentDeadlines({submissionDeadline:before,evaluationDeadline})
    assert.equal(saved.evaluationDeadline.toISOString(),new Date(evaluationDeadline).toISOString())
  }
  assert.throws(()=>assignmentDeadlines({evaluationDeadline:before},{submissionDeadline:after}),/on or after/)
  for (const value of ['bad','2026-01-01T12:00:00','null',42])
    assert.throws(()=>assignmentDeadlines({submissionDeadline:value}),/valid timestamps/)
  assert.equal(assignmentDeadlines({submissionDeadline:'2026-01-01T13:00:00+01:00'}).submissionDeadline.toISOString(),'2026-01-01T12:00:00.000Z')
})
test('both independent action guards reject only after their corresponding deadline', () => {
  for (const kind of ['submission','evaluation']) {
    assert.doesNotThrow(()=>assertDeadline({[`${kind}Deadline`]:after},kind,now))
    assert.doesNotThrow(()=>assertDeadline({[`${kind}Deadline`]:before},kind,Date.parse(before)))
    assert.throws(()=>assertDeadline({[`${kind}Deadline`]:before},kind,now),/deadline has passed/)
  }
  assert.equal(deadlinePassed(null,now),false)
})
test('submission failure covers missing/empty/open drafts, preserves valid submissions and is reversible', () => {
  const a = {...assignment,submissionDeadline:before}
  for (const sub of [null,{status:'Open',fileId:4},{status:'Close',fileId:null}]) {
    assert.equal(assignmentOutcome(a,[],sub,now).workflowStatus,'Failed')
    assert.equal(assignmentOutcome({...a,submissionDeadline:after},[],sub,now).deadlineFailure,false)
  }
  assert.equal(assignmentOutcome(a,[],submission,now).deadlineFailure,false)
  assert.equal(assignmentOutcome({...a,submissionDeadline:null},[],null,now).workflowStatus,'NotStarted')
})
test('overdue missing/pending rounds fail overall only; completed, scored failure and cancelled attempts stay untouched', () => {
  const a = {...assignment,evaluationDeadline:before}
  for (const attempts of [[],[pairing(null,'Pending')],[pairing(null,'Cancelled')]]) {
    const original = structuredClone(attempts)
    const result = assignmentOutcome(a,attempts,submission,now)
    assert.equal(result.workflowStatus,'Failed')
    assert.equal(result.evaluationRounds[0].outcome,'Pending')
    assert.deepEqual(attempts,original)
    assert.deepEqual(assignmentOutcome(a,attempts,submission,now),result)
  }
  assert.equal(assignmentOutcome(a,[pairing(80)],submission,now).workflowStatus,'Passed')
  assert.equal(assignmentOutcome(a,[pairing(20)],submission,now).deadlineFailure,false)
  assert.equal(assignmentOutcome({...a,evaluationDeadline:after},[pairing(20)],submission,now).workflowStatus,'Failed')
  assert.equal(assignmentOutcome(assignment,[],submission,now).deadlineFailure,false)
})

test('existing score-cache writes never persist a deadline-induced failure',async()=>{
  const {recomputeSubmissionPassed}=require('../eval/outcome')
  let saved
  const db={group:{findUnique:async()=>({assignment:{...assignment,evaluationDeadline:before},evalAssignmentsAsEvaluee:[]})},
    submission:{findUnique:async()=>({...submission,groupId:2}),update:async({data})=>{saved=data}},
    evalResponse:{findMany:async()=>[]}}
  await recomputeSubmissionPassed(db,3)
  assert.equal(saved.passed,null);assert.equal(saved.finalScore,null)
})
