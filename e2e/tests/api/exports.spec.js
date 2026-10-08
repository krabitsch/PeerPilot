// Teacher downloads: the CSV sheet, the bulk ZIP, and the staff bypass on the
// per-submission download. Pins the staff-only gate and the response shapes so a
// later change can't quietly reopen them or corrupt the archive.
const { test, expect, expectError } = require('../../support/api')
const { seeded } = require('../../support/sessions')

const EXPECTED_CSV_HEADER =
  'evalueeGroup,round,evaluatorUsername,evaluatorEmail,isStaffReview,' +
  'Functionality,Code quality,totalGivenMarks,maxScore,comment,reply,replied,recordingFileName'

test.describe('export endpoints are staff-only', () => {
  const paths = () => {
    const { assignments } = seeded()
    return [
      `export/assignment/${assignments.peer}/evaluations.csv`,
      `export/assignment/${assignments.peer}/archive`,
    ]
  }

  test('a student is refused', async ({ api }) => {
    const alice = await api('alice')
    for (const path of paths()) {
      await test.step(`GET ${path}`, async () => {
        await expectError(await alice.get(path), 403)
      })
    }
  })

  test('an anonymous caller is refused', async ({ api }) => {
    const anon = await api('anon')
    for (const path of paths()) {
      await test.step(`GET ${path}`, async () => {
        await expectError(await anon.get(path), 401)
      })
    }
  })
})

test.describe('evaluations CSV', () => {
  test('staff get a CSV with the expected header', async ({ api }) => {
    const { assignments } = seeded()
    const res = await (await api('bocal')).get(`export/assignment/${assignments.peer}/evaluations.csv`)

    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/csv')
    expect(res.headers()['content-disposition']).toContain('attachment')
    expect(res.headers()['content-disposition']).toContain('.csv')

    const firstLine = (await res.text()).split(/\r?\n/)[0]
    expect(firstLine).toBe(EXPECTED_CSV_HEADER)
  })
})

test.describe('bulk ZIP archive', () => {
  test('staff get a ZIP holding the CSV and manifest', async ({ api }) => {
    const { assignments } = seeded()
    const res = await (await api('bocal')).get(`export/assignment/${assignments.peer}/archive`)

    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/zip')
    expect(res.headers()['content-disposition']).toContain('.zip')

    const buf = await res.body()
    // ZIP local-file-header magic.
    expect(buf.slice(0, 2).toString('latin1')).toBe('PK')
    // store mode keeps entry names (and stored text) in the clear.
    const text = buf.toString('latin1')
    expect(text).toContain('evaluations.csv')
    expect(text).toContain('MANIFEST.txt')
  })

  test('recordings=0 excludes the audio and says so in the manifest', async ({ api }) => {
    const { assignments } = seeded()
    const res = await (await api('bocal')).get(`export/assignment/${assignments.peer}/archive?recordings=0`)

    expect(res.status()).toBe(200)
    const text = (await res.body()).toString('latin1')
    expect(text).toContain('recordings excluded by request')
  })
})

test.describe('per-submission download: staff bypass', () => {
  // Staff may download any group's submission; a non-member student may not.
  // Carol's seeded submission has no file, so staff reach the file lookup and
  // get "File not found" — proof they passed the membership gate a student
  // can't. The student is stopped earlier, before any file lookup.
  test('staff pass the membership gate; a non-member student does not', async ({ api }) => {
    const { groups } = seeded()
    const path = `submission/${groups.carol}/file/download`

    const staffBody = await expectError(await (await api('bocal')).get(path), 404)
    expect(staffBody.error).toBe('File not found')

    const studentBody = await (await api('alice')).get(path).then(r => r.json())
    expect(studentBody.ok).toBe(false)
    expect(studentBody.error, 'student must be blocked before the file lookup').not.toBe('File not found')
  })
})
