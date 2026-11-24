// Teacher downloads: the CSV sheet, the bulk ZIP, and the staff bypass on the
// per-submission download. Pins the staff-only gate and the response shapes so a
// later change can't quietly reopen them or corrupt the archive.
const { test, expect, expectError } = require('../../support/api')
const { seeded } = require('../../support/sessions')

const EXPECTED_CSV_HEADER =
  'evalueeGroup,round,evaluatorUsername,evaluatorEmail,isStaffReview,' +
  'Functionality,Code quality,totalGivenMarks,maxScore,comment,reply,replied,recordingFileName,' +
  // One row per pairing attempt, so retries and cancelled pairings stay traceable.
  'evalAssignmentId,attempt,status,outcome,createdAt,retryRequestedAt,evalResponseId'

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

// The browser downloads the ZIP natively (no Bearer header possible), so staff
// first trade their session for a single-use, short-lived ticket.
test.describe('bulk ZIP via download ticket', () => {
  const ticketPath = () => `export/assignment/${seeded().assignments.peer}/archive-ticket`

  test('only staff can obtain a ticket', async ({ api }) => {
    await expectError(await (await api('alice')).post(ticketPath(), { data: {} }), 403)
    await expectError(await (await api('anon')).post(ticketPath(), { data: {} }), 401)
  })

  test('the ticket alone downloads the ZIP exactly once', async ({ api }) => {
    const grant = await (await (await api('bocal')).post(ticketPath(), { data: { recordings: false } })).json()
    expect(grant).toMatchObject({ ok: true, includeRecordings: false, recordings: 0 })
    expect(grant.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(typeof grant.totalBytes).toBe('number')

    // No Authorization header: the ticket is the credential.
    const anon = await api('anon')
    const res = await anon.get(`export/archive/${grant.ticket}`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/zip')
    expect(res.headers()['content-disposition']).toContain('.zip')
    const text = (await res.body()).toString('latin1')
    expect(text.slice(0, 2)).toBe('PK')
    expect(text).toContain('recordings excluded by request')

    const reused = await anon.get(`export/archive/${grant.ticket}`)
    expect(reused.status()).toBe(410)
    expect(reused.headers()['content-disposition']).toBeUndefined()
    expect((await anon.get('export/archive/made-up-ticket')).status()).toBe(410)
  })

  test('an unknown assignment fails on the ticket call, not inside a download', async ({ api }) => {
    await expectError(await (await api('bocal')).post('export/assignment/999999/archive-ticket', { data: {} }), 404)
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
