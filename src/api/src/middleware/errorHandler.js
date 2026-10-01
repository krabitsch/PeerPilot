const logger = require('@transcendence/logger')

const isProd = process.env.NODE_ENV === 'production'

// Single error handler for the whole API. Merged from the eight per-service
// handlers the split architecture used to carry; it is the union of their
// behaviour so the merge stays observable-identical to the frontend.
//
// TODO(phase-2): respond with `status` instead of 200. Every old service
// answered errors with HTTP 200 and an `{ ok: false, code }` body, and the
// frontend's 401 refresh interceptor keys off the real status code, so
// flipping this needs a coordinated frontend change.
module.exports = (err, req, res, next) => {
    const status = err.status || 500

    // Only log real failures. Expected client errors (4xx) are already
    // handled/displayed by the frontend, so they're noise in every environment.
    if (status >= 500) {
        logger.error('api', err.message, { status, path: req.originalUrl, stack: err.stack })
    }

    const message = !isProd || status < 500 ? err.message : 'Something went wrong!'
    const body = { ok: false, error: message, code: status }
    if (err.suggestions) body.suggestions = err.suggestions

    res.status(200).json(body)
}
