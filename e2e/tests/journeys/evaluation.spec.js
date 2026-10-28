// Dave evaluates the project Carol's group submitted, then Carol reads the
// feedback and replies — which completes the grade.
const { test, expect, request } = require('@playwright/test')
const { pageAs, sampleAudioUpload } = require('../../support/ui')
const { seeded, tokenFor } = require('../../support/sessions')
const { db } = require('../../support/db')
const { BASE_URL } = require('../../support/env')
const D = require('../../support/data')

// Fetch the recording-download endpoint as a given role; returns the JSON body.
const fetchRecording = async (role, responseId) => {
  const ctx = await request.newContext({
    baseURL: BASE_URL, ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: `Bearer ${tokenFor(role)}` },
  })
  const res = await ctx.get(`/api/eval/responses/${responseId}/recording`)
  const body = await res.json()
  await ctx.dispose()
  return body
}

const startEvaluation = async (page, passkey) => {
  await page.goto('/evaluation')
  await page.getByRole('button', { name: 'Start evaluation →', exact: true }).click()
  await page.getByPlaceholder('482913').fill(passkey)
  await page.getByRole('button', { name: 'Start evaluation', exact: true }).click()
}

test('a wrong passkey does not open the evaluation', async ({ browser }) => {
  const dave = await pageAs(browser, 'dave')
  await startEvaluation(dave, '000000')
  await expect(dave.getByText('Invalid evaluation passkey')).toBeVisible()
  await expect(dave.getByRole('heading', { name: 'Peer evaluation' })).toHaveCount(0)
})

test('Dave evaluates Carol, and Carol replies to the feedback', async ({ browser }) => {
  // Evaluations need at least 100 characters of feedback.
  const feedback = 'Clear structure and solid error handling throughout. ' +
    'The tests cover the edge cases; naming could be more consistent.'

  // ── Dave scores the submission ──
  const dave = await pageAs(browser, 'dave')
  await startEvaluation(dave, D.PASSKEY)
  await expect(dave.getByRole('heading', { name: 'Peer evaluation' })).toBeVisible()
  await expect(dave.getByText('Evaluate: carol')).toBeVisible()

  const submit = dave.getByRole('button', { name: 'Submit evaluation' })
  await expect(submit, 'disabled until written feedback is given').toBeDisabled()
  await dave.getByRole('slider').fill('45')
  await dave.getByRole('button', { name: /^Yes/ }).click()
  await dave.getByPlaceholder('Describe what was done well and what could be improved...').fill(feedback)

  await expect(dave.locator('input[type=file][accept*="audio"]'), 'the evaluator uploads no recording').toHaveCount(0)
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect.poll(async () =>
    (await db().evalAssignment.findUnique({ where: { id: seeded().evalAssignment } })).status,
  ).toBe('Submitted')
  const response = await db().evalResponse.findFirst({ where: { userId: seeded().users.dave } })
  expect(response).toMatchObject({ givenMarks: 85, comment: feedback })   // 45 + 40
  expect(response.recordingFileId, 'evaluator submits without a recording').toBeNull()

  // ── Carol reads it and replies ──
  const carol = await pageAs(browser, 'carol')
  await carol.goto(`/assignment-detail?assId=${seeded().assignments.peer}`)
  await expect(carol.getByText(feedback)).toBeVisible()
  await carol.getByPlaceholder('Reply to this feedback...').fill('Thanks, Dave — fixed the edge case you spotted.')
  await expect(carol.getByRole('button', { name: 'Reply' })).toBeDisabled()
  await carol.locator('input[id^="reply-recording-"]').setInputFiles(sampleAudioUpload())
  await carol.getByRole('button', { name: 'Reply' }).click()
  await expect(carol.getByText('Thanks, Dave — fixed the edge case you spotted.')).toBeVisible()

  const recorded = await db().evalResponse.findUnique({ where: { id: response.id }, include: { recordingFile: true } })
  expect(recorded.recordingFile.uploadedBy).toBe(seeded().users.carol)

  // The recording is reachable by the evaluator, the evaluated group, and staff,
  // but not by an unrelated student.
  expect((await fetchRecording('dave', response.id)).url, 'evaluator can play it').toBeTruthy()
  expect((await fetchRecording('carol', response.id)).url, 'evaluated group can play it').toBeTruthy()
  expect((await fetchRecording('bocal', response.id)).url, 'staff can play it').toBeTruthy()
  expect((await fetchRecording('bob', response.id)).ok, 'an outsider cannot').toBe(false)

  // The evaluee's reply and recording complete the feedback step.
  await expect.poll(async () =>
    (await db().submission.findFirst({ where: { groupId: seeded().groups.carol } })).finalScore,
  ).toBe(85)
})
