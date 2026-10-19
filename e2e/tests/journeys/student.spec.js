// Alice, a student: her dashboard, her classes, and the core workflow —
// start a submission, upload a file, close it, get a passkey.
const { test, expect } = require('@playwright/test')
const { samplePdf } = require('../../support/ui')
const { sessionFile, seeded } = require('../../support/sessions')
const { db } = require('../../support/db')
const D = require('../../support/data')

test.use({ storageState: sessionFile('alice') })

test('the dashboard shows her class and assignments', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Welcome back, alice' })).toBeVisible()
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: D.classes.web.name })).toBeVisible()
  // The assignment shows up in the dashboard's action/info messages.
  await expect(main.getByText(D.assignments.solo.name).first()).toBeVisible()
})

test('My classes lists enrolled and available classes', async ({ page }) => {
  await page.goto('/classes')
  await expect(page.getByRole('heading', { name: 'My classes' })).toBeVisible()
  await expect(page.getByText(D.classes.web.name)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Browse classes' })).toBeVisible()
  await expect(page.getByText(D.classes.open.name)).toBeVisible()
})

// Enrolment is staff-only by decision. The page still offers students an
// Enroll button; clicking it must not enrol them.
test('a student cannot enrol themselves', async ({ page }) => {
  await page.goto('/classes')
  // Other journeys add classes too, so pick this class's button specifically.
  const openClass = page.locator('div')
    .filter({ has: page.getByText(D.classes.open.name, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Enroll →' }) })
    .last()
  await openClass.getByRole('button', { name: 'Enroll →' }).click()
  await expect(page.getByText('Failed to enroll. Please try again.')).toBeVisible()
  const enrolled = await db().enrollment.count({ where: { userId: seeded().users.alice, classId: seeded().classes.open } })
  expect(enrolled).toBe(0)
})

test('she submits and closes her project', async ({ page }, testInfo) => {
  page.on('dialog', (d) => d.accept())   // "Are you sure you want to close this submission?"

  await page.goto('/assignment')
  const card = page.locator('div')
    .filter({ has: page.getByText(D.assignments.solo.name, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Open →' }) })
    .last()
  await card.getByRole('button', { name: 'Open →' }).click()
  await expect(page).toHaveURL(/\/assignment-detail\?assId=\d+/)
  await expect(page.getByRole('heading', { name: D.assignments.solo.name })).toBeVisible()

  // Enrolled students can start a submission straight away. (The old
  // "You're enrolled in this assignment." banner was dropped in the merged UI.)
  await page.getByRole('button', { name: 'Start submission' }).click()
  await page.locator('main input[type=file]').setInputFiles(samplePdf(testInfo.outputDir))
  await expect(page.getByText('report.pdf')).toBeVisible()

  await page.getByRole('button', { name: 'Close submission' }).click()

  // Evaluation passkeys are per pairing and are issued later, once a teacher
  // generates pairings (see the full-lifecycle journey) — so closing does not
  // reveal a passkey. It records the submission with its file.
  await expect.poll(async () =>
    (await db().submission.findFirst({ where: { groupId: seeded().groups.aliceSolo } }))?.status
  ).toBe('Close')
  const stored = await db().submission.findFirst({ where: { groupId: seeded().groups.aliceSolo }, include: { file: true } })
  expect(stored.file?.name).toBe('report.pdf')

  // It survives a reload: the page reads it back from the API.
  await page.reload()
  await expect(page.getByText('report.pdf')).toBeVisible()
})

test('she edits her bio', async ({ page }) => {
  await page.goto('/user-profile')
  await page.getByRole('button', { name: '✏️ Edit profile' }).click()
  const bio = page.getByRole('main').getByRole('textbox').last()
  await bio.fill('I like peer reviews.')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('I like peer reviews.')).toBeVisible()
})
