const express = require('express')
const route = express.Router()
const service = require('./service')
const { requireStaff, isStaff } = require('../../middleware/authenticate')
const { recordingUploader } = require('@transcendence/filemanager')

// Eval sheets and the pairing table are course machinery: staff build them,
// students only read them. The evaluation flow itself stays open to students,
// but the evaluator's identity comes from the token — `submitEvaluation`
// already refuses a pairing that isn't yours, and replying to feedback already
// requires being the group leader.

route.get('/sheet/:id', async(req, res, next)=>{
    try{
        res.json(await service.getEvalSheetById(req.params.id))
    }catch(err){next(err)}
})

route.get('/sheet/ass/:id', async(req, res, next)=>{
        try{
        res.json(await service.getEvalSheetByAssId(req.params.id))
    }catch(err){next(err)}
})

route.post('/sheet', requireStaff, async (req, res, next)=>{
    try{
        res.json(await service.createEvalSheet(req.body))
    }catch(err){next(err)}
})

route.post('/sheet/:id/section', requireStaff, async (req, res, next)=>{
    try {
        res.json(await service.createEvalSection(req.params.id, req.body))
    } catch (err) {next(err)}
})

route.patch('/sheet/:id/section', requireStaff, async(req, res, next)=>{
    try{
        res.json(await service.updateEvalSheetSection(req.params.id, req.body))
    }catch(err){ next(err)}
})


route.delete('/sheet/:id/section', requireStaff, async(req, res, next)=>{
    //console.log(req.body)
    try{
        res.json(await service.removeSection(req.params.id, req.body))
    }catch(err){next(err)}
})

// TODO also move it.
route.get('/assignment/:id', async(req, res, next)=>{
    try{
        res.json(await service.getAssignment(req.params.id))
    }catch(err){ next(err)}
})


// Routes pertaining to EvalAssignment model/table

// creates one EvalAssignment manually (POST /api/eval/eval-assignments) 
route.post('/eval-assignments', requireStaff, async(req, res, next) => {
    try{
        res.json(await service.createEvalAssignment(req.body))
    }catch(err){next(err)}
})

// get all EvalAssignments for one assignment (GET /api/eval/assignment/:id/eval-assignments)
route.get('/assignment/:id/eval-assignments', async (req, res, next) => {
  //console.log('DELETE all eval assignments route reached, assignment id:', req.params.id)
  try {
    res.json(await service.getEvalAssignments(req.params.id))
  } catch (err) {
    next(err)
  }
})

// delete all EvalAssignments for one assignment (DELETE /api/eval/assignment/:id/eval-assignments)
route.delete('/assignment/:id/eval-assignments', requireStaff, async (req, res, next) => {
  try {
    res.json(await service.deleteEvalAssignments(req.params.id))
  } catch (err) {
    next(err)
  }
})

// get one EvalAssignment by its EvalAssignment-id (GET /api/eval/eval-assignments/:id)
route.get('/eval-assignments/:id', async (req, res, next) => {
  try {
    res.json(await service.getEvalAssignmentById(req.params.id))
  } catch (err) {
    next(err)
  }
})

// update one EvalAssignment (PUT /api/eval/eval-assignments/:id)
route.put('/eval-assignments/:id', requireStaff, async(req, res, next) => {
    try{
        res.json(await service.updateEvalAssignment(req.params.id, req.body))
    }catch(err){next(err)}
})

// delete one EvalAssignment (DELETE /api/eval/eval-assignments/:id)
route.delete('/eval-assignments/:id', requireStaff, async(req, res, next) => {
    try{
        res.json(await service.deleteEvalAssignment(req.params.id))
    }catch(err){next(err)}
})

route.post('/assignment/:id/generate-simple-pairings', requireStaff, async(req, res, next) => {
    try{
        res.json(await service.generateSimpleEvalAssignmentPairings(req.params.id))
    }catch(err){next(err)}
})

route.post('/evaluate/start', async (req, res, next) => {
    try{
        res.json(await service.startEvaluation({ ...req.body, evaluatorUserId: req.user.userId }))
    }catch(err){next(err)}
})

// Multipart: a required audio recording ('recording') plus the comment and
// scores. scores arrives as a JSON string in the form body.
route.post('/evaluate/submit', recordingUploader.single('recording'), async (req, res, next) => {
    try{
        let scores = req.body.scores
        if (typeof scores === 'string') {
            try { scores = JSON.parse(scores) } catch { scores = undefined }
        }
        res.json(await service.submitEvaluation({
            evalAssignmentId: req.body.evalAssignmentId,
            comment: req.body.comment,
            scores,
            evaluatorUserId: req.user.userId,
            recording: req.file,
        }))
    }catch(err){next(err)}
})

// get all eval feedback left on one submission (GET /api/eval/submission/:subId/responses)
route.get('/submission/:subId/responses', async (req, res, next) => {
    try{
        res.json(await service.getEvalResponsesForSubmission(req.params.subId))
    }catch(err){next(err)}
})

// presigned download of an evaluation's recording — gated to staff, the
// evaluator, or a member of the evaluated group (GET /api/eval/responses/:id/recording)
route.get('/responses/:id/recording', async (req, res, next) => {
    try{
        res.json(await service.getRecordingUrl(req.params.id, { userId: req.user.userId, isStaff: isStaff(req) }))
    }catch(err){next(err)}
})

// group leader replies to one piece of eval feedback (PATCH /api/eval/responses/:id/reply)
route.patch('/responses/:id/reply', async (req, res, next) => {
    try{
        res.json(await service.replyToEvalResponse(req.params.id, { ...req.body, userId: req.user.userId }))
    }catch(err){next(err)}
})

module.exports = route