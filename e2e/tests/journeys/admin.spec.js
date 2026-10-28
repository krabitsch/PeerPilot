// An Admin managing organisations and who may register.
const { test, expect } = require('@playwright/test')
const { sessionFile, seeded } = require('../../support/sessions')
const { db } = require('../../support/db')
const D = require('../../support/data')
const { mailedLink } = require('../../support/mail')

test.use({ storageState: sessionFile('admin') })

// Revoking and removing ask "Are you sure?" with confirm().
test.beforeEach(({ page }) => { page.on('dialog', (d) => d.accept()) })

// Regression: adminGuard used to redirect before the session had loaded.
test('opens admin pages directly', async ({ page }) => {
  await page.goto('/admin/orgs')
  await expect(page).toHaveURL(/\/admin\/orgs$/)
  await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible()
  await page.goto(`/admin/org/${seeded().orgId}`)
  await expect(page.getByRole('heading', { name: D.org.name })).toBeVisible()
})

test('creates an organization', async ({ page }) => {
  await page.goto('/admin/orgs')
  await page.getByRole('button', { name: '+ New org' }).click()
  await page.getByPlaceholder('e.g. 42 Paris').fill('Second Campus')
  await page.getByPlaceholder('admin@school.example').fill('office@campus2.e2e.test')
  await page.getByPlaceholder('optional').fill('C2')
  await page.getByPlaceholder('Brief description').fill('Our second site.')
  await page.getByPlaceholder('+33 1 23 45 67 89').fill('+43 1 234 5678')
  await page.getByRole('button', { name: 'Create organization' }).click()

  await expect(page.getByText('office@campus2.e2e.test')).toBeVisible()
  const org = await db().organization.findFirst({ where: { email: 'office@campus2.e2e.test' }, include: { profile: true } })
  expect(org).toMatchObject({ name: 'Second Campus', tag: 'C2' })
  expect(org.profile?.bio).toBe('Our second site.')
})

test('whitelists an email, sends the invitation, then revokes it', async ({ page }) => {
  await page.goto(`/admin/org/${seeded().orgId}`)
  await page.getByPlaceholder('name@example.com').fill('invitee@e2e.test')
  await page.getByRole('button', { name: 'Whitelist email', exact: true }).click()

  // The row is the innermost block holding the email cell and a Revoke button.
  // Anchor on the exact cell text: status messages ("Whitelisted …") contain
  // the address too.
  const row = page.locator('div')
    .filter({ has: page.getByText('invitee@e2e.test', { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Revoke' }) })
    .last()
  await expect(row).toContainText('Not invited')
  expect(await db().authAllowedEmail.findUnique({ where: { email: 'invitee@e2e.test' } })).toMatchObject({ used: false, orgId: seeded().orgId })

  // Whitelisting alone sends nothing; the invitation email carries the sign-up link.
  await row.getByRole('button', { name: 'Send invitation' }).click()
  await expect(row).toContainText('Invitation sent')
  const token = new URLSearchParams(mailedLink('invitee@e2e.test', '/register').split('?')[1]).get('token')
  const validate = () => page.request.post('/api/auth/invitation/validate', { data: { token } }).then((r) => r.json())
  expect(await validate()).toMatchObject({ email: 'invitee@e2e.test' })

  // Revoking removes the address and kills the link that was already sent.
  await row.getByRole('button', { name: 'Revoke' }).click()
  await expect(row).toHaveCount(0)
  await expect.poll(() => db().authAllowedEmail.findUnique({ where: { email: 'invitee@e2e.test' } })).toBeNull()
  expect(await validate()).toMatchObject({ ok: false })
})
