const express = require('express')
const route = express.Router()
const groupService = require('./service')
const { requireStaff } = require('../../middleware/authenticate')

// The service layer already enforces the real rules — you must be an active
// member, the group leader, or the invite's recipient. Those checks were
// keyed on a user id the client supplied, so anyone could claim to be anyone.
// The caller's id now comes from the verified token instead, which is what
// makes those existing checks mean something.

route.post('/', async (req, res, next)=>{
    try{
        res.json(await groupService.createGroup({ ...req.body, userId: req.user.userId }))
    }catch(err){next(err)}
})

// Specific routes MUST come before parameterised /:id routes

// Get current user's group for a specific assignment
route.get('/my-group', async(req, res, next)=>{
    try{
        res.json(await groupService.getMyGroupForAssignment({ ...req.query, userId: req.user.userId }))
    }catch(err){next(err)}
})

// List all groups for an assignment (staff management)
route.get('/assignment/:assId', requireStaff, async(req, res, next)=>{
    try{
        res.json(await groupService.getGroupsForAssignment(req.params.assId))
    }catch(err){next(err)}
})

//Show list of pending invites
route.get('/invite', async(req, res, next)=>{
    try{
        res.json(await groupService.getInvites({ ...req.query, userId: req.user.userId }))
    }catch(err){next(err)}
})

//delete pending invite
route.delete('/invite/:id', async(req, res, next)=>{
    try{
        res.json(await groupService.deleteInvite(req.params.id, req.user.userId))
    }catch(err){next(err)}
})

route.patch('/invite/:id', async(req, res, next)=>{
    try{
        res.json(await groupService.respondToInvite(req.params.id, { ...req.body, userId: req.user.userId }))
    }catch(err){next(err)}
})

// staff/admin: directly add a member to a group
route.post('/:id/admin/member', requireStaff, async (req, res, next) => {
    try {
        res.json(await groupService.addMemberAdmin(req.params.id, req.body))
    } catch (err) { next(err) }
})

// staff/admin: remove one member from a group
route.delete('/:id/admin/member', requireStaff, async (req, res, next) => {
    try {
        res.json(await groupService.removeMemberAdmin(req.params.id, req.body))
    } catch (err) { next(err) }
})

route.post('/:id/invite', async (req, res, next)=>{
    try{
        res.json(await groupService.inviteMember(req.params.id, { ...req.body, leaderId: req.user.userId }))
    }catch(err){next(err)}
})

//leave group
route.delete('/:id', async (req, res, next)=>{
    try{
        res.json(await groupService.leaveGroup(req.params.id, { ...req.body, userId: req.user.userId }))
    }catch(err){next(err)}
})

//staff/admin: force-remove a group entirely
route.delete('/:id/admin', requireStaff, async (req, res, next)=>{
    try{
        res.json(await groupService.deleteGroup(req.params.id))
    }catch(err){next(err)}
})

//get group profile
route.get('/:id', async (req, res, next)=>{
    try{
        res.json(await groupService.getGroup(req.params.id))
    }catch(err){next(err)}
})

module.exports = route
