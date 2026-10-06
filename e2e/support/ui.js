// Small UI helpers shared by the journey specs.
const crypto = require('crypto')
const { test, expect, request } = require('@playwright/test')
const { sessionFile } = require('./sessions')
const { BASE_URL } = require('./env')
const { db } = require('./db')

// With VIDEO=1 the journeys that build their own contexts record too (the
// config's `video` option only covers the default `page` fixture). Videos land
// in the running test's output dir, so `make e2e-report` can show them.
const recordVideoOpts = () =>
  process.env.VIDEO ? { recordVideo: { dir: test.info().outputDir } } : {}

const signIn = async (page, email, password) => {
  await page.goto('/login')
  await page.getByPlaceholder('you@PeerPilot.school').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

// A page already signed in as `role`, in its own browser context — for
// journeys where two people take turns (an evaluator, then the evaluated).
const pageAs = async (browser, role) => {
  const context = await browser.newContext({ storageState: sessionFile(role), ...recordVideoOpts() })
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  return page
}

// A browser context already signed in as an account that was created during
// the test (so it has no session saved by global-setup). Logs in through the
// API and injects the token exactly as global-setup does, then opens a page.
const freshContext = async (browser, email, password) => {
  const api = await request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
  const res = await api.post('/api/auth/login', { data: { email, password } })
  const body = await res.json()
  if (!body.accessToken) {
    await api.dispose()
    throw new Error(`Could not log in as ${email}: ${JSON.stringify(body)}`)
  }
  const state = await api.storageState()
  state.origins = [{
    origin: BASE_URL,
    localStorage: [
      { name: 'access_token', value: body.accessToken },
      { name: 'language', value: 'en' },
    ],
  }]
  await api.dispose()
  const context = await browser.newContext({ storageState: state, ignoreHTTPSErrors: true, ...recordVideoOpts() })
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  return { context, page }
}

// Registration emails aren't delivered in the e2e stack, so the test plants a
// verification token it knows and follows the link itself.
const plantVerificationToken = async (email) => {
  const token = crypto.randomBytes(24).toString('hex')
  await db().userAuth.updateMany({
    where: { user: { email } },
    data: {
      verification_token_hash: crypto.createHash('sha256').update(token).digest('hex'),
      verification_token_expiry: new Date(Date.now() + 60 * 60 * 1000),
    },
  })
  return token
}

// A tiny PDF on disk to upload.
const samplePdf = (dir, name = 'report.pdf') => {
  const fs = require('fs')
  fs.mkdirSync(dir, { recursive: true })
  const path = require('path').join(dir, name)
  fs.writeFileSync(path, '%PDF-1.4\n% PeerPilot e2e\n')
  return path
}

// A tiny in-memory audio "file" for the evaluation recording input. The bytes
// don't matter — only that the multipart part carries an allowed audio type.
const sampleAudioUpload = (name = 'evaluation.webm') => ({
  name, mimeType: 'audio/webm', buffer: Buffer.from('fake-evaluation-audio'),
})

module.exports = { signIn, pageAs, freshContext, recordVideoOpts, plantVerificationToken, samplePdf, sampleAudioUpload, expect }
