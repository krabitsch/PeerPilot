const express = require('express')
const userService = require('./service')
const { requireStaff, requireRole, requireSelfOrStaff } = require('../../middleware/authenticate')

const router = express.Router()
const {uploader} = require('@transcendence/filemanager')

router.get('/me/staff-dashboard', requireStaff, async (req, res, next) => {
  try {
    res.json(await require('./staff-dashboard').getStaffDashboard(req.user.orgId))
  } catch (err) { next(err) }
})

// Self-only summary; identity comes from the authenticated token, not a URL ID.
router.get('/me/learning-summary', async (req, res, next) => {
  try {
    res.json(await require('./learning-summary').getLearningSummary(req.user.userId))
  } catch (err) { next(err) }
})

router.post('/:id/avatar', requireSelfOrStaff('id'), uploader.single('avatar'), async (req, res, next) => {
  try {
    res.json(await userService.uploadAvatar(req.params.id, req.file))
  } catch (err) { next(err) }
})


router.get('/', async (req, res, next) => {
  try {
    res.json(await userService.getAllUsers())
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    res.json(await userService.getUserById(req.params.id))
  } catch (err) { next(err) }
})

//Havent tested it yet
router.get('/:id/role', async (req, res, next) => {
  try {
    res.json(await userService.getRole(req.params.id))
  } catch (err) { next(err) }
})

router.get('/:id/profile', async (req, res, next)=>{
  try {
    res.json(await userService.getProfile(req.params.id))
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/profile', requireSelfOrStaff('id'), async (req, res, next)=>{
  try{
    res.json(await userService.updateProfile(req.params.id, req.body.bio));
  }catch(err){
    next(err)
  }
})

router.delete('/:id', requireRole('Admin'), async(req, res, next)=>{
  try{
    res.json(await userService.deleteUser(req.params.id))
  }catch(err){
    next(err)
  }
})

// Admin resets a user's password (no mail service — the admin relays the
// returned one-time password out of band). Returns { password } once.
router.post('/:id/reset-password', requireRole('Admin'), async(req, res, next)=>{
  try{
    res.json(await userService.resetPassword(req.params.id))
  }catch(err){
    next(err)
  }
})

module.exports = router
