const { prisma } = require('@transcendence/database')
const {AppError, NotFoundError, ValidationError, ConflictError, ForbiddenError} = require('@transcendence/errors')
const utils = require('@transcendence/utils')
const { createPendingUser } = require('../auth/userModel')

const MAX_ROSTER_ROWS = 1000
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

// Staff enrol students by email, each with one of the course's official course
// numbers. An email without an account gets a pending one, so the student is in
// the roster (and in groups and pairings) before they ever sign up; signing up
// with that email later claims the account. Rows are applied one at a time and
// a bad row is reported back instead of failing the whole list.
const enrollByEmail = async ({ classId, students, actor }) => {
  const classIdNum = Number(classId)
  if (!Number.isInteger(classIdNum))
    throw new ValidationError('Invalid request')
  if (!Array.isArray(students) || students.length === 0)
    throw new ValidationError('Provide at least one student')
  if (students.length > MAX_ROSTER_ROWS)
    throw new ValidationError(`At most ${MAX_ROSTER_ROWS} students per request`)

  const course = await prisma.class.findUnique({
    where: { id: classIdNum },
    select: { id: true, org_id: true, externalCourseCodes: true }
  })
  if (!course)
    throw new NotFoundError('Class Not Found')
  if (actor.role !== 'Admin' && actor.orgId !== course.org_id)
    throw new ForbiddenError('You can only manage courses in your organisation')

  const codes = course.externalCourseCodes ?? []
  const seen = new Set()
  const results = []
  for (const row of students) {
    const email = String(row?.email ?? '').trim().toLowerCase()
    const code = String(row?.externalCourseCode ?? '').trim() || null
    const fail = (error) =>
      results.push({ email, externalCourseCode: code, status: 'failed', error })

    if (!EMAIL_PATTERN.test(email)) { fail('Invalid email address'); continue }
    if (seen.has(email)) { fail('Listed more than once'); continue }
    seen.add(email)
    if (codes.length > 0 && !code) { fail('Course number required'); continue }
    if (code && !codes.includes(code)) { fail(`${code} is not a course number of this course`); continue }

    try {
      results.push({ email, externalCourseCode: code, ...await enrollOneByEmail(course, email, code, actor) })
    } catch (err) {
      if (!(err instanceof AppError)) throw err
      fail(err.message)
    }
  }
  return { results }
}

// One roster row in one transaction. Returns which account was used
// (created / pending / registered) and what happened to the enrollment
// (enrolled / updated / unchanged).
const enrollOneByEmail = (course, email, code, actor) => prisma.$transaction(async (tx) => {
  let user = await tx.user.findUnique({
    where: { email },
    select: { id: true, role: true, orgId: true, userAuth: { select: { provider: true, pass_hash: true } } }
  })
  let account
  if (!user) {
    user = await createPendingUser(email, course.org_id, tx)
    account = 'created'
  } else {
    if (user.role !== 'Student')
      throw new ConflictError(`${email} is a ${user.role} account, not a student`)
    if (user.orgId != null && user.orgId !== course.org_id)
      throw new ConflictError(`${email} belongs to another organisation`)
    if (user.orgId == null)
      await tx.user.update({ where: { id: user.id }, data: { orgId: course.org_id } })
    account = utils.isPendingAuth(user.userAuth) ? 'pending' : 'registered'
  }

  // The whitelist entry is what lets the student sign up and claim the account.
  if (account !== 'registered') {
    await tx.authAllowedEmail.upsert({
      where: { email },
      create: { email, orgId: course.org_id, invited_by: actor.userId },
      update: { used: false }
    })
  }

  const existing = await tx.enrollment.findUnique({
    where: { userId_classId: { userId: user.id, classId: course.id } }
  })
  let status
  if (!existing) {
    await tx.enrollment.create({
      data: { userId: user.id, classId: course.id, externalCourseCode: code, status: 'Active' }
    })
    status = 'enrolled'
  } else if (existing.status !== 'Active') {
    await tx.enrollment.update({
      where: { id: existing.id },
      data: { status: 'Active', externalCourseCode: code }
    })
    status = 'enrolled'
  } else if (existing.externalCourseCode !== code) {
    await tx.enrollment.update({
      where: { id: existing.id },
      data: { externalCourseCode: code }
    })
    status = 'updated'
  } else {
    status = 'unchanged'
  }
  return { userId: user.id, account, status }
})

const enrollStudent = async ({
  classId,
  studentId,
  externalCourseCode,
  isStaff = false
}) => {
  // Students must supply a valid university course number; staff may enroll
  // any student directly (the route's documented "Staff can enroll any
  // student"), so the code and its eligibility checks are skipped for them.
  if (!classId || !studentId || (!isStaff && !externalCourseCode))
    throw new ValidationError('Invalid request')
  const classIdNum = Number(classId)
  const studentIdNum = Number(studentId)
  const requestedCode =
    externalCourseCode != null && String(externalCourseCode).trim() !== ''
      ? String(externalCourseCode).trim()
      : null
  // 1. Course must exist
  const resultClass = await prisma.class.findUnique({
    where: { id: classIdNum }
  })
  if (!resultClass)
    throw new NotFoundError('Class Not Found')
  // 2. Student must exist
  const user = await utils.getUserById(studentIdNum)
  if (!user)
    throw new NotFoundError('Student Not Found')
  // Steps 3–5 gate a student's self-enrollment by the course's whitelist.
  // Staff bypass this gate entirely.
  if (!isStaff) {
    // 3. The requested official university course number must actually belong to this Peerofessor course
    if (
      !Array.isArray(resultClass.externalCourseCodes) ||
      !resultClass.externalCourseCodes.includes(requestedCode)
    ) {
      throw new ValidationError(
        'Invalid university course number for this course'
      )
    }
    // 4. Check whitelist for this particular student + course
    const eligibility = await prisma.allowedEnrollment.findUnique({
      where: {
        email_classId: {
          email: user.email.toLowerCase(),
          classId: classIdNum
        }
      }
    })
    if (!eligibility) {
      throw new ValidationError(
        'Student is not authorised to enroll in this course'
      )
    }
    // 5. Student may only choose the course number assigned to them in the whitelist
    if (eligibility.externalCourseCode !== requestedCode) {
      throw new ValidationError(
        'Student is not authorised for this university course number'
      )
    }
  }
  // 6. Check existing enrollment
  const existing =
    await utils.getEnrollment(studentIdNum, classIdNum)

  if (existing && existing.status === 'Active') {
    throw new ConflictError(
      'Student is already enrolled'
    )
  }
  // 7. If previously dropped, reactivate enrollment
  if (existing && existing.status === 'Dropped') {
    return await prisma.enrollment.update({
      where: { id: existing.id },

      data: {
        status: 'Active',
        // keep the prior code if staff reactivates without supplying one
        externalCourseCode: requestedCode ?? existing.externalCourseCode
      },
      select: {
        id: true,
        userId: true,
        classId: true,
        externalCourseCode: true,
        enrollDate: true,
        status: true
      }
    })
  }
  // 8. Otherwise create new enrollment
  return await prisma.enrollment.create({
    data: {
      userId: studentIdNum,
      classId: classIdNum,
      externalCourseCode: requestedCode,
      status: 'Active'
    },
    select: {
      id: true,
      userId: true,
      classId: true,
      externalCourseCode: true,
      enrollDate: true,
      status: true
    }
  })
}

const dropStudent = async ({classId, studentId})=>{
    if(!classId || !studentId)
        throw new ValidationError("Invalid request")
    const resultClass = await utils.getClassById(classId)
    if(!resultClass) throw new NotFoundError('Class Not Found')

    const user = await utils.getUserById(studentId)
    if(!user) throw new NotFoundError("Student Not Found")
    
    const existing = await utils.getEnrollment(studentId, classId)
    if(!existing) throw new ConflictError('Student is not enrolled')

    const result = await prisma.enrollment.update({
        where: { id: existing.id },
        data: { status: 'Dropped' },
        select: {
            id: true,
            userId: true,
            classId: true,
            status: true,
            enrollDate: true
        }
    })

    // Consequence: a dropped student can no longer take part in this class's
    // assignment groups — leave their groups, promoting a new leader (or
    // deleting the group entirely) when they were the sole member/leader.
    await leaveClassGroups(studentId, classId)

    return result
}

const leaveClassGroups = async (studentId, classId)=>{
    const memberships = await prisma.groupMember.findMany({
        where: { userId: parseInt(studentId), group: { assignment: { classid: parseInt(classId) } } },
        include: { group: { include: { members: true } } }
    })

    for (const membership of memberships) {
        const group = membership.group
        const remaining = group.members.filter(m => m.userId !== parseInt(studentId))

        if (remaining.length === 0) {
            await prisma.group.delete({ where: { id: group.id } })
            continue
        }
        if (group.leaderId === parseInt(studentId)) {
            await prisma.group.update({ where: { id: group.id }, data: { leaderId: remaining[0].userId } })
        }
        await prisma.groupMember.delete({ where: { id: membership.id } })
    }
}

const getEnrollement = async(studentId)=>{
  if(!studentId)
    throw new ValidationError('invalid request')
  const user = await utils.getUserById(studentId, null, {enrollments:true})
  if(!user)
    throw new NotFoundError('User not found')
  return user.enrollments
}

const getEnrolledClasses = async(studentId, filter)=>{
  if(!studentId)
    throw new ValidationError('invalid request')
  const user = await utils.getUserById(studentId, null,
    { enrollments: {
      include:{class:{
        include:{
          assignments:true
        }
      }}
    }})
  if(!user)
    throw new NotFoundError('User not found')
  const enrolledClasses =
    user.enrollments
      .filter(enroll => enroll.status === 'Active')
      .map(enroll => ({
        ...enroll.class,

        externalCourseCode:
          enroll.externalCourseCode
      }))
  return enrolledClasses

}

const getEnrollmentEligibility = async (
  classId,
  studentId
) => {
  if (!classId || !studentId)
    throw new ValidationError('Invalid request')

  const classIdNum = Number(classId)
  const studentIdNum = Number(studentId)

  const course = await prisma.class.findUnique({
    where: { id: classIdNum }
  })

  if (!course)
    throw new NotFoundError('Class Not Found')

  const student =
    await utils.getUserById(studentIdNum)

  if (!student)
    throw new NotFoundError('Student Not Found')

  const eligibility =
    await prisma.allowedEnrollment.findUnique({
      where: {
        email_classId: {
          email: student.email.toLowerCase(),
          classId: classIdNum
        }
      }
    })
  return {
    eligible: Boolean(eligibility),
    allowedExternalCourseCode: eligibility?.externalCourseCode ?? null,
    availableExternalCourseCodes: course.externalCourseCodes ?? [],
    term: course.term ?? null
  }
}

module.exports = {enrollStudent, enrollByEmail, dropStudent, getEnrollement, getEnrolledClasses, getEnrollmentEligibility}