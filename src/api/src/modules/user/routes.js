const express = require('express')
const userService = require('./service')
const { requireRole, requireSelfOrStaff } = require('../../middleware/authenticate')

const router = express.Router()
const {uploader} = require('@transcendence/filemanager')

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

// TODO(phase-2): delete these two. /auth owns registration and login — these
// duplicate it, and `loginUser` still has its bcrypt comparison commented out.
// They are unreachable without a token now that the module sits behind
// `authenticate`, which defuses them, but they should not exist at all.
router.post('/login', requireRole('Admin'), async (req, res, next) => {
  try {
    res.json(await userService.loginUser(req.body))
  } catch (err) { next(err) }
})


router.post('/register', requireRole('Admin'), async (req, res, next) => {
  try {
    res.status(201).json(await userService.createUser(req.body))
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

module.exports = router
