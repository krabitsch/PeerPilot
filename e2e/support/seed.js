// Resets the e2e database to the fixed dataset in data.js.
//
// Every table except Prisma's migration history is truncated, then the dataset
// is inserted. Run on its own (`node support/seed.js`) or from global-setup.
// It only ever connects to the e2e database — see env.js.
const { srcRequire, E2E_DB_PORT } = require('./env')
const { db } = require('./db')
const D = require('./data')
const bcrypt = srcRequire('bcrypt')

const wipe = async (prisma) => {
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  if (!tables.length) throw new Error('No tables found — has `prisma migrate deploy` run against the e2e database?')
  const list = tables.map(t => `"public"."${t.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
}

const seed = async () => {
  const prisma = db()
  await wipe(prisma)

  const org = await prisma.organization.create({ data: D.org })
  const pass_hash = await bcrypt.hash(D.PASSWORD, 4)

  const u = {}
  for (const [key, spec] of Object.entries(D.users)) {
    u[key] = await prisma.user.create({
      data: {
        email: spec.email,
        username: spec.username,
        role: spec.role,
        orgId: org.id,
        userAuth: { create: { pass_hash, provider: 'local', email_verified: spec.verified !== false } },
      },
    })
  }

  const sections = { create: D.evalSheet }
  const makeClass = (spec) => prisma.class.create({
    data: { ...spec, org_id: org.id, created_by: u.bocal.id, pass_threshold: 50 },
  })
  const web = await makeClass(D.classes.web)
  const open = await makeClass(D.classes.open)

  for (const s of ['alice', 'bob', 'carol', 'dave']) {
    await prisma.enrollment.create({ data: { userId: u[s].id, classId: web.id, status: 'Active' } })
  }

  const makeAssignment = (spec) => prisma.assignment.create({
    data: {
      ...spec, classid: web.id, groupSize: 1, req_eval: 1, max_score: 100, pass_threshold: 50,
      evalSheet: { create: { sections } },
    },
  })
  const solo = await makeAssignment(D.assignments.solo)
  const peer = await makeAssignment(D.assignments.peer)

  // Students can't create groups in the UI; a Bocal does it for them. Alice
  // already has her solo group, so her journey can start at the submission.
  const aliceGroup = await prisma.group.create({
    data: { assId: solo.id, name: 'alice-solo', size: 1, leaderId: u.alice.id,
            members: { create: { userId: u.alice.id } } },
  })

  // Carol's group has already closed its submission; Dave is paired to evaluate it.
  const group = await prisma.group.create({
    data: { assId: peer.id, name: 'carol-group', size: 1, leaderId: u.carol.id,
            members: { create: { userId: u.carol.id } } },
  })
  await prisma.submission.create({
    data: { groupId: group.id, status: 'Close', type: 'FILE', passkey: D.PASSKEY, closedAt: new Date() },
  })
  const pairing = await prisma.evalAssignment.create({
    data: { assignmentId: peer.id, evalueeGroupId: group.id, evaluatorUserId: u.dave.id, round: 1, status: 'Pending' },
  })

  await prisma.authAllowedEmail.create({
    data: { email: D.invite.email, orgId: org.id, invited_by: u.admin.id },
  })

  return {
    orgId: org.id,
    users: Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.id])),
    classes: { web: web.id, open: open.id },
    assignments: { solo: solo.id, peer: peer.id },
    groups: { aliceSolo: aliceGroup.id, carol: group.id },
    evalAssignment: pairing.id,
  }
}

module.exports = { seed }

if (require.main === module) {
  seed()
    .then((r) => { console.log(`e2e database (localhost:${E2E_DB_PORT}) seeded:`, JSON.stringify(r)); return db().$disconnect() })
    .catch(async (e) => { console.error(e); await db().$disconnect(); process.exit(1) })
}
