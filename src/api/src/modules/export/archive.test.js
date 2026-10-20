// Runs with the API's installed Express/archiver dependencies; no DB/storage writes.
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm')
const express=require('express')
const {harness}=require('./service.test')
test('real ZIP route streams all retry files, feedback, attempts and optional recordings',async()=>{
  const service=harness(),moduleStub={exports:{}}
  vm.runInNewContext(fs.readFileSync(__dirname+'/routes.js','utf8'),{module:moduleStub,process,require:name=>{
    if(name==='./service')return {...service,planArchive:async(id,opts)=>{if(id==='999')throw Object.assign(Error('Assignment not found'),{status:404});return service.planArchive(id,opts)}}
    if(name==='@transcendence/logger')return {error(){}}
    if(name==='../../middleware/authenticate')return {requireStaff:(req,res,next)=>next()}
    return require(name)
  }})
  const app=express();app.use(moduleStub.exports)
  const server=app.listen(0,'127.0.0.1')
  await new Promise(resolve=>server.once('listening',resolve))
  try{
    const base=`http://127.0.0.1:${server.address().port}`
    for(const recordings of [true,false]){
      const response=await fetch(`${base}/assignment/1/archive${recordings?'':'?recordings=0'}`)
      assert.equal(response.status,200)
      assert.equal(response.headers.get('content-type'),'application/zip')
      assert.match(response.headers.get('content-disposition'),/attachment; filename="peerofessor-Course-Assignment.zip"/)
      const bytes=Buffer.from(await response.arrayBuffer())
      assert.equal(bytes.subarray(0,4).toString('hex'),'504b0304')
      fs.writeFileSync(`/tmp/peerofessor-fixture-${recordings?'audio':'no-audio'}.zip`,bytes)
    }
    const failed=await fetch(`${base}/assignment/999/archive`)
    assert.equal(failed.status,404);assert.equal(failed.headers.get('content-disposition'),null)
    assert.match(failed.headers.get('content-type'),/application\/json/)
    assert.equal((await failed.json()).error,'Assignment not found')
  }finally{await new Promise(resolve=>server.close(resolve))}
})
