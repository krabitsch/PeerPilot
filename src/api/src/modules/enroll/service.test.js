const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm')
const errors=require('../../../../packages/errors')
const {isPendingAuth}=require('../../../../packages/utils/src/userUtils')

// In-memory stand-in for the tables enrollByEmail touches.
const harness=({codes=['1268','1269','1421']}={})=>{
  const course={id:1,org_id:1,externalCourseCodes:codes}
  const users=[
    {id:10,email:'reg@wu.at',role:'Student',orgId:1,userAuth:{provider:'local',pass_hash:'h'}},
    {id:11,email:'pend@wu.at',role:'Student',orgId:1,userAuth:{provider:'local',pass_hash:null}},
    {id:12,email:'staff@wu.at',role:'Bocal',orgId:1,userAuth:{provider:'local',pass_hash:'h'}},
    {id:13,email:'other@wu.at',role:'Student',orgId:2,userAuth:{provider:'local',pass_hash:'h'}},
  ]
  const allowed=new Map([['pend@wu.at',{email:'pend@wu.at',used:true,orgId:1}]])
  const enrollments=[]
  const db={
    class:{findUnique:async()=>course},
    user:{
      findUnique:async({where})=>users.find(u=>u.email===where.email)??null,
      update:async({where,data})=>Object.assign(users.find(u=>u.id===where.id),data),
    },
    authAllowedEmail:{upsert:async({where,create,update})=>{
      const row=allowed.get(where.email)
      if(row)return Object.assign(row,update)
      allowed.set(where.email,{used:false,...create});return allowed.get(where.email)
    }},
    enrollment:{
      findUnique:async({where:{userId_classId:{userId,classId}}})=>enrollments.find(e=>e.userId===userId&&e.classId===classId)??null,
      create:async({data})=>{enrollments.push({id:enrollments.length+1,...data});return data},
      update:async({where,data})=>Object.assign(enrollments.find(e=>e.id===where.id),data),
    },
  };db.$transaction=fn=>fn(db)
  const userModel={createPendingUser:async(email,orgId)=>{
    const user={id:100+users.length,email,role:'Student',orgId,userAuth:{provider:'local',pass_hash:null}}
    users.push(user);return user
  }}
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/service.js','utf8'),{module,require:name=>{
    if(name==='@transcendence/database')return {prisma:db}
    if(name==='@transcendence/errors')return errors
    if(name==='@transcendence/utils')return {isPendingAuth}
    if(name==='../auth/userModel')return userModel
    if(name==='../group/history')return require('../group/history')
    throw Error(name)
  }})
  return {service:module.exports,users,allowed,enrollments}
}
const bocal={userId:12,role:'Bocal',orgId:1}
const enroll=(h,students,actor=bocal)=>h.service.enrollByEmail({classId:'1',students,actor})

test('an unknown email gets a pending account, a whitelist entry and an enrollment with its course number',async()=>{
  const h=harness()
  const {results:[r]}=await enroll(h,[{email:' New.Student@WU.at ',externalCourseCode:'1269'}])
  assert.equal(r.status,'enrolled');assert.equal(r.account,'created');assert.equal(r.email,'new.student@wu.at')
  const user=h.users.find(u=>u.email==='new.student@wu.at')
  assert.equal(user.userAuth.pass_hash,null);assert.equal(user.orgId,1)
  assert.equal(h.allowed.get('new.student@wu.at').used,false)
  assert.deepEqual(h.enrollments.map(e=>[e.userId,e.externalCourseCode,e.status]),[[user.id,'1269','Active']])
})
test('a registered student is enrolled without touching the whitelist',async()=>{
  const h=harness()
  const {results:[r]}=await enroll(h,[{email:'reg@wu.at',externalCourseCode:'1268'}])
  assert.equal(r.account,'registered');assert.equal(r.status,'enrolled')
  assert.equal(h.allowed.has('reg@wu.at'),false)
})
test('re-adding a pending account reopens its whitelist entry so the student can still sign up',async()=>{
  const h=harness()
  const {results:[r]}=await enroll(h,[{email:'pend@wu.at',externalCourseCode:'1421'}])
  assert.equal(r.account,'pending');assert.equal(h.allowed.get('pend@wu.at').used,false)
})
test('existing enrollments are updated, left alone or reactivated',async()=>{
  const h=harness()
  await enroll(h,[{email:'reg@wu.at',externalCourseCode:'1268'}])
  assert.equal((await enroll(h,[{email:'reg@wu.at',externalCourseCode:'1268'}])).results[0].status,'unchanged')
  assert.equal((await enroll(h,[{email:'reg@wu.at',externalCourseCode:'1421'}])).results[0].status,'updated')
  assert.equal(h.enrollments[0].externalCourseCode,'1421')
  h.enrollments[0].status='Dropped'
  assert.equal((await enroll(h,[{email:'reg@wu.at',externalCourseCode:'1269'}])).results[0].status,'enrolled')
  assert.deepEqual([h.enrollments.length,h.enrollments[0].status,h.enrollments[0].externalCourseCode],[1,'Active','1269'])
})
test('bad rows are reported one by one and do not stop the rest',async()=>{
  const h=harness()
  const {results}=await enroll(h,[
    {email:'not-an-email',externalCourseCode:'1268'},
    {email:'a@wu.at'},
    {email:'b@wu.at',externalCourseCode:'9999'},
    {email:'staff@wu.at',externalCourseCode:'1268'},
    {email:'other@wu.at',externalCourseCode:'1268'},
    {email:'c@wu.at',externalCourseCode:'1268'},
    {email:'C@wu.at',externalCourseCode:'1269'},
  ])
  assert.deepEqual(Array.from(results,r=>r.status),['failed','failed','failed','failed','failed','enrolled','failed'])
  assert.match(results[0].error,/Invalid email/);assert.match(results[1].error,/Course number required/)
  assert.match(results[2].error,/9999 is not a course number/);assert.match(results[3].error,/Bocal account/)
  assert.match(results[4].error,/another organisation/);assert.match(results[6].error,/more than once/)
  assert.deepEqual(h.users.filter(u=>['a@wu.at','b@wu.at'].includes(u.email)),[])
})
test('a course without official numbers enrolls without one and rejects one',async()=>{
  const h=harness({codes:[]})
  const {results}=await enroll(h,[{email:'a@wu.at'},{email:'b@wu.at',externalCourseCode:'1268'}])
  assert.deepEqual(Array.from(results,r=>r.status),['enrolled','failed'])
  assert.equal(h.enrollments[0].externalCourseCode,null)
})
test('a Bocal cannot enroll into another organisation, an Admin can',async()=>{
  const h=harness()
  await assert.rejects(enroll(h,[{email:'a@wu.at',externalCourseCode:'1268'}],{userId:5,role:'Bocal',orgId:2}),errors.ForbiddenError)
  const {results:[r]}=await enroll(h,[{email:'a@wu.at',externalCourseCode:'1268'}],{userId:5,role:'Admin',orgId:null})
  assert.equal(r.status,'enrolled')
})
test('empty and malformed requests are rejected before any write',async()=>{
  const h=harness()
  await assert.rejects(enroll(h,[]),/at least one student/)
  await assert.rejects(enroll(h,'a@wu.at'),/at least one student/)
  assert.equal(h.enrollments.length,0)
})
