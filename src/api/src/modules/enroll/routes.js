const express = require('express')
const enrollService = require('./service')
const { requireSelfOrStaff, isStaff } = require('../../middleware/authenticate')
const route = express.Router()

// Staff enrol and drop anyone; a student may only enrol or drop themselves, so
// their `studentId` is taken from the token rather than the request body.
const studentId = (req) => isStaff(req) && req.body.studentId
    ? req.body.studentId
    : req.user.userId

route.post('/',async (req, res, next)=>{
    try{
        const result = await enrollService.enrollStudent({ ...req.body, studentId: studentId(req) })
        res.status(201).json(result)
    }catch(err){next(err)}
})

route.patch('/', async(req, res, next)=>{
    try{
        const result = await enrollService.dropStudent({ ...req.body, studentId: studentId(req) })
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
