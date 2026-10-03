// Who may do what. These pin down the authorization rules added in Phase 3 and
// the fixes that followed, so a later change can't quietly reopen them.
const { test, expect, expectError, expectOk } = require('../../support/api')
const { seeded } = require('../../support/sessions')

const MODULES = ['user', 'org', 'class', 'enroll', 'group', 'submission', 'eval']

test.describe('anonymous callers', () => {
  for (const mod of MODULES) {
    test(`are refused on /api/${mod}/`, async ({ api }) => {
      await expectError(await (await api('anon')).get(`${mod}/`), 401)
    })
  }

  test('cannot delete a class', async ({ api }) => {
    await expectError(await (await api('anon')).delete(`class/${seeded().classes.web}`), 401)
  })

  test('are refused with a forged token', async ({ request }) => {
    const res = await request.get('/api/class/', { headers: { Authorization: 'Bearer not.a.jwt' } })
    await expectError(res, 403)
  })
})

test.describe('role gates', () => {
  const staffOnly = () => {
    const s = seeded()
    return [
      ['POST',   'class/',                                        { name: 'x', description: 'y', org_id: s.orgId, created_by: s.users.alice, pass_threshold: 50 }],
      ['DELETE', `class/${s.classes.web}`],
      ['POST',   'org/',                                          { email: 'x@e2e.test', orgname: 'x', tag: 'x' }],
      ['DELETE', `user/${s.users.bob}`],
      ['POST',   'eval/sheet',                                    { assId: s.assignments.solo }],
      ['POST',   `eval/assignment/${s.assignments.peer}/generate-simple-pairings`],
      ['DELETE', `group/${s.groups.carol}/admin`],
      ['GET',    `group/assignment/${s.assignments.peer}`],
      ['POST',   'enroll/',                                       { classId: s.classes.open, studentId: s.users.alice }],
      ['PATCH',  'enroll/',                                       { classId: s.classes.web, studentId: s.users.alice }],
    ]
  }

  test('a student is refused on every staff-only route', async ({ api }) => {
    const alice = await api('alice')
    for (const [method, path, data] of staffOnly()) {
      await test.step(`${method} ${path}`, async () => {
        await expectError(await alice.fetch(path, { method, data }), 403)
      })
    }
  })

  test('a Bocal is refused on Admin-only routes', async ({ api }) => {
    const bocal = await api('bocal')
    await expectError(await bocal.post('org/', { data: { email: 'y@e2e.test', orgname: 'y', tag: 'y' } }), 403)
    await expectError(await bocal.delete(`user/${seeded().users.bob}`), 403)
  })

  test('a Bocal can use staff routes', async ({ api }) => {
    const groups = await expectOk(await (await api('bocal')).get(`group/assignment/${seeded().assignments.peer}`))
    expect(groups.map((g) => g.name)).toContain('carol-group')
  })
})

test.describe('self-or-staff routes', () => {
  test('a student edits only their own profile', async ({ api }) => {
    const { users } = seeded()
    const alice = await api('alice')
    await expectError(await alice.patch(`user/${users.bob}/profile`, { data: { bio: 'hacked' } }), 403)
    const own = await expectOk(await alice.patch(`user/${users.alice}/profile`, { data: { bio: 'mine' } }))
    expect(own.bio).toBe('mine')
  })

  test('a student reads only their own enrolments; staff read anyone\'s', async ({ api }) => {
    const { users } = seeded()
    await expectError(await (await api('alice')).get(`enroll/${users.bob}`), 403)
    await expectOk(await (await api('bocal')).get(`enroll/${users.alice}`))
  })
})

test.describe('identity comes from the token, not the request', () => {
  test('a student cannot submit an evaluation assigned to someone else', async ({ api }) => {
    const { evalAssignment, users } = seeded()
    const res = await (await api('bob')).post('eval/evaluate/submit', {
      data: { evalAssignmentId: evalAssignment, evaluatorUserId: users.dave, comment: 'x'.repeat(30),
              scores: [{ sectionId: 1, score: 1 }] },
    })
    const body = await expectError(res, 401)
    expect(body.error).toBe('This is not your evaluation')
  })

  test('a student cannot upload into another student\'s group', async ({ api }) => {
    const { groups, users } = seeded()
    const res = await (await api('bob')).post(`submission/${groups.aliceSolo}/file`, {
      multipart: { userId: String(users.alice), file: { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') } },
    })
    expect((await res.json()).ok).toBe(false)
  })

  test('a student creating a group always leads it themselves', async ({ api }) => {
    const { assignments, users } = seeded()
    const group = await expectOk(await (await api('bob')).post('group/', {
      data: { assId: assignments.solo, userId: users.carol, name: 'bob-claims-carol', size: 1 },
    }))
    expect(group.leaderId).toBe(users.bob)
  })

  // Regression: Phase 3 bound the leader to the caller for staff too, which
  // broke the Bocal panel's "Create group" and "Generate groups".
  test('staff can create a group led by a student', async ({ api }) => {
    const { assignments, users } = seeded()
    const group = await expectOk(await (await api('bocal')).post('group/', {
      data: { assId: assignments.solo, userId: users.carol, name: 'bocal-for-carol', size: 1 },
    }))
    expect(group.leaderId).toBe(users.carol)
  })
})

// Regression: Phase 3 made this staff-only, which broke the student assignment
// page. Students must see their own group's submission and nobody else's.
test.describe('submission lists are scoped to the caller', () => {
  test('a student sees only their own group\'s submission', async ({ api }) => {
    const { assignments, groups } = seeded()
    const carolSees = await expectOk(await (await api('carol')).get(`submission/assignment/${assignments.peer}/`))
    expect(carolSees.map((s) => s.groupId)).toEqual([groups.carol])

    const bobSees = await expectOk(await (await api('bob')).get(`submission/assignment/${assignments.peer}/`))
    expect(bobSees, 'Bob is in no Peer Review group, so no passkeys for him').toEqual([])
  })

  test('staff see every group\'s submission', async ({ api }) => {
    const { assignments, groups } = seeded()
    const all = await expectOk(await (await api('bocal')).get(`submission/assignment/${assignments.peer}/`))
    expect(all.map((s) => s.groupId)).toContain(groups.carol)
  })
})

test.describe('enrolment is staff-driven', () => {
  test('a Bocal enrols and drops a student', async ({ api }) => {
    const { classes, users } = seeded()
    const bocal = await api('bocal')
    const enrolled = await expectOk(await bocal.post('enroll/', { data: { classId: classes.open, studentId: users.bob } }))
    expect(enrolled).toMatchObject({ userId: users.bob, classId: classes.open, status: 'Active' })
    const dropped = await expectOk(await bocal.patch('enroll/', { data: { classId: classes.open, studentId: users.bob } }))
    expect(dropped.status).toBe('Dropped')
  })
})

test.describe('the user directory', () => {
  test('the list carries no email addresses', async ({ api }) => {
    const users = await expectOk(await (await api('alice')).get('user/'))
    expect(users.length).toBeGreaterThan(1)
    for (const u of users) expect(u).not.toHaveProperty('email')
  })

  // Accepted by the team: a single user's email is not treated as secret.
  test('a single user still includes their email', async ({ api }) => {
    const bob = await expectOk(await (await api('alice')).get(`user/${seeded().users.bob}`))
    expect(bob.email).toBe('bob@e2e.test')
  })
})

test.describe('admin password reset (no mail service)', () => {
  test('only an Admin can reset, and it returns a working password', async ({ api }) => {
    const { users } = seeded()

    // A non-admin cannot reset anyone.
    await expectError(await (await api('bocal')).post(`user/${users.bob}/reset-password`, { data: {} }), 403)
    await expectError(await (await api('alice')).post(`user/${users.alice}/reset-password`, { data: {} }), 403)

    // Admin resets and gets a one-time password back.
    const body = await expectOk(await (await api('admin')).post(`user/${users.dave}/reset-password`, { data: {} }))
    expect(typeof body.password).toBe('string')
    expect(body.password.length).toBeGreaterThanOrEqual(12)

    // That password actually logs the user in.
    const login = await (await api('anon')).post('auth/login', {
      data: { email: 'dave@e2e.test', password: body.password },
    })
    expect((await login.json()).accessToken).toBeTruthy()
  })
})
