require('dotenv').config()

const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const helmet = require('helmet')

const logger = require('@transcendence/logger')
const errorHandler = require('./middleware/errorHandler')

const app = express()

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
app.use('/auth',       require('./modules/auth/routes'))
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
