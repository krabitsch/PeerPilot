const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm')
const errors=require('../../../../packages/errors')
const {isPendingAuth}=require('../../../../packages/utils/src/userUtils')

// register/login against stubbed models: `users` maps email -> the flat shape
// findUserByEmail returns; `allowed` holds unused whitelist emails.
const harness=({users={},allowed=[]}={})=>{
  const calls={created:[],claimed:[],used:[],compared:0}
  const model={
    findUserByEmail:async email=>users[email],
    isEmailAllowed:async email=>allowed.includes(email)?{orgId:1}:null,
    createUser:async(email,password,orgId)=>{calls.created.push(email);return {id:99,email}},
    claimPendingUser:async(id,password)=>{calls.claimed.push([id,password])},
    markEmailAsUsed:async email=>{calls.used.push(email)},
    storeRefreshToken:async()=>{},
  }
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/controller.js','utf8'),{module,exports:module.exports,process,require:name=>{
    if(name==='./userModel')return model
    if(name==='./invitationService')return {validateInvitation:async token=>{if(token!=='valid')throw new errors.ValidationError('Invalid invitation')},redeemInvitation:async()=>({id:7,email:'s@wu.at'})}
    if(name==='./utils')return {validatePasswordStrength:()=>({isValid:true}),generateAccessToken:()=>'a',generateRefreshToken:()=>'r'}
    if(name==='@transcendence/utils')return {isPendingAuth}
    if(name==='@transcendence/errors')return errors
    if(name==='bcrypt')return {compare:async()=>{calls.compared++;return true}}
    if(name==='google-auth-library')return {OAuth2Client:class{}}
    if(name==='dotenv')return {config(){}}
    if(name==='crypto')return require('node:crypto')
    if(name==='@transcendence/logger')return {error(){}}
    throw Error(name)
  }})
  return {controller:module.exports,calls}
}
// Runs a handler and returns the error passed to next(), or the response.
const call=async(handler,body)=>{
  let out
  const res={status(code){this.code=code;return this},json(b){out={code:this.code??200,body:b}},cookie(){}}
  await handler({body},res,err=>{out={error:err}})
  return out
}
const local=(id,pass_hash)=>({id,email:'s@wu.at',pass_hash,provider:'local'})

test('registration requires a validated token and ignores arbitrary supplied email',async()=>{
  const h=harness({allowed:['s@wu.at']})
  assert.ok((await call(h.controller.register,{email:'s@wu.at',password:'pw'})).error instanceof errors.ValidationError)
  const result=await call(h.controller.register,{token:'valid',email:'attacker@wu.at',password:'pw'})
  assert.equal(result.code,201);assert.equal(result.body.email,'s@wu.at')
})
test('a pending account cannot sign in and is told to sign up',async()=>{
  const h=harness({users:{'s@wu.at':local(7,null)}})
  const out=await call(h.controller.login,{email:'s@wu.at',password:'pw'})
  assert.ok(out.error instanceof errors.UnauthorizedError);assert.match(out.error.message,/invitation link/)
  assert.equal(h.calls.compared,0)
})
test('an account without a password is rejected cleanly instead of crashing bcrypt',async()=>{
  const h=harness({users:{'s@wu.at':{id:7,email:'s@wu.at',pass_hash:null,provider:'google'}}})
  const out=await call(h.controller.login,{email:'s@wu.at',password:'pw'})
  assert.ok(out.error instanceof errors.UnauthorizedError);assert.equal(h.calls.compared,0)
})
test('login finds a lowercased account when the email is typed in another case',async()=>{
  const h=harness({users:{'s@wu.at':local(7,'hash')}})
  const out=await call(h.controller.login,{email:'S@WU.at',password:'pw'})
  assert.equal(out.code,200);assert.equal(h.calls.compared,1)
})
