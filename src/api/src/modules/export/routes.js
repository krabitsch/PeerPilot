const express = require('express')
const archiver = require('archiver')
const route = express.Router()
const service = require('./service')
const logger = require('@transcendence/logger')
const { prisma } = require('@transcendence/database')
const { requireStaff, STAFF_ROLES } = require('../../middleware/authenticate')
const { archiveTickets } = require('./tickets')

// Teacher-facing bulk exports. All staff-only: these expose every group's work
// and the private evaluation recordings, so they sit behind requireStaff and
// are never handed out as unauthenticated links. The one URL-borne credential
// is the single-use, 60-second archive ticket (see tickets.js).

// Evaluations as a CSV sheet (one row per evaluation).
route.get('/assignment/:id/evaluations.csv', requireStaff, async (req, res, next) => {
    try {
        const { csv, filenameBase } = await service.buildEvaluationsCsv(req.params.id)
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-evaluations.csv"`)
        res.send(csv)
    } catch (err) { next(err) }
})

// Pipes a validated plan into a ZIP on `res`.
//
// MinIO objects are opened lazily, one at a time: entry k+1 is opened only
// after archiver reports entry k fully written. Opening them all up front left
// dozens of idle MinIO sockets waiting their turn, and those got dropped on
// large assignments, truncating the download. Backpressure from the client
// propagates through archiver to the one open object, so memory stays flat.
//
// Headers are committed before the first byte, so after that a failure can
// only tear the socket down — the browser then reports the download as failed.
const streamArchive = async (plan, res, { label = '' } = {}) => {
    const root = `peerofessor-${service.sanitize(plan.filenameBase).replace(/\s+/g, '-')}`
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${root}.zip"`)
    res.setHeader('Cache-Control', 'no-store')

    // store: no recompression — audio and zipped submissions don't shrink,
    // and it keeps CPU off the critical path for large archives.
    const archive = archiver('zip', { store: true })
    let stopped = null   // first fatal reason; once set, nothing more is opened
    let source = null    // the single MinIO stream currently being archived
    let waiting = null   // { resolve, reject } for the entry being written

    const stop = (err, { clientGone = false } = {}) => {
        if (stopped) return
        stopped = err
        source?.destroy()
        archive.abort()
        waiting?.reject(err)
        if (clientGone) logger.info('export', 'Archive download cancelled by client', { label })
        else { logger.error('export', 'Archive failed mid-stream', { label, message: err.message }); res.destroy(err) }
    }

    archive.on('entry', () => waiting?.resolve())
    archive.on('error', (err) => stop(err))
    // A missing/slow object shouldn't abort the whole archive.
    archive.on('warning', (err) => logger.error('export', 'Archive warning', { label, message: err.message }))
    res.on('close', () => { if (!res.writableFinished) stop(new Error('Client closed the connection'), { clientGone: true }) })

    // Appends one entry and resolves once archiver has fully written it.
    const add = (data, name) => new Promise((resolve, reject) => {
        if (stopped) return reject(stopped)
        waiting = { resolve, reject }
        archive.append(data, { name })
    }).finally(() => { waiting = null })

    archive.pipe(res)
    try {
        await add(plan.csv, `${root}/evaluations.csv`)
        await add(plan.manifest, `${root}/MANIFEST.txt`)

        for (const entry of [...plan.submissionEntries, ...plan.recordingEntries]) {
            if (stopped) break
            try {
                source = await service.openEntryStream(entry)
            } catch (err) {
                // Skip an object that can't be read rather than failing the lot.
                logger.error('export', 'Skipping unreadable object', { label, path: entry.path, message: err.message })
                continue
            }
            if (stopped) { source.destroy(); break }
            // A socket dropped mid-object can't be recovered inside a stored ZIP
            // entry; fail loudly instead of crashing on an unhandled 'error'.
            source.once('error', (err) => stop(err))
            await add(source, `${root}/${entry.path}`)
            source = null
        }
        if (!stopped) await archive.finalize()
    } catch (err) {
        stop(err)
    }
}

const includeRecordingsFrom = (value) => !(value === false || value === '0' || value === 0 || value === 'false')

// Step 1 of the browser download: validate + plan with the caller's Bearer
// token, park the plan under a single-use ticket, and return it. Every
// pre-stream failure (unknown assignment, CSV build error, …) therefore
// surfaces here as normal JSON the page can show, not inside a download.
route.post('/assignment/:id/archive-ticket', requireStaff, async (req, res, next) => {
    try {
        const includeRecordings = includeRecordingsFrom(req.body?.recordings)
        const plan = await service.planArchive(req.params.id, { includeRecordings })
        const { token, expiresAt } = archiveTickets.issue({
            userId: req.user.userId,
            assignmentId: parseInt(req.params.id),
            plan,
        })
        res.json({
            ok: true,
            ticket: token,
            expiresAt,
            totalBytes: plan.totalBytes,
            submissions: plan.submissionEntries.length,
            recordings: plan.recordingEntries.length,
            includeRecordings,
        })
    } catch (err) { next(err) }
})

// Bearer-authenticated variant (API clients, e2e). Same streaming as the
// ticket route; the browser UI uses the ticket so it can download natively.
route.get('/assignment/:id/archive', requireStaff, async (req, res, next) => {
    let plan
    try {
        plan = await service.planArchive(req.params.id, { includeRecordings: includeRecordingsFrom(req.query.recordings) })
    } catch (err) { return next(err) }
    await streamArchive(plan, res, { label: `assignment ${req.params.id}` })
})

// Export failures must remain errors, never downloadable JSON attachments.
const exportErrors = (err, req, res, next) => {
    if (res.headersSent) return next(err)
    res.removeHeader('Content-Disposition')
    const status = err.status || 500
    if (status >= 500) logger.error('export', 'Export request failed', { message: err.message })
    res.status(status).json({ ok: false, code: status,
        error: status >= 500 && process.env.NODE_ENV === 'production' ? 'Could not generate the export.' : err.message })
}
route.use(exportErrors)

// ── Ticket-authenticated download ─────────────────────
// Mounted BEFORE the global `authenticate` (see index.js): the ticket replaces
// the Bearer header for this one route. It answers in plain text because it is
// loaded by a hidden iframe, not by HttpClient; the page reads the text back
// to show the reason.
const ticketed = express.Router()

const refuse = (res, status, message) => {
    res.status(status).type('text/plain; charset=utf-8').set('Cache-Control', 'no-store').send(message)
}

ticketed.get('/archive/:ticket', async (req, res, next) => {
    const grant = archiveTickets.redeem(req.params.ticket)
    if (!grant) {
        return refuse(res, 410, 'This download link has expired or was already used. Please click "Download all (ZIP)" again.')
    }
    try {
        // Same rule as `authenticate`: the role is read now, not trusted from
        // when the ticket was issued.
        const user = await prisma.user.findUnique({ where: { id: grant.userId }, select: { role: true } })
        if (!user || !STAFF_ROLES.includes(user.role)) return refuse(res, 403, 'You are no longer allowed to download this export.')
    } catch (err) { return next(err) }
    await streamArchive(grant.plan, res, { label: `assignment ${grant.assignmentId}` })
})

ticketed.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    logger.error('export', 'Ticket download failed', { message: err.message })
    refuse(res, 500, 'Could not generate the export. Please try again.')
})

module.exports = route
module.exports.ticketed = ticketed
module.exports.streamArchive = streamArchive
