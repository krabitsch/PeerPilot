// A Prisma client bound explicitly to the e2e database. The URL is passed to
// the constructor so no .env file can redirect it somewhere else.
const path = require('path')
const { ROOT, DB_URL } = require('./env')
const { PrismaClient } = require(path.join(ROOT, 'src', 'packages', 'database', 'generated', 'prisma'))

let client
const db = () => (client ??= new PrismaClient({ datasources: { db: { url: DB_URL } } }))

module.exports = { db }
