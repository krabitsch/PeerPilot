// A Bocal running a course: classes, assignments with eval sheets, groups.
const { test, expect } = require('@playwright/test')
const { sessionFile, seeded } = require('../../support/sessions')
const { db } = require('../../support/db')
const D = require('../../support/data')

test.use({ storageState: sessionFile('bocal') })

// The bocal panel calls courses "Courses" in the UI; the create form and the
// DB model still say "class". Opening a course's assignments is a card button
// that leads to the Assignments view scoped to that course.
const openAssignments = async (page, courseName) => {
  await page.goto('/bocal/classes')
  await page.getByText(courseName, { exact: true }).first().waitFor()
  await page.getByText(courseName, { exact: true })
    .locator('xpath=ancestor::*[.//button[normalize-space()="Open assignments"]][1]')
    .getByRole('button', { name: 'Open assignments' }).click()
  await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible()
  await expect(page.getByText(`Assignments for ${courseName}`)).toBeVisible()
}

test('creates a course', async ({ page }) => {
  await page.goto('/bocal/classes')
  await page.getByRole('button', { name: '+ New course' }).click()
  const form = page.getByRole('main')
  await form.getByRole('textbox').nth(0).fill('Algorithms')
  await form.getByRole('textbox').nth(1).fill('Sorting, searching and graphs.')
  await page.getByRole('button', { name: 'Create class' }).click()

  await expect(page.getByText('Algorithms')).toBeVisible()
  const created = await db().class.findFirst({ where: { name: 'Algorithms' } })
  expect(created).toMatchObject({ created_by: seeded().users.bocal, org_id: seeded().orgId })
})

test('creates an assignment with an eval sheet that sums to the max score', async ({ page }) => {
  await openAssignments(page, D.classes.web.name)
  await page.getByRole('button', { name: '+ New assignment' }).click()
  await expect(page.getByRole('heading', { name: /New assignment/ })).toBeVisible()

  const main = page.getByRole('main')
  await main.getByRole('textbox').nth(0).fill('Team Project')
  await main.getByRole('textbox').nth(1).fill('Build it together.')
  await main.getByRole('spinbutton').nth(0).fill('100')   // max score
  await main.getByRole('spinbutton').nth(1).fill('2')     // required evaluations
  await main.getByRole('spinbutton').nth(2).fill('60')    // pass threshold

  await page.getByRole('button', { name: /Eval sheet/ }).click()
  for (const [name, marks, type] of [['Works', '70', 'Slider'], ['Tested', '30', 'Toggle']]) {
    await main.getByRole('textbox').nth(0).fill(name)
    await main.getByRole('textbox').nth(1).fill(`${name}?`)
    await main.getByRole('spinbutton').nth(0).fill(marks)
    await main.getByRole('combobox').nth(0).selectOption(type)
    await page.getByRole('button', { name: '+ Add section' }).click()
  }
  await expect(page.getByText('0 pts remaining')).toBeVisible()
  await page.getByRole('button', { name: 'Create assignment' }).click()

  // The page saves in three steps — assignment, then eval sheet, then each
  // section — and returns to the class once all of them have landed.
  await expect(page).toHaveURL(/\/bocal\/classes\?classId=\d+/)
  const load = () => db().assignment.findFirst({
    where: { name: 'Team Project' },
    include: { evalSheet: { include: { sections: true } } },
  })
  await expect.poll(async () => (await load())?.evalSheet?.sections.length).toBe(2)
  const created = await load()
  expect(created).toMatchObject({ classid: seeded().classes.web, max_score: 100, req_eval: 2, pass_threshold: 60 })
  expect(created.evalSheet.sections.map((s) => [s.name, s.marks, s.sectionType]).sort())
    .toEqual([['Tested', 30, 'Toggle'], ['Works', 70, 'Slider']])
})

// Regression: Phase 3 broke this — the group was created as led by the Bocal.
test('creates a group for a student', async ({ page }) => {
  await openAssignments(page, D.classes.web.name)

  // Expand just the Peer Review assignment's groups, so only its
  // "Add single group" is on screen.
  await page.getByText(D.assignments.peer.name, { exact: true })
    .locator('xpath=ancestor::*[.//button[normalize-space()="Manage groups"]][1]')
    .getByRole('button', { name: 'Manage groups' }).click()
  await page.getByRole('button', { name: 'Add single group' }).click()

  // The modal has a student picker (a combobox listing emails) and a group
  // name field; the page also has a course picker, so target the one with
  // student options.
  const studentSelect = page.getByRole('combobox')
    .filter({ has: page.getByRole('option', { name: /bob · / }) })
  await studentSelect.selectOption({ label: 'bob · bob@e2e.test' })
  await page.getByRole('main').getByRole('textbox').first().fill('bob-group')
  await page.getByRole('button', { name: 'Create group' }).click()

  await expect(page.getByText('bob (leader)')).toBeVisible()
  const group = await db().group.findFirst({ where: { name: 'bob-group' } })
  expect(group.leaderId).toBe(seeded().users.bob)
})
