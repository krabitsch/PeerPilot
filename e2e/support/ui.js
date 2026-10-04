// Small UI helpers shared by the journey specs.
const crypto = require('crypto')
const { expect } = require('@playwright/test')
const { sessionFile } = require('./sessions')
const { db } = require('./db')

const signIn = async (page, email, password) => {
  await page.goto('/login')
  await page.getByPlaceholder('you@PeerPilot.school').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

// A page already signed in as `role`, in its own browser context — for
// journeys where two people take turns (an evaluator, then the evaluated).
const pageAs = async (browser, role) => {
  const context = await browser.newContext({ storageState: sessionFile(role) })
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  return page
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

module.exports = { signIn, pageAs, plantVerificationToken, samplePdf, sampleAudioUpload, expect }
