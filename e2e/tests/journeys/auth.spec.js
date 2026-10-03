// Signing in, signing up, and signing out — as a visitor with no session.
// This deployment has no mail service: registration auto-verifies and there is
// no emailed verification or password reset (see GOING-LIVE.md).
const { test, expect } = require('@playwright/test')
const { signIn } = require('../../support/ui')
const { sessionFile } = require('../../support/sessions')
const D = require('../../support/data')

test.describe('signing in', () => {
  test('a student lands on their dashboard', async ({ page }) => {
    await signIn(page, D.users.alice.email, D.PASSWORD)
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('heading', { name: 'Welcome back, alice.' })).toBeVisible()
  })

  test('staff land on the Bocal panel', async ({ page }) => {
    await signIn(page, D.users.bocal.email, D.PASSWORD)
    await expect(page).toHaveURL(/\/bocal\/classes$/)
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
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
  test('an invited address registers and signs in immediately', async ({ page }) => {
    await page.goto('/register')
    await page.getByPlaceholder('your.invited@email.com').fill(D.invite.email)
    await page.locator('input[type=password]').nth(0).fill(D.invite.password)
    await page.locator('input[type=password]').nth(1).fill(D.invite.password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText(/Registration successful/)).toBeVisible()

    // No verification step — the account is active right away.
    await signIn(page, D.invite.email, D.invite.password)
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('an address without an invite cannot register', async ({ page }) => {
    await page.goto('/register')
    await page.getByPlaceholder('your.invited@email.com').fill('stranger@e2e.test')
    await page.locator('input[type=password]').nth(0).fill(D.invite.password)
    await page.locator('input[type=password]').nth(1).fill(D.invite.password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('This email has not been invited. Contact an administrator.')).toBeVisible()
  })

  test('the login page offers no OAuth or forgot-password', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /GitHub|Google/i })).toHaveCount(0)
    await expect(page.getByText(/forgot password/i)).toHaveCount(0)
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
    await expect(page.getByRole('heading', { name: 'Welcome back, bob.' })).toBeVisible()
    await page.getByText('Sign out').click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })
})
