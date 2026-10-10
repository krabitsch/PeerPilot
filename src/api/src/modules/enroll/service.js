const { prisma } = require('@transcendence/database')
const {NotFoundError, ValidationError, ConflictError} = require('@transcendence/errors')
const utils = require('@transcendence/utils')

const enrollStudent = async ({
  classId,
  studentId,
  externalCourseCode
}) => {
  if (!classId || !studentId || !externalCourseCode)
    throw new ValidationError('Invalid request')
  const classIdNum = Number(classId)
  const studentIdNum = Number(studentId)
  const requestedCode = String(externalCourseCode).trim()
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
        externalCourseCode: requestedCode
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

module.exports = {enrollStudent, dropStudent, getEnrollement, getEnrolledClasses, getEnrollmentEligibility}