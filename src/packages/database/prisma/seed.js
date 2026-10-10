const path = require('path')
const bcrypt = require('bcrypt')
const { PrismaClient } = require('../generated/prisma')

const prisma = new PrismaClient()

require('dotenv').config({
  path: path.resolve(__dirname, '../../../.env')
})

const SEED_PASSWORD = 'Test1234!'


// ============================================================
// CLEAR DATABASE
// ============================================================

async function clearDatabase() {
  await prisma.evalSectionScore.deleteMany()
  await prisma.evalAssignment.deleteMany()
  await prisma.evalResponse.deleteMany()
  await prisma.submission.deleteMany()
  await prisma.file.deleteMany()

  await prisma.groupInvite.deleteMany()
  await prisma.groupMember.deleteMany()
  await prisma.group.deleteMany()

  await prisma.evalSection.deleteMany()
  await prisma.evalSheet.deleteMany()
  await prisma.assignment.deleteMany()

  // Must be removed before Class because AllowedEnrollment
  // contains a foreign key to Class.
  await prisma.allowedEnrollment.deleteMany()

  await prisma.enrollment.deleteMany()
  await prisma.class.deleteMany()

  await prisma.userProfile.deleteMany()
  await prisma.userAuth.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.user.deleteMany()

  await prisma.orgProfile.deleteMany()
  await prisma.organization.deleteMany()
}


// ============================================================
// USER HELPER
// ============================================================

async function createUser({
  email,
  username,
  role,
  orgId,
  passwordHash
}) {
  return prisma.user.create({
    data: {
      email,
      username,
      role,
      orgId,

      userAuth: {
        create: {
          pass_hash: passwordHash,
          email_verified: true,
          provider: 'local'
        }
      },

      profile: {
        create: {
          bio: '',
          last_update: new Date()
        }
      }
    }
  })
}


// ============================================================
// OFFICIAL UNIVERSITY COURSE CODE HELPER
//
// student01 - student20 -> 1268
// student21 - student40 -> 1269
// student41 - student61 -> 1421
// ============================================================

function externalCourseCodeForStudent(studentNumber) {
  if (studentNumber <= 20) return '1268'
  if (studentNumber <= 40) return '1269'
  return '1421'
}


// ============================================================
// ENROLLMENT HELPER
//
// studentRecords have the form:
//
// {
//   user: <Prisma User>,
//   externalCourseCode: '1268' | '1269' | '1421'
// }
// ============================================================

async function enrollUsers(studentRecords, classId) {
  for (const record of studentRecords) {
    await prisma.enrollment.create({
      data: {
        userId: record.user.id,
        classId,
        externalCourseCode: record.externalCourseCode,
        status: 'Active'
      }
    })
  }
}


// ============================================================
// ASSIGNMENT HELPER
// ============================================================

async function createAssignments(classId) {
  await prisma.assignment.create({
    data: {
      classid: classId,
      name: 'Assignment 1: data and stylized facts',
      description: 'Data and stylized facts'
    }
  })

  await prisma.assignment.create({
    data: {
      classid: classId,
      name:
        'Assignment 2: dynamic optimization and the stochastic growth model',
      description:
        'Dynamic optimization and the stochastic growth model'
    }
  })
}


// ============================================================
// MAIN SEED
// ============================================================

async function main() {
  console.log('Seeding Peerofessor development database...')

  const passwordHash =
    await bcrypt.hash(SEED_PASSWORD, 12)


  // ----------------------------------------------------------
  // Clear existing sample data
  // ----------------------------------------------------------

  await clearDatabase()


  // ----------------------------------------------------------
  // Organization
  // ----------------------------------------------------------

  const wu = await prisma.organization.create({
    data: {
      email: 'office@example.com',
      name: 'WU Vienna',
      tag: 'WU',

      profile: {
        create: {
          bio:
            'Vienna University of Economics and Business',
          tel_num: ''
        }
      }
    }
  })


  // ----------------------------------------------------------
  // Bocals
  // ----------------------------------------------------------

  const katrin = await createUser({
    email: 'katrin@example.com',
    username: 'Katrin',
    role: 'Bocal',
    orgId: wu.id,
    passwordHash
  })

  await createUser({
    email: 'peter@example.com',
    username: 'Peter',
    role: 'Bocal',
    orgId: wu.id,
    passwordHash
  })


  // ----------------------------------------------------------
  // Students: student01 ... student61
  //
  // 01-20 -> WU 1268
  // 21-40 -> WU 1269
  // 41-61 -> WU 1421
  //
  // student61 is deliberately NOT enrolled below.
  // It is our development account for testing the new
  // student self-enrollment workflow.
  // ----------------------------------------------------------

  const students = []

  for (let i = 1; i <= 61; i++) {
    const number =
      String(i).padStart(2, '0')

    const username =
      `student${number}`

    const user = await createUser({
      email: `${username}@example.com`,
      username,
      role: 'Student',
      orgId: wu.id,
      passwordHash
    })

    students.push({
      user,
      externalCourseCode:
        externalCourseCodeForStudent(i)
    })
  }


  // ----------------------------------------------------------
  // Peerofessor Course
  //
  // ONE Peerofessor course contains students from all three
  // official WU course numbers.
  // ----------------------------------------------------------

  const foundations =
    await prisma.class.create({
      data: {
        name:
          'Foundations of Macroeconomics',

        description:
          'Introductory course to the methods and applications in Macroeconomics, MA Economics, science track and applied track.',

        created_by: katrin.id,
        org_id: wu.id,

        pass_threshold: 100,

        term: 'Fall 2026',

        externalCourseCodes: [
          '1268',
          '1269',
          '1421'
        ]
      }
    })


  // ----------------------------------------------------------
  // Enrollment whitelist
  //
  // Every student is allowed to enroll in Foundations of
  // Macroeconomics, but ONLY with their assigned official
  // university course code.
  //
  // Example:
  //
  // student01@example.com -> 1268
  // student21@example.com -> 1269
  // student41@example.com -> 1421
  // student61@example.com -> 1421
  // ----------------------------------------------------------

  await prisma.allowedEnrollment.createMany({
    data: students.map(record => ({
      email:
        record.user.email.toLowerCase(),

      classId:
        foundations.id,

      externalCourseCode:
        record.externalCourseCode
    })),

    skipDuplicates: true
  })


  // ----------------------------------------------------------
  // Existing enrollments
  //
  // student01 ... student60 are already enrolled.
  //
  // student61 is intentionally left UNENROLLED while remaining
  // whitelisted for WU course 1421.
  //
  // This lets us log in as student61 and test:
  //
  // Browse classes
  // -> Enroll
  // -> modal
  // -> 1268 disabled
  // -> 1269 disabled
  // -> 1421 enabled
  // -> enroll successfully
  // ----------------------------------------------------------

  await enrollUsers(
    students.slice(0, 60),
    foundations.id
  )


  // ----------------------------------------------------------
  // Assignments
  //
  // Only ONE set of assignments now exists, because all
  // students belong to the same Peerofessor course.
  // ----------------------------------------------------------

  await createAssignments(
    foundations.id
  )


  // ----------------------------------------------------------
  // Summary
  // ----------------------------------------------------------

  console.log('')
  console.log(
    'Peerofessor development database seeded successfully.'
  )

  console.log('')
  console.log('Bocals:')
  console.log('  katrin@example.com')
  console.log('  peter@example.com')

  console.log('')
  console.log('Students:')
  console.log(
    '  student01@example.com ... student61@example.com'
  )

  console.log('')
  console.log(
    `Password for all seeded users: ${SEED_PASSWORD}`
  )

  console.log('')
  console.log('Peerofessor course:')
  console.log(
    '  Foundations of Macroeconomics — Fall 2026'
  )

  console.log('')
  console.log(
    'Official university course numbers:'
  )
  console.log(
    '  WU 1268 — student01 to student20'
  )
  console.log(
    '  WU 1269 — student21 to student40'
  )
  console.log(
    '  WU 1421 — student41 to student61'
  )

  console.log('')
  console.log('Existing enrollments:')
  console.log(
    '  student01 to student60 are enrolled'
  )

  console.log('')
  console.log('Enrollment test account:')
  console.log(
    '  student61@example.com'
  )
  console.log(
    '  WU course 1421'
  )
  console.log(
    '  whitelisted, but NOT yet enrolled'
  )
}


// ============================================================
// RUN
// ============================================================

main()
  .catch((error) => {
    console.error('Seed failed:')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })