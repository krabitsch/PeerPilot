const express = require('express')
const orgService = require('./service')
const { requireRole, requireStaff } = require('../../middleware/authenticate')

const router = express.Router()

// Reads stay open to any authenticated user; every mutation is staff-only, and
// creating or deleting a whole organisation is Admin-only.

router.get('/', async (req, res, next)=>{
    try{
        res.json(await orgService.getAllOrgs())
    }catch(err) { next(err) }
})

router.get('/:id', async(req, res, next)=>{
    try{
        res.json(await orgService.getOrg(req.params.id))
    }catch(err) { next(err) }
})

router.post('/', requireRole('Admin'), async (req, res, next)=>{
    try {
        res.json(await orgService.createOrg(req.body))
    } catch (err) { next(err) }
})

router.delete('/:id', requireRole('Admin'), async (req, res, next)=>{
    try {
        res.json(await orgService.deleteOrg(req.params.id))
    } catch (err) { next(err) }
})

router.post('/:id/members', requireStaff, async (req, res, next)=>{
    try{
        res.json( await orgService.createMember(req.params.id, req.body))
    }catch(err) { next(err) }
})

router.delete('/:id/members', requireStaff, async (req, res, next)=>{
    try{
        res.json(await orgService.removeMember(req.params.id, req.body))
    }catch(err){ next(err)}
})

router.patch('/:id/members', requireStaff, async (req, res, next)=>{
    try{
        res.json(await orgService.updateMemberRole(req.params.id, req.body))
    }catch(err){ next(err)}
})

router.get('/:id/members', async (req, res, next)=>{
    try{
        res.json( await orgService.listOrgMembers(req.params.id))
    }catch(err) { next(err) }
})

router.put('/:id/profile', requireStaff, async (req, res, next)=>{
    try{
        res.json( await orgService.createOrgProfile(req.params.id, req.body))
    }catch(err) { next(err) }
})

router.get('/:id/profile', async (req, res, next)=>{
    try{
        res.json( await orgService.getOrgProfile(req.params.id))
    }catch(err) { next(err) }
})

router.delete('/:id/profile', requireStaff, async (req, res, next)=>{
    try{
        res.json(await orgService.deleteOrgProfile(req.params.id))
    }catch(err){ next(err)}
})


router.get('/:id/courses', async (req, res, next)=>{
    try{
        res.json( await orgService.getOrgCourses(req.params.id))
    }catch(err) { next(err) }
})

module.exports = router