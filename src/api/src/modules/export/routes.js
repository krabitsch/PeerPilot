const express = require('express')
const archiver = require('archiver')
const route = express.Router()
const service = require('./service')
const logger = require('@transcendence/logger')
const { requireStaff } = require('../../middleware/authenticate')

// Teacher-facing bulk exports. All staff-only: these expose every group's work
// and the private evaluation recordings, so they sit behind requireStaff and
// are never handed out as unauthenticated links.

// Evaluations as a CSV sheet (one row per evaluation).
route.get('/assignment/:id/evaluations.csv', requireStaff, async (req, res, next) => {
    try {
        const { csv, filenameBase } = await service.buildEvaluationsCsv(req.params.id)
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-evaluations.csv"`)
        res.send(csv)
    } catch (err) { next(err) }
})

// Everything for the assignment as one streamed ZIP: submissions, the
// evaluations CSV, and (unless ?recordings=0) the audio recordings.
//
// Validation/gathering happens in planArchive BEFORE any byte is written, so a
// failure there still becomes a normal JSON error. Once the archive is piped we
// can only tear the socket down on error — the response is already committed.
route.get('/assignment/:id/archive', requireStaff, async (req, res, next) => {
    let streaming = false
    try {
        const includeRecordings = req.query.recordings !== '0'
        const plan = await service.planArchive(req.params.id, { includeRecordings })
        const root = service.sanitize(plan.filenameBase)

        res.setHeader('Content-Type', 'application/zip')
        res.setHeader('Content-Disposition', `attachment; filename="${root}.zip"`)

        // store: no recompression — audio and zipped submissions don't shrink,
        // and it keeps CPU off the critical path for large archives.
        const archive = archiver('zip', { store: true })
        archive.on('error', (err) => {
            logger.error('export', 'Archive stream error', { message: err.message })
            res.destroy(err)
        })
        // A missing/slow object shouldn't abort the whole archive.
        archive.on('warning', (err) => {
            logger.error('export', 'Archive warning', { message: err.message })
        })

        streaming = true
        archive.pipe(res)

        archive.append(plan.csv, { name: `${root}/evaluations.csv` })
        archive.append(plan.manifest, { name: `${root}/MANIFEST.txt` })

        for (const entry of [...plan.submissionEntries, ...plan.recordingEntries]) {
            try {
                const stream = await service.openEntryStream(entry)
                archive.append(stream, { name: `${root}/${entry.path}` })
            } catch (err) {
                // Skip an object that can't be read rather than failing the lot.
                logger.error('export', 'Skipping unreadable object', { path: entry.path, message: err.message })
            }
        }

        await archive.finalize()
    } catch (err) {
        if (streaming || res.headersSent) {
            logger.error('export', 'Archive failed mid-stream', { message: err.message })
            res.destroy(err)
        } else {
            next(err)
        }
    }
})

module.exports = route
