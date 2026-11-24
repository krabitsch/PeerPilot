// Runs with the API's installed Express/archiver dependencies; no DB/storage writes.
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path')
const {Readable}=require('node:stream')
const express=require('express')
const {harness}=require('./service.test')

// Loads routes.js with stubbed service/auth/db. `opts.openEntryStream` replaces
// the MinIO reader; `opts.role` is what the DB says the ticket holder is now.
function loadRoutes(opts={}){
  const service=harness(),moduleStub={exports:{}}
  const stubService={...service,
    planArchive:async(id,o)=>{if(id==='999')throw Object.assign(Error('Assignment not found'),{status:404});return service.planArchive(id,o)},
    ...(opts.openEntryStream?{openEntryStream:opts.openEntryStream}:{})}
  vm.runInNewContext(fs.readFileSync(__dirname+'/routes.js','utf8'),{module:moduleStub,process,require:name=>{
    if(name==='./service')return stubService
    if(name==='./tickets')return {archiveTickets:require('./tickets').createTicketStore()}
    if(name==='@transcendence/logger')return {error(){},info(){}}
    if(name==='@transcendence/database')return {prisma:{user:{findUnique:async()=>opts.role===null?null:{role:opts.role??'Bocal'}}}}
    if(name==='../../middleware/authenticate')return {STAFF_ROLES:['Admin','Bocal'],requireStaff:(req,res,next)=>{req.user={userId:7,role:'Bocal'};next()}}
    return require(name)
  }})
  return moduleStub.exports
}
async function serve(routes,fn){
  const app=express();app.use(express.json());app.use(routes.ticketed);app.use(routes)
  const server=app.listen(0,'127.0.0.1')
  await new Promise(resolve=>server.once('listening',resolve))
  try{await fn(`http://127.0.0.1:${server.address().port}`)}finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve))}
}
const isZip=bytes=>bytes.subarray(0,4).toString('hex')==='504b0304'
const ticketFor=async(base,body={})=>{
  const res=await fetch(`${base}/assignment/1/archive-ticket`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  assert.equal(res.status,200);return res.json()
}

test('real ZIP route streams all retry files, feedback, attempts and optional recordings',async()=>{
  await serve(loadRoutes(),async base=>{
    for(const recordings of [true,false]){
      const response=await fetch(`${base}/assignment/1/archive${recordings?'':'?recordings=0'}`)
      assert.equal(response.status,200)
      assert.equal(response.headers.get('content-type'),'application/zip')
      assert.match(response.headers.get('content-disposition'),/attachment; filename="peerofessor-Course-Assignment.zip"/)
      const bytes=Buffer.from(await response.arrayBuffer())
      assert(isZip(bytes))
      fs.writeFileSync(path.join(os.tmpdir(),`peerofessor-fixture-${recordings?'audio':'no-audio'}.zip`),bytes)
      const text=bytes.toString('latin1')
      for(const key of ['content:original','content:retry1','content:retry2']) assert(text.includes(key),key)
      assert.equal(text.includes('content:audio-1'),recordings)
    }
    const failed=await fetch(`${base}/assignment/999/archive`)
    assert.equal(failed.status,404);assert.equal(failed.headers.get('content-disposition'),null)
    assert.match(failed.headers.get('content-type'),/application\/json/)
    assert.equal((await failed.json()).error,'Assignment not found')
  })
})

test('ticket download: plan validated up front, ZIP streamed once, then refused',async()=>{
  await serve(loadRoutes(),async base=>{
    const grant=await ticketFor(base,{recordings:false})
    assert.equal(grant.ok,true);assert.match(grant.ticket,/^[A-Za-z0-9_-]{43}$/)
    assert.equal(grant.submissions,3);assert.equal(grant.recordings,0);assert.equal(grant.includeRecordings,false)
    assert.equal(typeof grant.totalBytes,'number')

    const first=await fetch(`${base}/archive/${grant.ticket}`)
    assert.equal(first.status,200);assert.equal(first.headers.get('content-type'),'application/zip')
    assert.match(first.headers.get('content-disposition'),/attachment; filename=".+\.zip"/)
    const bytes=Buffer.from(await first.arrayBuffer());assert(isZip(bytes))
    assert(bytes.toString('latin1').includes('recordings excluded by request'))

    const reused=await fetch(`${base}/archive/${grant.ticket}`)
    assert.equal(reused.status,410);assert.equal(reused.headers.get('content-disposition'),null)
    assert.match(await reused.text(),/expired or was already used/)
    assert.equal((await fetch(`${base}/archive/not-a-real-ticket`)).status,410)

    // Pre-stream failures surface on the JSON ticket call, never as a download.
    const bad=await fetch(`${base}/assignment/999/archive-ticket`,{method:'POST'})
    assert.equal(bad.status,404);assert.equal((await bad.json()).error,'Assignment not found')
  })
})

test('ticket holder demoted since issuing is refused',async()=>{
  for(const role of ['Student',null]){
    await serve(loadRoutes({role}),async base=>{
      const {ticket}=await ticketFor(base)
      const res=await fetch(`${base}/archive/${ticket}`)
      assert.equal(res.status,403);assert.equal(res.headers.get('content-disposition'),null)
    })
  }
})

// A slow MinIO object: a few chunks, each on a later tick.
const slowObject=(key,track)=>{
  track.open++;track.maxOpen=Math.max(track.maxOpen,track.open);track.opened.push(key)
  let n=0
  const s=new Readable({read(){setTimeout(()=>this.push(n++<4?Buffer.alloc(64*1024,65):null),2)}})
  s.on('close',()=>{track.open--})
  return s
}

test('MinIO objects are opened one at a time, never all up front',async()=>{
  const track={open:0,maxOpen:0,opened:[]}
  await serve(loadRoutes({openEntryStream:async e=>slowObject(e.key,track)}),async base=>{
    const res=await fetch(`${base}/assignment/1/archive`)
    assert(isZip(Buffer.from(await res.arrayBuffer())))
  })
  assert.deepEqual(track.opened,['original','retry1','retry2','audio-1','audio-2'])
  assert.equal(track.maxOpen,1)
  assert.equal(track.open,0)
})

test('an unreadable object is skipped, the rest still arrive',async()=>{
  const track={open:0,maxOpen:0,opened:[]}
  const open=async e=>{if(e.key==='retry1')throw new Error('NoSuchKey');return slowObject(e.key,track)}
  await serve(loadRoutes({openEntryStream:open}),async base=>{
    const bytes=Buffer.from(await (await fetch(`${base}/assignment/1/archive`)).arrayBuffer())
    assert(isZip(bytes))
  })
  assert.deepEqual(track.opened,['original','retry2','audio-1','audio-2'])
})

test('client cancelling mid-download closes the open object and opens no more',async()=>{
  const track={open:0,maxOpen:0,opened:[]}
  // Endless object: only a cancel can end it.
  const open=async e=>{track.open++;track.opened.push(e.key)
    const s=new Readable({read(){setTimeout(()=>this.push(Buffer.alloc(64*1024,66)),1)}});s.on('close',()=>track.open--);return s}
  await serve(loadRoutes({openEntryStream:open}),async base=>{
    const ctrl=new AbortController()
    const res=await fetch(`${base}/assignment/1/archive`,{signal:ctrl.signal})
    const reader=res.body.getReader()
    for(let got=0;got<512*1024;){const {value}=await reader.read();got+=value.length}
    ctrl.abort()
    await new Promise(r=>setTimeout(r,100))
  })
  assert.deepEqual(track.opened,['original'])
  assert.equal(track.open,0)
})
