// Signing in, signing up, and signing out — as a visitor with no session.
// Registration is by invitation only: staff whitelist an address and send an
// invitation email; its one-time link opens the sign-up form. A forgotten
// password is reset through an emailed link. In e2e, email goes to the JSON mail
// sink (support/mail.js) and the tests follow the links from there.
const { test, expect } = require('@playwright/test')
const { signIn } = require('../../support/ui')
const { sessionFile, seeded } = require('../../support/sessions')
const { mailedLink, sendInvitation } = require('../../support/mail')
const { db } = require('../../support/db')
const { srcRequire } = require('../../support/env')
const D = require('../../support/data')

test.describe('signing in', () => {
  test('a student lands on their dashboard', async ({ page }) => {
    await signIn(page, D.users.alice.email, D.PASSWORD)
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('heading', { name: 'Welcome back, alice' })).toBeVisible()
  })

  test('staff land on the Bocal panel', async ({ page }) => {
    await signIn(page, D.users.bocal.email, D.PASSWORD)
    await expect(page).toHaveURL(/\/bocal\/dashboard$/)
    await expect(page.getByRole('heading', { name: `Welcome back, ${D.users.bocal.username}` })).toBeVisible()
  })

  test('a wrong password is refused', async ({ page }) => {
    await signIn(page, D.users.alice.email, 'not-the-password')
    await expect(page.getByText('Invalid credentials')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('visitors are sent to sign in from protected pages', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('signing up', () => {
  test('an invited address registers through the emailed link and signs in immediately', async ({ page, browser }) => {
    const link = await sendInvitation(D.invite.email)
    await page.goto(link)
    // The link fixes the address; nobody can sign up under another one.
    await expect(page.locator('input[type=email]')).toHaveValue(D.invite.email)
    await expect(page.locator('input[type=email]')).toHaveAttribute('readonly', '')
    await page.locator('input[type=password]').nth(0).fill(D.invite.password)
    await page.locator('input[type=password]').nth(1).fill(D.invite.password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText(/Registration successful/)).toBeVisible()

    // No verification step — the account is active right away.
    await signIn(page, D.invite.email, D.invite.password)
    await expect(page).toHaveURL(/\/dashboard$/)

    // The link worked once and is now spent (checked as a visitor: signed-in
    // users are sent to their dashboard instead).
    const visitor = await browser.newPage({ ignoreHTTPSErrors: true })
    await visitor.goto(link)
    await expect(visitor.getByText(/invitation link is invalid or has expired/)).toBeVisible()
    await visitor.close()
  })

  test('without an invitation link there is no sign-up form', async ({ page }) => {
    await page.goto('/register')
    await expect(page.getByText(/available by invitation only/)).toBeVisible()
    await expect(page.locator('input[type=password]')).toHaveCount(0)
  })

  test('a made-up invitation link is refused', async ({ page }) => {
    await page.goto('/register?token=not-a-real-invitation-token')
    await expect(page.getByText(/invitation link is invalid or has expired/)).toBeVisible()
    await expect(page.locator('input[type=password]')).toHaveCount(0)
  })
})

test.describe('forgotten password', () => {
  test('the login page offers no OAuth, and a password is reset through the emailed link', async ({ page }) => {
    // Its own account, so other tests keep their known passwords.
    const email = `forgetful-${Date.now()}@e2e.test`
    const bcrypt = srcRequire('bcrypt')
    await db().user.create({ data: { email, username: `forgetful_${Date.now()}`, role: 'Student', orgId: seeded().orgId,
      userAuth: { create: { provider: 'local', email_verified: true, pass_hash: await bcrypt.hash(D.PASSWORD, 4) } } } })

    await page.goto('/login')
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /GitHub|Google/i })).toHaveCount(0)
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Send password reset link' }).click()

    const newPassword = 'Reset-Passw0rd!42'
    await expect.poll(() => { try { return mailedLink(email, '/reset-password') } catch { return null } }).toBeTruthy()
    await page.goto(mailedLink(email, '/reset-password'))
    await page.getByLabel('New password', { exact: true }).fill(newPassword)
    await page.getByLabel('Confirm new password').fill(newPassword)
    await page.getByRole('button', { name: 'Set new password' }).click()
    await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible()

    await signIn(page, email, newPassword)
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})

test.describe('admin password reset', () => {
  test.use({ storageState: sessionFile('admin') })

  test('an admin resets a member and the new password works', async ({ page }) => {
    page.on('dialog', (d) => d.accept())   // "Reset the password for …?"
    await page.goto(`/admin/org/${require('../../support/sessions').seeded().orgId}`)

    const row = page.locator('div')
      .filter({ has: page.getByText(D.users.carol.email, { exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'Reset password' }) })
      .last()
    await row.getByRole('button', { name: 'Reset password' }).click()

    const banner = page.getByText(/New password for/)
    await expect(banner).toBeVisible()
    const temp = (await banner.locator('code').textContent())?.trim()
    expect(temp, 'a generated password is shown').toBeTruthy()

    // The new password works (login is public, so page.request needs no auth).
    const res = await page.request.post('/api/auth/login', {
      data: { email: D.users.carol.email, password: temp },
    })
    expect((await res.json()).accessToken, 'temp password logs in').toBeTruthy()
  })
})

test.describe('signing out', () => {
  test.use({ storageState: sessionFile('bob') })

  test('ends the session and protects pages again', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: 'Welcome back, bob' })).toBeVisible()
    await page.getByText('Sign out').click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })
})
