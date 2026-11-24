const {test}=require('node:test')
const assert=require('node:assert/strict')
const {createTicketStore}=require('./tickets')

test('tickets are random, single-use and carry their payload',()=>{
  const store=createTicketStore()
  const a=store.issue({userId:1,plan:'A'}),b=store.issue({userId:1,plan:'A'})
  assert.notEqual(a.token,b.token)
  assert.deepEqual(store.redeem(a.token),{userId:1,plan:'A'})
  assert.equal(store.redeem(a.token),null,'second use refused')
  assert.equal(store.redeem('nope'),null)
  assert.equal(store.redeem(undefined),null)
  assert.equal(store.redeem({}),null)
})

test('tickets expire after the TTL and expired ones are swept',()=>{
  let now=1_000
  const store=createTicketStore({ttlMs:60_000,now:()=>now})
  const {token,expiresAt}=store.issue({plan:'x'})
  assert.equal(expiresAt.getTime(),61_000)
  now=60_999;const fresh=store.issue({plan:'y'})
  assert.deepEqual(store.redeem(fresh.token),{plan:'y'})
  now=61_000
  assert.equal(store.redeem(token),null,'expired exactly at the TTL')
  store.issue({plan:'z'});now=200_000;store.issue({plan:'w'})
  assert.equal(store.size(),1,'stale tickets swept on issue')
})

test('outstanding tickets are capped',()=>{
  const store=createTicketStore({max:2})
  store.issue({});store.issue({})
  assert.throws(()=>store.issue({}),err=>err.status===429)
})
