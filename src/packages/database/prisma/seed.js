const path = require('path')
const bcrypt = require('bcrypt')
const { PrismaClient } = require('../generated/prisma')

const prisma = new PrismaClient()

require('dotenv').config({
  path: path.resolve(__dirname, '../../../.env')
})

const SEED_PASSWORD = 'Test1234!'


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
  await prisma.enrollment.deleteMany()
  await prisma.class.deleteMany()
  await prisma.userProfile.deleteMany()
  await prisma.userAuth.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.user.deleteMany()
  await prisma.orgProfile.deleteMany()
  await prisma.organization.deleteMany()
}


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


async function enrollUsers(users, classId) {
  for (const user of users) {
    await prisma.enrollment.create({
      data: {
        userId: user.id,
        classId,
        status: 'Active'
      }
    })
  }
}


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
      name: 'Assignment 2: dynamic optimization and the stochastic growth model',
      description: 'Dynamic optimization and the stochastic growth model'
    }
  })
}


async function main() {
  console.log('Seeding PeerPilot development database...')

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12)

  // ------------------------------------------------------------
  // Clear existing sample data
  // ------------------------------------------------------------

  await clearDatabase()


  // ------------------------------------------------------------
  // Organization
  // ------------------------------------------------------------

  const wu = await prisma.organization.create({
    data: {
      email: 'office@example.com',
      name: 'WU Vienna',
      tag: 'WU',

      profile: {
        create: {
          bio: 'Vienna University of Economics and Business',
          tel_num: ''
        }
      }
    }
  })


  // ------------------------------------------------------------
  // Bocals
  // ------------------------------------------------------------

  const katrin = await createUser({
    email: 'katrin@example.com',
    username: 'Katrin',
    role: 'Bocal',
    orgId: wu.id,
    passwordHash
  })

  const peter = await createUser({
    email: 'peter@example.com',
    username: 'Peter',
    role: 'Bocal',
    orgId: wu.id,
    passwordHash
  })


  // ------------------------------------------------------------
  // Students: student01 ... student60
  // ------------------------------------------------------------

  const students = []

  for (let i = 1; i <= 60; i++) {
    const number = String(i).padStart(2, '0')
    const username = `student${number}`

    const student = await createUser({
      email: `${username}@example.com`,
      username,
      role: 'Student',
      orgId: wu.id,
      passwordHash
    })

    students.push(student)
  }


  // ------------------------------------------------------------
  // Classes
  // ------------------------------------------------------------

  const class1268 = await prisma.class.create({
    data: {
      name: 'PI 1268 Foundations of Macroeconomics',
      description: 'Introductory course to the methods and applications in Macroeconomics, MA Economics, science track and applied track, Fall 2026',
      created_by: katrin.id,
      org_id: wu.id
    }
  })

  const class1269 = await prisma.class.create({
    data: {
      name: 'PI 1269 Foundations of Macroeconomics',
      description: 'Introductory course to the methods and applications in Macroeconomics, MA Economics, science track and applied track, Fall 2026',
      created_by: katrin.id,
      org_id: wu.id
    }
  })

  const class1421 = await prisma.class.create({
    data: {
      name: 'PI 1421 Foundations of Macroeconomics',
      description: 'Introductory course to the methods and applications in Macroeconomics, MA Economics, science track and applied track, Fall 2026',
      created_by: katrin.id,
      org_id: wu.id
    }
  })


  // ------------------------------------------------------------
  // Enroll 20 different students in each class
  //
  // PI 1268: student01 - student20
  // PI 1269: student21 - student40
  // PI 1421: student41 - student60
  // ------------------------------------------------------------

  await enrollUsers(
    students.slice(0, 20),
    class1268.id
  )

  await enrollUsers(
    students.slice(20, 40),
    class1269.id
  )

  await enrollUsers(
    students.slice(40, 60),
    class1421.id
  )


  // ------------------------------------------------------------
  // Two assignments per class
  // ------------------------------------------------------------

  await createAssignments(class1268.id)
  await createAssignments(class1269.id)
  await createAssignments(class1421.id)


  // ------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------

  console.log('')
  console.log('PeerPilot development database seeded successfully.')
  console.log('')
  console.log('Bocals:')
  console.log('  katrin@example.com')
  console.log('  peter@example.com')
  console.log('')
  console.log('Students:')
  console.log('  student01@example.com ... student60@example.com')
  console.log('')
  console.log(`Password for all seeded users: ${SEED_PASSWORD}`)
  console.log('')
  console.log('Classes:')
  console.log('  PI 1268 Foundations of Macroeconomics — student01 to student20')
  console.log('  PI 1269 Foundations of Macroeconomics — student21 to student40')
  console.log('  PI 1421 Foundations of Macroeconomics — student41 to student60')
}


main()
  .catch((error) => {
    console.error('Seed failed:')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })