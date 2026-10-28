// Removing someone from a course, a group or the platform must never cut a
// student off from their submission or the evaluations around it. Regression for
// the prod incident of 2026-10-27: a student was removed from the course and
// added back, groups were generated again, and the student only saw "Start
// submission" while their file sat orphaned in the bucket.
//
// Each test builds its own course, so dropping and re-adding students never
// disturbs the shared seed other tests rely on.
const { request } = require('@playwright/test')
const { test, expect, expectOk, expectError } = require('../../support/api')
const { seeded } = require('../../support/sessions')
const { db } = require('../../support/db')
const { srcRequire, BASE_URL } = require('../../support/env')
const D = require('../../support/data')
const bcrypt = srcRequire('bcrypt')

let counter = 0
const tag = () => `${Date.now().toString(36)}${counter++}`

// Course with students a-d. "Solo essay": A submitted and B evaluated A; A is
// due to evaluate C, C is due to evaluate B. "Pair project": A+B submitted
// together, C+D have nothing yet.
const build = async () => {
  const p = db(), t = tag(), { orgId, users } = seeded()
  const pass_hash = await bcrypt.hash(D.PASSWORD, 4)
  const s = {}
  for (const k of ['a', 'b', 'c', 'd']) {
    s[k] = await p.user.create({ data: { email: `${k}-${t}@e2e.test`, username: `${k}_${t}`, role: 'Student', orgId,
      userAuth: { create: { pass_hash, provider: 'local', email_verified: true } } } })
  }
  const course = await p.class.create({ data: { name: `History ${t}`, description: 'Drop and re-add regression course.',
    org_id: orgId, created_by: users.bocal, pass_threshold: 50 } })
  for (const k of Object.keys(s)) await p.enrollment.create({ data: { userId: s[k].id, classId: course.id, status: 'Active' } })
  const assignment = (name, groupSize) => p.assignment.create({
    data: { name, description: name, classid: course.id, groupSize, req_eval: 1, max_score: 100, pass_threshold: 50,
      evalSheet: { create: { sections: { create: D.evalSheet } } } },
    include: { evalSheet: { include: { sections: true } } },
  })
  const group = (assId, name, members) => p.group.create({ data: { assId, name, size: members.length,
    leaderId: members[0].id, members: { create: members.map(m => ({ userId: m.id })) } } })
  const closed = async (groupId, uploader) => p.submission.create({ data: { groupId, status: 'Close', type: 'FILE',
    closedAt: new Date(), fileId: (await p.file.create({ data: { name: 'essay.pdf', mimiType: 'application/pdf',
      size: 10, url: `history-${t}-${groupId}.pdf`, uploadedBy: uploader.id } })).id } })

  const solo = await assignment('Solo essay', 1)
  const g = {}
  for (const k of ['a', 'b', 'c']) g[k] = await group(solo.id, `${k}-solo`, [s[k]])
  const submission = await closed(g.a.id, s.a)
  const response = await p.evalResponse.create({ data: { subId: submission.id, userId: s.b.id, givenMarks: 80, coreScore: 80,
    comment: 'A clear, well-argued essay. '.repeat(5),
    scores: { create: solo.evalSheet.sections.map(x => ({ sectionId: x.id, score: Math.round(x.marks * 0.8) })) } } })
  const pairing = data => p.evalAssignment.create({ data: { assignmentId: solo.id, round: 1, ...data } })
  const pairings = {
    bEvaluatedA: await pairing({ evalueeGroupId: g.a.id, evaluatorUserId: s.b.id, evaluatorGroupId: g.b.id,
      status: 'Submitted', submissionId: submission.id, evalResponseId: response.id }),
    aEvaluatesC: await pairing({ evalueeGroupId: g.c.id, evaluatorUserId: s.a.id, evaluatorGroupId: g.a.id }),
    cEvaluatesB: await pairing({ evalueeGroupId: g.b.id, evaluatorUserId: s.c.id, evaluatorGroupId: g.c.id }),
  }

  const pair = await assignment('Pair project', 2)
  const pairs = { ab: await group(pair.id, 'ab', [s.a, s.b]), cd: await group(pair.id, 'cd', [s.c, s.d]) }
  await closed(pairs.ab.id, s.a)
  return { course, solo, pair, s, g, pairs, submission, response, pairings }
}

// API context for a student built by this file (no saved session exists for them).
const loginAs = async (email) => {
  const anon = await request.newContext({ baseURL: `${BASE_URL}/api/`, ignoreHTTPSErrors: true })
  const { accessToken } = await (await anon.post('auth/login', { data: { email, password: D.PASSWORD } })).json()
  await anon.dispose()
  expect(accessToken, `login as ${email}`).toBeTruthy()
  return request.newContext({ baseURL: `${BASE_URL}/api/`, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` } })
}

test.describe('removing a student keeps course history', () => {
  test('drop, re-add and regroup: the student still has their submission and the evaluation they received', async ({ api }) => {
    const x = await build(), bocal = await api('bocal')
    await expectOk(await bocal.patch('enroll', { data: { classId: x.course.id, studentId: x.s.a.id } }))

    await test.step('dropping deletes nothing', async () => {
      expect(await db().submission.findUnique({ where: { id: x.submission.id } })).not.toBeNull()
      expect(await db().evalResponse.findUnique({ where: { id: x.response.id } })).not.toBeNull()
      expect(await db().groupMember.findFirst({ where: { groupId: x.g.a.id, userId: x.s.a.id } })).not.toBeNull()
      expect(await db().groupMember.findFirst({ where: { groupId: x.pairs.ab.id, userId: x.s.a.id } })).not.toBeNull()
      expect((await db().evalAssignment.findUnique({ where: { id: x.pairings.bEvaluatedA.id } })).status).toBe('Submitted')
    })
    await test.step('work the dropped student can no longer do is cancelled, the rest is untouched', async () => {
      expect((await db().evalAssignment.findUnique({ where: { id: x.pairings.aEvaluatesC.id } })).status).toBe('Cancelled')
      expect((await db().evalAssignment.findUnique({ where: { id: x.pairings.cEvaluatesB.id } })).status).toBe('Pending')
    })

    await expectOk(await bocal.post(`enroll/class/${x.course.id}/students`, { data: { students: [{ email: x.s.a.email }] } }))
    await expectOk(await bocal.post(`group/assignment/${x.solo.id}/generate`))

    await test.step('re-adding restores everything and generating groups adds no empty duplicate', async () => {
      const groupsOfA = await db().group.findMany({ where: { assId: x.solo.id, members: { some: { userId: x.s.a.id } } } })
      expect(groupsOfA.map(g => g.id)).toEqual([x.g.a.id])
      const student = await loginAs(x.s.a.email)
      const mine = await expectOk(await student.get(`submission/assignment/${x.solo.id}/`))
      expect(mine.map(sub => sub.id)).toEqual([x.submission.id])
      const received = await expectOk(await student.get(`eval/submission/${x.submission.id}/responses`))
      expect(received.map(r => r.id)).toContain(x.response.id)
      await student.dispose()
    })
  })

  test('a group with history keeps its members; one without history can still change', async ({ api }) => {
    const x = await build(), bocal = await api('bocal')
    await expectError(await bocal.delete(`group/${x.pairs.ab.id}/admin/member`, { data: { userId: x.s.b.id } }), 409)
    const b = await loginAs(x.s.b.email)
    await expectError(await b.delete(`group/${x.pairs.ab.id}`), 409)
    await b.dispose()
    expect(await db().groupMember.count({ where: { groupId: x.pairs.ab.id } })).toBe(2)

    await expectOk(await bocal.delete(`group/${x.pairs.cd.id}/admin/member`, { data: { userId: x.s.d.id } }))
    expect(await db().groupMember.count({ where: { groupId: x.pairs.cd.id } })).toBe(1)
  })

  test('an account with submissions or evaluations cannot be deleted; one without can', async ({ api }) => {
    const x = await build(), admin = await api('admin')
    for (const k of ['a', 'b']) {
      await test.step(`${k} has history`, async () => {
        await expectError(await admin.delete(`user/${x.s[k].id}`), 409)
        expect(await db().user.findUnique({ where: { id: x.s[k].id } })).not.toBeNull()
      })
    }
    const fresh = await db().user.create({ data: { email: `fresh-${tag()}@e2e.test`, username: `fresh_${tag()}`, role: 'Student', orgId: seeded().orgId } })
    await expectOk(await admin.delete(`user/${fresh.id}`))
    expect(await db().user.findUnique({ where: { id: fresh.id } })).toBeNull()
  })
})
