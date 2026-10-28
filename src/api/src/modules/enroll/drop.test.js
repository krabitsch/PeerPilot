const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm')
const errors=require('../../../../packages/errors')

// In-memory course 5; student 1 gets dropped. Group 10 (solo, submitted and
// evaluated) and group 11 (shared with student 2, submitted) carry history;
// group 12 (solo, nothing yet) does not.
const harness=()=>{
  const s={
    users:[{id:1,role:'Student'},{id:2,role:'Student'},{id:3,role:'Student'}],
    enrollments:[1,2,3].map(userId=>({id:userId,userId,classId:5,status:'Active'})),
    groups:[{id:10,leaderId:1,members:[1]},{id:11,leaderId:1,members:[1,2]},{id:12,leaderId:1,members:[1]}],
    submissions:[{id:100,groupId:10},{id:101,groupId:11}],
    pairings:[
      {id:1,evalueeGroupId:10,evaluatorUserId:2,status:'Submitted',evalResponseId:7,submissionId:100},
      {id:2,evalueeGroupId:10,evaluatorUserId:3,status:'Pending',evalResponseId:null,submissionId:null}, // nobody left to evaluate
      {id:3,evalueeGroupId:11,evaluatorUserId:3,status:'Pending',evalResponseId:null,submissionId:null}, // student 2 is still enrolled
      {id:4,evalueeGroupId:99,evaluatorUserId:1,status:'Pending',evalResponseId:null,submissionId:null}, // the dropped student evaluates
      {id:5,evalueeGroupId:98,evaluatorUserId:1,status:'Submitted',evalResponseId:8,submissionId:200},  // already done
    ],
  }
  const live=p=>p.status!=='Cancelled'||p.evalResponseId!=null||p.submissionId!=null
  const memberId=(groupId,userId)=>groupId*100+userId
  const db={
    $queryRaw:async()=>[],
    enrollment:{update:async({where,data})=>Object.assign(s.enrollments.find(e=>e.id===where.id),data)},
    groupMember:{
      findMany:async({where})=>s.groups.filter(g=>g.members.includes(where.userId)).map(g=>({id:memberId(g.id,where.userId),
        userId:where.userId,groupId:g.id,group:{...g,members:g.members.map(userId=>({id:memberId(g.id,userId),userId}))}})),
      delete:async({where})=>{const g=s.groups.find(g=>g.id===Math.floor(where.id/100));g.members=g.members.filter(u=>u!==where.id%100)},
    },
    group:{
      findUnique:async({where})=>{const g=s.groups.find(g=>g.id===where.id);return g&&{...g,_count:{
        submissions:s.submissions.filter(x=>x.groupId===g.id).length,
        evalAssignmentsAsEvaluee:s.pairings.filter(p=>p.evalueeGroupId===g.id&&live(p)).length,
        evalAssignmentsAsEvaluatorGroup:0}}},
      findMany:async({where})=>s.groups.filter(g=>g.members.includes(where.members.some.userId)).map(g=>({id:g.id,
        members:g.members.map(userId=>({userId,user:{role:s.users.find(u=>u.id===userId).role,
          enrollments:s.enrollments.filter(e=>e.userId===userId&&e.status==='Active')}}))})),
      update:async({where,data})=>Object.assign(s.groups.find(g=>g.id===where.id),data),
      delete:async({where})=>{s.groups=s.groups.filter(g=>g.id!==where.id)},
    },
    evalAssignment:{updateMany:async({where,data})=>{
      const hit=s.pairings.filter(p=>p.status===where.status&&p.evalResponseId===where.evalResponseId&&
        where.OR.some(c=>c.evaluatorUserId===p.evaluatorUserId||c.evalueeGroupId?.in.includes(p.evalueeGroupId)))
      hit.forEach(p=>Object.assign(p,data));return {count:hit.length}
    }},
  };db.$transaction=fn=>fn(db)
  const utils={getClassById:async()=>({id:5}),getUserById:async id=>s.users.find(u=>u.id===Number(id)),
    getEnrollment:async userId=>s.enrollments.find(e=>e.userId===Number(userId))}
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/service.js','utf8'),{module,require:name=>{
    if(name==='@transcendence/database')return {prisma:db}
    if(name==='@transcendence/errors')return errors
    if(name==='@transcendence/utils')return utils
    if(name==='../auth/userModel')return {}
    if(name==='../group/history')return require('../group/history')
    throw Error(name)
  }})
  return {service:module.exports,s}
}
const drop=h=>h.service.dropStudent({classId:'5',studentId:'1'})

test('dropping keeps every group with history, and the student in it, so submissions stay linked',async()=>{
  const h=harness();await drop(h)
  assert.equal(h.s.enrollments[0].status,'Dropped')
  assert.deepEqual(h.s.groups.find(g=>g.id===10).members,[1])
  assert.deepEqual(h.s.groups.find(g=>g.id===11).members,[1,2])
  assert.equal(h.s.groups.find(g=>g.id===11).leaderId,1)
  assert(!h.s.groups.some(g=>g.id===12),'a solo group without history is still removed')
})
test('dropping cancels only open pairings that can no longer happen, and deletes none',async()=>{
  const h=harness();await drop(h)
  assert.deepEqual(h.s.pairings.map(p=>[p.id,p.status]),
    [[1,'Submitted'],[2,'Cancelled'],[3,'Pending'],[4,'Cancelled'],[5,'Submitted']])
})
test('a shared group without history is left as before, and its leadership passes on',async()=>{
  const h=harness();h.s.groups.push({id:13,leaderId:1,members:[1,3]})
  await drop(h)
  const g=h.s.groups.find(g=>g.id===13);assert.deepEqual(g.members,[3]);assert.equal(g.leaderId,3)
})
