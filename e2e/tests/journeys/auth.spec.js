// Signing in, signing up, and signing out — as a visitor with no session.
const { test, expect } = require('@playwright/test')
const { signIn, plantVerificationToken } = require('../../support/ui')
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
    await expect(page.getByRole('heading', { name: 'Manage classes' })).toBeVisible()
  })

  test('a wrong password is refused', async ({ page }) => {
    await signIn(page, D.users.alice.email, 'not-the-password')
    await expect(page.getByText('Invalid credentials')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('an unverified account is asked to verify first', async ({ page }) => {
    await signIn(page, D.users.unverified.email, D.PASSWORD)
    await expect(page.getByText(/verify your email/i)).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('visitors are sent to sign in from protected pages', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('signing up', () => {
  test('an invited address registers, verifies its email and signs in', async ({ page }) => {
    await page.goto('/register')
    await page.getByPlaceholder('your.invited@email.com').fill(D.invite.email)
    await page.locator('input[type=password]').nth(0).fill(D.invite.password)
    await page.locator('input[type=password]').nth(1).fill(D.invite.password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText(/Registration successful/)).toBeVisible()

    // Can't sign in before verifying.
    await signIn(page, D.invite.email, D.invite.password)
    await expect(page.getByText(/verify your email/i)).toBeVisible()

    const token = await plantVerificationToken(D.invite.email)
    await page.goto(`/verify-email?token=${token}`)
    await expect(page.getByText(/Your email has been verified/)).toBeVisible()

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

  test('a bogus verification link is rejected', async ({ page }) => {
    await page.goto('/verify-email?token=bogus')
    await expect(page.getByText(/Invalid or expired token|Verification failed/)).toBeVisible()
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
