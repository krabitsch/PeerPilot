// Where the e2e stack lives, and access to the backend's dependencies.
//
// The suite reuses packages already installed for the backend workspace
// (src/node_modules): the generated Prisma client, bcrypt and dotenv. `srcRequire`
// resolves modules from there, so this package only needs Playwright itself.
const path = require('path')
const { createRequire } = require('module')

const ROOT = path.resolve(__dirname, '..', '..')
const srcRequire = createRequire(path.join(ROOT, 'src', 'package.json'))

srcRequire('dotenv').config({ path: path.join(ROOT, 'src', '.env'), quiet: true })

const E2E_DB_PORT = process.env.E2E_DB_PORT || '5434'
const E2E_WEB_PORT = process.env.E2E_WEB_PORT || '8443'

// Built here rather than read from DATABASE_URL on purpose: src/.env points
// DATABASE_URL at the *dev* database, and the seed wipes whatever it connects to.
const DB_URL = `postgresql://${encodeURIComponent(process.env.POSTGRES_USER)}:${encodeURIComponent(process.env.DB_PASSWORD)}`
  + `@localhost:${E2E_DB_PORT}/${process.env.POSTGRES_DB}`

module.exports = {
  ROOT,
  srcRequire,
  DB_URL,
  E2E_DB_PORT,
  BASE_URL: `https://localhost:${E2E_WEB_PORT}`,
}
