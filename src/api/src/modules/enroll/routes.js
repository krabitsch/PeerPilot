const express = require('express')
const enrollService = require('./service')

const {
  requireStaff,
  requireSelfOrStaff
} = require('../../middleware/authenticate')

const route = express.Router()


// ---------------------------------------------------------
// Check whether this student may enroll in this course,
// and which official university course number they may use.
//
// Student can check their own eligibility.
// Staff can check any student's eligibility.
// ---------------------------------------------------------
route.get(
  '/eligibility/:classId/:id',
  requireSelfOrStaff('id'),
  async (req, res, next) => {
    try {
      const result =
        await enrollService.getEnrollmentEligibility(
          req.params.classId,
          req.params.id
        )

      res.json(result)
    } catch (err) {
      next(err)
    }
  }
)


// ---------------------------------------------------------
// Enroll a student.
//
// Student can enroll THEMSELVES.
// Staff can enroll any student.
//
// IMPORTANT:
// studentId comes from the protected URL parameter,
// not from an arbitrary studentId supplied in the body.
// ---------------------------------------------------------
route.post(
  '/:id',
  requireSelfOrStaff('id'),
  async (req, res, next) => {
    try {
      const result =
        await enrollService.enrollStudent({
          ...req.body,
          studentId: req.params.id
        })

      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  }
)


// ---------------------------------------------------------
// Dropping students remains staff-controlled for now.
// ---------------------------------------------------------
route.patch(
  '/',
  requireStaff,
  async (req, res, next) => {
    try {
      const result =
        await enrollService.dropStudent(req.body)

      res.json(result)
    } catch (err) {
      next(err)
    }
  }
)


// ---------------------------------------------------------
// Get raw enrollment records for a student.
// Student can see their own; staff can see anyone's.
// ---------------------------------------------------------
route.get(
  '/:id',
  requireSelfOrStaff('id'),
  async (req, res, next) => {
    try {
      res.json(
        await enrollService.getEnrollement(
          req.params.id
        )
      )
    } catch (error) {
      next(error)
    }
  }
)


// ---------------------------------------------------------
// Get classes in which a student is enrolled.
// ---------------------------------------------------------
route.get(
  '/classes/:id',
  requireSelfOrStaff('id'),
  async (req, res, next) => {
    try {
      res.json(
        await enrollService.getEnrolledClasses(
          req.params.id
        )
      )
    } catch (err) {
      next(err)
    }
  }
)


module.exports = route