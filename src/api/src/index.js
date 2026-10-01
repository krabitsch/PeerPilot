require('dotenv').config()

const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const helmet = require('helmet')

const logger = require('@transcendence/logger')
const errorHandler = require('./middleware/errorHandler')
const { authenticate } = require('./middleware/authenticate')

const app = express()

// nginx is the only way in, so trust exactly one proxy hop. Express then takes
// the client address from the entry nginx appends to X-Forwarded-For, and
// req.ip is the real client rather than nginx's container. Without this every
// visitor shared one IP, so the auth rate limits were global: ten logins in
// fifteen minutes from anyone locked everyone out. Entries a client forges are
// further left in the header and are ignored.
app.set('trust proxy', 1)

// ── Security / parsing ───────────────────────────────
// Previously these lived only in the auth service; every route gets them now.
app.use(helmet())
app.use(cors({
    origin: process.env.FRONTEND_URL || 'https://localhost',
    credentials: true
}))
app.use(cookieParser())
app.use(express.json())

// ── Health ───────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'api' })
})

// ── Modules ──────────────────────────────────────────
// Mount paths are unchanged from the per-service layout, so nginx only has to
// forward /api/ here and the frontend needs no changes.

// The auth module owns the only endpoints that may be reached without a token
// (login, register, password reset, OAuth callbacks) and applies `authenticate`
// itself on the few of its routes that need it.
app.use('/auth', require('./modules/auth/routes'))

// Everything past this line requires a valid access token. Individual routes
// add role and ownership checks on top; this is the floor, not the ceiling.
app.use(authenticate)

app.use('/user',       require('./modules/user/routes'))
app.use('/org',        require('./modules/org/routes'))
app.use('/class',      require('./modules/class/routes'))
app.use('/enroll',     require('./modules/enroll/routes'))
app.use('/group',      require('./modules/group/routes'))
app.use('/submission', require('./modules/submission/routes'))
app.use('/eval',       require('./modules/eval/routes'))

app.use(errorHandler)

// ── Start ────────────────────────────────────────────
const PORT = process.env.PORT || 3000

// The submission module needs its MinIO bucket before it can serve traffic.
const { storageReady } = require('./modules/submission/service')

const start = async () => {
    await storageReady
    app.listen(PORT, () => {
        logger.info('api', `Running on port ${PORT}`)
    })
}

start().catch(err => {
    logger.error('api', 'Failed to start API', { message: err.message, stack: err.stack })
    process.exit(1)
})
