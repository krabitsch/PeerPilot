const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto')
const errors = require('../../../../packages/errors')
const stateHelpers = require('../../services/invitationState')
const {isPendingAuth} = require('../../../../packages/utils/src/userUtils')
const admin = {role:'Admin',userId:1}, bocal = {role:'Bocal',orgId:1,userId:2}
const token = () => crypto.randomBytes(32).toString('base64url')
const hash = t => crypto.createHash('sha256').update(t).digest('hex')
function harness() {
  let state = {entries:[{id:1,email:'student@wu.at',orgId:1,used:false,invite_token_hash:null,invite_token_expiry:null,invite_sent_at:null}],users:[]}
  const deliveries = [], relations = {enrollment:{userId:7,externalCourseCode:'1268'},group:{userId:7},pairing:{evaluatorUserId:7}}
  let failMail = false, failEmail = null, failCreate = false, activeMail = 0, maxMail = 0
  const matches = (row,where) => Object.entries(where).every(([key,v]) => {
    if (v && typeof v === 'object' && 'gt' in v) return row[key] > v.gt
    if (v && typeof v === 'object' && 'equals' in v) return String(row[key]).trim().toLowerCase() === v.equals
    return row[key] === v
  })
  const db = {
    organization:{findUnique:async({where}) => [1,2].includes(where.id) ? {id:where.id} : null},
    class:{findUnique:async({where}) => ({org_id:where.id === 1 ? 1 : 2})},
    enrollment:{findMany:async() => state.users.map(user => ({user}))},
    authAllowedEmail:{
      findUnique:async({where}) => structuredClone(state.entries.find(e => matches(e,where)) ?? null),
      findMany:async({where,select}) => state.entries.filter(e => matches(e,where)).map(e => structuredClone(select ? Object.fromEntries(Object.keys(select).map(k => [k,e[k]])) : e)),
      updateMany:async({where,data}) => {
        const rows = state.entries.filter(e => matches(e,where)); rows.forEach(e => Object.assign(e,data)); return {count:rows.length}
      },
    },
    user:{
      findMany:async({where}) => structuredClone(state.users.filter(u => matches(u,where))),
      create:async({data}) => {
        if (failCreate) throw Error('create failed')
        const u = {id:9,...data,userAuth:data.userAuth.create};state.users.push(u);return {id:u.id,email:u.email}
      },
    },
    userAuth:{updateMany:async({where,data}) => {
      const u = state.users.find(u => u.id === where.userId && u.userAuth.provider === where.provider && u.userAuth.pass_hash === where.pass_hash)
      if (u) Object.assign(u.userAuth,data)
      return {count:u ? 1 : 0}
    }},
  }
  // Serialize transactions and restore state on failure, like a locked redemption.
  let queue = Promise.resolve()
  db.$transaction = fn => {
    const result = queue.then(async() => { const before = structuredClone(state);try {return await fn(db)} catch(e) {state=before;throw e} })
    queue = result.catch(()=>{});return result
  }
  const module = {exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/invitationService.js','utf8'),{module,process:{env:{PUBLIC_APP_URL:'http://localhost:4200'}},URL,Date,require:name => {
    if (name === '@transcendence/database') return {prisma:db}
    if (name === 'crypto') return crypto
    if (name === 'bcrypt') return {hash:async p => 'hashed:'+p}
    if (name === '@transcendence/errors') return errors
    if (name === '@transcendence/utils') return {isPendingAuth}
    if (name === './userModel') return {generateUsername:async email => email.split('@')[0]}
    if (name === '../../services/invitationState') return stateHelpers
    if (name === '../../services/mailService') return {sendInvitationEmail:async mail => {
      activeMail++;maxMail=Math.max(activeMail,maxMail);try {if(failMail || mail.email === failEmail) throw Error('secret SMTP error');deliveries.push(mail)} finally {activeMail--}
    }}
    throw Error(name)
  }})
  return {service:module.exports,deliveries,relations,get state(){return state},set failMail(v){failMail=v},set failEmail(v){failEmail=v},set failCreate(v){failCreate=v},get maxMail(){return maxMail},
    activate(){const t=token();Object.assign(state.entries[0],{invite_token_hash:hash(t),invite_token_expiry:new Date(Date.now()+86400000)});return t},
    pending(){state.users.push({id:7,email:'student@wu.at',username:'original',orgId:1,userAuth:{provider:'local',pass_hash:null}})},
  }
}
test('send stores only a hash, creates a unique URL and resend invalidates the old link',async()=>{
  const h=harness();await h.service.sendInvitation(admin,1,1)
  const first=new URL(h.deliveries[0].url).searchParams.get('token')
  assert.equal(Buffer.from(first,'base64url').length,32)
  assert.equal(h.state.entries[0].invite_token_hash,hash(first));assert.ok(h.state.entries[0].invite_sent_at)
  assert.equal(h.deliveries[0].hours,168);assert.ok(h.deliveries[0].url.startsWith('http://localhost:4200/register?token='))
  assert.deepEqual(JSON.parse(JSON.stringify(await h.service.validateInvitation(first))),{email:'student@wu.at'})
  await h.service.sendInvitation(admin,1,1)
  const second=new URL(h.deliveries[1].url).searchParams.get('token');assert.notEqual(first,second)
  await assert.rejects(h.service.validateInvitation(first));await h.service.validateInvitation(second)
  const list=await h.service.listInvitations(admin,1)
  assert.equal(list[0].invitation_status,'Invitation sent');assert.equal('invite_token_hash' in list[0],false)
})
test('delivery failure clears the new token and does not expose SMTP errors or mark sent',async()=>{
  const h=harness();h.failMail=true
  await assert.rejects(h.service.sendInvitation(admin,1,1),e=>!e.message.includes('secret')&&/could not be sent/.test(e.message))
  assert.equal(h.state.entries[0].invite_token_hash,null);assert.equal(h.state.entries[0].invite_token_expiry,null);assert.equal(h.state.entries[0].invite_sent_at,null)
})
test('rejects missing, malformed, unknown, expired, consumed and registered-account tokens',async()=>{
  const h=harness();for(const t of [undefined,'',{},'short',token()]) await assert.rejects(h.service.validateInvitation(t))
  const t=h.activate();h.state.entries[0].invite_token_expiry=new Date(0);await assert.rejects(h.service.validateInvitation(t))
  h.state.entries[0].invite_token_expiry=new Date(Date.now()+10000);h.state.entries[0].used=true;await assert.rejects(h.service.validateInvitation(t))
  h.state.entries[0].used=false;h.pending();h.state.users[0].userAuth.pass_hash='existing';await assert.rejects(h.service.validateInvitation(t))
  await assert.rejects(h.service.sendInvitation(admin,1,1));assert.equal(h.deliveries.length,0)
})
test('new account and invitation consumption commit together; token cannot be reused',async()=>{
  const h=harness(),t=h.activate();const result=await h.service.redeemInvitation(t,'strong')
  assert.equal(result.email,'student@wu.at');assert.equal(h.state.users.length,1);assert.equal(h.state.users[0].username,'student')
  assert.equal(h.state.users[0].userAuth.pass_hash,'hashed:strong');assert.equal(h.state.entries[0].used,true);assert.equal(h.state.entries[0].invite_token_hash,null)
  await assert.rejects(h.service.redeemInvitation(t,'different'))
})
test('pending claim preserves ID, username, enrollment, group and pairing relationships',async()=>{
  const h=harness();h.pending();const before=structuredClone(h.relations),t=h.activate()
  const result=await h.service.redeemInvitation(t,'new')
  assert.equal(result.id,7);assert.equal(h.state.users.length,1);assert.equal(h.state.users[0].username,'original')
  assert.equal(h.state.users[0].userAuth.pass_hash,'hashed:new');assert.deepEqual(h.relations,before)
})
test('credential creation failure rolls back invitation consumption',async()=>{
  const h=harness(),t=h.activate();h.failCreate=true;await assert.rejects(h.service.redeemInvitation(t,'pw'))
  assert.equal(h.state.entries[0].used,false);assert.equal(h.state.entries[0].invite_token_hash,hash(t));assert.equal(h.state.users.length,0)
})
test('concurrent redemption has exactly one success',async()=>{
  const h=harness();h.pending();const t=h.activate()
  const results=await Promise.allSettled([h.service.redeemInvitation(t,'one'),h.service.redeemInvitation(t,'two')])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(h.state.users.length,1)
})
test('Bocal cannot list, create scope, revoke scope, send or bulk-send across organizations',async()=>{
  const h=harness();h.state.entries.push({...h.state.entries[0],id:2,email:'other@wu.at',orgId:2})
  for(const operation of [()=>h.service.scope(bocal,2,true),()=>h.service.listInvitations(bocal,2),()=>h.service.scopedEntry(bocal,2),()=>h.service.sendInvitation(bocal,2),()=>h.service.sendBulk(bocal,{classId:2})]) await assert.rejects(operation())
  assert.equal((await h.service.listInvitations(bocal)).length,1)
  await assert.rejects(h.service.scope(admin,'bad'));await assert.rejects(h.service.scope(admin,999,true));await assert.rejects(h.service.scope({role:'Student',orgId:1},1))
})
test('bulk sends distinct tokens sequentially, skips registered, and isolates failures',async()=>{
  const h=harness();h.pending();h.state.entries.push({...h.state.entries[0],id:2,email:'second@wu.at'},{...h.state.entries[0],id:3,email:'registered@wu.at'})
  h.state.users.push({id:8,email:'registered@wu.at',userAuth:{provider:'local',pass_hash:'hash'}})
  const result=await h.service.sendBulk(admin,{orgId:1});assert.equal(result.sent,2);assert.equal(result.failed,0);assert.equal(h.maxMail,1)
  assert.notEqual(h.deliveries[0].url,h.deliveries[1].url)
  h.failMail=true;const failed=await h.service.sendBulk(admin,{orgId:1});assert.equal(failed.failed,2);assert.equal(failed.sent,0)
  const classResult=await h.service.sendBulk(bocal,{classId:1});assert.equal(classResult.failed,1)
})
test('case-variant accounts cannot bypass registered-account checks',async()=>{
  const h=harness(),t=h.activate();h.state.users.push({id:2,email:'Student@WU.at',userAuth:{provider:'local',pass_hash:'hash'}})
  await assert.rejects(h.service.validateInvitation(t));await assert.rejects(h.service.sendInvitation(admin,1,1))
})

test('one bulk recipient failure preserves other successful deliveries',async()=>{
  const h=harness();h.state.entries.push({...h.state.entries[0],id:2,email:'second@wu.at'});
  h.failEmail='student@wu.at';
  const result=await h.service.sendBulk(admin,{orgId:1});
  assert.equal(result.sent,1);assert.equal(result.failed,1);
  assert.equal(h.state.entries[0].invite_token_hash,null);
  const delivered=new URL(h.deliveries[0].url).searchParams.get('token');
  assert.equal((await h.service.validateInvitation(delivered)).email,'second@wu.at');
});
