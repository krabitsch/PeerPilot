const express = require('express')
const enrollService = require('./service')
const { requireStaff, requireSelfOrStaff } = require('../../middleware/authenticate')
const route = express.Router()

// Enrolment is staff-driven: students do not add themselves to a course they
// were never admitted to. Staff name the student in the request body.
route.post('/', requireStaff, async (req, res, next)=>{
    try{
        const result = await enrollService.enrollStudent(req.body)
        res.status(201).json(result)
    }catch(err){next(err)}
})

route.patch('/', requireStaff, async(req, res, next)=>{
    try{
        const result = await enrollService.dropStudent(req.body)
        res.json(result)
    }catch(err){next(err)}
})

route.get('/:id', requireSelfOrStaff('id'), async(req, res, next)=>{
    try{
        res.json(await enrollService.getEnrollement(req.params.id))
    }catch(error){next(error)}
})

route.get('/classes/:id', requireSelfOrStaff('id'), async(req, res, next)=>{
    try{
        await res.json(await enrollService.getEnrolledClasses(req.params.id))
    }catch(err){next(err)}
})

module.exports = route
