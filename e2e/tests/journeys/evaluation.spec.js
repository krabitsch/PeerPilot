// Dave evaluates the project Carol's group submitted, then Carol reads the
// feedback and replies — which completes the grade.
const { test, expect } = require('@playwright/test')
const { pageAs } = require('../../support/ui')
const { seeded } = require('../../support/sessions')
const { db } = require('../../support/db')
const D = require('../../support/data')

const startEvaluation = async (page, passkey) => {
  await page.goto('/evaluation')
  await page.getByPlaceholder('leader@example.com').fill(D.users.carol.email)
  await page.getByPlaceholder('482913').fill(passkey)
  await page.getByRole('button', { name: 'Continue' }).click()
}

test('a wrong passkey does not open the evaluation', async ({ browser }) => {
  const dave = await pageAs(browser, 'dave')
  await startEvaluation(dave, '000000')
  await expect(dave.getByText('Invalid passkey')).toBeVisible()
  await expect(dave.getByRole('heading', { name: 'Peer evaluation' })).toHaveCount(0)
})

test('Dave evaluates Carol, and Carol replies to the feedback', async ({ browser }) => {
  const feedback = 'Clear structure and solid error handling throughout.'

  // ── Dave scores the submission ──
  const dave = await pageAs(browser, 'dave')
  await startEvaluation(dave, D.PASSKEY)
  await expect(dave.getByRole('heading', { name: 'Peer evaluation' })).toBeVisible()
  await expect(dave.getByText('carol-group')).toBeVisible()

  const submit = dave.getByRole('button', { name: 'Submit evaluation' })
  await expect(submit, 'disabled until written feedback is given').toBeDisabled()
  await dave.getByRole('slider').fill('45')
  await dave.getByRole('button', { name: /^Yes/ }).click()
  await dave.getByPlaceholder('Describe what was done well and what could be improved...').fill(feedback)
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect.poll(async () =>
    (await db().evalAssignment.findUnique({ where: { id: seeded().evalAssignment } })).status,
  ).toBe('Submitted')
  const response = await db().evalResponse.findFirst({ where: { userId: seeded().users.dave } })
  expect(response).toMatchObject({ givenMarks: 85, comment: feedback })   // 45 + 40

  // ── Carol reads it and replies ──
  const carol = await pageAs(browser, 'carol')
  await carol.goto(`/assignment-detail?assId=${seeded().assignments.peer}`)
  await expect(carol.getByText(feedback)).toBeVisible()
  await carol.getByPlaceholder('Reply to this feedback...').fill('Thanks, Dave — fixed the edge case you spotted.')
  await carol.getByRole('button', { name: 'Reply' }).click()
  await expect(carol.getByText('Thanks, Dave — fixed the edge case you spotted.')).toBeVisible()

  // Replying is what triggers the final grade.
  await expect.poll(async () =>
    (await db().submission.findFirst({ where: { groupId: seeded().groups.carol } })).finalScore,
  ).toBe(85)
})
