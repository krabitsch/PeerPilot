const crypto = require('node:crypto')

// Short-lived, single-use download tickets for the bulk ZIP.
//
// A native browser download (iframe / link) cannot carry the Bearer token, and
// buffering a multi-GB archive through XHR kills the tab. So an authenticated
// staff call trades its token for a ticket that is:
//   - random (256 bits), never derived from the session,
//   - bound to the user who asked and to an already-validated archive plan,
//   - valid for TTL_MS and consumed on first use.
// The ticket is the only credential that ever travels in a URL here.
//
// Kept in process memory: the API runs as a single container. With several
// API replicas this would need a shared store (or sticky routing).
const TTL_MS = 60 * 1000
const MAX_OUTSTANDING = 100

const createTicketStore = ({ ttlMs = TTL_MS, max = MAX_OUTSTANDING, now = Date.now } = {}) => {
    const tickets = new Map()

    const sweep = () => {
        const t = now()
        for (const [token, entry] of tickets) if (entry.expiresAt <= t) tickets.delete(token)
    }

    const issue = (payload) => {
        sweep()
        if (tickets.size >= max) {
            const err = new Error('Too many downloads are being prepared. Please try again in a minute.')
            err.status = 429
            throw err
        }
        const token = crypto.randomBytes(32).toString('base64url')
        const expiresAt = now() + ttlMs
        tickets.set(token, { payload, expiresAt })
        return { token, expiresAt: new Date(expiresAt) }
    }

    // Returns the payload once, or null for unknown / expired / reused tickets.
    const redeem = (token) => {
        if (typeof token !== 'string' || !tickets.has(token)) return null
        const entry = tickets.get(token)
        tickets.delete(token)
        return entry.expiresAt > now() ? entry.payload : null
    }

    return { issue, redeem, size: () => tickets.size }
}

module.exports = { createTicketStore, TTL_MS, archiveTickets: createTicketStore() }
