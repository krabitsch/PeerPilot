const express = require('express')
const router = express.Router()
const subService = require('./service')
const { uploader } = require('@transcendence/filemanager')
const { isStaff } = require('../../middleware/authenticate')

// `validateGroupMember` in the service already requires the caller to be
// enrolled in the class and a member of this exact group, and closing a
// submission additionally requires being the leader. The caller's id now comes
// from the token, so those checks can no longer be sidestepped by posting
// someone else's user id.

router.post('/', async (req, res, next)=>{
    try{
        res.json(await subService.createSubmission({ ...req.body, userId: req.user.userId }))
    }catch(err){next(err)}
})

router.patch('/:groupId/close' , async (req, res, next)=>{
    try{
        res.json(await subService.closeSubmission(req.params.groupId, { ...req.body, userId: req.user.userId }))
    }catch(err){ next(err)}
})

// Staff see every group's submission. Students see only their own group's —
// the assignment page finds "my submission" in this list — and never other
// groups' passkeys, which are what an evaluator needs to start an evaluation.
router.get('/assignment/:assId/', async (req, res, next)=>{
    try{
        const scope = isStaff(req) ? {} : { memberId: req.user.userId }
        res.json(await subService.getSubmissionsForAssignment(req.params.assId, scope))
    }catch(err){next(err)}
})


router.post('/:groupId/file', uploader.single('file'), async (req, res, next) => {
  try {
    res.json(await subService.uploadFile(req.params.groupId, req.user.userId, req.file))
  } catch (err) { next(err) }
})


router.get('/:groupId/file/download', async (req, res, next) => {
  try {
    res.json(await subService.getDownloadUrl(req.params.groupId, { userId: req.user.userId, isStaff: isStaff(req) }))
  } catch (err) { next(err) }
})


router.delete('/:groupId/file', async (req, res, next) => {
  try {
    res.json(await subService.removeFile(req.params.groupId, req.user.userId))
  } catch (err) { next(err) }
})

router.get('/:groupId', async (req, res, next)=>{
    try{
        res.json(await subService.getGroupSubmissions(req.params.groupId))
    }catch(err){next(err)}
})

module.exports = router
