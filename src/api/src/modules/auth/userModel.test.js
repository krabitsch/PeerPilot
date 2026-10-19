const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm')
const errors=require('../../../../packages/errors')

const harness=(auth)=>{
  const db={userAuth:{updateMany:async({where,data})=>{
    const match=auth.userId===where.userId&&auth.provider===where.provider&&auth.pass_hash===where.pass_hash
    if(match)Object.assign(auth,data)
    return {count:match?1:0}
  }}}
  const module={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/userModel.js','utf8'),{module,process,require:name=>{
    if(name==='@transcendence/database')return {prisma:db}
    if(name==='@transcendence/errors')return errors
    if(name==='bcrypt')return {hash:async p=>`hash:${p}`}
    if(name==='crypto')return require('node:crypto')
    throw Error(name)
  }})
  return module.exports
}

test('claiming sets the first password of a pending account',async()=>{
  const auth={userId:7,provider:'local',pass_hash:null}
  await harness(auth).claimPendingUser(7,'pw')
  assert.equal(auth.pass_hash,'hash:pw')
})
test('claiming never replaces a password that is already set',async()=>{
  const auth={userId:7,provider:'local',pass_hash:'original'}
  await assert.rejects(harness(auth).claimPendingUser(7,'pw'),errors.ConflictError)
  assert.equal(auth.pass_hash,'original')
})
