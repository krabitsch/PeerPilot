// Full bottom-up lifecycle, all through the UI:
//   admin creates an org and whitelists emails → people register → admin
//   promotes one to Bocal → the teacher builds a class, enrols students, creates
//   an assignment (with a subject file + eval sheet) and a group per student →
//   students submit → the teacher generates pairings → two rounds of peer
//   evaluations, each with a recording upload.
//
// Unlike the other journeys, this one does NOT use the seeded dataset: it builds
// everything itself (only the seeded `admin` session is reused, to start from a
// real admin). See e2e/FULL-LIFECYCLE-PLAN.md.
//
// Uploaded files are throwaway buffers — we only assert the features fire.
const { test, expect } = require('@playwright/test')
const { pageAs, freshContext, recordVideoOpts, samplePdf, sampleAudioUpload } = require('../../support/ui')
const { db } = require('../../support/db')
const D = require('../../support/data')

const PW = D.PASSWORD // a zxcvbn-strong password the seed already uses

const ORG = { name: 'Lifecycle Academy', email: 'life-org@e2e.test', tag: 'LIFE' }
const TEACHER = 'life-teacher@e2e.test'
const STUDENTS = ['life-s1@e2e.test', 'life-s2@e2e.test', 'life-s3@e2e.test']
const CLASS_NAME = 'Lifecycle Web'
const ASSIGNMENT = 'Lifecycle Project'

// State carried across the ordered steps.
const S = {
  orgId: null,
  classId: null,
  assignmentId: null,
  idByEmail: {},        // email -> user id
  emailById: {},        // user id -> email
  passkeyByEmail: {},   // student email -> their group's submission passkey
}

test.describe.serial('full lifecycle, bottom-up through the UI', () => {

  test('admin creates an organisation', async ({ browser }) => {
    const admin = await pageAs(browser, 'admin')
    await admin.goto('/admin/orgs')
    await admin.getByRole('button', { name: '+ New org' }).click()
    await admin.getByPlaceholder('e.g. 42 Paris').fill(ORG.name)
    await admin.getByPlaceholder('admin@school.example').fill(ORG.email)
    await admin.getByPlaceholder('optional').fill(ORG.tag)
    await admin.getByPlaceholder('Brief description').fill('Full-lifecycle e2e org.')
    await admin.getByPlaceholder('+33 1 23 45 67 89').fill('+43 1 234 5678')
    await admin.getByRole('button', { name: 'Create organization' }).click()

    await expect.poll(async () =>
      (await db().organization.findFirst({ where: { email: ORG.email } }))?.id ?? null,
    ).toBeTruthy()
    const org = await db().organization.findFirst({ where: { email: ORG.email } })
    S.orgId = org.id
    await admin.context().close()
  })

  test('admin whitelists the teacher and students', async ({ browser }) => {
    const admin = await pageAs(browser, 'admin')
    await admin.goto(`/admin/org/${S.orgId}`)
    for (const email of [TEACHER, ...STUDENTS]) {
      await admin.getByPlaceholder('name@example.com').fill(email)
      await admin.getByRole('button', { name: 'Whitelist email', exact: true }).click()
      await expect(admin.getByText(email, { exact: true }).first()).toBeVisible()
    }
    const invited = await db().authAllowedEmail.findMany({ where: { orgId: S.orgId } })
    expect(invited.map(i => i.email).sort()).toEqual([TEACHER, ...STUDENTS].sort())
    await admin.context().close()
  })

  test('the invited people register and can sign in immediately', async ({ browser }) => {
    for (const email of [TEACHER, ...STUDENTS]) {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...recordVideoOpts() })
      const page = await ctx.newPage()
      await page.goto('/register')
      await page.getByPlaceholder('your.invited@email.com').fill(email)
      await page.locator('input[type=password]').nth(0).fill(PW)
      await page.locator('input[type=password]').nth(1).fill(PW)
      await page.getByRole('button', { name: 'Create account' }).click()
      await expect(page.getByText(/Registration successful/)).toBeVisible()
      await ctx.close()
    }

    // Capture the ids the backend assigned (we select students by id later).
    const users = await db().user.findMany({ where: { email: { in: [TEACHER, ...STUDENTS] } } })
    for (const u of users) { S.idByEmail[u.email] = u.id; S.emailById[u.id] = u.email }
    expect(Object.keys(S.idByEmail).sort()).toEqual([TEACHER, ...STUDENTS].sort())
    for (const u of users) expect(u.orgId, `${u.email} joined the org`).toBe(S.orgId)
  })

  test('admin promotes the teacher to Bocal', async ({ browser }) => {
    const admin = await pageAs(browser, 'admin')
    await admin.goto(`/admin/org/${S.orgId}`)

    const row = admin.locator('div')
      .filter({ has: admin.getByText(TEACHER, { exact: true }) })
      .filter({ has: admin.locator('select') })
      .last()
    await row.locator('select').selectOption('Bocal')
    await row.getByRole('button', { name: 'Change' }).click()

    await expect.poll(async () =>
      (await db().user.findUnique({ where: { email: TEACHER } })).role,
    ).toBe('Bocal')
    await admin.context().close()
  })

  test('the teacher creates a course', async ({ browser }) => {
    const { page: teacher, context } = await freshContext(browser, TEACHER, PW)
    await teacher.goto('/bocal/classes')
    await teacher.getByRole('button', { name: '+ New course' }).click()
    const form = teacher.getByRole('main')
    await form.getByRole('textbox').nth(0).fill(CLASS_NAME)
    await form.getByRole('textbox').nth(1).fill('Built from scratch by the e2e lifecycle test.')
    await teacher.getByRole('button', { name: 'Create class' }).click()

    await expect(teacher.getByText(CLASS_NAME).first()).toBeVisible()
    const cls = await db().class.findFirst({ where: { name: CLASS_NAME, org_id: S.orgId } })
    expect(cls, 'class created in the org').toBeTruthy()
    S.classId = cls.id
    await context.close()
  })

  test('the teacher enrols the students through the Students tab', async ({ browser }) => {
    const { page: teacher, context } = await freshContext(browser, TEACHER, PW)
    // The classId query param preselects the course, which reveals the
    // "Add student to class" control added for this flow.
    await teacher.goto(`/bocal/students?classId=${S.classId}`)

    // Anchor on the control's unique "Add to class" button (not the filter-bar
    // selects), and wait for it — the student list loads async.
    const addRow = teacher.locator('div')
      .filter({ has: teacher.getByRole('button', { name: 'Add to class' }) })
      .last()
    await expect(addRow.getByRole('button', { name: 'Add to class' })).toBeVisible()

    for (const email of STUDENTS) {
      const id = S.idByEmail[email]
      await addRow.locator('select').selectOption(String(id))
      await addRow.getByRole('button', { name: 'Add to class' }).click()
      // The student leaves the "enrollable" picker once enrolled.
      await expect(addRow.locator(`option[value="${id}"]`)).toHaveCount(0)
    }

    const enrolled = await db().enrollment.findMany({ where: { classId: S.classId, status: 'Active' } })
    expect(enrolled.map(e => e.userId).sort()).toEqual(STUDENTS.map(e => S.idByEmail[e]).sort())
    await context.close()
  })

  test('the teacher creates an assignment with a subject file and eval sheet', async ({ browser }, testInfo) => {
    const { page: teacher, context } = await freshContext(browser, TEACHER, PW)

    // Open the course's assignments view.
    await teacher.goto(`/bocal/classes`)
    await teacher.getByText(CLASS_NAME, { exact: true }).first().waitFor()
    await teacher.getByText(CLASS_NAME, { exact: true })
      .locator('xpath=ancestor::*[.//button[normalize-space()="Open assignments"]][1]')
      .getByRole('button', { name: 'Open assignments' }).click()
    await teacher.getByRole('button', { name: '+ New assignment' }).click()
    await expect(teacher.getByRole('heading', { name: /New assignment/ })).toBeVisible()

    const main = teacher.getByRole('main')
    await main.getByRole('textbox').nth(0).fill(ASSIGNMENT)
    await main.getByRole('textbox').nth(1).fill('Each student submits solo, then peers evaluate.')
    await main.getByRole('spinbutton').nth(0).fill('100')  // max score
    await main.getByRole('spinbutton').nth(1).fill('2')    // required evaluations = rounds
    await main.getByRole('spinbutton').nth(2).fill('1')    // group size (one student per group)
    await main.getByRole('spinbutton').nth(3).fill('50')   // pass threshold

    // Subject file — a throwaway PDF.
    await main.locator('input[type=file]').setInputFiles(samplePdf(testInfo.outputDir, 'subject.pdf'))

    // Eval sheet: one Slider + one Toggle section summing to the max score.
    await teacher.getByRole('button', { name: /Eval sheet/ }).click()
    for (const [name, marks, type] of [['Functionality', '60', 'Slider'], ['Quality', '40', 'Toggle']]) {
      await main.getByRole('textbox').nth(0).fill(name)
      await main.getByRole('textbox').nth(1).fill(`${name}?`)
      await main.getByRole('spinbutton').nth(0).fill(marks)
      await main.getByRole('combobox').nth(0).selectOption(type)
      await teacher.getByRole('button', { name: '+ Add section' }).click()
    }
    await expect(teacher.getByText('0 pts remaining')).toBeVisible()
    await teacher.getByRole('button', { name: 'Create assignment' }).click()

    const load = () => db().assignment.findFirst({
      where: { name: ASSIGNMENT, classid: S.classId },
      include: { evalSheet: { include: { sections: true } } },
    })
    await expect.poll(async () => (await load())?.evalSheet?.sections.length).toBe(2)
    const created = await load()
    expect(created).toMatchObject({ groupSize: 1, req_eval: 2, max_score: 100 })
    expect(created.fileId, 'a subject file is attached').toBeTruthy()
    const subjectFile = await db().file.findUnique({ where: { id: created.fileId } })
    expect(subjectFile?.name, 'subject file stored').toBe('subject.pdf')
    S.assignmentId = created.id
    await context.close()
  })

  test('the teacher makes one group per student', async ({ browser }) => {
    const { page: teacher, context } = await freshContext(browser, TEACHER, PW)
    await teacher.goto(`/bocal/classes?classId=${S.classId}`)

    await teacher.getByText(ASSIGNMENT, { exact: true })
      .locator('xpath=ancestor::*[.//button[normalize-space()="Manage groups"]][1]')
      .getByRole('button', { name: 'Manage groups' }).click()
    await teacher.getByRole('button', { name: 'Generate all groups' }).click()

    // One solo group per enrolled student (groupSize 1), each its own leader.
    await expect.poll(async () =>
      (await db().group.findMany({ where: { assId: S.assignmentId } })).length,
    ).toBe(STUDENTS.length)
    const groups = await db().group.findMany({ where: { assId: S.assignmentId } })
    expect(groups.map(g => g.leaderId).sort()).toEqual(STUDENTS.map(e => S.idByEmail[e]).sort())
    await context.close()
  })

  test('each student submits and closes their project', async ({ browser }, testInfo) => {
    for (const email of STUDENTS) {
      const { page, context } = await freshContext(browser, email, PW)
      await page.goto('/assignment')
      const card = page.locator('div')
        .filter({ has: page.getByText(ASSIGNMENT, { exact: true }) })
        .filter({ has: page.getByRole('button', { name: 'Open →' }) })
        .last()
      await card.getByRole('button', { name: 'Open →' }).click()
      await expect(page).toHaveURL(/\/assignment-detail\?assId=\d+/)

      await page.getByRole('button', { name: 'Start submission' }).click()
      await page.locator('main input[type=file]').setInputFiles(samplePdf(testInfo.outputDir, 'work.pdf'))
      await expect(page.getByText('work.pdf')).toBeVisible()
      await page.getByRole('button', { name: 'Close submission' }).click()

      await expect(page.getByText('Eval passkey')).toBeVisible()
      const passkey = (await page.getByRole('main').textContent()).match(/Eval passkey\s*(\d{6})/)?.[1]
      expect(passkey, `${email} got a passkey`).toBeTruthy()
      S.passkeyByEmail[email] = passkey
      await context.close()
    }
  })

  test('the teacher generates two rounds of pairings', async ({ browser }) => {
    const { page: teacher, context } = await freshContext(browser, TEACHER, PW)
    await teacher.goto(`/eval-assignments?assignmentId=${S.assignmentId}`)
    await teacher.getByRole('button', { name: 'Generate all pairings' }).click()

    await expect.poll(async () =>
      (await db().evalAssignment.findMany({ where: { assignmentId: S.assignmentId } })).length,
    ).toBe(STUDENTS.length * 2) // groups × rounds = 3 × 2
    const rounds = [...new Set(
      (await db().evalAssignment.findMany({ where: { assignmentId: S.assignmentId } })).map(p => p.round),
    )].sort()
    expect(rounds, 'two rounds generated').toEqual([1, 2])
    await context.close()
  })

  test('every evaluator completes both rounds with a recording', async ({ browser }) => {
    const pairings = await db().evalAssignment.findMany({ where: { assignmentId: S.assignmentId } })
    const groups = await db().group.findMany({ where: { assId: S.assignmentId } })
    const leaderOf = Object.fromEntries(groups.map(g => [g.id, S.emailById[g.leaderId]]))

    // Group the pairings by the evaluator so each person signs in once.
    const byEvaluator = {}
    for (const p of pairings) {
      const evaluator = S.emailById[p.evaluatorUserId]
      ;(byEvaluator[evaluator] ??= []).push({
        evalueeEmail: leaderOf[p.evalueeGroupId],
        passkey: S.passkeyByEmail[leaderOf[p.evalueeGroupId]],
        evalueeGroupId: p.evalueeGroupId,
        round: p.round,
      })
    }

    for (const [evaluator, jobs] of Object.entries(byEvaluator)) {
      const { page, context } = await freshContext(browser, evaluator, PW)
      for (const job of jobs) {
        await page.goto('/evaluation')
        await page.getByPlaceholder('leader@example.com').fill(job.evalueeEmail)
        await page.getByPlaceholder('482913').fill(job.passkey)
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByRole('heading', { name: 'Peer evaluation' })).toBeVisible()

        await page.getByRole('slider').fill('45')
        await page.getByRole('button', { name: /^Yes/ }).click()
        await page.getByPlaceholder('Describe what was done well and what could be improved...')
          .fill(`Round ${job.round}: solid work overall, a few things to tighten up.`)

        const submit = page.getByRole('button', { name: 'Submit evaluation' })
        await page.locator('input[accept="audio/*"]').setInputFiles(sampleAudioUpload())
        await expect(submit).toBeEnabled()
        await submit.click()

        await expect.poll(async () =>
          (await db().evalAssignment.findFirst({
            where: { assignmentId: S.assignmentId, evaluatorUserId: S.idByEmail[evaluator], evalueeGroupId: job.evalueeGroupId },
          })).status,
        ).toBe('Submitted')
      }
      await context.close()
    }

    // Every pairing is submitted, and every evaluation carries a recording.
    const done = await db().evalAssignment.findMany({ where: { assignmentId: S.assignmentId } })
    expect(done).toHaveLength(STUDENTS.length * 2)
    for (const p of done) expect(p.status, 'pairing submitted').toBe('Submitted')

    const responses = await db().evalResponse.findMany({
      where: { userId: { in: STUDENTS.map(e => S.idByEmail[e]) } },
    })
    expect(responses, 'one evaluation per pairing').toHaveLength(STUDENTS.length * 2)
    for (const r of responses) expect(r.recordingFileId, 'recording stored for the evaluation').toBeTruthy()
  })
})
